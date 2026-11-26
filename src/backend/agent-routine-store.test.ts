// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROUTINE_MISSED_COUNT_LIMIT } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { onceRoutineSchedule, RoutineInputError } from "@openbot/team-client/routine-schedule";
import { afterEach, describe, expect, it } from "vitest";
import { routineToolSchedule, routineToolView } from "./agent/routine-tools";
import { AgentRoutineStore } from "./agent-routine-store";
import { AgentStore } from "./agent-store";
import { ChannelRoutineStore } from "./channel-routine-store";
import { OpenBotDatabase } from "./openbot-database";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("AgentRoutineStore", () => {
  it("persists a routine, its trigger, and immutable run snapshots", async () => {
    const { database, routines } = await setup();
    const routine = routines.create(
      {
        agentId: "chief",
        name: "Morning brief",
        instruction: "Prepare the daily brief.",
        active: true,
        timezone: "Europe/Warsaw",
        schedule: { kind: "weekdays", time: "07:00" },
      },
      new Date("2026-08-25T10:00:00.000Z"),
    );
    expect(routine.trigger.schedule).toEqual({ kind: "weekdays", time: "07:00" });

    const run = routines.createRun(routine, routine.trigger.id, "scheduled", "2026-08-26T05:00:00.000Z");
    routines.update({ agentId: "chief", routineId: routine.id, name: "Changed name", instruction: "New text" });
    expect(routines.listRuns("chief", routine.id, 10, true)[0]).toMatchObject({
      id: run.id,
      routineName: "Morning brief",
      instruction: "Prepare the daily brief.",
    });
    database.close();

    const reopened = new OpenBotDatabase(database.userDataPath);
    await reopened.initialize();
    expect(new AgentRoutineStore(reopened).list("chief")).toHaveLength(1);
    reopened.close();
  });

  it("does not create a duplicate scheduled run", async () => {
    const { database, routines } = await setup();
    const routine = routines.create({
      agentId: "chief",
      name: "Check queue",
      instruction: "Check the queue.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "hourly", minute: 0 },
    });
    const triggerId = routine.trigger.id;
    const first = routines.createRun(routine, triggerId, "scheduled", "2026-08-25T12:00:00.000Z");
    const second = routines.createRun(routine, triggerId, "scheduled", "2026-08-25T12:00:00.000Z");
    expect(second.id).toBe(first.id);
    expect(routines.listRuns("chief", routine.id, 10, true)).toHaveLength(1);
    database.close();
  });

  it("skips missed times after a cold start", async () => {
    const { database, routines } = await setup();
    const routine = routines.create(
      {
        agentId: "chief",
        name: "Quarter hour",
        instruction: "Run the check.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "interval", amount: 15, unit: "minutes", anchorAt: "2026-08-25T10:00:00.000Z" },
      },
      new Date("2026-08-25T10:00:00.000Z"),
    );
    routines.skipMissed(new Date("2026-08-25T12:07:00.000Z"));
    expect(routines.get("chief", routine.id)?.trigger.nextRunAt).toBe("2026-08-25T12:15:00.000Z");
    const skipped = {
      kind: "scheduled",
      status: "cancelled",
      deliveryId: null,
      scheduledFor: "2026-08-25T10:15:00.000Z",
      missed: { count: 8, until: "2026-08-25T12:00:00.000Z" },
    };
    expect(routines.listRuns("chief", routine.id, 10, true)).toEqual([expect.objectContaining(skipped)]);
    // Only the local history asks for the record; the Team API, the calendar and the flows do not get it.
    expect(routines.listRuns("chief", routine.id, 10)).toEqual([]);
    expect(routines.pendingRuns()).toEqual([]);
    // A second start finds nothing missed and records nothing.
    routines.skipMissed(new Date("2026-08-25T12:10:00.000Z"));
    expect(routines.listRuns("chief", routine.id, 10, true)).toEqual([expect.objectContaining(skipped)]);
    database.close();
  });

  it("runs the newest missed time once and records the others when the routine asks", async () => {
    const { database, routines } = await setup();
    const now = new Date("2026-08-25T12:07:00.000Z");
    const routine = routines.create(
      {
        agentId: "chief",
        name: "Quarter hour",
        instruction: "Run the check.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "interval", amount: 15, unit: "minutes", anchorAt: "2026-08-25T10:00:00.000Z" },
        missedPolicy: "run-once",
      },
      new Date("2026-08-25T10:00:00.000Z"),
    );
    routines.skipMissed(now);
    expect(routines.get("chief", routine.id)).toMatchObject({
      missedPolicy: "run-once",
      trigger: { nextRunAt: "2026-08-25T12:00:00.000Z" },
    });
    expect(routines.due(now).map((due) => due.nextRunAt)).toEqual(["2026-08-25T12:00:00.000Z"]);
    expect(routines.listRuns("chief", routine.id, 10, true)).toEqual([
      expect.objectContaining({
        status: "cancelled",
        scheduledFor: "2026-08-25T10:15:00.000Z",
        missed: { count: 7, until: "2026-08-25T11:45:00.000Z" },
      }),
    ]);
    database.close();
  });

  it("records nothing when a routine set to run once missed one time", async () => {
    const { database, routines } = await setup();
    const routine = routines.create(
      {
        agentId: "chief",
        name: "Quarter hour",
        instruction: "Run the check.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "interval", amount: 15, unit: "minutes", anchorAt: "2026-08-25T10:00:00.000Z" },
        missedPolicy: "run-once",
      },
      new Date("2026-08-25T10:00:00.000Z"),
    );
    routines.skipMissed(new Date("2026-08-25T10:20:00.000Z"));
    expect(routines.get("chief", routine.id)?.trigger.nextRunAt).toBe("2026-08-25T10:15:00.000Z");
    expect(routines.listRuns("chief", routine.id, 10, true)).toEqual([]);
    database.close();
  });

  // A crash after the run was made and before the trigger moved leaves a due time that already ran.
  describe("one-time routines", () => {
    const AT = "2026-08-25T11:00:00.000Z";
    const createOnce = (routines: AgentRoutineStore, missedPolicy: "skip" | "run-once") =>
      routines.create(
        {
          agentId: "chief",
          name: "Release note",
          instruction: "Write the release note.",
          active: true,
          timezone: "UTC",
          schedule: onceRoutineSchedule(new Date(AT)),
          missedPolicy,
        },
        new Date("2026-08-25T10:00:00.000Z"),
      );

    it("turns off when its trigger moves past its one time", async () => {
      const { database, routines } = await setup();
      const routine = createOnce(routines, "skip");
      expect(routine.trigger.nextRunAt).toBe(AT);
      const [due] = routines.due(new Date("2026-08-25T11:00:30.000Z"));
      expect(due?.routine.id).toBe(routine.id);
      routines.advanceTrigger(routine.id, routine.trigger.id, "2300-01-01T00:00:00.000Z");
      expect(routines.get("chief", routine.id)?.active).toBe(false);
      expect(routines.due(new Date("2400-01-01T00:00:00.000Z"))).toEqual([]);
      database.close();
    });

    it("records a time missed while closed and turns off when the routine skips missed times", async () => {
      const { database, routines } = await setup();
      const routine = createOnce(routines, "skip");
      routines.skipMissed(new Date("2026-08-25T13:00:00.000Z"));
      expect(routines.get("chief", routine.id)?.active).toBe(false);
      expect(routines.listRuns("chief", routine.id, 10, true)).toEqual([
        expect.objectContaining({ status: "cancelled", scheduledFor: AT, missed: { count: 1, until: null } }),
      ]);
      database.close();
    });

    it("keeps a time missed while closed due when the routine runs a missed time once", async () => {
      const { database, routines } = await setup();
      const routine = createOnce(routines, "run-once");
      const now = new Date("2026-08-25T13:00:00.000Z");
      routines.skipMissed(now);
      expect(routines.get("chief", routine.id)?.active).toBe(true);
      expect(routines.due(now).map((due) => due.nextRunAt)).toEqual([AT]);
      expect(routines.listRuns("chief", routine.id, 10, true)).toEqual([]);
      database.close();
    });

    it("turns off when its one run ends after a crash left the trigger not moved", async () => {
      const { database, routines } = await setup();
      const routine = createOnce(routines, "run-once");
      const run = routines.createRun(routine, routine.trigger.id, "scheduled", AT);
      routines.skipMissed(new Date("2026-08-25T13:00:00.000Z"));
      // The trigger is past its one time, so nothing else is due; the open run keeps it on.
      expect(routines.get("chief", routine.id)?.active).toBe(true);
      expect(routines.due(new Date("2026-08-25T13:00:00.000Z"))).toEqual([]);
      routines.updateRunStatus(run.id, "succeeded");
      expect(routines.get("chief", routine.id)?.active).toBe(false);
      expect(routines.listRuns("chief", routine.id, 10, true)).toHaveLength(1);
      database.close();
    });

    it("refuses to turn on a one-time routine whose time has passed", async () => {
      const { database, routines } = await setup();
      const routine = createOnce(routines, "skip");
      routines.skipMissed(new Date("2026-08-25T13:00:00.000Z"));
      expect(() =>
        routines.update(
          { agentId: "chief", routineId: routine.id, active: true },
          new Date("2026-08-25T13:00:00.000Z"),
        ),
      ).toThrow(RoutineInputError);
      // A done routine can still be renamed while it stays off.
      expect(
        routines.update(
          { agentId: "chief", routineId: routine.id, name: "Old note" },
          new Date("2026-08-25T13:00:00.000Z"),
        ),
      ).toMatchObject({ name: "Old note", active: false });
      database.close();
    });

    it("reads a one-time time from the agent routine tool in the routine's zone", () => {
      // A clock time without an offset is local to the routine's zone, not to the host process.
      expect(routineToolSchedule({ kind: "once", at: "2026-08-25T09:30" }, "Pacific/Auckland")).toEqual(
        onceRoutineSchedule(new Date("2026-08-24T21:30:00.000Z")),
      );
      expect(routineToolSchedule({ kind: "once", at: "2026-01-15T09:30:00" }, "America/New_York")).toEqual(
        onceRoutineSchedule(new Date("2026-01-15T14:30:00.000Z")),
      );
      // An explicit offset or Z is kept as that instant, whatever the zone.
      expect(routineToolSchedule({ kind: "once", at: "2026-08-25T09:30+02:00" }, "Pacific/Auckland")).toEqual(
        onceRoutineSchedule(new Date("2026-08-25T07:30:00.000Z")),
      );
      expect(routineToolSchedule({ kind: "once", at: AT }, "Pacific/Auckland")).toEqual(
        onceRoutineSchedule(new Date(AT)),
      );
      expect(() => routineToolSchedule({ kind: "once", at: "2026-08-25" }, "UTC")).toThrow(
        sourceText("error.backend.routineOnceTimeDateOnly"),
      );
      expect(() => routineToolSchedule({ kind: "once", at: "soon" }, "UTC")).toThrow(RoutineInputError);
      // A day that the month does not have is not a date, with or without an offset.
      for (const at of ["2027-02-31T09:00", "2027-02-29T09:00Z", "2027-04-31T09:00+02:00"]) {
        expect(() => routineToolSchedule({ kind: "once", at }, "UTC")).toThrow(
          sourceText("error.backend.routineOnceTimeInvalid"),
        );
      }
      expect(routineToolSchedule({ kind: "once", at: "2028-02-29T09:00Z" }, "UTC")).toEqual(
        onceRoutineSchedule(new Date("2028-02-29T09:00:00.000Z")),
      );
    });

    it("shows a one-time routine to the agent tool as once, not as its saved interval", async () => {
      const { database, routines } = await setup();
      const routine = createOnce(routines, "skip");
      expect(routineToolView(routine).trigger.schedule).toEqual({ kind: "once", at: AT });
      database.close();
    });

    it("keeps a repeating interval routine on after its trigger moves", async () => {
      const { database, routines } = await setup();
      const routine = routines.create(
        {
          agentId: "chief",
          name: "Quarter hour",
          instruction: "Run the check.",
          active: true,
          timezone: "UTC",
          schedule: { kind: "interval", amount: 15, unit: "minutes", anchorAt: "2026-08-25T10:00:00.000Z" },
        },
        new Date("2026-08-25T10:00:00.000Z"),
      );
      routines.advanceTrigger(routine.id, routine.trigger.id, "2026-08-25T10:15:00.000Z");
      routines.skipMissed(new Date("2026-08-25T13:00:00.000Z"));
      expect(routines.get("chief", routine.id)?.active).toBe(true);
      database.close();
    });
  });

  it("does not record a missed time that already has its run", async () => {
    const { database, routines } = await setup();
    const routine = routines.create(
      {
        agentId: "chief",
        name: "Quarter hour",
        instruction: "Run the check.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "interval", amount: 15, unit: "minutes", anchorAt: "2026-08-25T10:00:00.000Z" },
      },
      new Date("2026-08-25T10:00:00.000Z"),
    );
    const ran = routines.createRun(routine, routine.trigger.id, "scheduled", "2026-08-25T10:15:00.000Z");
    routines.skipMissed(new Date("2026-08-25T10:50:00.000Z"));
    expect(routines.get("chief", routine.id)?.trigger.nextRunAt).toBe("2026-08-25T11:00:00.000Z");
    // Both rows have the same creation time, so the list order is not fixed.
    const runs = routines.listRuns("chief", routine.id, 10, true);
    expect(runs).toHaveLength(2);
    expect(runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scheduledFor: "2026-08-25T10:30:00.000Z",
          missed: { count: 2, until: "2026-08-25T10:45:00.000Z" },
        }),
        expect.objectContaining({ id: ran.id }),
      ]),
    );
    database.close();
  });

  it("stops counting a long closure at the limit and still finds the newest time", async () => {
    const { database, routines } = await setup();
    const now = new Date("2026-09-04T10:02:00.000Z");
    const schedule = { kind: "interval", amount: 5, unit: "minutes", anchorAt: "2026-08-25T10:00:00.000Z" } as const;
    const fields = { agentId: "chief", instruction: "Run the check.", active: true, timezone: "UTC", schedule };
    const skip = routines.create({ ...fields, name: "Skip" }, new Date("2026-08-25T10:00:00.000Z"));
    const once = routines.create(
      { ...fields, name: "Once", missedPolicy: "run-once" },
      new Date("2026-08-25T10:00:00.000Z"),
    );
    routines.skipMissed(now);
    expect(routines.get("chief", skip.id)?.trigger.nextRunAt).toBe("2026-09-04T10:05:00.000Z");
    expect(routines.listRuns("chief", skip.id, 10, true)[0]?.missed).toEqual({
      count: ROUTINE_MISSED_COUNT_LIMIT + 1,
      until: "2026-09-04T10:00:00.000Z",
    });
    expect(routines.get("chief", once.id)?.trigger.nextRunAt).toBe("2026-09-04T10:00:00.000Z");
    expect(routines.listRuns("chief", once.id, 10, true)[0]?.missed).toEqual({
      count: ROUTINE_MISSED_COUNT_LIMIT + 1,
      until: "2026-09-04T09:55:00.000Z",
    });
    database.close();
  });

  it("keeps a time that came due while a restart held the routines", async () => {
    const { database, routines } = await setup();
    const routine = routines.create(
      {
        agentId: "chief",
        name: "Quarter hour",
        instruction: "Run the check.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "interval", amount: 15, unit: "minutes", anchorAt: "2026-08-25T10:00:00.000Z" },
      },
      new Date("2026-08-25T10:00:00.000Z"),
    );
    routines.skipMissed(new Date("2026-08-25T10:20:00.000Z"), {
      since: new Date("2026-08-25T10:10:00.000Z"),
      until: new Date("2026-08-25T10:18:00.000Z"),
    });
    expect(routines.get("chief", routine.id)?.trigger.nextRunAt).toBe("2026-08-25T10:15:00.000Z");
    database.close();
  });

  it("excludes pending agents from due and next-due routine queries", async () => {
    const { database, routines } = await setup();
    const now = new Date("2026-08-25T10:00:00.000Z");
    routines.create(
      {
        agentId: "chief",
        name: "Quarter hour",
        instruction: "Run every quarter hour.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "interval", amount: 15, unit: "minutes", anchorAt: now.toISOString() },
      },
      now,
    );
    routines.create(
      {
        agentId: "research",
        name: "Half hour",
        instruction: "Run every half hour.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "interval", amount: 30, unit: "minutes", anchorAt: now.toISOString() },
      },
      now,
    );
    const excluded = new Set(["chief"]);

    expect(routines.nextDueAt(excluded)).toBe("2026-08-25T10:30:00.000Z");
    expect(routines.due(new Date("2026-08-25T10:31:00.000Z"), excluded).map((due) => due.routine.agentId)).toEqual([
      "research",
    ]);
    database.close();
  });

  it("reschedules a paused routine from the activation time without creating a run", async () => {
    const { database, routines } = await setup();
    const routine = routines.create(
      {
        agentId: "chief",
        name: "Morning brief",
        instruction: "Prepare the brief.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "daily", time: "09:00" },
      },
      new Date("2026-08-25T08:00:00.000Z"),
    );
    routines.update({ agentId: "chief", routineId: routine.id, active: false }, new Date("2026-08-25T08:30:00.000Z"));

    const resumed = routines.update(
      { agentId: "chief", routineId: routine.id, active: true },
      new Date("2026-08-27T10:00:00.000Z"),
    );

    expect(resumed.trigger.id).toBe(routine.trigger.id);
    expect(resumed.trigger.nextRunAt).toBe("2026-08-28T09:00:00.000Z");
    expect(routines.listRuns("chief", routine.id, 10, true)).toEqual([]);
    database.close();
  });

  it("creates one future trigger when a paused routine is resumed with a new schedule", async () => {
    const { database, routines } = await setup();
    const routine = routines.create(
      {
        agentId: "chief",
        name: "Morning brief",
        instruction: "Prepare the brief.",
        active: false,
        timezone: "Europe/Warsaw",
        schedule: { kind: "daily", time: "07:00" },
      },
      new Date("2026-08-25T08:00:00.000Z"),
    );

    const resumed = routines.update(
      {
        agentId: "chief",
        routineId: routine.id,
        active: true,
        schedule: { kind: "weekdays", time: "08:15" },
      },
      new Date("2026-08-28T10:00:00.000Z"),
    );

    expect(resumed.trigger.id).not.toBe(routine.trigger.id);
    expect(resumed.trigger.schedule).toEqual({ kind: "weekdays", time: "08:15" });
    expect(resumed.trigger.nextRunAt).toBe("2026-08-31T06:15:00.000Z");
    expect(
      database.connection
        .prepare("SELECT COUNT(*) AS count FROM projection_routine_triggers WHERE routine_id = ?")
        .get(routine.id),
    ).toMatchObject({ count: 1 });
    expect(routines.listRuns("chief", routine.id, 10, true)).toEqual([]);
    database.close();
  });

  it("removes routines when the agent is deleted", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-routine-agent-delete-"));
    roots.push(root);
    const agents = new AgentStore(join(root, "data"), join(root, "home"));
    await agents.initialize();
    const agent = await agents.getOrCreate("chief");
    const routines = new AgentRoutineStore(agents.database);
    routines.create({
      agentId: agent.id,
      name: "Temporary",
      instruction: "Remove this routine.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "daily", time: "09:00" },
    });
    await agents.deleteAgent(agent.id);
    expect(routines.list(agent.id)).toEqual([]);
    agents.database.close();
  });
});

