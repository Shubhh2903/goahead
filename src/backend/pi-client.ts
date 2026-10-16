import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { access, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { type DynamicRecord, isBoolean, isNumber, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { secretElicitationField } from "./agent/prompts";
import type { AgentClient, DiagnosticOrigin } from "./agent-client";
import { type AgentCliInfo, cliSpawnTarget } from "./cli";
import { type DynamicToolNamespace, LocalMcpBridge, type LocalMcpSession } from "./local-mcp-bridge";
import {
  agentMcpServers,
  claudeMcpServers,
  computerUseParam,
  disabledMcpServersParam,
  type McpAuthorizationSource,
  type McpDropReporter,
  type McpServerSource,
  type McpToolRuntimeSource,
  usableMcpServers,
} from "./mcp-provider-shapes";
import { mcpSecretValues, redactMcpValues } from "./mcp-redaction";
import { PendingServerRequests } from "./pending-server-requests";
import { createPiMcpExtension, type PiMcpExtension } from "./pi-mcp";
import { piMessageItems, piPrompt, piText } from "./pi-messages";
import { PiRpc } from "./pi-rpc";
import type { SpawnTarget } from "./process-confinement";
import {
  type AppServerNotification,
  type AppServerRequest,
  type DynamicToolResult,
  getArray,
  getRecord,
  getString,
  isRecord,
  type RequestId,
  type ResponseDecoder,
  type RpcError,
  type ThreadItem,
} from "./protocol";

export interface PiProviderOptions {
  requestTimeoutMs?: number;
  discoveryCwd?: () => string;
  confine?: (target: SpawnTarget) => SpawnTarget;
  extraEnv?: () => Record<string, string>;
  providerStateDirectory?: string;
  profileGeneration?: boolean;
  mcpServers?: McpServerSource;
  reportMcpDrops?: McpDropReporter;
  mcpToolRuntimes?: McpToolRuntimeSource;
  mcpAuthorization?: McpAuthorizationSource;
}

interface PiTurn {
  id: string;
  startedAt: number;
  messageIndex: number;
  items: Map<string, ThreadItem>;
  stopped: boolean;
  failure: string | null;
  finishing: boolean;
}
interface PiThread {
  id: string;
  cwd: string;
  params: unknown;
  rpc: PiRpc;
  mcp: LocalMcpSession;
  extension: PiMcpExtension;
  turn: PiTurn | null;
  closed: boolean;
  gate: Gate;
}
interface ClientEvents {
  notification: [AppServerNotification];
  request: [AppServerRequest];
  exit: [Error];
  diagnostic: [string, DiagnosticOrigin?];
}

const UI_METHODS = ["confirm", "select", "input", "editor"];

/** Runs one task at a time, in call order. A failed task does not block the next one. */
class Gate {
  #tail: Promise<unknown> = Promise.resolve();
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(task, task);
    this.#tail = result.catch(() => undefined);
    return result;
  }
}

function requiredString(value: unknown, key: string): string {
  const text = getString(value, key);
  if (!text) throw new Error(`Missing ${key}.`);
  return text;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Owns Pi's native sessions. The database owns OpenBot history and agent identity. */
export class PiAgentClient extends EventEmitter<ClientEvents> implements AgentClient {
  readonly provider = "pi";
  readonly #bridge = new LocalMcpBridge();
  readonly #requests = new PendingServerRequests((request) => this.emit("request", request));
  readonly #threads = new Map<string, PiThread>();
  readonly #released = new Map<string, unknown>();
  readonly #secrets = new Set<string>();
  readonly #opening = new Gate();
  #running = false;
  constructor(
    private readonly cli: AgentCliInfo,
    private readonly options: PiProviderOptions,
  ) {
    super();
  }
  get running(): boolean {
    return this.#running;
  }
  start(): void {
    this.#running = true;
  }
  notify(): void {
    /* Pi has no post-initialize notification. */
  }
  respond(id: RequestId, value: unknown): void {
    this.#requests.resolve(id, value);
  }
  respondError(id: RequestId, error: RpcError): void {
    this.#requests.reject(id, error);
  }

  #redact = (text: string): string => {
    const values = [...this.#secrets, ...mcpSecretValues(this.options.mcpServers?.() ?? [])];
    return redactMcpValues(
      redactText(text),
      values.flatMap((value) => [value, JSON.stringify(value).slice(1, -1)]),
    );
  };

  async stop(): Promise<void> {
    this.#running = false;
    this.#requests.rejectAll(sourceText("error.provider.piStopped"));
    const threads = [...this.#threads.values()];
    this.#threads.clear();
    this.#released.clear();
    await Promise.allSettled(threads.map((thread) => this.#close(thread)));
    await this.#bridge.close();
  }

  async #close(thread: PiThread): Promise<void> {
    thread.closed = true;
    await thread.rpc.stop();
    thread.mcp.close();
    await thread.extension.close();
  }

  async releaseThread(id: string): Promise<void> {
    const thread = this.#threads.get(id);
    if (!thread) {
      this.#released.delete(id);
      return;
    }
    if (thread.turn) throw new Error(sourceText("error.provider.piSessionBusy"));
    this.#threads.delete(id);
    this.#released.delete(id);
    await this.#close(thread);
  }

  releaseIdleThreads(): void {
    for (const [id, thread] of this.#threads) {
      if (thread.turn) continue;
      this.#released.set(id, thread.params);
      this.#threads.delete(id);
      this.#background(this.#close(thread));
    }
  }

  async request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>, timeoutMs?: number): Promise<T> {
    if (!this.running) throw new Error(sourceText("error.provider.piStopped"));
    let response: unknown;
    switch (method) {
      case "initialize":
        response = {};
        break;
      case "account/rateLimits/read":
        response = { rateLimits: null, rateLimitsByLimitId: null };
        break;
      case "plugin/list":
        response = { marketplaces: [] };
        break;
      case "account/read": {
        const models = await this.#models(timeoutMs);
        response = { account: models.length ? { type: "pi", email: null } : null, requiresOpenaiAuth: false };
        break;
      }
      case "model/list":
        response = { data: await this.#models(timeoutMs) };
        break;
      case "thread/start":
      case "thread/resume": {
        const thread = await this.#opening.run(() => this.#open(params, method === "thread/resume"));
        response = { thread: { id: thread.id } };
        break;
      }
      case "thread/read": {
        const id = requiredString(params, "threadId");
        const thread = await this.#thread(id, params);
        const turns = isRecord(params) && params.includeTurns === true ? await this.#history(thread) : [];
        response = { thread: { id, turns } };
        break;
      }
      case "turn/start":
      case "turn/steer": {
        const id = requiredString(params, "threadId");
        const thread = await this.#thread(id, params);
        response = await thread.gate.run(() => this.#prompt(thread, params, method === "turn/steer"));
        break;
      }
      case "turn/interrupt": {
        const id = requiredString(params, "threadId");
        const thread = this.#threads.get(id);
        if (thread?.turn) {
          thread.turn.stopped = true;
          await thread.rpc.request({ type: "clear_queue" });
          await thread.rpc.request({ type: "abort" });
        }
        response = {};
        break;
      }
      case "thread/compact/start": {
        const id = requiredString(params, "threadId");
        const thread = await this.#thread(id, params);
        await thread.gate.run(() => thread.rpc.request({ type: "compact" }, timeoutMs ?? 120_000));
        response = {};
        break;
      }
      default:
        throw new Error(`Pi adapter does not implement ${method}.`);
    }
    return decoder(response);
  }

  async #models(timeoutMs?: number): Promise<DynamicRecord[]> {
    const rpc = new PiRpc(this.#redact);
    rpc.on("diagnostic", (text) => this.emit("diagnostic", text));
    rpc.on("record", (record) => {
      if (record.type === "extension_ui_request" && isString(record.id) && UI_METHODS.includes(String(record.method)))
        rpc.send({ type: "extension_ui_response", id: record.id, cancelled: true });
    });
    this.#spawn(rpc, this.options.discoveryCwd?.() ?? process.cwd(), ["--no-session", "--no-tools"], {});
    try {
      const state = await rpc.request({ type: "get_state" }, timeoutMs);
      const listed = await rpc.request({ type: "get_available_models" }, timeoutMs);
      const models: DynamicRecord[] = [];
      for (const model of getArray(listed, "models")) {
        const provider = getString(model, "provider");
        const id = getString(model, "id");
        if (!provider || !id) continue;
        const reasoning = isRecord(model) && model.reasoning === true;
        let levels: string[] = [];
        if (reasoning) {
          await rpc.request({ type: "set_model", provider, modelId: id }, timeoutMs);
          const advertised = await rpc.request({ type: "get_available_thinking_levels" }, timeoutMs);
          levels = getArray(advertised, "levels")
            .filter(isString)
            .map((level) => (level === "off" ? "none" : level));
        }
        const preferred = getString(state, "thinkingLevel");
        models.push({
          model: `${provider}/${id}`,
          displayName: getString(model, "name") ?? id,
          defaultReasoningEffort: preferred && levels.includes(preferred) ? preferred : (levels[0] ?? "none"),
          supportedReasoningEfforts: levels.map((reasoningEffort) => ({ reasoningEffort })),
          reasoningEffortConfigurable: levels.length > 0,
        });
      }
      return models;
    } finally {
      await rpc.stop().catch(() => undefined);
    }
  }

  #spawn(rpc: PiRpc, cwd: string, args: string[], environment: Record<string, string>): void {
    const extra = this.options.extraEnv?.() ?? {};
    for (const value of Object.values(extra)) if (value) this.#secrets.add(value);
    const target = cliSpawnTarget(this.cli.executable, ["--mode", "rpc", ...args]);
    rpc.start(this.options.confine?.(target) ?? target, cwd, { ...process.env, ...extra, ...environment });
  }

  async #open(params: unknown, resume: boolean): Promise<PiThread> {
    const requestedId = getString(params, "threadId");
    if (resume && requestedId) {
      const live = this.#threads.get(requestedId);
      if (live) return live;
      if (!isAbsolute(requestedId)) throw new Error(sourceText("error.provider.piSessionMissing"));
      try {
        await access(requestedId);
      } catch {
        throw new Error(sourceText("error.provider.piSessionMissing"));
      }
    }
    const cwd = requiredString(params, "cwd");
    let thread: PiThread | null = null;
    let extension: PiMcpExtension | null = null;
    const rpc = new PiRpc(this.#redact);
    let retained = false;
    const mcp = await this.#bridge.createSession(
      requestedId ?? randomUUID(),
      getArray(params, "dynamicTools").filter(isNamespace),
      () => thread?.turn?.id ?? null,
      (call, signal) => this.#callTool(call, signal),
    );
    try {
      const handoff = claudeMcpServers(
        await usableMcpServers(
          agentMcpServers(this.options.mcpServers?.() ?? [], computerUseParam(params), disabledMcpServersParam(params)),
          this.options.mcpToolRuntimes?.(),
          this.options.mcpAuthorization,
        ),
      );
      this.options.reportMcpDrops?.("pi", handoff.dropped);
      extension = await createPiMcpExtension(handoff.servers, mcp, this.options.providerStateDirectory);
      for (const secret of extension.secrets) this.#secrets.add(secret);
      rpc.on("diagnostic", (text) => this.emit("diagnostic", text, { duringStop: thread?.closed ?? false }));
      rpc.on("record", (record) => {
        if (thread && !thread.closed) this.#record(thread, record);
        else if (
          record.type === "extension_ui_request" &&
          isString(record.id) &&
          UI_METHODS.includes(String(record.method))
        )
          rpc.send({ type: "extension_ui_response", id: record.id, cancelled: true });
      });
      rpc.on("exit", (error) => {
        if (thread?.closed) return;
        if (thread?.turn) this.#background(this.#finish(thread, "failed", error.message));
        this.emit("exit", error);
      });
      const args = this.options.profileGeneration
        ? ["--no-tools", "--no-extensions", "--no-mcp"]
        : ["--extension", extension.path];
      const instructions = getString(params, "developerInstructions");
      if (instructions) args.push("--append-system-prompt", instructions);
      this.#spawn(rpc, cwd, args, extension.environment);
      if (resume && requestedId) {
        const loaded = await rpc.request({ type: "switch_session", sessionPath: requestedId });
        if (loaded.cancelled === true) throw new Error(sourceText("error.provider.piResumeCancelled"));
      }
      const state = await rpc.request({ type: "get_state" });
      const id = getString(state, "sessionFile");
      if (!id || (resume && id !== requestedId)) throw new Error(sourceText("error.provider.piSessionIdentity"));
      if (!resume) {
        // Pi normally delays its first file write until a user message. Create an exclusive empty
        // file now, so idle release and restart can resume an empty thread.
        let created = false;
        try {
          await writeFile(id, "", { flag: "wx", mode: 0o600 });
          created = true;
        } catch (cause) {
          if (!(cause instanceof Error && "code" in cause && cause.code === "EEXIST")) throw cause;
        }
        if (created) {
          const loaded = await rpc.request({ type: "switch_session", sessionPath: id });
          const persisted = await rpc.request({ type: "get_state" });
          if (loaded.cancelled === true || getString(persisted, "sessionFile") !== id)
            throw new Error(sourceText("error.provider.piResumeCancelled"));
        }
      }
      mcp.setThreadId(id);
      const opened: PiThread = {
        id,
        cwd,
        params,
        rpc,
        mcp,
        extension,
        turn: null,
        closed: false,
        gate: new Gate(),
      };
      thread = opened;
      await this.#configure(opened, params);
      this.#threads.set(id, opened);
      this.#released.delete(id);
      retained = true;
      return opened;
    } finally {
      if (!retained) {
        await rpc.stop().catch(() => undefined);
        mcp.close();
        await extension?.close().catch(() => undefined);
      }
    }
  }

  async #thread(id: string, params: unknown): Promise<PiThread> {
    const existing = this.#threads.get(id);
    if (existing) return existing;
    const saved = this.#released.get(id);
    return this.#opening.run(() =>
      this.#open({ ...(isRecord(saved) ? saved : {}), ...(isRecord(params) ? params : {}), threadId: id }, true),
    );
  }

  async #configure(thread: PiThread, params: unknown): Promise<void> {
    const model = getString(params, "model");
    if (model) {
      const separator = model.indexOf("/");
      if (separator < 1) throw new Error(sourceText("error.provider.piModelInvalid"));
      await thread.rpc.request({
        type: "set_model",
        provider: model.slice(0, separator),
        modelId: model.slice(separator + 1),
      });
    }
    const effort = getString(params, "effort") ?? getString(params, "reasoningEffort");
    if (effort) await thread.rpc.request({ type: "set_thinking_level", level: effort === "none" ? "off" : effort });
  }

  async #prompt(thread: PiThread, params: unknown, steer: boolean): Promise<DynamicRecord> {
    if (thread.turn && !steer) throw new Error(sourceText("error.provider.piSessionBusy"));
    if (!thread.turn) await this.#configure(thread, params);
    const prompt = await piPrompt(params);
    const active = thread.turn;
    const turn: PiTurn = active ?? {
      id: getString(params, "clientUserMessageId") ?? randomUUID(),
      startedAt: Date.now() / 1_000,
      messageIndex: 0,
      items: new Map(),
      stopped: false,
      failure: null,
      finishing: false,
    };
    const userId = `${turn.id}:user:${randomUUID()}`;
    turn.items.set(userId, {
      id: userId,
      type: "userMessage",
      content: [{ type: "text", text: this.#redact(prompt.message) }],
    });
    if (!active) {
      thread.turn = turn;
      this.#notify("turn/started", thread, { turn: { id: turn.id, status: "inProgress" } });
    }
    // Not awaited: a successful `prompt` response only accepts the prompt, and `agent_settled`
    // completes the turn. A completed event can arrive before the acknowledgement.
    this.#background(
      thread.rpc
        .request(
          { type: "prompt", ...prompt, ...(steer ? { streamingBehavior: "steer" } : {}) },
          this.options.requestTimeoutMs,
        )
        .then(
          async (response) => {
            if (response.disposition === "handled" && thread.turn === turn) await this.#finish(thread, "completed");
          },
          async (failure: unknown) => {
            if (thread.turn === turn) await this.#finish(thread, "failed", this.#redact(errorMessage(failure)));
          },
        ),
    );
    return { turn: { id: turn.id, status: "inProgress" }, turnId: turn.id };
  }

  #notify(method: string, thread: PiThread, params: DynamicRecord): void {
    // Usage contains only validated numeric counters. Generic secret-name matching masks `*Tokens`.
    const safe = method === "openbot/usage" ? params : JSON.parse(this.#redact(JSON.stringify(params)));
    this.emit("notification", {
      method,
      params: {
        threadId: thread.id,
        ...(thread.turn ? { turnId: thread.turn.id } : {}),
        ...(isRecord(safe) ? safe : {}),
      },
    });
  }

  #background(task: Promise<void>): void {
    task.catch((failure: unknown) => this.emit("diagnostic", this.#redact(errorMessage(failure))));
  }

  #record(thread: PiThread, record: DynamicRecord): void {
    if (record.type === "extension_ui_request") {
      this.#background(this.#ui(thread, record));
      return;
    }
    const turn = thread.turn;
    if (!turn || turn.finishing) return;
    if (record.type === "agent_settled") {
      this.#background(
        this.#finish(
          thread,
          turn.stopped ? "interrupted" : turn.failure ? "failed" : "completed",
          turn.failure ?? undefined,
        ),
      );
    } else if (record.type === "message_update") {
      const update = getRecord(record, "assistantMessageEvent");
      const kind = getString(update, "type");
      if (kind !== "text_delta" && kind !== "thinking_delta") return;
      const delta = getString(update, "delta") ?? "";
      const index = isRecord(update) && typeof update.contentIndex === "number" ? update.contentIndex : 0;
      const id = `${turn.id}:message:${turn.messageIndex}:${kind === "text_delta" ? "text" : "thinking"}:${index}`;
      const item = turn.items.get(id) ?? { id, type: kind === "text_delta" ? "agentMessage" : "reasoning", text: "" };
      if (!turn.items.has(id)) this.#notify("item/started", thread, { item });
      item.text = (item.text ?? "") + delta;
      turn.items.set(id, item);
      this.#notify(kind === "text_delta" ? "item/agentMessage/delta" : "item/reasoning/summaryTextDelta", thread, {
        itemId: id,
        delta,
        summaryIndex: 0,
      });
    } else if (record.type === "message_end") {
      const message = getRecord(record, "message");
      if (getString(message, "role") !== "assistant") return;
      const id = `${turn.id}:message:${turn.messageIndex++}`;
      for (const key of turn.items.keys()) if (key.startsWith(`${id}:`)) turn.items.delete(key);
      for (const item of piMessageItems(message, id)) {
        if (item.id) turn.items.set(item.id, item);
        this.#notify("item/completed", thread, { item });
      }
      const stop = getString(message, "stopReason");
      turn.failure =
        stop === "error" ? this.#redact(getString(message, "errorMessage") ?? "Pi model request failed.") : null;
      if (stop === "aborted") turn.stopped = true;
    } else if (record.type === "tool_execution_start" || record.type === "tool_execution_end") {
      const id = getString(record, "toolCallId");
      if (!id) return;
      const done = record.type === "tool_execution_end";
      const item: ThreadItem = {
        ...turn.items.get(id),
        id,
        type: "dynamicToolCall",
        tool: getString(record, "toolName"),
        arguments: record.args ?? turn.items.get(id)?.arguments,
        status: done ? (record.isError === true ? "failed" : "completed") : "inProgress",
        ...(done ? { contentItems: [{ type: "inputText", text: piText(getRecord(record, "result")?.content) }] } : {}),
      };
      turn.items.set(id, item);
      this.#notify(done ? "item/completed" : "item/started", thread, { item });
    }
  }

  async #finish(thread: PiThread, status: string, failure?: string): Promise<void> {
    const turn = thread.turn;
    if (!turn || turn.finishing) return;
    turn.finishing = true;
    if (failure) this.#notify("error", thread, { error: { message: this.#redact(failure) }, willRetry: false });
    // Native totals survive process release/resume. Per-message usage is not a cumulative counter.
    // A crashed host cannot answer telemetry; it must not block completion.
    const usage = await thread.rpc
      .request({ type: "get_session_stats" }, 2_000)
      .then(sessionUsage)
      .catch(() => null);
    if (usage) this.#notify("openbot/usage", thread, { usage });
    this.#notify("turn/completed", thread, { turn: { id: turn.id, status } });
    if (thread.turn === turn) thread.turn = null;
  }

  async #ui(thread: PiThread, record: DynamicRecord): Promise<void> {
    const id = getString(record, "id");
    const method = getString(record, "method");
    if (!id || !method || !UI_METHODS.includes(method)) return;
    if (this.options.profileGeneration) {
      thread.rpc.send({ type: "extension_ui_response", id, cancelled: true });
      return;
    }
    const confirm = sourceText("status.provider.confirmContinue");
    const options =
      method === "confirm"
        ? [confirm, sourceText("status.provider.confirmCancel")]
        : getArray(record, "options").filter(isString);
    const question = getString(record, "message") ?? getString(record, "title") ?? "Pi";
    const result = await this.#requests
      .call("item/tool/requestUserInput", {
        threadId: thread.id,
        turnId: thread.turn?.id ?? randomUUID(),
        questions: [
          {
            id,
            header: "Pi",
            question: this.#redact(question),
            isSecret: secretElicitationField(question, undefined),
            options: options.length ? options.map((label) => ({ label, description: label })) : null,
          },
        ],
      })
      .catch(() => null);
    const answer = getArray(getRecord(getRecord(result, "answers"), id), "answers").find(isString);
    thread.rpc.send({
      type: "extension_ui_response",
      id,
      ...(answer === undefined
        ? { cancelled: true }
        : method === "confirm"
          ? { confirmed: answer === confirm }
          : { value: answer }),
    });
  }

  async #callTool(
    params: { threadId: string; turnId: string; callId: string; namespace: string; tool: string; arguments: unknown },
    signal: AbortSignal,
  ): Promise<DynamicToolResult> {
    const result = await this.#requests.call("item/tool/call", params, signal);
    if (!isToolResult(result)) throw new Error(sourceText("error.provider.piToolInvalid"));
    return result;
  }

  /** The active branch of the Pi session, newest turn last. `get_entries` also has abandoned branches. */
  async #history(
    thread: PiThread,
  ): Promise<Array<{ id: string; status: string; startedAt?: number; items: ThreadItem[] }>> {
    const response = await thread.rpc.request({ type: "get_messages" });
    return getArray(response, "messages").map((message, index) => ({
      id: `${thread.id}:history:${index}`,
      status: "completed",
      ...(isRecord(message) && typeof message.timestamp === "number" ? { startedAt: message.timestamp / 1_000 } : {}),
      items: this.#safeItems(piMessageItems(message, `pi-history:${index}`)),
    }));
  }

  #safeItems(items: ThreadItem[]): ThreadItem[] {
    return items.flatMap((item) => {
      const value = JSON.parse(this.#redact(JSON.stringify(item)));
      return isRecord(value) && isString(value.type) ? [{ ...value, type: value.type }] : [];
    });
  }
}

