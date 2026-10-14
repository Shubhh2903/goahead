import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { type DynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { type AgentProvider, RequestTimeoutError } from "./agent-client";
import { cliSpawnTarget } from "./cli";
import { JsonLineDecoder, LineTooLongError } from "./jsonl";
import {
  type AppServerNotification,
  type AppServerRequest,
  decodeRecordResponse,
  isRecord,
  type RequestId,
  type ResponseDecoder,
  type RpcError,
  type RpcMessage,
  type ThreadItem,
} from "./protocol";
import {
  PROVIDER_HISTORY_PAGE_SIZE,
  type ProviderHistoryConsumer,
  type ProviderHistoryFragment,
  type ProviderHistoryRequest,
} from "./provider-history";
import { createDiagnosticStream } from "./stderr-diagnostics";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string];
}

export class AppServerError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "AppServerError";
  }
}

export class CodexAppServerClient extends EventEmitter<ClientEvents> {
  readonly provider: AgentProvider = "codex";
  readonly #executable: string;
  readonly #requestTimeoutMs: number;
  #decoder = new JsonLineDecoder();
  readonly #pending = new Map<RequestId, PendingRequest>();
  #process: ChildProcessWithoutNullStreams | null = null;
  #nextId = 1;
  #stopping = false;

  constructor(executable: string, requestTimeoutMs = 30_000) {
    super();
    this.#executable = executable;
    this.#requestTimeoutMs = requestTimeoutMs;
  }

  get running(): boolean {
    return this.#process !== null && this.#process.exitCode === null;
  }

