import {
  type AgentSummary,
  LOCAL_SERVER_ID,
  type UsageDashboard,
  type UsageDashboardDays,
  usageRange,
} from "@openbot/contracts/ipc";
import type { UsageDashboardPhase } from "@openbot/ui/features/usage/UsageDashboardPanel";
import type { UsageAgentLabel } from "@openbot/ui/features/usage/usage-format";
import { createEffect, createStore } from "solid-js";
import { usageDashboardPort } from "./usage-dashboard-port";

interface SettingsUsageState {
  days: UsageDashboardDays;
  dashboard: UsageDashboard | null;
  phase: UsageDashboardPhase;
  agents: AgentSummary[];
}

/**
 * The Usage tab's view of this computer's usage. It is created by the settings dialog and reads
 * again each time the tab opens or the period changes. It always reads the local host: a joined
 * server's usage stays in the host usage report.
 */
export function createSettingsUsageStore(active: () => boolean) {
  const [state, setState] = createStore<SettingsUsageState>({
    days: 7,
    dashboard: null,
    phase: "loading",
    agents: [],
  });
  let generation = 0;

  async function load(): Promise<void> {
    const request = ++generation;
    const days = state.days;
    setState((draft) => {
      draft.phase = "loading";
    });
    try {
      const [dashboard, agents] = await Promise.all([
        usageDashboardPort().usage.getDashboard(usageRange(days)),
        // The names are a label only: without them a row shows the agent id.
        usageDashboardPort()
          .agent.listAgents(LOCAL_SERVER_ID)
          .catch((): AgentSummary[] => []),
      ]);
      if (request !== generation) return;
      setState((draft) => {
        draft.dashboard = dashboard;
        draft.agents = agents;
        draft.phase = "ready";
      });
    } catch {
      if (request !== generation) return;
      setState((draft) => {
        draft.dashboard = null;
        draft.phase = "error";
      });
    }
  }

  createEffect(
    () => active() && state.days,
    (days) => {
      if (days) void load();
    },
  );

  return {
    state,
    reload: () => void load(),
    setDays(days: UsageDashboardDays): void {
      setState((draft) => {
        draft.days = days;
      });
    },
    agentLabel(agentId: string): UsageAgentLabel {
      const agent = state.agents.find((candidate) => candidate.id === agentId);
      return { name: agent?.name ?? agentId, provider: agent?.provider ?? "", avatar: agent };
    },
  };
}

export type SettingsUsageStore = ReturnType<typeof createSettingsUsageStore>;
