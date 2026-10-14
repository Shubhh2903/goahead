// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentService } from "../agent-service";
import {
  createTestService,
  FakeAgentClient,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "../agent-service-test-harness";
import { createHostRoutineFlows } from "./routine-flow-host";
import { RoutineFlowStore } from "./routine-flow-store";
import type { RoutineFlows } from "./routine-flows";

// The hand-off through the real agent service and mailbox. Failure modes:
// - the next agent never gets the answer of the routine's own agent (a lost hand-off);
// - a second sweep or a restart sends the same hand-off twice.

let root: string;
let service: AgentService | null = null;
let flows: RoutineFlows | null = null;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await flows?.close();
  flows = null;
  await stopAgentTestFixture(root, service);
  service = null;
});

describe("routine flow hand-off on this computer's host", () => {
  it("queues the routine's answer for the next agent once, and records that agent's answer", async () => {
    const { store, mailbox } = stores(root);
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider) => new FakeAgentClient(provider, "THREE_HEADLINES"),
    });
    const running = service;
    const runtime = createHostRoutineFlows({ store, mailbox, service: running, changed: () => undefined });
    flows = runtime;
    running.on("event", (event) => runtime.notice(event));
    await running.initialize();
    const research = await store.getOrCreate("research");
    const writer = await store.getOrCreate("writer");
    const routine = running.createRoutine({
      agentId: research.id,
      name: "Morning brief",
      instruction: "Collect the news.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "daily", time: "07:00" },
    });
    await runtime.connect({
      routineId: routine.id,
      fromAgentId: research.id,
      toAgentId: writer.id,
      instruction: "Write the brief.",
    });

    const run = await running.testRoutine({ agentId: research.id, routineId: routine.id });
    const steps = new RoutineFlowStore({ database: store.database });
    await waitFor(() => steps.steps(run.id).find((step) => step.agentId === writer.id)?.status === "succeeded");

    const writerStep = steps.steps(run.id).find((step) => step.agentId === writer.id);
    expect(writerStep).toMatchObject({ status: "succeeded", output: "THREE_HEADLINES" });
    expect(writerStep?.input).toContain("THREE_HEADLINES");
    expect(writerStep?.input).toContain("Write the brief.");
    const handoffs = (await running.readConversation(writer.id)).messages.filter(
      (message) => message.author !== "assistant" && message.text.includes("Write the brief."),
    );
    expect(handoffs).toHaveLength(1);

    // A later sweep, and a new runtime as after a restart, find nothing more to send.
    await runtime.sweep();
    await createHostRoutineFlows({ store, mailbox, service: running, changed: () => undefined }).sweep();
    expect(running.listQueue(writer.id).deliveries).toHaveLength(1);
  });
});
