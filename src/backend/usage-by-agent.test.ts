// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UsageRange, UsageTokens } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentRoutineStore } from "./agent-routine-store";
import { ChannelRoutineStore } from "./channel-routine-store";
import { runCauseEffect } from "./effect-boundary";
import { OpenBotDatabase } from "./openbot-database";

const roots: string[] = [];
const databases: OpenBotDatabase[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const db of databases.splice(0)) db.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function database(): Promise<OpenBotDatabase> {
  const root = await mkdtemp(join(tmpdir(), "goahead-usage-dashboard-"));
  roots.push(root);
  const db = new OpenBotDatabase(root);
  await runCauseEffect(db.initialize());
  databases.push(db);
  return db;
}

function output(tokens: number): UsageTokens {
  return { uncachedInput: 0, cachedInput: 0, cacheCreation: 0, output: tokens };
}

describe("usage by agent", () => {
  it("sums a resumed session once across two providers, by agent, provider and local day", async () => {
    // Only Date is faked: a record takes the current time. The records are written directly, so this
    // tests the dashboard sums and not the rules of the provider collectors.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-05T10:00:00Z"));
    const db = await database();
    const totals = (
      agentId: string,
      provider: "codex" | "claude",
      counterId: string,
      turnId: string,
      tokens: [uncached: number, cached: number, cacheCreation: number, output: number],
      baseline = false,
    ) =>
      db.usage.record({
        agentId,
        sessionId: `${counterId}-session`,
        turnId,
        provider,
        model: provider === "codex" ? "gpt-5.6-sol" : "claude-sonnet-5",
        counterId,
        tokens: { uncachedInput: tokens[0], cachedInput: tokens[1], cacheCreation: tokens[2], output: tokens[3] },
        baseline,
      });

    // A counter reports cumulative totals: each record counts only what is new.
    totals("coder", "codex", "codex-1", "turn-1", [100, 200, 0, 50]);
    vi.setSystemTime(new Date("2027-01-05T11:00:00Z"));
    totals("coder", "codex", "codex-1", "turn-2", [300, 500, 0, 80]);
    // The same report again adds nothing.
    totals("coder", "codex", "codex-1", "turn-2", [300, 500, 0, 80]);
    vi.setSystemTime(new Date("2027-01-05T12:00:00Z"));
    totals("writer", "claude", "thread-a", "turn-1", [100, 1000, 50, 40]);

    // The next day: the session resumes with the same counter and reports its whole totals.
    vi.setSystemTime(new Date("2027-01-06T08:00:00Z"));
    totals("writer", "claude", "thread-a", "turn-2", [150, 1800, 50, 70]);
    // A resumed session with no checkpoint is a baseline: no tokens.
    totals("writer", "claude", "thread-b", "turn-3", [500, 500, 0, 500], true);
    totals("writer", "claude", "thread-b", "turn-4", [510, 500, 0, 505]);
    vi.setSystemTime(new Date("2027-01-06T09:00:00Z"));
    totals("coder", "codex", "codex-1", "turn-3", [400, 600, 0, 100]);
    // The Codex agent also ran one Claude turn: one agent, two providers.
    totals("coder", "claude", "thread-c", "turn-5", [10, 0, 0, 10]);

    const range: UsageRange = { days: 7, endDate: "2027-01-06", timeZone: "UTC" };
    expect(db.usageDashboard.usageByAgent(range)).toEqual([
      {
        agentId: "writer",
        uncachedInput: 160,
        cachedInput: 1800,
        cacheCreation: 50,
        output: 75,
        totalTokens: 2085,
        incompleteRecords: 0,
        skippedRuns: 0,
        daily: [
          {
            date: "2027-01-05",
            provider: "claude",
            uncachedInput: 100,
            cachedInput: 1000,
            cacheCreation: 50,
            output: 40,
            totalTokens: 1190,
          },
          {
            date: "2027-01-06",
            provider: "claude",
            uncachedInput: 60,
            cachedInput: 800,
            cacheCreation: 0,
            output: 35,
            totalTokens: 895,
          },
        ],
      },
      {
        agentId: "coder",
        uncachedInput: 410,
        cachedInput: 600,
        cacheCreation: 0,
        output: 110,
        totalTokens: 1120,
        incompleteRecords: 0,
        skippedRuns: 0,
        daily: [
          {
            date: "2027-01-05",
            provider: "codex",
            uncachedInput: 300,
            cachedInput: 500,
            cacheCreation: 0,
            output: 80,
            totalTokens: 880,
          },
          {
            date: "2027-01-06",
            provider: "claude",
            uncachedInput: 10,
            cachedInput: 0,
            cacheCreation: 0,
            output: 10,
            totalTokens: 20,
          },
          {
            date: "2027-01-06",
            provider: "codex",
            uncachedInput: 100,
            cachedInput: 100,
            cacheCreation: 0,
            output: 20,
            totalTokens: 220,
          },
        ],
      },
    ]);
  });

  it("keeps cached, uncached and cache-write input apart and counts the known keys of an incomplete row", async () => {
    const db = await database();
    const base = {
      agentId: "agent-a",
      sessionId: "session-a",
      turnId: "turn-a",
      provider: "codex",
      model: "gpt-5.6-sol",
      baseline: false,
      occurredAt: "2026-09-02T12:00:00Z",
    };
    db.usage.record({
      ...base,
      counterId: "complete",
      tokens: { uncachedInput: 100, cachedInput: 200, cacheCreation: 30, output: 50 },
    });
    db.usage.record({
      ...base,
      counterId: "incomplete",
      tokens: { uncachedInput: null, cachedInput: 400, cacheCreation: 0, output: 10 },
    });
    const [summary] = db.usageDashboard.usageByAgent({ days: 7, endDate: "2026-09-07", timeZone: "UTC" });
    expect(summary).toMatchObject({
      uncachedInput: 100,
      cachedInput: 600,
      cacheCreation: 30,
      output: 60,
      totalTokens: 790,
      incompleteRecords: 1,
    });
  });

  it("uses the local days of the time zone at the 7-day and 30-day boundaries", async () => {
    const db = await database();
    // Each row has its own counter and a distinct output, so the sum names the rows it holds.
    const rows: Array<[string, number]> = [
      ["2026-08-31T14:59:59Z", 16], // Tokyo 08-31 23:59:59
      ["2026-08-31T15:00:00Z", 32], // Tokyo 09-01 00:00
      ["2026-09-23T14:59:59Z", 1], // Tokyo 09-23 23:59:59, Los Angeles 09-23 07:59
      ["2026-09-23T15:00:00Z", 2], // Tokyo 09-24 00:00, Los Angeles 09-23 08:00
      ["2026-09-24T07:00:00Z", 256], // Tokyo 09-24 16:00, Los Angeles 09-24 00:00
      ["2026-09-30T14:59:59Z", 4], // Tokyo 09-30 23:59:59, Los Angeles 09-30 07:59
      ["2026-09-30T15:00:00Z", 8], // Tokyo 10-01 00:00, Los Angeles 09-30 08:00
      ["2026-10-01T06:59:59Z", 64], // Los Angeles 09-30 23:59:59, one UTC day after the range
      ["2026-10-01T07:00:00Z", 128], // Los Angeles 10-01 00:00
    ];
    for (const [occurredAt, tokens] of rows)
      db.usage.record({
        agentId: "agent-a",
        sessionId: "session-a",
        turnId: occurredAt,
        provider: "codex",
        model: "gpt-5.6-sol",
        counterId: occurredAt,
        baseline: false,
        occurredAt,
        tokens: output(tokens),
      });
    const total = (range: UsageRange) => db.usageDashboard.usageByAgent(range)[0]?.totalTokens;
    const tokyo7: UsageRange = { days: 7, endDate: "2026-09-30", timeZone: "Asia/Tokyo" };
    expect(total(tokyo7)).toBe(2 + 256 + 4);
    expect(db.usageDashboard.usageByAgent(tokyo7)[0]?.daily.map((cell) => [cell.date, cell.totalTokens])).toEqual([
      ["2026-09-24", 258],
      ["2026-09-30", 4],
    ]);
    expect(total({ ...tokyo7, days: 30 })).toBe(32 + 1 + 2 + 256 + 4);
    expect(total({ days: 7, endDate: "2026-09-30", timeZone: "America/Los_Angeles" })).toBe(256 + 4 + 8 + 64);
  });

  it("counts the scheduled runs that a run condition skipped, by agent, and channel runs apart", async () => {
    const db = await database();
    const agentRoutines = new AgentRoutineStore(db);
    const routine = agentRoutines.create({
      agentId: "coder",
      name: "Watch the build",
      instruction: "Check the build.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "hourly", minute: 0 },
    });
    const run = (scheduledFor: string, status: "cancelled" | "failed", error: string | null) => {
      const created = agentRoutines.createRun(routine, routine.trigger.id, "scheduled", scheduledFor);
      agentRoutines.updateRunStatus(created.id, status, error);
    };
    const unchanged = sourceText("error.backend.routineRunConditionUnchanged");
    const notMet = sourceText("error.backend.routineRunConditionNotMet");
    run("2026-09-29T05:00:00.000Z", "cancelled", unchanged);
    run("2026-09-30T05:00:00.000Z", "cancelled", notMet);
    // A limit-policy skip and a failure are not run-condition skips.
    run("2026-09-28T05:00:00.000Z", "cancelled", null);
    run("2026-09-27T05:00:00.000Z", "failed", unchanged);
    // Outside the 7-day range, inside the 30-day range.
    run("2026-09-05T05:00:00.000Z", "cancelled", unchanged);

    db.connection
      .prepare("INSERT INTO projection_channels(channel_id, channel_json) VALUES (?, ?)")
      .run("channel-1", JSON.stringify({ id: "channel-1" }));
    const channelRoutines = new ChannelRoutineStore(db);
    const channelRoutine = channelRoutines.create({
      channelId: "channel-1",
      name: "Watch the inbox",
      instruction: "Check the inbox.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "hourly", minute: 0 },
    });
    const channelRun = channelRoutines.createRun(
      channelRoutine,
      channelRoutine.trigger.id,
      "scheduled",
      "2026-09-30T06:00:00.000Z",
    );
    channelRoutines.updateRunStatus(channelRun.id, "cancelled", unchanged);

    const range: UsageRange = { days: 7, endDate: "2026-09-30", timeZone: "UTC" };
    // An agent with skipped runs and no tokens is still listed.
    expect(db.usageDashboard.usageByAgent(range)).toEqual([
      expect.objectContaining({ agentId: "coder", totalTokens: 0, skippedRuns: 2, daily: [] }),
    ]);
    expect(db.usageDashboard.usageByAgent({ ...range, days: 30 })[0]?.skippedRuns).toBe(3);
    expect(db.usageDashboard.skippedChannelRuns(range)).toBe(1);
  });

  it("answers an empty list when nothing is recorded", async () => {
    const db = await database();
    const range: UsageRange = { days: 30, endDate: "2026-09-30", timeZone: "UTC" };
    expect(db.usageDashboard.usageByAgent(range)).toEqual([]);
    expect(db.usageDashboard.skippedChannelRuns(range)).toBe(0);
  });
});
