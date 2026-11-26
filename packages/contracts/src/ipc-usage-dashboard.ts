import { type AgentAnalyticsInput, analyticsDate, parseAnalyticsRange } from "./ipc-agent-analytics";
import { type AgentWeeklyTokenBudget, isAgentWeeklyTokenBudget } from "./ipc-agents";
import { type DynamicRecord, isDynamicRecord, isString } from "./runtime-values";

/**
 * The Usage tab of this computer: tokens per local day for each agent and provider, and the routine
 * runs that a run condition skipped. It reads only the local database; a joined server's usage stays
 * in the host usage report.
 */
export const USAGE_DASHBOARD_DAYS = [7, 30] as const;
export type UsageDashboardDays = (typeof USAGE_DASHBOARD_DAYS)[number];

/** The last `days` local days that end with `endDate` in `timeZone`. */
export interface UsageRange {
  days: UsageDashboardDays;
  endDate: string;
  timeZone: string;
}

interface UsageTokenTotals {
  uncachedInput: number;
  cachedInput: number;
  /** Input written to the provider's cache. It is not read from the cache. */
  cacheCreation: number;
  output: number;
  totalTokens: number;
}

/** The tokens of one agent with one provider on one local day. */
export interface UsageProviderDay extends UsageTokenTotals {
  date: string;
  provider: string;
}

export interface AgentUsageSummary extends UsageTokenTotals {
  agentId: string;
  /** Usage rows with a token count the provider did not report. Their known counts are included. */
  incompleteRecords: number;
  /** Scheduled routine runs of this agent that a run condition skipped. */
  skippedRuns: number;
  /** One cell for each local day and provider that has usage, sorted by date and then provider. */
  daily: UsageProviderDay[];
}

/** The share of the weekly budget, in percent, at which the user hears about it, lowest first. */
export const TOKEN_BUDGET_ALERT_LEVELS = [80, 100] as const;
export type TokenBudgetLevel = (typeof TOKEN_BUDGET_ALERT_LEVELS)[number];

/** The highest alert level that `usedTokens` reached, or null below the first. */
export function tokenBudgetLevel(usedTokens: number, budgetTokens: number): TokenBudgetLevel | null {
  return [...TOKEN_BUDGET_ALERT_LEVELS].reverse().find((level) => usedTokens >= (budgetTokens * level) / 100) ?? null;
}

/** `YYYY-MM-DD` of the date in the computer's time zone. */
export function computerLocalDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The Monday of the week of `date`, in the computer's time zone. A budget week starts there at 00:00. */
export function tokenBudgetWeekStart(date: Date): string {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return computerLocalDate(monday);
}

/**
 * The analytics request that measures an agent's tokens of this budget week: from Monday to today in
 * the computer's time zone. The budget alert and the Usage tab both read `totals.processedTokens` of
 * this request, so they cannot disagree.
 */
export function tokenBudgetWeekInput(agentId: string, now: Date, timeZone: string): AgentAnalyticsInput {
  return { agentId, startDate: tokenBudgetWeekStart(now), endDate: computerLocalDate(now), timeZone };
}

/** One agent with a weekly token budget, and its tokens of this week. */
export interface AgentWeeklyBudgetUsage {
  agentId: string;
  budgetTokens: AgentWeeklyTokenBudget;
  usedTokens: number;
  /** The highest alert level reached this week, as the budget alert counts it. */
  level: TokenBudgetLevel | null;
  /** The Monday the week starts on, in the computer's time zone. */
  weekStart: string;
}

export interface UsageDashboard {
  days: UsageDashboardDays;
  startDate: string;
  endDate: string;
  timeZone: string;
  /** Most tokens first. An agent with only skipped runs is included with zero tokens. */
  agents: AgentUsageSummary[];
  /** Scheduled channel routine runs that a run condition skipped. A channel has no agent. */
  skippedChannelRuns: number;
  /**
   * Every agent with a weekly token budget, over the budget first. The week is the budget alert's week,
   * not the range above.
   */
  weeklyBudgets: AgentWeeklyBudgetUsage[];
}

/** Today in the user's time zone, and the days before it. */
export function usageRange(days: UsageDashboardDays, now = new Date()): UsageRange {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return { days, endDate: analyticsDate(now, timeZone), timeZone };
}

/** The first local day of the range. */
export function usageRangeStart(range: UsageRange): string {
  const start = new Date(`${range.endDate}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - range.days + 1);
  return start.toISOString().slice(0, 10);
}

function isUsageDashboardDays(value: unknown): value is UsageDashboardDays {
  return value === 7 || value === 30;
}

export function parseUsageRange(value: unknown): UsageRange {
  if (!isDynamicRecord(value) || !isUsageDashboardDays(value.days)) throw new Error("Invalid usage range.");
  const { endDate, timeZone } = parseAnalyticsRange({
    startDate: value.endDate,
    endDate: value.endDate,
    timeZone: value.timeZone,
  });
  return { days: value.days, endDate, timeZone };
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid usage count.");
  return value;
}

function decodeTokenTotals(item: DynamicRecord): UsageTokenTotals {
  return {
    uncachedInput: count(item.uncachedInput),
    cachedInput: count(item.cachedInput),
    cacheCreation: count(item.cacheCreation),
    output: count(item.output),
    totalTokens: count(item.totalTokens),
  };
}

function decodeProviderDay(value: unknown): UsageProviderDay {
  if (!isDynamicRecord(value) || !isString(value.date) || !isString(value.provider))
    throw new Error("Invalid usage day.");
  return { date: value.date, provider: value.provider, ...decodeTokenTotals(value) };
}

function decodeAgentUsageSummary(value: unknown): AgentUsageSummary {
  if (!isDynamicRecord(value) || !isString(value.agentId) || !Array.isArray(value.daily))
    throw new Error("Invalid agent usage.");
  return {
    agentId: value.agentId,
    ...decodeTokenTotals(value),
    incompleteRecords: count(value.incompleteRecords),
    skippedRuns: count(value.skippedRuns),
    daily: value.daily.map(decodeProviderDay),
  };
}

function decodeWeeklyBudgetUsage(value: unknown): AgentWeeklyBudgetUsage {
  if (
    !isDynamicRecord(value) ||
    !isString(value.agentId) ||
    !isString(value.weekStart) ||
    !isAgentWeeklyTokenBudget(value.budgetTokens) ||
    (value.level !== null && value.level !== 80 && value.level !== 100)
  )
    throw new Error("Invalid weekly budget usage.");
  return {
    agentId: value.agentId,
    budgetTokens: value.budgetTokens,
    usedTokens: count(value.usedTokens),
    level: value.level,
    weekStart: value.weekStart,
  };
}

export function decodeUsageDashboard(value: unknown): UsageDashboard {
  if (
    !isDynamicRecord(value) ||
    !Array.isArray(value.agents) ||
    !Array.isArray(value.weeklyBudgets) ||
    !isString(value.startDate)
  )
    throw new Error("Invalid usage dashboard.");
  const range = parseUsageRange(value);
  return {
    ...range,
    startDate: value.startDate,
    agents: value.agents.map(decodeAgentUsageSummary),
    skippedChannelRuns: count(value.skippedChannelRuns),
    weeklyBudgets: value.weeklyBudgets.map(decodeWeeklyBudgetUsage),
  };
}
