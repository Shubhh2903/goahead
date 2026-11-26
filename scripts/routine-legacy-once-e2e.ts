import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Routine } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { redactText } from "@openbot/logging";
import { ROUTINE_ONCE_INTERVAL_DAYS } from "@openbot/team-client/routine-schedule";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { RoutineScheduler } from "../src/backend/agent/routine-scheduler";
import { AgentRoutineStore } from "../src/backend/agent-routine-store";
import { AgentStore } from "../src/backend/agent-store";
import { AgentWaitStore } from "../src/backend/agent-waits/agent-wait-store";
import { AgentWaits } from "../src/backend/agent-waits/agent-waits";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { RoutineTimer } from "../src/backend/routine-timer";

/**
 * GoAhead v0.40 and v0.41 store a one-time routine as an interval of 100,000 days. This build reads
 * such a row as a one-time routine without a rewrite, and saves a new one-time routine in that shape,
 * so a downgrade still reads it. Repeated skips for the same reason add one chat row.
 */
const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "routine-legacy-once-e2e");
const STEP = 5 * 60_000;
const TRIGGERS = "projection_routine_triggers";

interface Fixture {
  database: OpenBotDatabase;
  conversation: ConversationRuntime;
  scheduler: RoutineScheduler;
  runs: AgentRoutineStore;
  agentId: string;
  errors: string[];
  close(): void;
}

type CaseDetails = DynamicRecord;

interface CaseResult {
  name: string;
  passed: boolean;
  details?: CaseDetails;
  error?: string;
}

const ownedRoots: string[] = [];
const cases: CaseResult[] = [];

async function openFixture(conditionExitCode = 0): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "openbot-routine-legacy-once-"));
  ownedRoots.push(root);
  const database = new OpenBotDatabase(join(root, "state"));
  const store = new AgentStore(join(root, "state"), join(root, "home"), database);
  const mailbox = new MailboxStore(join(root, "state"), store.sharedRoot, database);
  await runCauseEffect(store.initialize());
  await runCauseEffect(mailbox.initialize());
  const agent = await runCauseEffect(
    store.createAgent({
      name: "Legacy once fixture",
      description: "Synthetic routine fixture",
      avatarSeed: "routine-legacy-once",
      avatarHue: null,
    }),
  );
  const errors: string[] = [];
  const conversation = new ConversationRuntime(
    store,
    () => {},
    () => store.list(),
  );
  const timer = new RoutineTimer(
    () => [],
    () => false,
    (code) => errors.push(code),
  );
  const waits = new AgentWaits({
    store: new AgentWaitStore({ database }),
    mailbox,
    hooks: {
      emit: () => {},
      ownsRoutine: () => true,
      hasRoutine: () => true,
      requireKnownAgent: () => {},
      isSideThread: () => false,
    },
  });
  const scheduler = new RoutineScheduler({
    store,
    mailbox,
    conversation,
    timer,
    waits,
    timezone: () => "UTC",
    runConditionCommand: async () => ({ exitCode: conditionExitCode, output: "" }),
    hooks: {
      emit: () => {},
      emitError: (code) => errors.push(code),
      emitQueue: () => {},
      scheduleDrain: () => {},
      interrupt: () => Effect.void,
      awaitDrain: () => undefined,
      syncMailboxMessages: () => {},
      listAgents: () => store.list(),
      excludedAgents: () => new Set(),
      isRunning: () => false,
      usageLimited: () => false,
      routineThread: () => null,
      waitThread: () => null,
      queueHold: () => null,
      routineDeleted: () => Effect.void,
    },
  });
  return {
    database,
    conversation,
    scheduler,
    runs: new AgentRoutineStore(database),
    agentId: agent.id,
    errors,
    close() {
      timer.dispose();
      conversation.dispose();
      database.close();
    },
  };
}

function hourly(fixture: Fixture, name: string): Routine {
  return fixture.scheduler.create(
    {
      agentId: fixture.agentId,
      name,
      instruction: "Send the prepared reminder.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "hourly", minute: 0 },
      limitPolicy: "wait",
    },
    { recordConversationEvent: false },
  );
}

