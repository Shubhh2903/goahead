// @vitest-environment node

import type { AgentEvent } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CACHE_WARM_MS } from "./agent/auto-model";
import type { AgentService } from "./agent-service";
import {
  callOpenBotTool,
  createTestService,
  FakeAgentClient,
  notification,
  paramsRecord,
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  stores,
  waitFor,
  waitForQueue,
} from "./agent-service-test-harness";
import type { AgentStore } from "./agent-store";
import { type AppServerNotification, getRecord, getString } from "./protocol";

let root: string;
let service: AgentService | null = null;
/** The one clock of the automatic model choice in these tests. */
let clock = 0;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
  clock = 1_000_000_000;
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

async function codexService(
  requestHook?: (method: string) => Promise<void>,
  modelList?: FakeAgentClient["modelList"],
): Promise<{ client: FakeAgentClient; service: AgentService; store: AgentStore }> {
  const { store, mailbox } = stores(root);
  const client = new FakeAgentClient("codex", "CODEX_DONE", true, true, {}, requestHook);
  client.modelList = modelList;
  const next = createTestService({
    store,
    mailbox,
    preferredProvider: "codex",
    clientFactory: () => client,
    now: () => clock,
  });
  await next.initialize();
  // The first message creates the agent. Only the turns after it count below.
  await send(next, "Hello.");
  return { client, service: next, store };
}

/** Turns on the setting on a larger model, after a quiet time, so both prompt caches are cold. */
async function largerModelWithAutoModel(target: AgentService): Promise<void> {
  await target.updateAgent({ agentId: "chief", model: "gpt-5.6-sol", reasoningEffort: "high", autoModel: true });
  clock += CACHE_WARM_MS;
}

const SHORT = "Thanks, sounds good!";
const LONG = "Please review the release plan and write a short report for the team.";

function models(client: FakeAgentClient): unknown[] {
  return turnStarts(client).map((params) => params?.model);
}

async function send(target: AgentService, text: string): Promise<void> {
  await target.sendMessage({ agentId: "chief", text });
  await waitForQueue(target, "chief", (queue) =>
    queue.deliveries.every((delivery) => ["completed", "failed"].includes(delivery.status)),
  );
}

function turnStarts(client: FakeAgentClient): Array<ReturnType<typeof paramsRecord>> {
  return client.requests
    .filter((request) => request.method === "turn/start")
    .slice(1)
    .map((request) => paramsRecord(request.params));
}

