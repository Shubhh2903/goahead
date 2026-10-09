// Connects the emotion engine to what the agents do and to the two places that show the face: the
// Dynamic Island windows and the macOS Dock. `index.ts` sends the events here; this module only
// translates them, so the engine stays pure.
import type {
  AgentEvent,
  AgentHandoff,
  AgentHandoffStatus,
  DynamicIslandPreference,
  DynamicIslandPresentation,
  EmotionId,
  ServerSummary,
} from "@openbot/contracts/ipc";
import { dynamicIslandEmotionsEnabled, LOCAL_SERVER_ID } from "@openbot/contracts/ipc";
import type { DockEmotion } from "./dock-emotion";
import { createEmotionEngine } from "./emotion-engine";

/** How often the time-based rules (joy, strain, sleepy, idle changes, held changes) apply. */
export const EMOTION_TICK_MS = 1_000;

export interface EmotionFacesOptions {
  island: { setEmotion: (emotion: EmotionId | undefined) => void };
  dock: Pick<DockEmotion, "show">;
  now: () => number;
  random: () => number;
  /** Starts the tick timer. The caller makes it unref'd, so it does not keep the app alive. */
  every: (run: () => void, intervalMs: number) => { cancel: () => void };
}

export interface EmotionFaces {
  agentEvent: (serverId: string, event: AgentEvent) => void;
  /** A local agent ran one tool step. */
  toolUse: (serverId: string, agentId: string) => void;
  /** The hand-offs of one local sender changed. `handoffs` is the sender's whole current list. */
  handoffsChanged: (senderId: string, handoffs: readonly Pick<AgentHandoff, "id" | "status">[]) => void;
  presentation: (presentation: DynamicIslandPresentation) => void;
  /** Faces show only while both the Dynamic Island and its "Show emotions" switch are on. */
  preference: (preference: Pick<DynamicIslandPreference, "enabled" | "emotionsEnabled">) => void;
  /**
   * The remote servers changed. A server that is gone or not online sends no `turn-completed`, so
   * its turns end here. Otherwise the face could stay on strain until the app restarts.
   */
  serversChanged: (servers: readonly Pick<ServerSummary, "id" | "state">[]) => void;
  /** The user did something, such as focusing a window. */
  activity: () => void;
  dispose: () => void;
}

export function createEmotionFaces({ island, dock, now, random, every }: EmotionFacesOptions): EmotionFaces {
  // Off until the stored preference is read, so a user who turned faces off never sees one.
  let enabled = false;
  // The last status of each hand-off, by sender. Only the sender's current list is kept.
  const handoffStatuses = new Map<string, Map<string, AgentHandoffStatus>>();
  // The agents with an active turn, by server. Only these turns can use tools, and a server that
  // goes away ends its turns.
  const activeTurns = new Map<string, Set<string>>();
  const engine = createEmotionEngine({ now, random, onChange: show });
  const timer = every(() => engine.tick(), EMOTION_TICK_MS);

  function show(emotion: EmotionId): void {
    if (!enabled) return;
    island.setEmotion(emotion);
    dock.show(emotion);
  }

  // Agents on different servers can have the same id.
  const turnKey = (serverId: string, agentId: string) => `${serverId}\u0000${agentId}`;

  function endServerTurns(serverId: string): void {
    const agents = activeTurns.get(serverId);
    if (!agents) return;
    activeTurns.delete(serverId);
    // Any status other than "completed" or "failed" only ends the turn.
    for (const agentId of agents) engine.turnCompleted(turnKey(serverId, agentId), "interrupted");
  }

  return {
    agentEvent(serverId, event) {
      switch (event.type) {
        case "turn-started": {
          const agents = activeTurns.get(serverId) ?? new Set<string>();
          agents.add(event.agentId);
          activeTurns.set(serverId, agents);
          engine.turnStarted(turnKey(serverId, event.agentId));
          return;
        }
        case "turn-completed": {
          const agents = activeTurns.get(serverId);
          agents?.delete(event.agentId);
          if (agents?.size === 0) activeTurns.delete(serverId);
          engine.turnCompleted(turnKey(serverId, event.agentId), event.status);
          return;
        }
        case "memories-changed":
          engine.memorySaved();
          return;
        case "usage-limit-reached":
          engine.usageLimit();
          return;
        default:
          return;
      }
    },
    toolUse(serverId, agentId) {
      // A late tool step after `turn-completed` must not start a turn that nothing ends.
      if (!activeTurns.get(serverId)?.has(agentId)) return;
      engine.toolUse(turnKey(serverId, agentId));
    },
    handoffsChanged(senderId, handoffs) {
      const previous = handoffStatuses.get(senderId);
      const current = new Map(handoffs.map((handoff) => [handoff.id, handoff.status]));
      handoffStatuses.set(senderId, current);
      for (const [id, status] of current) {
        if (previous?.get(id) !== status) engine.handoff(status);
      }
    },
    presentation(presentation) {
      engine.presentation(presentation.mode);
    },
    preference(preference) {
      // The "Show emotions" switch is disabled while the island is off, so the island switch must
      // also turn off the Dock faces. Otherwise the user could not turn them off.
      const next = preference.enabled && dynamicIslandEmotionsEnabled(preference);
      if (next === enabled) return;
      enabled = next;
      if (enabled) {
        show(engine.current());
      } else {
        island.setEmotion(undefined);
        dock.show(undefined);
      }
    },
    serversChanged(servers) {
      const online = new Set(servers.filter((server) => server.state === "online").map((server) => server.id));
      for (const serverId of [...activeTurns.keys()]) {
        if (serverId !== LOCAL_SERVER_ID && !online.has(serverId)) endServerTurns(serverId);
      }
    },
    activity() {
      engine.activity();
    },
    dispose() {
      timer.cancel();
    },
  };
}