function storedSchedule(fixture: Fixture, routineId: string): string {
  const row = fixture.database.connection
    .prepare(`SELECT schedule_json FROM ${TRIGGERS} WHERE routine_id = ?`)
    .get(routineId);
  assert.ok(isDynamicRecord(row) && isString(row.schedule_json), "The routine has a trigger row.");
  return row.schedule_json;
}

/** The row that GoAhead v0.41 writes for a one-time routine at `at`. */
function writeLegacyOnce(fixture: Fixture, routineId: string, at: Date, nextRunAt: Date): string {
  const json = JSON.stringify({
    kind: "interval",
    amount: ROUTINE_ONCE_INTERVAL_DAYS,
    unit: "days",
    anchorAt: at.toISOString(),
  });
  fixture.database.connection
    .prepare(`UPDATE ${TRIGGERS} SET schedule_json = ?, next_run_at = ? WHERE routine_id = ?`)
    .run(json, nextRunAt.toISOString(), routineId);
  return json;
}

function routine(fixture: Fixture, routineId: string): Routine {
  const found = fixture.scheduler.list(fixture.agentId).find((candidate) => candidate.id === routineId);
  assert.ok(found, "The routine is listed.");
  return found;
}

async function legacyRowReadsAsOnce(): Promise<CaseDetails> {
  const fixture = await openFixture();
  try {
    const created = hourly(fixture, "Legacy reminder");
    const at = new Date(Date.parse(created.trigger.nextRunAt) + 24 * 3_600_000);
    const legacy = writeLegacyOnce(fixture, created.id, at, at);
    const read = routine(fixture, created.id);
    const date = at.toISOString().slice(0, 10);
    const time = at.toISOString().slice(11, 16);
    assert.deepEqual(read.trigger.schedule, { kind: "once", date, time });
    assert.equal(storedSchedule(fixture, created.id), legacy, "A read does not rewrite the stored row.");
    await runCauseEffect(fixture.scheduler.processDue(at));
    const runs = fixture.runs.listRuns(fixture.agentId, created.id, 10, true);
    assert.equal(runs.length, 1, "The one time makes one run.");
    assert.equal(routine(fixture, created.id).active, false, "The routine turns off after its one run.");
    await runCauseEffect(fixture.scheduler.processDue(new Date(at.getTime() + 7 * 24 * 3_600_000)));
    assert.equal(fixture.runs.listRuns(fixture.agentId, created.id, 10, true).length, 1, "It does not run again.");
    assert.equal(storedSchedule(fixture, created.id), legacy, "The stored row keeps the v0.41 shape.");
    assert.deepEqual(fixture.errors, []);
    return { schedule: read.trigger.schedule };
  } finally {
    fixture.close();
  }
}

async function newOnceSavesLegacyShape(): Promise<CaseDetails> {
  const fixture = await openFixture();
  try {
    const at = new Date(Math.ceil((Date.now() + 2 * 24 * 3_600_000) / 60_000) * 60_000);
    const date = at.toISOString().slice(0, 10);
    const time = at.toISOString().slice(11, 16);
    const created = fixture.scheduler.create(
      {
        agentId: fixture.agentId,
        name: "New reminder",
        instruction: "Send the prepared reminder.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "once", date, time },
      },
      { recordConversationEvent: false },
    );
    assert.deepEqual(created.trigger.schedule, { kind: "once", date, time });
    const stored = JSON.parse(storedSchedule(fixture, created.id));
    assert.deepEqual(
      stored,
      { kind: "interval", amount: ROUTINE_ONCE_INTERVAL_DAYS, unit: "days", anchorAt: at.toISOString() },
      "A new one-time routine is saved in the shape that v0.40 and v0.41 read.",
    );
    assert.equal(created.trigger.nextRunAt, at.toISOString());
    return { stored };
  } finally {
    fixture.close();
  }
}

