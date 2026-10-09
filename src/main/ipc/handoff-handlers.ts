// The work this computer's agents gave to teammates, for the hand-off cards of a conversation.

import type { AgentService } from "../../backend/agent-service";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { stringPayload } from "./validation";

export interface HandoffIpcDependencies {
  agents: Pick<AgentService, "listHandoffs">;
}

/**
 * One endpoint. Only the local server answers it: a remote server's agents run on another
 * computer, and no released Team API protocol carries hand-offs.
 */
export function handoffIpcHandlers({ agents }: HandoffIpcDependencies): Pick<IpcGroupHandlers, "handoffs"> {
  return {
    handoffs: {
      list: payloadHandler(stringPayload("agentId"), (agentId) => agents.listHandoffs(agentId)),
    },
  };
}
