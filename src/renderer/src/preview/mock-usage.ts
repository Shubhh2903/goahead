import {
  type AgentUsageSummary,
  type AgentWeeklyBudgetUsage,
  type ClientAgentSummary,
  tokenBudgetWeekStart,
  type UsageDashboard,
  type UsageDesktopApi,
  type UsageProviderDay,
  usageRangeStart,
} from "@openbot/contracts/ipc";

/**
 * The Usage tab of the preview: each agent spends a different amount each day with its own
 * provider, and the first agent has two skipped routine runs, so every region of the tab shows data.
 */
export function createMockUsage(listAgents: () => ClientAgentSummary[]): UsageDesktopApi {
  return {
    getDashboard: async (range): Promise<UsageDashboard> => {
      const startDate = usageRangeStart(range);
      const agents = listAgents().map((agent, index): AgentUsageSummary => {
        const weight = listAgents().length - index;
        const daily: UsageProviderDay[] = [];
        for (let offset = 0; offset < range.days; offset++) {
          const day = new Date(`${startDate}T12:00:00Z`);
          day.setUTCDate(day.getUTCDate() + offset);
          const scale = ((offset + index) % 5) * weight;
          if (scale === 0) continue;
          const cell = {
            date: day.toISOString().slice(0, 10),
            provider: agent.provider,
            uncachedInput: scale * 4000,
            cachedInput: scale * 16000,
            cacheCreation: scale * 500,
            output: scale * 1200,
            totalTokens: 0,
          };
          cell.totalTokens = cell.uncachedInput + cell.cachedInput + cell.cacheCreation + cell.output;
          daily.push(cell);
        }
        const sum = (key: "uncachedInput" | "cachedInput" | "cacheCreation" | "output" | "totalTokens") =>
          daily.reduce((total, cell) => total + cell[key], 0);
        return {
          agentId: agent.id,
          uncachedInput: sum("uncachedInput"),
          cachedInput: sum("cachedInput"),
          cacheCreation: sum("cacheCreation"),
          output: sum("output"),
          totalTokens: sum("totalTokens"),
          incompleteRecords: 0,
          skippedRuns: index === 0 ? 2 : 0,
          daily,
        };
      });
      return {
        ...range,
        startDate,
        agents: agents.sort((a, b) => b.totalTokens - a.totalTokens),
        skippedChannelRuns: 1,
        // One agent over its budget and one warned, so both marks show.
        weeklyBudgets: listAgents()
          .slice(0, 2)
          .map(
            (agent, index): AgentWeeklyBudgetUsage => ({
              agentId: agent.id,
              budgetTokens: 5_000_000,
              usedTokens: index === 0 ? 5_400_000 : 4_100_000,
              level: index === 0 ? 100 : 80,
              weekStart: tokenBudgetWeekStart(new Date()),
            }),
          ),
      };
    },
  };
}
