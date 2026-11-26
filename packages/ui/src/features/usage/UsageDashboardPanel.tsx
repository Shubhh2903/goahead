import type { AgentUsageSummary, UsageDashboard, UsageDashboardDays } from "@openbot/contracts/ipc";
import {
  Badge,
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Progress,
  SettingsSection,
  SlidingTabs,
} from "@openbot/ui";
import { createMemo, For, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { UsageProviderMark } from "./UsageProviderMark";
import { type UsageAgentLabel, usageCompact, usageNumber, usageProviderName } from "./usage-format";

export type UsageDashboardPhase = "loading" | "ready" | "error";

export interface UsageDashboardPanelProps {
  dashboard: UsageDashboard | null;
  phase: UsageDashboardPhase;
  days: UsageDashboardDays;
  onDaysChange: (days: UsageDashboardDays) => void;
  onRetry: () => void;
  /** The name of an agent by id. An agent this computer no longer lists shows its id. */
  agentLabel: (agentId: string) => UsageAgentLabel;
}

/** The share of input tokens that came from the provider's cache, or null when there was no input. */
function cachedShare(usage: Pick<AgentUsageSummary, "cachedInput" | "uncachedInput" | "cacheCreation">) {
  const input = usage.cachedInput + usage.uncachedInput + usage.cacheCreation;
  return input === 0 ? null : usage.cachedInput / input;
}

/**
 * The Usage tab of this computer: totals, cached against uncached input, the agents that used the
 * most tokens, and tokens per local day for each agent and provider. Data and actions come from props.
 */
export function UsageDashboardPanel(props: UsageDashboardPanelProps) {
  const text = useText();
  const { t, format } = text;
  const agents = () => props.dashboard?.agents ?? [];
  const totals = createMemo(() => {
    const sum = { uncachedInput: 0, cachedInput: 0, cacheCreation: 0, output: 0, totalTokens: 0 };
    let skippedRuns = props.dashboard?.skippedChannelRuns ?? 0;
    let incompleteRecords = 0;
    for (const agent of agents()) {
      sum.uncachedInput += agent.uncachedInput;
      sum.cachedInput += agent.cachedInput;
      sum.cacheCreation += agent.cacheCreation;
      sum.output += agent.output;
      sum.totalTokens += agent.totalTokens;
      skippedRuns += agent.skippedRuns;
      incompleteRecords += agent.incompleteRecords;
    }
    return { ...sum, skippedRuns, incompleteRecords };
  });
  const empty = () => totals().totalTokens === 0 && totals().skippedRuns === 0;
  const topAgents = () => agents().filter((agent) => agent.totalTokens > 0);
  const percent = (share: number | null) =>
    share === null ? t("usage.unavailable") : format.percent(share, { maximumFractionDigits: 0 });
  // Newest day first, and on one day the agent that used the most first.
  const dailyRows = createMemo(() =>
    agents()
      .flatMap((agent, rank) => agent.daily.map((cell) => ({ agentId: agent.agentId, rank, cell })))
      .sort(
        (a, b) =>
          b.cell.date.localeCompare(a.cell.date) || a.rank - b.rank || a.cell.provider.localeCompare(b.cell.provider),
      ),
  );
  const tokenRows = [
    { label: "usage.dashboard.uncachedInput", value: () => totals().uncachedInput },
    { label: "usage.dashboard.cacheCreation", value: () => totals().cacheCreation },
    { label: "usage.dashboard.output", value: () => totals().output },
  ] as const;

  return (
    <>
      <SettingsSection
        title={t("usage.dashboard.title")}
        description={t("usage.dashboard.description")}
        actions={
          <SlidingTabs.Root value={String(props.days)} onChange={(value) => props.onDaysChange(value === "7" ? 7 : 30)}>
            <SlidingTabs.List aria-label={t("usage.dashboard.period")}>
              <SlidingTabs.Trigger value="7">{t("usage.period.days7")}</SlidingTabs.Trigger>
              <SlidingTabs.Trigger value="30">{t("usage.period.days30")}</SlidingTabs.Trigger>
            </SlidingTabs.List>
          </SlidingTabs.Root>
        }
      >
        <Switch>
          <Match when={props.phase === "loading" && !props.dashboard}>
            <p class="agent-usage-tokens-note" role="status">
              {t("usage.dashboard.loading")}
            </p>
          </Match>
          <Match when={props.phase === "error"}>
            <ItemGroup class="settings-modal-card">
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemDescription role="alert">{t("usage.dashboard.loadFailed")}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button variant="secondary" onClick={() => props.onRetry()}>
                    {t("common.retry")}
                  </Button>
                </ItemActions>
              </Item>
            </ItemGroup>
          </Match>
          <Match when={empty()}>
            <p class="agent-usage-tokens-note" role="status">
              {t("usage.dashboard.empty")}
            </p>
          </Match>
          <Match when={props.dashboard}>
            <ItemGroup class="settings-modal-card">
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>{t("usage.dashboard.totalTokens")}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <ItemDescription>{usageNumber(totals().totalTokens, text)}</ItemDescription>
                </ItemActions>
              </Item>
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>{t("usage.dashboard.cachedInput")}</ItemTitle>
                  <Progress
                    value={(cachedShare(totals()) ?? 0) * 100}
                    minValue={0}
                    maxValue={100}
                    aria-label={t("usage.dashboard.cachedMeter")}
                    getValueLabel={() => percent(cachedShare(totals()))}
                  />
                  <ItemDescription>
                    {t("usage.dashboard.cachedShare", { share: percent(cachedShare(totals())) })}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <ItemDescription>{usageNumber(totals().cachedInput, text)}</ItemDescription>
                </ItemActions>
              </Item>
              <For each={tokenRows}>
                {(row) => (
                  <Item class="settings-modal-row">
                    <ItemContent>
                      <ItemTitle>{t(row.label)}</ItemTitle>
                    </ItemContent>
                    <ItemActions>
                      <ItemDescription>{usageNumber(row.value(), text)}</ItemDescription>
                    </ItemActions>
                  </Item>
                )}
              </For>
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>{t("usage.dashboard.skippedRuns")}</ItemTitle>
                  <ItemDescription>
                    {t("usage.dashboard.skippedRunsDescription")}
                    <Show when={props.dashboard?.skippedChannelRuns}>
                      {(count) => <> {t("usage.dashboard.skippedChannelRuns", { count: count() })}</>}
                    </Show>
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <ItemDescription>{usageNumber(totals().skippedRuns, text)}</ItemDescription>
                </ItemActions>
              </Item>
            </ItemGroup>
            <Show when={totals().incompleteRecords > 0}>
              <p class="agent-usage-tokens-note" role="status">
                {t("usage.dashboard.incomplete", { count: totals().incompleteRecords })}
              </p>
            </Show>
          </Match>
        </Switch>
      </SettingsSection>

      <Show when={props.phase !== "error" && props.dashboard}>
        {(dashboard) => (
          <SettingsSection
            title={t("usage.dashboard.budget.title")}
            description={t("usage.dashboard.budget.description")}
          >
            <Show
              when={dashboard().weeklyBudgets.length > 0}
              fallback={
                <p class="agent-usage-tokens-note" role="status">
                  {t("usage.dashboard.budget.empty")}
                </p>
              }
            >
              <ItemGroup class="settings-modal-card">
                <For each={dashboard().weeklyBudgets}>
                  {(budget) => {
                    const name = () => props.agentLabel(budget.agentId).name;
                    const share = () =>
                      format.percent(budget.usedTokens / budget.budgetTokens, { maximumFractionDigits: 0 });
                    return (
                      <Item class="settings-modal-row">
                        <ItemContent>
                          <ItemTitle>{name()}</ItemTitle>
                          <Progress
                            value={Math.min(budget.usedTokens, budget.budgetTokens)}
                            minValue={0}
                            maxValue={budget.budgetTokens}
                            aria-label={t("usage.dashboard.budget.meter", { name: name() })}
                            getValueLabel={share}
                          />
                          <ItemDescription>
                            {t("usage.dashboard.budget.used", {
                              used: usageNumber(budget.usedTokens, text),
                              budget: usageNumber(budget.budgetTokens, text),
                              percent: share(),
                            })}
                          </ItemDescription>
                        </ItemContent>
                        <Show when={budget.level}>
                          {(level) => (
                            <ItemActions>
                              <Badge variant={level() === 100 ? "destructive-light" : "warning-light"}>
                                {level() === 100
                                  ? t("usage.dashboard.budget.over")
                                  : t("usage.dashboard.budget.warned")}
                              </Badge>
                            </ItemActions>
                          )}
                        </Show>
                      </Item>
                    );
                  }}
                </For>
              </ItemGroup>
            </Show>
          </SettingsSection>
        )}
      </Show>

      <Show when={props.dashboard && !empty() && props.phase !== "error" && topAgents().length > 0}>
        <SettingsSection title={t("usage.dashboard.topAgents")}>
          <ItemGroup class="settings-modal-card">
            <For each={topAgents()}>
              {(agent) => {
                const label = () => props.agentLabel(agent.agentId);
                const providers = () => [...new Set(agent.daily.map((cell) => cell.provider))];
                return (
                  <Item class="settings-modal-row">
                    <ItemContent>
                      <ItemTitle>
                        <span class="agent-usage-model-name">
                          <For each={providers()}>{(provider) => <UsageProviderMark provider={provider} />}</For>
                          <span>{label().name}</span>
                        </span>
                      </ItemTitle>
                      <Progress
                        value={agent.totalTokens}
                        minValue={0}
                        maxValue={topAgents()[0]?.totalTokens ?? agent.totalTokens}
                        aria-label={t("usage.dashboard.agentMeter", { name: label().name })}
                        getValueLabel={() => t("usage.tokensAmount", { tokens: usageNumber(agent.totalTokens, text) })}
                      />
                      <ItemDescription>
                        {t("usage.dashboard.agentDetail", {
                          cached: percent(cachedShare(agent)),
                          count: agent.skippedRuns,
                        })}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <ItemDescription>
                        <span aria-hidden="true">
                          {t("usage.tokensAmount", { tokens: usageCompact(agent.totalTokens, text) })}
                        </span>
                        <span class="sr-only">
                          {t("usage.tokensAmount", { tokens: usageNumber(agent.totalTokens, text) })}
                        </span>
                      </ItemDescription>
                    </ItemActions>
                  </Item>
                );
              }}
            </For>
          </ItemGroup>
        </SettingsSection>

        <SettingsSection title={t("usage.dashboard.daily")}>
          <div class="agent-usage-table">
            <table>
              <caption class="sr-only">{t("usage.dashboard.dailyTable")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("usage.dashboard.column.date")}</th>
                  <th scope="col">{t("usage.dashboard.column.agent")}</th>
                  <th scope="col">{t("usage.dashboard.column.provider")}</th>
                  <th scope="col">{t("usage.dashboard.cachedInput")}</th>
                  <th scope="col">{t("usage.dashboard.uncachedInput")}</th>
                  <th scope="col">{t("usage.dashboard.cacheCreation")}</th>
                  <th scope="col">{t("usage.dashboard.output")}</th>
                  <th scope="col">{t("usage.dashboard.column.total")}</th>
                </tr>
              </thead>
              <tbody>
                <For each={dailyRows()}>
                  {(row) => (
                    <tr>
                      <th scope="row">{row.cell.date}</th>
                      <td>{props.agentLabel(row.agentId).name}</td>
                      <td>
                        <span class="agent-usage-model-name">
                          <UsageProviderMark provider={row.cell.provider} />
                          <span>{usageProviderName(row.cell.provider)}</span>
                        </span>
                      </td>
                      <td>{usageNumber(row.cell.cachedInput, text)}</td>
                      <td>{usageNumber(row.cell.uncachedInput, text)}</td>
                      <td>{usageNumber(row.cell.cacheCreation, text)}</td>
                      <td>{usageNumber(row.cell.output, text)}</td>
                      <td>{usageNumber(row.cell.totalTokens, text)}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </SettingsSection>
      </Show>
    </>
  );
}
