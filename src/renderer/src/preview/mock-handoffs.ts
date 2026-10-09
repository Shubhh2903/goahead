import type { AgentHandoff, AgentHandoffsChanged, HandoffsDesktopApi } from "@openbot/contracts/ipc";
import { clone } from "./mock-support";

export interface MockHandoffs {
  api: HandoffsDesktopApi;
  /** Replaces one sender's hand-offs and tells the open conversation, as the host does. */
  setHandoffs: (agentId: string, handoffs: AgentHandoff[]) => void;
}

/** The hand-off cards of the preview: the story's, or the ones a test gives. */
export function createMockHandoffs(initial: Record<string, AgentHandoff[]>): MockHandoffs {
  const handoffs = new Map(Object.entries(clone(initial)));
  const listeners = new Set<(change: AgentHandoffsChanged) => void>();
  return {
    api: {
      list: async (agentId) => clone(handoffs.get(agentId) ?? []),
      onChanged: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    setHandoffs: (agentId, next) => {
      handoffs.set(agentId, clone(next));
      for (const listener of listeners) listener({ agentId });
    },
  };
}
