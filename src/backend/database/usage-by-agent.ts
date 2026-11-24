import {
  type AgentUsageSummary,
  analyticsDate,
  decodeUsageTokens,
  type UsageProviderDay,
  type UsageRange,
  usageRangeStart,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { DatabaseCore } from "./database-core";
import { databaseRows, requiredStringColumn } from "./database-rows";

const TOKEN_KEYS = ["uncachedInput", "cachedInput", "cacheCreation", "output"] as const;
const DAY_MS = 86_400_000;

/**
 * Owns the read-only queries of the Usage tab: tokens per agent, provider and local day, and the
 * scheduled routine runs that a run condition skipped. It reads `agent_usage_records`, which
 * `AgentUsage` writes, and the routine run projections. It writes nothing and never imports the facade.
 *
 * A usage row is already the difference from the previous cumulative report of its counter (see
 * `AgentUsage.record`), so a resumed session or a repeated report adds no tokens twice. The sum of the
 * rows is the usage.
 */
export class UsageByAgent {
  readonly #core: DatabaseCore;
  constructor(core: DatabaseCore) {
    this.#core = core;
  }

  usageByAgent(range: UsageRange): AgentUsageSummary[] {
    const window = queryWindow(range);
    const agents = new Map<string, AgentUsageSummary>();
    const cells = new Map<string, UsageProviderDay>();
    const agent = (agentId: string): AgentUsageSummary => {
      let entry = agents.get(agentId);
      if (!entry) {
        entry = {
          agentId,
          uncachedInput: 0,
          cachedInput: 0,
          cacheCreation: 0,
          output: 0,
          totalTokens: 0,
          incompleteRecords: 0,
          skippedRuns: 0,
          daily: [],
        };
        agents.set(agentId, entry);
      }
      return entry;
    };
    const records = databaseRows(
      this.#core.connection
        .prepare(
          "SELECT agent_id, provider, occurred_at, tokens_json FROM agent_usage_records WHERE occurred_at >= ? AND occurred_at < ?",
        )
        .all(window.from, window.until),
    );
    for (const row of records) {
      const date = window.localDate(requiredStringColumn(row, "occurred_at"));
      if (!date) continue;
      const agentId = requiredStringColumn(row, "agent_id");
      const provider = requiredStringColumn(row, "provider");
      const tokens = decodeUsageTokens(JSON.parse(requiredStringColumn(row, "tokens_json")));
      const summary = agent(agentId);
      const cellKey = JSON.stringify([agentId, date, provider]);
      let cell = cells.get(cellKey);
      if (!cell) {
        cell = { date, provider, uncachedInput: 0, cachedInput: 0, cacheCreation: 0, output: 0, totalTokens: 0 };
        cells.set(cellKey, cell);
        summary.daily.push(cell);
      }
      // A key the provider did not report adds nothing; the known keys of the row still count.
      if (TOKEN_KEYS.some((key) => tokens[key] === null)) summary.incompleteRecords++;
      for (const key of TOKEN_KEYS) {
        const value = tokens[key];
        if (value === null) continue;
        summary[key] += value;
        summary.totalTokens += value;
        cell[key] += value;
        cell.totalTokens += value;
      }
    }
    const skipped = databaseRows(
      this.#core.connection
        .prepare(
          "SELECT agent_id, scheduled_for FROM projection_routine_runs WHERE status = 'cancelled' AND error IN (?, ?) AND scheduled_for >= ? AND scheduled_for < ?",
        )
        .all(...runConditionReasons(), window.from, window.until),
    );
    for (const row of skipped)
      if (window.localDate(requiredStringColumn(row, "scheduled_for")))
        agent(requiredStringColumn(row, "agent_id")).skippedRuns++;
    for (const summary of agents.values())
      summary.daily.sort((a, b) => a.date.localeCompare(b.date) || a.provider.localeCompare(b.provider));
    return [...agents.values()].sort((a, b) => b.totalTokens - a.totalTokens || a.agentId.localeCompare(b.agentId));
  }

  /** Scheduled channel routine runs that a run condition skipped. A channel run has no agent. */
  skippedChannelRuns(range: UsageRange): number {
    const window = queryWindow(range);
    return databaseRows(
      this.#core.connection
        .prepare(
          "SELECT scheduled_for FROM projection_channel_routine_runs WHERE status = 'cancelled' AND error IN (?, ?) AND scheduled_for >= ? AND scheduled_for < ?",
        )
        .all(...runConditionReasons(), window.from, window.until),
    ).filter((row) => window.localDate(requiredStringColumn(row, "scheduled_for"))).length;
  }
}

/**
 * The two reasons a run condition stores on the run it skips. `sourceText` is English and stays the
 * same byte for byte, and no other cancelled run carries either text, so they identify the skip.
 */
function runConditionReasons(): [string, string] {
  return [
    sourceText("error.backend.routineRunConditionUnchanged"),
    sourceText("error.backend.routineRunConditionNotMet"),
  ];
}

/**
 * SQLite cannot convert a timestamp to an IANA zone, so the query reads one UTC day more before the
 * range and two after it - every offset from UTC-12 to UTC+14 - and each timestamp is then put on
 * its local day with the same formatter as the host report. A row outside the local range gives null.
 */
function queryWindow(range: UsageRange) {
  const startDate = usageRangeStart(range);
  return {
    from: new Date(Date.parse(startDate) - DAY_MS).toISOString(),
    until: new Date(Date.parse(range.endDate) + 2 * DAY_MS).toISOString(),
    localDate(timestamp: string): string | null {
      const time = Date.parse(timestamp);
      if (!Number.isFinite(time)) return null;
      const date = analyticsDate(new Date(time), range.timeZone);
      return date >= startDate && date <= range.endDate ? date : null;
    },
  };
}