  start(): void {
    if (this.running) return;

    this.#stopping = false;
    this.#decoder = new JsonLineDecoder();
    const target = cliSpawnTarget(this.#executable, ["app-server", "--listen", "stdio://"]);
    const child = spawn(target.command, target.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
      windowsVerbatimArguments: target.windowsVerbatimArguments,
      windowsHide: true,
    });
    this.#process = child;

    child.stdin.on("error", (error) => this.#fail(error, child));
    child.stdout.on("data", (chunk: Buffer) => {
      try {
        for (const message of this.#decoder.push(chunk)) this.#handleMessage(message);
      } catch (error) {
        // Not wrapped: the screen translates this text only when no prefix is in front of it.
        this.#fail(
          error instanceof LineTooLongError ? error : new Error(`Codex protocol error: ${String(error)}`),
          child,
        );
      }
    });

    // Whole records only. A chunk ends wherever the pipe filled up, and half a record is neither
    // readable nor reliably redactable.
    const diagnostics = createDiagnosticStream({
      redact: redactDiagnostic,
      emit: (message) => this.emit("diagnostic", message),
    });
    child.stderr.on("data", (chunk: Buffer) => diagnostics.push(chunk.toString("utf8")));
    child.once("close", () => diagnostics.flush());

    child.once("error", (error) => this.#fail(error, child));
    child.once("exit", (code, signal) => {
      const suffix = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      this.#fail(new Error(`Codex App Server exited with ${suffix}.`), child);
    });
  }

  async stop(): Promise<void> {
    const child = this.#process;
    if (!child) return;

    this.#stopping = true;
    this.#process = null;

    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Codex App Server stopped."));
    }
    this.#pending.clear();

    child.stdin.end();
    if (child.exitCode !== null) return;

    await new Promise<void>((resolve) => {
      const forceKill = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 2_000);
      child.once("exit", () => {
        clearTimeout(forceKill);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }

  /**
   * Drops this connection's hold on one thread and keeps the app server for the others.
   *
   * `thread/unsubscribe` is the non-destructive end of a thread: the app server keeps the thread and
   * its history, stops the thread's MCP event streams at once, and unloads the thread - with the
   * MCP servers it started - once nothing is subscribed to it and it is idle. It does not archive
   * or delete. A refresh after an MCP change starts a replacement session for the same public
   * thread, so without this the old session stays loaded there with the servers the user turned off.
   *
   * A thread this connection never subscribed to answers `NotSubscribed`, which is not an error
   * here: either way this side has stopped using it.
   */
  async releaseThread(threadId: string): Promise<void> {
    if (!this.running) return;
    await this.request("thread/unsubscribe", { threadId }, decodeRecordResponse);
  }

  /**
   * Reads Codex history without asking the app server for the legacy full thread snapshot.
   *
   * The app server returns turns newest first. Items are read one turn at a time in ascending
   * order, so consumers can persist each fragment and stop without retaining the transcript.
   * Cursors belong to this adapter and never cross the provider-history boundary.
   */
  readonly readHistory = async (request: ProviderHistoryRequest, consume: ProviderHistoryConsumer): Promise<void> => {
    // These endpoints read the persisted rollout directly. Do not resume here: a resume applies
    // runtime settings and can reopen an archived thread while this operation only needs history.
    let cursor: string | undefined;
    const seenTurnCursors = new Set<string>();
    while (true) {
      const page = await this.request(
        "thread/turns/list",
        {
          threadId: request.threadId,
          limit: PROVIDER_HISTORY_PAGE_SIZE,
          sortDirection: "desc",
          itemsView: "notLoaded",
          ...(cursor === undefined ? {} : { cursor }),
        },
        decodeTurnHistoryPage,
      );

      for (const turn of page.data) {
        if (request.items === "none") {
          if (!(await consume(toHistoryFragment(turn, [], true)))) return;
          continue;
        }

        let itemCursor: string | undefined;
        const seenItemCursors = new Set<string>();
        let itemOffset = 0;
        while (true) {
          const itemPage = await this.request(
            "thread/items/list",
            {
              threadId: request.threadId,
              turnId: turn.id,
              limit: PROVIDER_HISTORY_PAGE_SIZE,
              sortDirection: "asc",
              ...(itemCursor === undefined ? {} : { cursor: itemCursor }),
            },
            decodeItemHistoryPage,
          );
          if (itemPage.data.some((entry) => entry.turnId !== turn.id)) {
            throw new Error("Codex returned an item for the wrong turn.");
          }
          const complete = itemPage.nextCursor === null;
          const fragment = toHistoryFragment(
            turn,
            itemPage.data.map((entry) => entry.item),
            complete,
            itemOffset,
          );
          if (!(await consume(fragment))) return;
          itemOffset += itemPage.data.length;
          if (complete) break;
          itemCursor = freshCursor(itemPage.nextCursor, itemCursor, seenItemCursors, "item");
        }
      }

      if (page.nextCursor === null) return;
      cursor = freshCursor(page.nextCursor, cursor, seenTurnCursors, "turn");
    }
  };

  request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>, timeoutMs?: number): Promise<T>;
  request<T>(
    method: string,
    params: unknown,
    decoder: ResponseDecoder<T>,
    timeoutMs = this.#requestTimeoutMs,
  ): Promise<T> {
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new RequestTimeoutError("Codex", method));
      }, timeoutMs);

      this.#pending.set(id, {
        resolve: (value) => resolve(decoder(value)),
        reject,
        timeout,
      });

      try {
        this.#write({ method, id, params: method === "thread/resume" ? metadataOnlyResumeParams(params) : params });
      } catch (error) {
        clearTimeout(timeout);
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method: string, params: unknown = {}): void {
    this.#write({ method, params });
  }

  respond(id: RequestId, result: unknown): void {
    this.#write({ id, result });
  }

  respondError(id: RequestId, error: RpcError): void {
    this.#write({ id, error });
  }

  #write(message: unknown): void {
    if (!this.running || !this.#process) {
      throw new Error("Codex App Server is not running.");
    }
    this.#process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleMessage(message: RpcMessage): void {
    if ("method" in message) {
      if ("id" in message) {
        this.emit("request", {
          method: message.method,
          id: message.id,
          params: message.params,
        });
      } else {
        this.emit("notification", { method: message.method, params: message.params });
      }
      return;
    }

    const pending = this.#pending.get(message.id);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.#pending.delete(message.id);

    if (message.error && isRecord(message.error)) {
      const code = isNumber(message.error.code) ? message.error.code : -1;
      const text = isString(message.error.message) ? message.error.message : "Unknown error";
      pending.reject(new AppServerError(text, code, message.error.data));
      return;
    }

    pending.resolve(message.result);
  }

  #fail(error: Error, child: ChildProcessWithoutNullStreams): void {
    if (this.#process !== child) return;
    this.#process = null;

    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();

    if (child.exitCode === null) child.kill("SIGTERM");
    if (!this.#stopping) this.emit("exit", error);
  }
}

