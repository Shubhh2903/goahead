// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSummary, AgentWeeklyTokenBudget } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";
import { weeklyBudgetUsage } from "../backend/agent/weekly-token-budget";
import { OpenBotDatabase } from "../backend/openbot-database";
import { AgentTokenBudget, type TokenBudgetAlert } from "./agent-token-budget";

// The tests run with TZ=UTC (tools/vitest/hermetic-environment.ts), so the computer's local midnight
// is UTC midnight. Wednesday 2026-09-30; the budget week starts on Monday 2026-09-28.
const NOW = new Date("2026-09-30T12:00:00Z");
const TIME_ZONE = "UTC";

const roots: string[] = [];
const databases: OpenBotDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function agent(id: string, weeklyTokenBudget?: AgentWeeklyTokenBudget): AgentSummary {
  return {
    id,
    name: id,
    title: "",
    description: "",
    notifications: true,
    provider: "codex",
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
    weeklyTokenBudget,
    threadId: null,
    workspacePath: "",
    preview: "",
    updatedAt: null,
    avatarSeed: id,
    avatarHue: null,
    avatarUrl: null,
  };
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "goahead-token-budget-"));
  roots.push(root);
  const db = new OpenBotDatabase(root);
  await db.initialize();
  databases.push(db);
  const use = (agentId: string, occurredAt: string, output: number) =>
    db.usage.record({
      agentId,
      sessionId: "session",
      turnId: occurredAt,
      provider: "codex",
      model: "gpt-5.6-sol",
      counterId: `${agentId}:${occurredAt}`,
      baseline: false,
      occurredAt,
      tokens: { uncachedInput: 0, cachedInput: 0, cacheCreation: 0, output },
    });
  const agents = [agent("warned", 5_000_000), agent("over", 5_000_000), agent("none"), agent("boundary", 5_000_000)];
  use("warned", "2026-09-29T09:00:00Z", 4_250_000);
  use("over", "2026-09-28T09:00:00Z", 2_000_000);
  use("over", "2026-09-30T09:00:00Z", 3_000_000);
  use("none", "2026-09-29T09:00:00Z", 90_000_000);
  // Sunday 23:59:59 local is the previous week; Monday 00:00 local is this week.
  use("boundary", "2026-09-27T23:59:59Z", 4_000_000);
  use("boundary", "2026-09-28T00:00:00Z", 1_000);
  return { db, agents };
}

describe("weekly token budget", () => {
  it("lists only agents with a budget, over budget first, with the alert's week and levels", async () => {
    const { db, agents } = await setup();
    expect(weeklyBudgetUsage(agents, (input) => db.usage.read(input), NOW, TIME_ZONE)).toEqual([
      { agentId: "over", budgetTokens: 5_000_000, usedTokens: 5_000_000, level: 100, weekStart: "2026-09-28" },
      { agentId: "warned", budgetTokens: 5_000_000, usedTokens: 4_250_000, level: 80, weekStart: "2026-09-28" },
      { agentId: "boundary", budgetTokens: 5_000_000, usedTokens: 1_000, level: null, weekStart: "2026-09-28" },
    ]);
  });

  it("measures the same tokens and level as the budget alert for the same rows", async () => {
    const { db, agents } = await setup();
    const alerts: TokenBudgetAlert[] = [];
    const budget = new AgentTokenBudget({
      listAgents: () => agents,
      getAnalytics: (input) => db.usage.read(input),
      notify: (alert) => alerts.push(alert),
      now: () => NOW,
      timeZone: () => TIME_ZONE,
    });
    for (const { id } of agents) budget.check(id);
    const dashboard = weeklyBudgetUsage(agents, (input) => db.usage.read(input), NOW, TIME_ZONE);
    expect(alerts.map((alert) => [alert.agent.id, alert.usedTokens, alert.level]).sort()).toEqual(
      dashboard
        .filter((entry) => entry.level !== null)
        .map((entry) => [entry.agentId, entry.usedTokens, entry.level])
        .sort(),
    );
    // The agent below 80% gets no alert, and the dashboard shows it with no level.
    expect(alerts.some((alert) => alert.agent.id === "boundary")).toBe(false);
    const read = vi.fn((input: Parameters<typeof db.usage.read>[0]) => db.usage.read(input));
    weeklyBudgetUsage([agent("boundary", 5_000_000)], read, NOW, TIME_ZONE);
    expect(read).toHaveBeenCalledWith({
      agentId: "boundary",
      startDate: "2026-09-28",
      endDate: "2026-09-30",
      timeZone: TIME_ZONE,
    });
  });
});
