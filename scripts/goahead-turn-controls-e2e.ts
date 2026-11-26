// GoAhead v0.41 turn controls on the v0.77 agent service, with a Codex stand-in client:
// "Choose model automatically", the small model for routine turns, the per-turn tool-call limit with
// its Continue card, and the install guard for Codex commands. Report: .openbot-build/goahead-turn-controls-e2e.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type AgentEvent } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { CACHE_WARM_MS } from "../src/backend/agent/auto-model";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient } from "../src/backend/agent-client";
import type { AppServerNotification, RequestId, ResponseDecoder } from "../src/backend/protocol";
import { providerSync } from "../src/backend/provider-client-effects";

const OUT = resolve(import.meta.dirname, "../.openbot-build/goahead-turn-controls-e2e");
const root = await mkdtemp(join(tmpdir(), "goahead-turn-controls-"));
const home = join(root, "home");
const codexExecutable = join(root, "codex");
mkdirSync(home, { recursive: true });
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = codexExecutable;
await writeFile(
  codexExecutable,
  `#!${process.execPath}\nif (process.argv.includes("--version")) process.stdout.write("codex-cli 99.0.0\\n");\n`,
  { mode: 0o755 },
);

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

const LARGE = "gpt-5.6-sol";
const SMALL = "gpt-6-luna";
const SMALL_NAME = "GPT-6 Luna";
const efforts = ["low", "medium", "high"].map((reasoningEffort) => ({ reasoningEffort }));

/** A Codex app server in this process. A turn ends at once unless `holdTurns` is set. */
class CodexStandIn extends EventEmitter implements AgentClient {
  readonly provider = "codex";
  readonly requests: Array<{ method: string; params: DynamicRecord }> = [];
  running = false;
  holdTurns = false;
  #threads = 0;

  start(): void {
    this.running = true;
  }

  stop() {
    return Effect.sync(() => {
      this.running = false;
    });
  }

  emitNotification(method: string, params: DynamicRecord): void {
    const notification: AppServerNotification = { method, params };
    this.emit("notification", notification);
  }

  request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>) {
    const record: DynamicRecord = isDynamicRecord(params) ? params : {};
    this.requests.push({ method, params: structuredClone(record) });
    return providerSync(() => decoder(this.#answer(method, record)));
  }

  #answer(method: string, params: DynamicRecord): unknown {
    switch (method) {
      case "initialize":
        return {};
      case "account/read":
        return { account: { type: "chatgpt", email: "codex@example.com" }, requiresOpenaiAuth: false };
      case "account/rateLimits/read":
        return { rateLimits: null, rateLimitsByLimitId: null };
      case "model/list":
        return {
          data: [
            {
              model: SMALL,
              displayName: SMALL_NAME,
              supportedReasoningEfforts: efforts,
              defaultReasoningEffort: "low",
            },
            {
              model: LARGE,
              displayName: "GPT-5.6 Sol",
              supportedReasoningEfforts: efforts,
              defaultReasoningEffort: "high",
            },
          ],
        };
      case "plugin/list":
        return { marketplaces: [] };
      case "thread/start":
        this.#threads += 1;
        return { thread: { id: `codex-session-${this.#threads}` } };
      case "thread/resume":
        return { thread: { id: params.threadId } };
      case "turn/interrupt": {
        const threadId = String(params.threadId);
        const turnId = String(params.turnId);
        setTimeout(
          () => this.emitNotification("turn/completed", { threadId, turn: { id: turnId, status: "interrupted" } }),
          0,
        );
        return {};
      }
      case "turn/start":
        return this.#startTurn(String(params.threadId));
      default:
        return {};
    }
  }

  #startTurn(threadId: string): unknown {
    const turnId = `turn-${this.requests.filter((request) => request.method === "turn/start").length}`;
    const itemId = `${turnId}:assistant`;
    setTimeout(() => {
      if (!this.running) return;
      this.emitNotification("turn/started", { threadId, turn: { id: turnId } });
      if (this.holdTurns) return;
      this.emitNotification("item/started", { threadId, turnId, item: { id: itemId, type: "agentMessage", text: "" } });
      this.emitNotification("item/completed", {
        threadId,
        turnId,
        item: { id: itemId, type: "agentMessage", text: "Done." },
      });
      this.emitNotification("turn/completed", { threadId, turn: { id: turnId, status: "completed" } });
    }, 0);
    return { turn: { id: turnId, status: "inProgress", items: [] } };
  }

  notify(): void {}
  respond(_id: RequestId, _result: unknown): void {}
  respondError(): void {}
}

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  toolCanUseTab: () => false,
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};