describe.sequential("AgentService: Choose model automatically", () => {
  it("starts every turn on the agent's own model and effort when the setting is off or absent", async () => {
    const started = await codexService();
    service = started.service;
    await service.updateAgent({ agentId: "chief", model: "gpt-5.6-sol", reasoningEffort: "high" });
    expect(service.listAgents().find((agent) => agent.id === "chief")?.autoModel).toBeUndefined();
    await send(service, "Thanks!");
    await service.updateAgent({ agentId: "chief", autoModel: true });
    await service.updateAgent({ agentId: "chief", autoModel: false });
    // Turned off again, the agent reads like one from before the setting existed.
    expect(service.listAgents().find((agent) => agent.id === "chief")).not.toHaveProperty("autoModel");
    await send(service, "Thanks again!");
    expect(turnStarts(started.client).map((params) => [params?.model, params?.effort])).toEqual([
      ["gpt-5.6-sol", "high"],
      ["gpt-5.6-sol", "high"],
    ]);
    const answers = (await service.readConversation("chief")).messages.filter(
      (message) => message.author === "assistant",
    );
    expect(answers.length).toBeGreaterThan(2);
    expect(answers.every((message) => message.autoModelName === undefined)).toBe(true);
  });

  it("runs a short chat message on the small model and keeps the agent's thread and session", async () => {
    const started = await codexService();
    service = started.service;
    await service.updateAgent({ agentId: "chief", model: "gpt-5.6-sol", reasoningEffort: "high", autoModel: true });
    const before = service.listAgents().find((agent) => agent.id === "chief");

    await send(service, "Thanks, sounds good!");
    await send(service, "Please review the release plan and write a short report for the team.");

    expect(turnStarts(started.client).map((params) => [params?.model, params?.effort])).toEqual([
      ["gpt-6-luna", "low"],
      ["gpt-5.6-sol", "high"],
    ]);
    // One provider session for both turns: the switch is per turn, not a new thread.
    expect(started.client.requests.filter((request) => request.method === "thread/start")).toHaveLength(1);
    const threadIds = new Set(turnStarts(started.client).map((params) => params?.threadId));
    expect(threadIds.size).toBe(1);
    const after = service.listAgents().find((agent) => agent.id === "chief");
    expect(after).toMatchObject({
      id: before?.id,
      threadId: before?.threadId,
      workspacePath: before?.workspacePath,
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      autoModel: true,
    });

    const answers = (await service.readConversation("chief")).messages.filter(
      (message) => message.author === "assistant",
    );
    const [, first, second] = [...new Set(answers.map((message) => message.turnId))];
    // One label, on the answer of the turn.
    expect(
      answers.filter((message) => message.autoModelName).map((message) => [message.turnId, message.autoModelName]),
    ).toEqual([[first, "GPT-6 Luna"]]);
    expect(answers.filter((message) => message.turnId === second).every((message) => !message.autoModelName)).toBe(
      true,
    );

    // The label and the setting are saved: a restart reads both back.
    await service.stop();
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox, preferredProvider: "codex", clientFactory: () => started.client });
    await service.initialize();
    expect(service.listAgents().find((agent) => agent.id === "chief")?.autoModel).toBe(true);
    expect(
      (await service.readConversation("chief")).messages
        .filter((message) => message.autoModelName)
        .map((message) => [message.turnId, message.autoModelName]),
    ).toEqual([[first, "GPT-6 Luna"]]);
  });

  it("keeps the own model while its cache is warm, so short and long messages do not flip models", async () => {
    const started = await codexService();
    service = started.service;
    await largerModelWithAutoModel(service);
    for (const text of [SHORT, LONG, SHORT, LONG]) {
      await send(service, text);
      clock += 60_000;
    }
    expect(models(started.client)).toEqual(["gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-sol", "gpt-5.6-sol"]);
  });

  it("goes small after five quiet minutes, and stays small right after a small turn", async () => {
    const started = await codexService();
    service = started.service;
    await largerModelWithAutoModel(service);
    await send(service, LONG);
    clock += CACHE_WARM_MS;
    await send(service, SHORT);
    clock += 60_000;
    await send(service, SHORT);
    expect(models(started.client)).toEqual(["gpt-5.6-sol", "gpt-6-luna", "gpt-6-luna"]);
  });

  it("does not count a refused turn start as the thread's last turn", async () => {
    let refuse = false;
    let client: FakeAgentClient | null = null;
    const started = await codexService(async (method) => {
      const params = paramsRecord(client?.requests.at(-1)?.params);
      if (refuse && method === "turn/start" && params?.model === "gpt-6-luna") throw new Error("Turn rejected.");
    });
    client = started.client;
    service = started.service;
    await largerModelWithAutoModel(service);
    await send(service, LONG);
    clock += CACHE_WARM_MS;
    refuse = true;
    await send(service, SHORT);
    expect(models(started.client)).toEqual(["gpt-5.6-sol", "gpt-6-luna"]);
    expect(service.listQueue("chief").deliveries.at(-1)?.status).toBe("failed");

    // A turn the provider starts on its own counts on the last accepted model, not the refused one.
    const session = started.store.activeProviderSession("chief");
    if (!session) throw new Error("The provider session did not start.");
    const threadId = session.externalSessionId;
    started.client.emit("notification", notification("turn/started", { threadId, turn: { id: "provider-turn" } }));
    started.client.emit(
      "notification",
      notification("turn/completed", { threadId, turn: { id: "provider-turn", status: "completed" } }),
    );
    expect(started.store.database.usage.turnModel("chief", session.id, "provider-turn")).toBe("gpt-5.6-sol");
  });

  it("keeps the own model while the model list is not one the CLI gave", async () => {
    const started = await codexService(undefined, () => {
      throw new Error("model/list failed.");
    });
    service = started.service;
    await largerModelWithAutoModel(service);
    await send(service, SHORT);
    // The built-in list names gpt-6-luna, but the CLI never confirmed it.
    expect(models(started.client)).toEqual(["gpt-5.6-sol"]);
  });
});