/**
 * The same seven cases against the channel owner. Both classes are thin name mappers over one
 * `RoutineStore`, so this block is what proves the shared SQL is owner-agnostic rather than
 * agent-shaped with a channel alias.
 */
describe("ChannelRoutineStore", () => {
  it("persists a routine, its trigger, and immutable run snapshots", async () => {
    const { database, routines } = await channelSetup();
    const routine = routines.create(
      {
        channelId: "channel-1",
        name: "Morning brief",
        instruction: "Prepare the daily brief.",
        active: true,
        timezone: "Europe/Warsaw",
        schedule: { kind: "weekdays", time: "07:00" },
      },
      new Date("2026-08-25T10:00:00.000Z"),
    );
    expect(routine.trigger.schedule).toEqual({ kind: "weekdays", time: "07:00" });

    const run = routines.createRun(routine, routine.trigger.id, "scheduled", "2026-08-26T05:00:00.000Z");
    routines.update({ channelId: "channel-1", routineId: routine.id, name: "Changed name", instruction: "New text" });
    expect(routines.listRuns("channel-1", routine.id, 10, true)[0]).toMatchObject({
      id: run.id,
      routineName: "Morning brief",
      instruction: "Prepare the daily brief.",
      requestMessageId: null,
    });
    database.close();

    const reopened = new OpenBotDatabase(database.userDataPath);
    await reopened.initialize();
    expect(new ChannelRoutineStore(reopened).list("channel-1")).toHaveLength(1);
    reopened.close();
  });

  it("does not create a duplicate scheduled run", async () => {
    const { database, routines } = await channelSetup();
    const routine = routines.create({
      channelId: "channel-1",
      name: "Check queue",
      instruction: "Check the queue.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "hourly", minute: 0 },
    });
    const triggerId = routine.trigger.id;
    const first = routines.createRun(routine, triggerId, "scheduled", "2026-08-25T12:00:00.000Z");
    const second = routines.createRun(routine, triggerId, "scheduled", "2026-08-25T12:00:00.000Z");
    expect(second.id).toBe(first.id);
    expect(routines.listRuns("channel-1", routine.id, 10, true)).toHaveLength(1);
    database.close();
  });

  it("finds a run by the request message the fire posted", async () => {
    const { database, routines } = await channelSetup();
    const routine = routines.create({
      channelId: "channel-1",
      name: "Check queue",
      instruction: "Check the queue.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "hourly", minute: 0 },
    });
    const run = routines.createRun(routine, routine.trigger.id, "scheduled", "2026-08-25T12:00:00.000Z");
    expect(routines.pendingRuns().map((pending) => pending.id)).toEqual([run.id]);
    routines.attachRequest(run.id, "request-1");
    expect(routines.runForRequest("request-1")?.id).toBe(run.id);
    expect(routines.pendingRuns().map((pending) => pending.id)).toEqual([run.id]);
    expect(routines.channelsWithOpenRuns()).toEqual(["channel-1"]);
    database.close();
  });

  it("skips missed times after a cold start", async () => {
    const { database, routines } = await channelSetup();
    const routine = routines.create(
      {
        channelId: "channel-1",
        name: "Quarter hour",
        instruction: "Run the check.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "interval", amount: 15, unit: "minutes", anchorAt: "2026-08-25T10:00:00.000Z" },
      },
      new Date("2026-08-25T10:00:00.000Z"),
    );
    routines.skipMissed(new Date("2026-08-25T12:07:00.000Z"));
    expect(routines.get("channel-1", routine.id)?.trigger.nextRunAt).toBe("2026-08-25T12:15:00.000Z");
    expect(routines.listRuns("channel-1", routine.id, 10, true)).toEqual([
      expect.objectContaining({
        status: "cancelled",
        requestMessageId: null,
        scheduledFor: "2026-08-25T10:15:00.000Z",
        missed: { count: 8, until: "2026-08-25T12:00:00.000Z" },
      }),
    ]);
    expect(routines.pendingRuns()).toEqual([]);
    database.close();
  });

  it("excludes archived channels from due and next-due routine queries", async () => {
    const { database, routines } = await channelSetup(["channel-1", "channel-2"]);
    const now = new Date("2026-08-25T10:00:00.000Z");
    routines.create(
      {
        channelId: "channel-1",
        name: "Quarter hour",
        instruction: "Run every quarter hour.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "interval", amount: 15, unit: "minutes", anchorAt: now.toISOString() },
      },
      now,
    );
    routines.create(
      {
        channelId: "channel-2",
        name: "Half hour",
        instruction: "Run every half hour.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "interval", amount: 30, unit: "minutes", anchorAt: now.toISOString() },
      },
      now,
    );
    const archived = new Set(["channel-1"]);

    expect(routines.nextDueAt(archived)).toBe("2026-08-25T10:30:00.000Z");
    expect(routines.due(new Date("2026-08-25T10:31:00.000Z"), archived).map((due) => due.routine.channelId)).toEqual([
      "channel-2",
    ]);
    database.close();
  });

  it("reschedules a paused routine from the activation time without creating a run", async () => {
    const { database, routines } = await channelSetup();
    const routine = routines.create(
      {
        channelId: "channel-1",
        name: "Morning brief",
        instruction: "Prepare the brief.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "daily", time: "09:00" },
      },
      new Date("2026-08-25T08:00:00.000Z"),
    );
    routines.update(
      { channelId: "channel-1", routineId: routine.id, active: false },
      new Date("2026-08-25T08:30:00.000Z"),
    );

    const resumed = routines.update(
      { channelId: "channel-1", routineId: routine.id, active: true },
      new Date("2026-08-27T10:00:00.000Z"),
    );

    expect(resumed.trigger.id).toBe(routine.trigger.id);
    expect(resumed.trigger.nextRunAt).toBe("2026-08-28T09:00:00.000Z");
    expect(routines.listRuns("channel-1", routine.id, 10, true)).toEqual([]);
    database.close();
  });

  it("creates one future trigger when a paused routine is resumed with a new schedule", async () => {
    const { database, routines } = await channelSetup();
    const routine = routines.create(
      {
        channelId: "channel-1",
        name: "Morning brief",
        instruction: "Prepare the brief.",
        active: false,
        timezone: "Europe/Warsaw",
        schedule: { kind: "daily", time: "07:00" },
      },
      new Date("2026-08-25T08:00:00.000Z"),
    );

    const resumed = routines.update(
      {
        channelId: "channel-1",
        routineId: routine.id,
        active: true,
        schedule: { kind: "weekdays", time: "08:15" },
      },
      new Date("2026-08-28T10:00:00.000Z"),
    );

    expect(resumed.trigger.id).not.toBe(routine.trigger.id);
    expect(resumed.trigger.schedule).toEqual({ kind: "weekdays", time: "08:15" });
    expect(resumed.trigger.nextRunAt).toBe("2026-08-31T06:15:00.000Z");
    expect(
      database.connection
        .prepare("SELECT COUNT(*) AS count FROM projection_channel_routine_triggers WHERE routine_id = ?")
        .get(routine.id),
    ).toMatchObject({ count: 1 });
    expect(routines.listRuns("channel-1", routine.id, 10, true)).toEqual([]);
    database.close();
  });

  it("removes routines when the channel row goes", async () => {
    const { database, routines } = await channelSetup();
    const routine = routines.create({
      channelId: "channel-1",
      name: "Temporary",
      instruction: "Remove this routine.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "daily", time: "09:00" },
    });
    routines.createRun(routine, routine.trigger.id, "scheduled", "2026-08-26T07:00:00.000Z");
    database.connection.prepare("DELETE FROM projection_channels WHERE channel_id = ?").run("channel-1");
    expect(routines.list("channel-1")).toEqual([]);
    expect(routines.listRuns("channel-1", routine.id, 10, true)).toEqual([]);
    database.close();
  });
});

async function setup(): Promise<{ database: OpenBotDatabase; routines: AgentRoutineStore }> {
  const root = await mkdtemp(join(tmpdir(), "openbot-routine-store-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await database.initialize();
  return { database, routines: new AgentRoutineStore(database) };
}

/** A routine needs its channel row: the owner column is a cascading foreign key. */
async function channelSetup(
  channelIds: string[] = ["channel-1"],
): Promise<{ database: OpenBotDatabase; routines: ChannelRoutineStore }> {
  const root = await mkdtemp(join(tmpdir(), "openbot-channel-routine-store-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await database.initialize();
  const insert = database.connection.prepare("INSERT INTO projection_channels(channel_id, channel_json) VALUES (?, ?)");
  for (const channelId of channelIds) insert.run(channelId, JSON.stringify({ id: channelId }));
  return { database, routines: new ChannelRoutineStore(database) };
}
