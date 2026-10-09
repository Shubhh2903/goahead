// The bridge calls of the hand-off cards. Only this computer's host answers them.

import type { AgentHandoff } from "@openbot/contracts/ipc";

export interface HandoffsPort {
  list: (agentId: string) => Promise<AgentHandoff[]>;
  /** Calls `reload` when the hand-offs of this sender change. */
  subscribe: (agentId: string, reload: () => void) => () => void;
}

export const localHandoffsPort: HandoffsPort = {
  list: (agentId) => window.openbot.handoffs.list(agentId),
  subscribe: (agentId, reload) =>
    window.openbot.handoffs.onChanged((change) => {
      if (change.agentId === agentId) reload();
    }),
};
