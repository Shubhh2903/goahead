import {
  type AgentAnalytics,
  type AgentAnalyticsInput,
  type AgentSummary,
  type AgentWeeklyBudgetUsage,
  tokenBudgetLevel,
  tokenBudgetWeekInput,
} from "@openbot/contracts/ipc";

/**
 * This week's tokens of every agent with a weekly token budget, for the Usage tab. It builds the same
 * request as the budget alert (`AgentTokenBudget` in main) with `tokenBudgetWeekInput` and reads the same
 * measure, `totals.processedTokens` of the agent's analytics, so the tab and the alert cannot disagree.
 * Over the budget first, then the warned agents, then the highest share.
 */
export function weeklyBudgetUsage(
  agents: readonly Pick<AgentSummary, "id" | "weeklyTokenBudget">[],
  readAnalytics: (input: AgentAnalyticsInput) => AgentAnalytics,
  now: Date,
  timeZone: string,
): AgentWeeklyBudgetUsage[] {
  return agents
    .flatMap((agent): AgentWeeklyBudgetUsage[] => {
      const budgetTokens = agent.weeklyTokenBudget;
      if (!budgetTokens) return [];
      const week = tokenBudgetWeekInput(agent.id, now, timeZone);
      const usedTokens = readAnalytics(week).totals.processedTokens;
      return [
        {
          agentId: agent.id,
          budgetTokens,
          usedTokens,
          level: tokenBudgetLevel(usedTokens, budgetTokens),
          weekStart: week.startDate,
        },
      ];
    })
    .sort(
      (a, b) =>
        (b.level ?? 0) - (a.level ?? 0) ||
        b.usedTokens / b.budgetTokens - a.usedTokens / a.budgetTokens ||
        a.agentId.localeCompare(b.agentId),
    );
}