async function legacyAdvancedRunEnds(): Promise<CaseDetails> {
  const fixture = await openFixture();
  try {
    const created = hourly(fixture, "Waiting legacy reminder");
    const at = new Date(Date.now() - 3_600_000);
    // v0.41 moved the trigger past the one time while the run waited for a spent plan.
    writeLegacyOnce(fixture, created.id, at, new Date(at.getTime() + ROUTINE_ONCE_INTERVAL_DAYS * 86_400_000));
    const current = fixture.runs.get(fixture.agentId, created.id);
    assert.ok(current);
    const run = fixture.runs.createRun(current, current.trigger.id, "scheduled", at.toISOString());
    assert.equal(routine(fixture, created.id).active, true, "The routine stays on while its run is open.");
    fixture.runs.updateRunStatus(run.id, "succeeded");
    assert.equal(routine(fixture, created.id).active, false, "The routine turns off when its run ends.");
    return { runId: run.id };
  } finally {
    fixture.close();
  }
}

async function repeatedSkipOneRow(): Promise<CaseDetails> {
  const fixture = await openFixture(1);
  try {
    const created = fixture.scheduler.create(
      {
        agentId: fixture.agentId,
        name: "Watch the build",
        instruction: "Report the new build.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "custom", expression: "*/5 * * * *" },
        limitPolicy: "wait",
        runCondition: { command: "test -f build.done", when: "exit-zero" },
      },
      { recordConversationEvent: false },
    );
    const start = new Date(created.trigger.nextRunAt);
    for (let step = 0; step < 3; step += 1)
      await runCauseEffect(fixture.scheduler.processDue(new Date(start.getTime() + step * STEP)));
    const runs = fixture.runs.listRuns(fixture.agentId, created.id, 10, true);
    assert.equal(runs.length, 3, "Each skipped run keeps its record.");
    assert.ok(runs.every((run) => run.status === "cancelled"));
    const rows = (fixture.conversation.snapshot(fixture.agentId)?.messages ?? []).filter(
      (message) => message.author === "system" && message.text === "Watch the build",
    );
    assert.equal(rows.length, 1, "Skips with the same reason add one chat row.");
    assert.deepEqual(fixture.errors, []);
    return { runs: runs.length, rows: rows.length };
  } finally {
    fixture.close();
  }
}

function safe(value: string): string {
  let result = redactText(value);
  for (const root of [...ownedRoots, ROOT, homedir()]) result = result.replaceAll(root, "[private-root]");
  return result;
}

async function runCase(name: string, work: () => Promise<CaseDetails>): Promise<void> {
  const row: CaseResult = { name, passed: false };
  cases.push(row);
  try {
    row.details = await work();
    row.passed = true;
  } catch (error) {
    row.error = safe(error instanceof Error ? (error.stack ?? error.message) : String(error)).slice(0, 8192);
  }
  process.stdout.write(`${row.passed ? "PASS" : "FAIL"} ${name}${row.error ? `: ${row.error}` : ""}\n`);
}

const CASES: Array<[string, () => Promise<CaseDetails>]> = [
  ["a v0.41 one-time row reads as once and runs one time", legacyRowReadsAsOnce],
  ["a new one-time routine is saved in the v0.41 shape", newOnceSavesLegacyShape],
  ["a v0.41 one-time routine with an open run turns off when the run ends", legacyAdvancedRunEnds],
  ["repeated skips for the same reason add one chat row", repeatedSkipOneRow],
];

try {
  for (const [name, work] of CASES) await runCase(name, work);
} finally {
  for (const root of ownedRoots) await rm(root, { recursive: true, force: true });
  const passed = cases.length === CASES.length && cases.every((row) => row.passed);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${safe(JSON.stringify({ passed, cases }, null, 2))}\n`);
  process.stdout.write(`${passed ? "PASS" : "FAIL"}: report in ${join(OUT, "report.json")}\n`);
  if (!passed) process.exitCode = 1;
}
