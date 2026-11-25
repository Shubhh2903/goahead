/**
 * The routine flow runtime of this computer's host: the stores it reads and the agent service that
 * sends each handoff. The main process builds it once; a test builds the same one over its stores.
 */

import { latestTurnAnswer } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { AgentRoutineStore } from "../agent-routine-store";
import type { AgentService } from "../agent-service";
import type { AgentStore } from "../agent-store";
import type { MailboxStore } from "../mailbox-store";
import { routineFlowRoutines } from "./routine-flow-routines";
import { RoutineFlowStore } from "./routine-flow-store";
import { createRoutineFlows } from "./routine-flows";

export interface HostRoutineFlowsOptions {
  store: AgentStore;
  mailbox: MailboxStore;
  service: Pick<AgentService, "enqueueRoutineHandoff" | "stopRoutineRun" | "interrupt" | "cancelQueuedMessage">;
  /** The agents whose canvases changed. */
  changed(agentIds: string[]): void;
}

const SETTLED_DELIVERY_STATUSES = new Set(["completed", "failed", "interrupted", "cancelled"]);

export function createHostRoutineFlows({ store, mailbox, service, changed }: HostRoutineFlowsOptions) {
  return createRoutineFlows({
    store: new RoutineFlowStore({ database: store.database }),
    routines: routineFlowRoutines(new AgentRoutineStore(store.database)),
    delivery: (deliveryId) => {
      const found = mailbox.getDelivery(deliveryId)?.delivery;
      return found ? { status: found.status, turnId: found.turnId, error: found.error } : null;
    },
    turnAnswer: (agentId, turnId) =>
      latestTurnAnswer(store.database.readTurnAssistantMessages(agentId, turnId), turnId)?.text ?? null,
    agentName: (agentId) => store.list().find((agent) => agent.id === agentId)?.name ?? agentId,
    sendHandoff: (input) => service.enqueueRoutineHandoff(input),
    stopRoutineRun: (input) => service.stopRoutineRun(input),
    stopDelivery: (agentId, deliveryId) => {
      const found = mailbox.getDelivery(deliveryId)?.delivery;
      if (!found || SETTLED_DELIVERY_STATUSES.has(found.status)) return Effect.void;
      return found.status !== "queued" && found.turnId
        ? service.interrupt(agentId, found.turnId)
        : service.cancelQueuedMessage(agentId, deliveryId);
    },
    changed,
  });
}
