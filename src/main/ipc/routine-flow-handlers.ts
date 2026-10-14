// Routine flows: the canvas of one agent's routines and the handoffs between its agents. Only this
// computer's host keeps them, so a remote server is answered with a sentence instead of a request.
// No Team API route carries them.

import { sourceText } from "@openbot/i18n/source";
import type { RoutineFlows } from "../../backend/routine-flows/routine-flows";
import { parseAgentId } from "./agent-inputs";
import type { IpcGroupHandlers } from "./define-ipc-group";
import {
  parseConnectRoutineFlow,
  parseDisconnectRoutineFlow,
  parseRemoveRoutineFlowPosition,
  parseSaveRoutineFlowPosition,
  parseUpdateRoutineFlowLink,
} from "./routine-flow-inputs";
import { scopedHandler } from "./scoped-handler";

interface RoutineFlowIpcDependencies {
  routineFlows: RoutineFlows;
}

function remoteUnsupported(): never {
  throw new Error(sourceText("error.backend.routineFlowRemoteUnsupported"));
}

export function routineFlowIpcHandlers({
  routineFlows,
}: RoutineFlowIpcDependencies): Pick<IpcGroupHandlers, "routineFlows"> {
  return {
    routineFlows: {
      canvas: scopedHandler(parseAgentId, {
        local: (agentId) => routineFlows.canvas(agentId),
        remote: remoteUnsupported,
      }),
      savePosition: scopedHandler(parseSaveRoutineFlowPosition, {
        local: (input) => routineFlows.savePosition(input),
        remote: remoteUnsupported,
      }),
      removePosition: scopedHandler(parseRemoveRoutineFlowPosition, {
        local: (input) => routineFlows.removePosition(input),
        remote: remoteUnsupported,
      }),
      connect: scopedHandler(parseConnectRoutineFlow, {
        local: (input) => routineFlows.connect(input),
        remote: remoteUnsupported,
      }),
      disconnect: scopedHandler(parseDisconnectRoutineFlow, {
        local: (input) => routineFlows.disconnect(input),
        remote: remoteUnsupported,
      }),
      updateLink: scopedHandler(parseUpdateRoutineFlowLink, {
        local: (input) => routineFlows.updateLink(input),
        remote: remoteUnsupported,
      }),
    },
  };
}