describe.sequential("AgentService: small model for channel tasks of a teammate or a routine", () => {
  const actor = { id: "human", name: "Alex" };

  /** Two members on a larger model. Each turn stays running until the test completes it. */
  async function channelService(): Promise<{ client: FakeAgentClient; service: AgentService }> {
    const { store, mailbox } = stores(root);
    const client = new FakeAgentClient("codex", "CODEX_DONE", false);
    const next = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: () => client,
      now: () => clock,
    });
    await next.initialize();
    await next.ensureProvider("codex");
    for (const agentId of ["chief", "helper"]) {
      await store.getOrCreate(agentId);
      await next.updateAgent({ agentId, model: "gpt-5.6-sol", reasoningEffort: "high" });
    }
    await next.channels.command(
      {
        type: "save",
        channelId: "channel-1",
        operationId: "create",
        draft: {
          name: "Project",
          title: "",
          instructions: "Shared work",
          members: [{ agentId: "chief" }, { agentId: "helper" }],
          leadAgentId: "chief",
        },
      },
      actor,
    );
    return { client, service: next };
  }

  function channelTurns(client: FakeAgentClient): Array<[unknown, unknown]> {
    return client.requests
      .filter((request) => request.method === "turn/start")
      .map((request) => paramsRecord(request.params))
      .map((params) => [params?.model, params?.effort]);
  }

  async function runningTurn(target: AgentService, agentId: string): Promise<string> {
    let turnId: string | null = null;
    await waitFor(() => {
      turnId =
        target.channels.store.assignments("channel-1").find((item) => item.agentId === agentId && item.turnId)
          ?.turnId ?? null;
      return turnId !== null;
    });
    if (!turnId) throw new Error(`No running channel turn for ${agentId}.`);
    return turnId;
  }

  it("keeps the own model for a person's task and uses the small model for a teammate's task", async () => {
    const started = await channelService();
    service = started.service;
    await service.channels.command(
      {
        type: "send",
        channelId: "channel-1",
        operationId: "send",
        text: "Compare the two projects.",
        recipientAgentId: "chief",
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    );
    const parentTurn = await runningTurn(service, "chief");
    expect(channelTurns(started.client)).toEqual([["gpt-5.6-sol", "high"]]);

    const parent = service.channels.store.tasks("channel-1")[0];
    if (!parent) throw new Error("The channel task is missing.");
    await service.channels.tool("channel-1", "chief", parentTurn, "assign-1", "channel_assign", {
      recipientAgentId: "helper",
      task: "Inspect project B",
      expectedResult: "Findings B",
      sourceMessageIds: [parent.requestMessageId],
      resources: ["none"],
    });
    const threadId = paramsRecord(
      started.client.requests.find((request) => request.method === "turn/start")?.params,
    )?.threadId;
    started.client.emit(
      "notification",
      notification("turn/completed", { threadId, turn: { id: parentTurn, status: "completed" } }),
    );
    await runningTurn(service, "helper");
    expect(channelTurns(started.client)).toEqual([
      ["gpt-5.6-sol", "high"],
      ["gpt-6-luna", "medium"],
    ]);
  });

  it("uses the small model for a task that a routine requests", async () => {
    const started = await channelService();
    service = started.service;
    await service.channels.command(
      {
        type: "request",
        channelId: "channel-1",
        operationId: "routine-run",
        text: "Compare the two projects.",
        recipientAgentId: "chief",
        requestMessageId: "routine-request-1",
        origin: { kind: "routine", routineId: "daily", routineName: "Daily", runId: "run-1" },
      },
      actor,
    );
    await runningTurn(service, "chief");
    expect(channelTurns(started.client)).toEqual([["gpt-6-luna", "medium"]]);
  });
});

