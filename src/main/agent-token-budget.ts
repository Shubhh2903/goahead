// The weekly token budget of each agent on this computer. A budget only alerts: it never stops work.

import {
  type AgentAnalytics,
  type AgentAnalyticsInput,
  type AgentEvent,
  type AgentSummary,
  type TokenBudgetLevel,
  tokenBudgetLevel,
  tokenBudgetWeekInput,
} from "@openbot/contracts/ipc";

export type { TokenBudgetLevel } from "@openbot/contracts/ipc";

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
    // The Usage tab measures the same request, so the alert and the tab cannot disagree.
    const week = tokenBudgetWeekInput(agentId, now, timeZone);
    const usedTokens = this.#options.getAnalytics(week).totals.processedTokens;
    const level = tokenBudgetLevel(usedTokens, budgetTokens);
    if (!level) return;
    const key = `${agentId}:${week.startDate}`;
    const shown = this.#shown.get(key);
    if (shown !== undefined && shown >= level) return;
    this.#shown.set(key, level);
    this.#options.notify({ agent, level, usedTokens, budgetTokens });
  }
}
