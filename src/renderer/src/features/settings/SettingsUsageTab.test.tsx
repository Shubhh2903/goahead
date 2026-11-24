import { type UsageRange, usageRangeStart } from "@openbot/contracts/ipc";
import { UsageDashboardPanel } from "@openbot/ui/features/usage/UsageDashboardPanel";
import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installOpenbotStub } from "../../app-test-harness";
import { createSettingsUsageStore } from "./settings-usage-store";

beforeEach(installOpenbotStub);

function UsageTab() {
  const usage = createSettingsUsageStore(() => true);
  return (
    <UsageDashboardPanel
      dashboard={usage.state.dashboard}
      phase={usage.state.phase}
      days={usage.state.days}
      onDaysChange={usage.setDays}
      onRetry={usage.reload}
      agentLabel={usage.agentLabel}
    />
  );
}

describe("Usage tab", () => {
  it("shows the empty state when this computer recorded no usage", async () => {
    render(() => <UsageTab />);
    expect(await screen.findByText("No agent on this computer used tokens in this period.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      screen.getByText("No agent has a weekly token budget. Set one in the agent's settings."),
    ).toBeInTheDocument();
  });

  it("shows tokens per day by agent and provider, and reads 30 days when the period changes", async () => {
    vi.mocked(window.openbot.usage.getDashboard).mockImplementation(async (range: UsageRange) => ({
      ...range,
      startDate: usageRangeStart(range),
      skippedChannelRuns: 0,
      weeklyBudgets: [
        { agentId: "over-agent", budgetTokens: 5_000_000, usedTokens: 5_000_000, level: 100, weekStart: "2026-09-28" },
        { agentId: "near-agent", budgetTokens: 5_000_000, usedTokens: 4_250_000, level: 80, weekStart: "2026-09-28" },
      ],
      agents: [
        {
          agentId: "agent-unknown",
          uncachedInput: 100,
          cachedInput: 300,
          cacheCreation: 0,
          output: 50,
          totalTokens: 450,
          incompleteRecords: 0,
          skippedRuns: 2,
          daily: [
            {
              date: range.endDate,
              provider: "codex",
              uncachedInput: 100,
              cachedInput: 300,
              cacheCreation: 0,
              output: 50,
              totalTokens: 450,
            },
          ],
        },
      ],
    }));
    render(() => <UsageTab />);
    const table = await screen.findByRole("table", { name: "Tokens per day by agent and provider" });
    expect(within(table).getByRole("cell", { name: "agent-unknown" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "450" })).toBeInTheDocument();
    expect(screen.getByText("75% of input came from the cache")).toBeInTheDocument();
    const budgets = screen.getByRole("region", { name: "Weekly budgets" });
    expect(within(budgets).getByText("Over budget")).toBeInTheDocument();
    expect(within(budgets).getByText("Near budget")).toBeInTheDocument();
    expect(within(budgets).getByText(/ tokens · 85%$/)).toBeInTheDocument();
    expect(window.openbot.usage.getDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ days: 7 }));

    await fireEvent.click(screen.getByRole("tab", { name: "30 days" }));
    await vi.waitFor(() =>
      expect(window.openbot.usage.getDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ days: 30 })),
    );
  });
});