interface HistoryTurn {
  id: string;
  status?: string;
  startedAt?: number;
}

interface HistoryTurnPage {
  data: HistoryTurn[];
  nextCursor: string | null;
}

interface HistoryItemPage {
  data: Array<{ turnId: string; item: ThreadItem }>;
  nextCursor: string | null;
}

/** A resume needs only the thread's settings; its turns come from the paged history endpoints. */
function metadataOnlyResumeParams(params: unknown): DynamicRecord {
  return { ...(isRecord(params) ? params : {}), excludeTurns: true };
}

function decodeTurnHistoryPage(value: unknown): HistoryTurnPage {
  const record = decodeRecordResponse(value);
  if (!Array.isArray(record.data)) throw new Error("Invalid Codex turn history page.");
  return {
    // Do not retain `items` from the response. `itemsView: notLoaded` is the memory boundary, and
    // the item endpoint below is the only path that materializes item records.
    data: record.data.map(decodeHistoryTurn),
    nextCursor: nullableString(record.nextCursor, "turn history cursor"),
  };
}

function decodeHistoryTurn(value: unknown): HistoryTurn {
  if (!isRecord(value) || !isString(value.id)) throw new Error("Invalid Codex history turn.");
  const status = value.status;
  const startedAt = value.startedAt;
  return {
    id: value.id,
    ...(isString(status) ? { status } : {}),
    ...(typeof startedAt === "number" && Number.isFinite(startedAt) ? { startedAt } : {}),
  };
}

function decodeItemHistoryPage(value: unknown): HistoryItemPage {
  const record = decodeRecordResponse(value);
  if (!Array.isArray(record.data)) throw new Error("Invalid Codex item history page.");
  return {
    data: record.data.map(decodeHistoryItemEntry),
    nextCursor: nullableString(record.nextCursor, "item history cursor"),
  };
}

function decodeHistoryItemEntry(value: unknown): { turnId: string; item: ThreadItem } {
  if (!isRecord(value) || !isString(value.turnId) || !isRecord(value.item) || !isString(value.item.type)) {
    throw new Error("Invalid Codex history item.");
  }
  // Preserve provider item fields (tool output, image metadata, command status, and so on) while
  // validating the discriminator at the untrusted app-server boundary.
  return { turnId: value.turnId, item: { ...value.item, type: value.item.type } };
}

function nullableString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (!isString(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

function toHistoryFragment(
  turn: HistoryTurn,
  items: ThreadItem[],
  complete: boolean,
  itemOffset?: number,
): ProviderHistoryFragment {
  return {
    turnId: turn.id,
    ...(turn.status === undefined ? {} : { status: turn.status }),
    ...(turn.startedAt === undefined ? {} : { startedAt: turn.startedAt }),
    ...(itemOffset === undefined ? {} : { itemOffset }),
    items,
    complete,
  };
}

/** The next cursor. A repeated cursor would loop forever, so it is an error. */
function freshCursor(
  nextCursor: string | null,
  currentCursor: string | undefined,
  seenCursors: Set<string>,
  kind: "turn" | "item",
): string {
  if (nextCursor === null || nextCursor === currentCursor || seenCursors.has(nextCursor)) {
    throw new Error(`Codex returned a repeated ${kind} history cursor.`);
  }
  seenCursors.add(nextCursor);
  return nextCursor;
}

/**
 * The record as it leaves this client. It is not shortened here: the reader redacts the MCP
 * credentials this process handed the CLI, and a value cut in half by a bound applied first is a
 * value that redactor no longer recognises. `shortenDiagnostic` is applied there instead.
 */
function redactDiagnostic(message: string): string {
  return message
    .replace(/(?:sk|sess|Bearer|token)[-_a-zA-Z0-9.=]{8,}/gi, "[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]");
}
