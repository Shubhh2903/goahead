// Computer Use, local scripts and the busy-message mode of one agent, as this computer holds them.
// The `agent-host-settings-v1` host routes use this, and they write through `AgentService.updateAgent`,
// the writer of the local window, so a remote admin changes the same state.

import {
  type AgentHostSettings,
  type AgentSummary,
  agentAutomationAllowed,
  agentComputerUseEnabled,
  type UpdateAgentHostSettingsInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { AgentService } from "../backend/agent-service";
import { AgentNotFoundError } from "./agent-admin-settings";
import type { BusyMessageModePreferenceStore } from "./busy-message-mode-preference-store";

export interface AgentHostSettingsDependencies {
  agents: Pick<AgentService, "listAgents" | "updateAgent">;
  busyMessageMode: Pick<BusyMessageModePreferenceStore, "get">;
}

export interface AgentHostSettingsService {
  read(agentId: string): AgentHostSettings;
  update(input: UpdateAgentHostSettingsInput): Promise<AgentHostSettings>;
}

export function createAgentHostSettings({
  agents,
  busyMessageMode,
}: AgentHostSettingsDependencies): AgentHostSettingsService {
  function requireAgent(agentId: string): AgentSummary {
    const agent = agents.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) throw new AgentNotFoundError(sourceText("error.team.agentNotFound"));
    return agent;
  }
  function settings(agent: AgentSummary): AgentHostSettings {
    return {
      computerUse: agentComputerUseEnabled(agent),
      allowAutomation: agentAutomationAllowed(agent),
      busyMessageMode: agent.busyMessageMode ?? null,
      defaultBusyMessageMode: busyMessageMode.get().mode,
    };
  }
  return {
    read: (agentId) => settings(requireAgent(agentId)),
    update: async ({ agentId, ...changes }) => {
      requireAgent(agentId);
      return settings(await agents.updateAgent({ agentId, ...changes }));
    },
  };
}