function sessionUsage(stats: DynamicRecord): DynamicRecord | null {
  const tokens = getRecord(stats, "tokens");
  if (!tokens) return null;
  const { input, output, cacheRead, cacheWrite } = tokens;
  if (!isNumber(input) || !isNumber(output) || !isNumber(cacheRead) || !isNumber(cacheWrite)) return null;
  return {
    inputTokens: input + cacheRead + cacheWrite,
    outputTokens: output,
    cachedReadTokens: cacheRead,
    cachedWriteTokens: cacheWrite,
  };
}

function isNamespace(value: unknown): value is DynamicToolNamespace {
  return (
    isRecord(value) &&
    value.type === "namespace" &&
    isString(value.name) &&
    Array.isArray(value.tools) &&
    value.tools.every(
      (tool) => isRecord(tool) && tool.type === "function" && isString(tool.name) && isRecord(tool.inputSchema),
    )
  );
}
function isToolResult(value: unknown): value is DynamicToolResult {
  return (
    isRecord(value) &&
    isBoolean(value.success) &&
    Array.isArray(value.contentItems) &&
    value.contentItems.every(
      (item) =>
        isRecord(item) &&
        ((item.type === "inputText" && isString(item.text)) || (item.type === "inputImage" && isString(item.imageUrl))),
    )
  );
}
