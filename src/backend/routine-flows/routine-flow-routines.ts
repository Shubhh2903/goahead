// The agent routines a routine canvas shows. GoAhead routines start on a schedule only, so the
// trigger is the schedule with the `kind` tag the canvas reads.

import type { Routine, RoutineFlowRoutineInfo } from "@openbot/contracts/ipc";
import type { AgentRoutineStore } from "../agent-routine-store";
import type { RoutineFlowsDependencies } from "./routine-flows";

function flowRoutine({ trigger, ...fields }: Routine): RoutineFlowRoutineInfo {
  return { ...fields, trigger: { kind: "schedule", schedule: trigger.schedule } };
}

export function routineFlowRoutines(routines: AgentRoutineStore): RoutineFlowsDependencies["routines"] {
  return {
    list: (agentId) => routines.list(agentId).map(flowRoutine),
    get: (agentId, routineId) => {
      const routine = routines.get(agentId, routineId);
      return routine ? flowRoutine(routine) : null;
    },
    listRuns: (agentId, routineId, limit) => routines.listRuns(agentId, routineId, limit),
  };
}
