/**
 * The routine flow runtime of this computer's host: the stores it reads and the agent service that
 * sends each handoff. The main process builds it once; a test builds the same one over its stores.
 */

import { latestTurnAnswer } from "@openbot/contracts/ipc";
import { AgentRoutineStore } from "../agent-routine-store";
import type { AgentService } from "../agent-service";
import type { AgentStore } from "../agent-store";
import type { MailboxStore } from "../mailbox-store";
import { routineFlowRoutines } from "./routine-flow-routines";
import { RoutineFlowStore } from "./routine-flow-store";
import { RoutineFlows } from "./routine-flows";

export interface HostRoutineFlowsOptions {
  store: AgentStore;
  mailbox: MailboxStore;
  service: Pick<AgentService, "enqueueRoutineHandoff">;
  /** The agents whose canvases changed. */
  changed(agentIds: string[]): void;
}

export function createHostRoutineFlows({ store, mailbox, service, changed }: HostRoutineFlowsOptions): RoutineFlows {
  return new RoutineFlows({
    store: new RoutineFlowStore({ database: store.database }),
    routines: routineFlowRoutines(new AgentRoutineStore(store.database)),
    delivery: (deliveryId) => {
      const found = mailbox.getDelivery(deliveryId)?.delivery;
      return found ? { status: found.status, turnId: found.turnId, error: found.error } : null;
    },
    turnAnswer: (agentId, turnId) => {
      const threadId = store.list().find((agent) => agent.id === agentId)?.threadId;
      if (!threadId) return null;
      return (
        latestTurnAnswer(store.database.readTurnAssistantMessages(agentId, threadId, turnId), turnId)?.text ?? null
      );
    },
    agentName: (agentId) => store.list().find((agent) => agent.id === agentId)?.name ?? agentId,
    sendHandoff: (input) => service.enqueueRoutineHandoff(input),
    changed,
  });
}