async function waitFor<T>(
  label: string,
  read: () => Promise<T | null | undefined | false> | T | null | undefined | false,
) {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 20));
  }
}

const report: { checks: string[]; passed: boolean; error?: string } = { checks: [], passed: false };
const client = new CodexStandIn();
let clock = 1_000_000_000;
const userData = join(root, "user-data");
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
  clientFactory: () => client,
  now: () => clock,
});
const events: AgentEvent[] = [];
agents.on("event", (event) => events.push(event));

const turnStarts = () =>
  client.requests.filter((request) => request.method === "turn/start").map((request) => request.params);
const cards = (prefix: string) =>
  events.flatMap((event) =>
    event.type === "approval" && String(event.approval.requestId).startsWith(prefix) ? [event.approval] : [],
  );
const idle = (agentId: string) =>
  agents
    .listQueue(agentId)
    .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status));

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Chief",
      description: "Checks the GoAhead turn controls.",
      avatarSeed: "turn-controls",
      avatarHue: null,
      initialMessage: "Hello.",
      provider: "codex",
      model: LARGE,
    }),
  );
  const agentId = agent.id;
  await waitFor("the first turn", () => turnStarts().length === 1 && idle(agentId));
  await runCauseEffect(agents.updateAgent({ agentId, model: LARGE, reasoningEffort: "high", autoModel: true }));

  // (a) "Choose model automatically": a short chat message after a quiet time runs on the small model,
  // and its answer is labelled.
  clock += CACHE_WARM_MS;
  await runCauseEffect(agents.sendMessage({ agentId, text: "Thanks, sounds good!" }));
  await waitFor("the short turn", () => turnStarts().length === 2 && idle(agentId));
  assert.equal(turnStarts()[1]?.model, SMALL, "A short message runs on the small model.");
  assert.equal(turnStarts()[1]?.effort, "low");
  const labelled = await waitFor("the label", async () =>
    (await runCauseEffect(agents.readConversation(agentId))).messages.find((message) => message.autoModelName),
  );
  assert.equal(labelled.autoModelName, SMALL_NAME);
  report.checks.push("autoModel: a short message runs on the small model and the answer has its label");

  // (b) A routine turn runs on the small model, and on the own model when the setting is off.
  await runCauseEffect(agents.updateAgent({ agentId, autoModel: false }));
  const routine = agents.createRoutine({
    agentId,
    name: "Check",
    instruction: "Check the build.",
    active: false,
    timezone: "UTC",
    schedule: { kind: "interval", unit: "days", amount: 1, anchorAt: new Date().toISOString() },
  });
  const runRoutine = async (count: number) => {
    await runCauseEffect(agents.testRoutine({ agentId, routineId: routine.id }));
    await waitFor("the routine turn", () => turnStarts().length === count && idle(agentId));
  };
  await runRoutine(3);
  assert.equal(turnStarts()[2]?.model, SMALL, "A routine turn runs on the small model.");
  assert.equal(turnStarts()[2]?.effort, "medium", "A routine turn keeps its effort at medium or lower.");
  await runCauseEffect(agents.updateAgent({ agentId, delegatedSmallModel: false }));
  await runRoutine(4);
  assert.equal(turnStarts()[3]?.model, LARGE, "With the setting off, a routine turn keeps the own model.");
  report.checks.push("delegatedSmallModel: a routine turn runs on the small model, and on the own model when off");

  // (c) Turn limit: the 40th tool call stops the turn and shows one card; Allow queues the Continue
  // message, and the continued turn keeps the small model of the routine turn it continues.
  await runCauseEffect(agents.updateAgent({ agentId, delegatedSmallModel: null }));
  client.holdTurns = true;
  await runCauseEffect(agents.testRoutine({ agentId, routineId: routine.id }));
  await waitFor("the limited turn", () => turnStarts().length === 5);
  const limited = turnStarts()[4];
  assert.equal(limited?.model, SMALL);
  const threadId = String(limited?.threadId);
  const turnId = await waitFor("the turn start", () =>
    events.flatMap((event) => (event.type === "turn-started" ? [event.turnId] : [])).find((id) => id === "turn-5"),
  );
  for (let index = 1; index <= 45; index += 1) {
    client.emitNotification("item/started", {
      threadId,
      turnId,
      item: { id: `${turnId}-tool-${index}`, type: "commandExecution", status: "inProgress", command: "ls" },
    });
  }
  const [limitCard] = await waitFor("the turn-limit card", () => {
    const shown = cards("local-only:turn-limit:");
    return shown.length > 0 ? shown : null;
  });
  assert.ok(limitCard);
  assert.equal(limitCard.reason, sourceText("status.agent.turnLimitReached", { calls: 40, tokens: "0" }));
  const interrupts = () => client.requests.filter((request) => request.method === "turn/interrupt");
  await waitFor("the stopped turn", () => idle(agentId));
  assert.equal(interrupts().length, 1, "One stop for the turn.");
  assert.equal(cards("local-only:turn-limit:").length, 1, "One card for the turn.");
  client.holdTurns = false;
  clock += CACHE_WARM_MS;
  await runCauseEffect(
    agents.respondToApproval(
      { requestId: limitCard.requestId, decision: "accept" },
      { owner: true, localDesktop: true },
    ),
  );
  await waitFor("the continued turn", () => turnStarts().length === 6 && idle(agentId));
  const continued = agents.listQueue(agentId).deliveries.at(-1);
  assert.equal(continued?.text, sourceText("status.agent.turnLimitContinue"));
  assert.equal(turnStarts()[5]?.model, SMALL, "The continued turn keeps the model choice of the stopped turn.");
  report.checks.push("turnLimit: 40 tool calls stop the turn once; Allow continues on the same model choice");

  // (d) Install guard: a Codex command that installs a simulator runtime stops the turn and shows the card.
  client.holdTurns = true;
  await runCauseEffect(agents.sendMessage({ agentId, text: "Check the font size on iPhone." }));
  await waitFor("the guarded turn", () => turnStarts().length === 7);
  const guardedThread = String(turnStarts()[6]?.threadId);
  await waitFor("the guarded turn start", () =>
    events.some((event) => event.type === "turn-started" && event.turnId === "turn-7"),
  );
  client.emitNotification("item/started", {
    threadId: guardedThread,
    turnId: "turn-7",
    item: { id: "cmd-1", type: "commandExecution", status: "inProgress", command: "xcrun simctl runtime add iOS.dmg" },
  });
  const [guardCard] = await waitFor("the install card", () => {
    const shown = cards("local-only:install-guard:");
    return shown.length > 0 ? shown : null;
  });
  assert.ok(guardCard);
  assert.equal(
    guardCard.reason,
    sourceText("status.agent.installGuardRequest", { command: "xcrun simctl runtime add iOS.dmg" }),
  );
  await waitFor("the guarded stop", () => interrupts().length === 2 && idle(agentId));
  report.checks.push("install guard: a Codex simulator runtime install stops the turn and shows the card");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  for (const check of report.checks) process.stdout.write(`  ok ${check}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
