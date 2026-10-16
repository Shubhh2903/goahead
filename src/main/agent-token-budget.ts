// The weekly token budget of each agent on this computer. A budget only alerts: it never stops work.

import type { AgentAnalytics, AgentAnalyticsInput, AgentEvent, AgentSummary } from "@openbot/contracts/ipc";

/** The share of the budget at which the user hears about it, lowest first. */
const ALERT_LEVELS = [80, 100] as const;
export type TokenBudgetLevel = (typeof ALERT_LEVELS)[number];

export interface TokenBudgetAlert {
  agent: AgentSummary;
  level: TokenBudgetLevel;
  usedTokens: number;
  budgetTokens: number;
}

export interface AgentTokenBudgetOptions {
  listAgents(): AgentSummary[];
  getAnalytics(input: AgentAnalyticsInput): AgentAnalytics;
  notify(alert: TokenBudgetAlert): void;
  now?: () => Date;
  timeZone?: () => string;
}

/**
 * Reads an agent's tokens of this week after each turn it completes, and alerts once per level per
 * week. The week starts on Monday at 00:00 in the computer's time zone, as the usage view counts days.
 * The alerts already shown are kept in memory: after a restart, a level can alert once more.
 */
export class AgentTokenBudget {
  readonly #options: AgentTokenBudgetOptions;
  /** The highest level already shown, by agent and week start. */
  readonly #shown = new Map<string, TokenBudgetLevel>();

  constructor(options: AgentTokenBudgetOptions) {
    this.#options = options;
  }

  handle(event: AgentEvent): void {
    if (event.type !== "turn-completed") return;
    this.check(event.agentId);
  }

  check(agentId: string): void {
    const agent = this.#options.listAgents().find((candidate) => candidate.id === agentId);
    const budgetTokens = agent?.weeklyTokenBudget;
    if (!agent || !budgetTokens) return;
    const now = this.#options.now?.() ?? new Date();
    const timeZone = this.#options.timeZone?.() ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const startDate = weekStart(now);
    const usedTokens = this.#options.getAnalytics({
      agentId,
      startDate,
      endDate: localDate(now),
      timeZone,
    }).totals.processedTokens;
    const level = [...ALERT_LEVELS].reverse().find((candidate) => usedTokens >= (budgetTokens * candidate) / 100);
    if (!level) return;
    const key = `${agentId}:${startDate}`;
    const shown = this.#shown.get(key);
    if (shown !== undefined && shown >= level) return;
    this.#shown.set(key, level);
    this.#options.notify({ agent, level, usedTokens, budgetTokens });
  }
}

/** `YYYY-MM-DD` of the date in the computer's time zone. */
function localDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The Monday of the week of `date`, in the computer's time zone. */
function weekStart(date: Date): string {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return localDate(monday);
}