describe.sequential("AgentService: the model of a continued turn and of a teammate's answer", () => {
  /** Chief on a larger model. Each turn stays running until the test ends it. */
  async function runningService(autoModel: boolean) {
    const started = await startService(root, { provider: "codex", autoComplete: false, now: () => clock });
    service = started.service;
    await started.store.getOrCreate("chief");
    await started.service.updateAgent({ agentId: "chief", model: "gpt-5.6-sol", reasoningEffort: "high", autoModel });
    const events: AgentEvent[] = [];
    started.service.on("event", (event) => events.push(event));
    const routine = started.service.createRoutine({
      agentId: "chief",
      name: "Daily report",
      instruction: "Prepare the daily report.",
      active: false,
      timezone: "UTC",
      schedule: { kind: "daily", time: "09:00" },
    });
    return { ...started, events, routineId: routine.id };
  }

  type Running = Awaited<ReturnType<typeof runningService>>;

  /** The running turn of the agent's newest delivery, after the service saw it start. */
  async function runningTurn(target: Running, agentId: string): Promise<{ turnId: string; threadId: string }> {
    let turnId: string | null = null;
    await waitForQueue(target.service, agentId, (queue) => {
      turnId = queue.deliveries.findLast((delivery) => delivery.status === "running")?.turnId ?? null;
      return turnId !== null;
    });
    const threadId = target.store.activeProviderSession(agentId)?.externalSessionId;
    if (!turnId || !threadId) throw new Error(`No running turn for ${agentId}.`);
    await waitFor(() => target.events.some((event) => event.type === "turn-started" && event.turnId === turnId));
    return { turnId, threadId };
  }

  /** Stops chief's running turn at its 40th tool call, ends it, and allows the card a quiet time later. */
  async function stopAndContinue(target: Running): Promise<void> {
    const { turnId, threadId } = await runningTurn(target, "chief");
    for (let index = 0; index < 40; index += 1) {
      const item = { id: `${turnId}-tool-${index}`, type: "commandExecution", status: "inProgress" };
      target.client.emit("notification", notification("item/started", { threadId, turnId, item }));
    }
    await waitFor(() => target.service.localOnlyApprovals().length === 1);
    const [card] = target.service.localOnlyApprovals();
    if (!card) throw new Error("No turn-limit card.");
    target.client.emit(
      "notification",
      notification("turn/completed", { threadId, turn: { id: turnId, status: "interrupted" } }),
    );
    clock += CACHE_WARM_MS;
    await target.service.respondToApproval({ requestId: card.requestId, decision: "accept" }, "local-owner");
    await waitFor(() => turnStartsOf(target).length === 2);
  }

  function turnStartsOf(target: Running, threadId?: string): Array<[unknown, unknown]> {
    return target.client.requests
      .filter((request) => request.method === "turn/start")
      .map((request) => paramsRecord(request.params))
      .filter((params) => threadId === undefined || params?.threadId === threadId)
      .map((params) => [params?.model, params?.effort]);
  }

  it("continues a routine turn that the limit stopped on the small model", async () => {
    const target = await runningService(true);
    await target.service.testRoutine({ agentId: "chief", routineId: target.routineId });
    await stopAndContinue(target);
    expect(turnStartsOf(target)).toEqual([
      ["gpt-6-luna", "medium"],
      ["gpt-6-luna", "medium"],
    ]);
  });

  it("continues a person's turn that the limit stopped on the agent's own model", async () => {
    const target = await runningService(true);
    // "Choose model automatically" would run the short Continue text on the small model, after the
    // quiet time, if the continued turn did not keep the model of the stopped one.
    await target.service.sendMessage({ agentId: "chief", text: "Build the report." });
    await stopAndContinue(target);
    expect(turnStartsOf(target)).toEqual([
      ["gpt-5.6-sol", "high"],
      ["gpt-5.6-sol", "high"],
    ]);
  });

  it("continues a routine's channel task that the limit stopped on the small model", async () => {
    const actor = { id: "human", name: "Alex" };
    const started = await startService(root, {
      provider: "codex",
      autoComplete: false,
      now: () => clock,
      channelActor: () => actor,
    });
    service = started.service;
    await started.store.getOrCreate("chief");
    await started.service.updateAgent({ agentId: "chief", model: "gpt-5.6-sol", reasoningEffort: "high" });
    // A channel turn's events go to the channel: the fake's own `turn/started` is the barrier.
    const announced: string[] = [];
    started.client.on("notification", (message: AppServerNotification) => {
      const id = message.method === "turn/started" ? getString(getRecord(message.params, "turn"), "id") : null;
      if (id) announced.push(id);
    });
    await started.service.channels.command(
      {
        type: "save",
        channelId: "channel-1",
        operationId: "create",
        draft: {
          name: "Project",
          title: "",
          instructions: "Shared work",
          members: [{ agentId: "chief" }],
          leadAgentId: "chief",
        },
      },
      actor,
    );
    await started.service.channels.command(
      {
        type: "request",
        channelId: "channel-1",
        operationId: "routine-run",
        text: "Compare the two projects.",
        recipientAgentId: "chief",
        requestMessageId: "routine-request-1",
        origin: { kind: "routine", routineId: "daily", routineName: "Daily", runId: "run-1" },
      },
      actor,
    );
    await waitFor(() => started.service.channels.store.assignments("channel-1").some((item) => item.turnId));
    const turnId = started.service.channels.store.assignments("channel-1")[0]?.turnId;
    const channelThreadId = started.service.channels.store.context("channel-1", "chief").threadId;
    const threadId = started.store.database.activeProviderSession(channelThreadId, "codex")?.externalSessionId;
    if (!turnId || !threadId) throw new Error("The channel turn did not start.");
    await waitFor(() => announced.includes(turnId));
    for (let index = 0; index < 40; index += 1) {
      const item = { id: `channel-tool-${index}`, type: "commandExecution", status: "inProgress" };
      started.client.emit("notification", notification("item/started", { threadId, turnId, item }));
    }
    await waitFor(() => started.service.localOnlyApprovals().length === 1);
    const [card] = started.service.localOnlyApprovals();
    if (!card) throw new Error("No turn-limit card.");
    started.client.emit(
      "notification",
      notification("turn/completed", { threadId, turn: { id: turnId, status: "interrupted" } }),
    );
    await waitFor(() => started.service.channels.store.tasks("channel-1")[0]?.state === "paused");
    await started.service.respondToApproval({ requestId: card.requestId, decision: "accept" }, "local-owner");
    const starts = () =>
      started.client.requests
        .filter((request) => request.method === "turn/start")
        .map((request) => paramsRecord(request.params))
        .map((params) => [params?.model, params?.effort]);
    await waitFor(() => starts().length === 2);
    expect(starts()).toEqual([
      ["gpt-6-luna", "medium"],
      ["gpt-6-luna", "medium"],
    ]);
  });

  /** Chief's running turn asks worker; worker answers; returns the models of chief's turns. */
  async function answerTurns(target: Running): Promise<Array<[unknown, unknown]>> {
    await target.store.getOrCreate("worker");
    const chief = await runningTurn(target, "chief");
    await callOpenBotTool(
      target.client,
      chief.threadId,
      "send_message",
      { recipientAgentIds: ["worker"], text: "Draft the summary." },
      chief.turnId,
    );
    target.client.emit(
      "notification",
      notification("turn/completed", { threadId: chief.threadId, turn: { id: chief.turnId, status: "completed" } }),
    );
    const worker = await runningTurn(target, "worker");
    const answer = { id: "worker-answer", type: "agentMessage", text: "The summary is ready.", phase: "final_answer" };
    target.client.emit(
      "notification",
      notification("item/completed", { threadId: worker.threadId, turnId: worker.turnId, item: answer }),
    );
    target.client.emit(
      "notification",
      notification("turn/completed", { threadId: worker.threadId, turn: { id: worker.turnId, status: "completed" } }),
    );
    await waitFor(() => turnStartsOf(target, chief.threadId).length === 2);
    return turnStartsOf(target, chief.threadId);
  }

  it("answers the person's own request on the agent's own model", async () => {
    const target = await runningService(false);
    await target.service.sendMessage({ agentId: "chief", text: "Ask worker for a summary." });
    expect(await answerTurns(target)).toEqual([
      ["gpt-5.6-sol", "high"],
      ["gpt-5.6-sol", "high"],
    ]);
  });

  it("answers a routine's request on the small model", async () => {
    const target = await runningService(false);
    await target.service.testRoutine({ agentId: "chief", routineId: target.routineId });
    expect(await answerTurns(target)).toEqual([
      ["gpt-6-luna", "medium"],
      ["gpt-6-luna", "medium"],
    ]);
  });
});
