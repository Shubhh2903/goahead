// What main answers about the work this computer's agents gave to teammates. These guard the renderer.

import {
  type AgentHandoff,
  type AgentHandoffsChanged,
  isAgentHandoffList,
  isAgentHandoffsChanged,
} from "@openbot/contracts/ipc";

export function decodeAgentHandoffsReply(value: unknown): AgentHandoff[] {
  if (!isAgentHandoffList(value)) throw new Error("Invalid hand-off list response.");
  return value;
}

export function decodeAgentHandoffsChanged(value: unknown): AgentHandoffsChanged | null {
  return isAgentHandoffsChanged(value) ? value : null;
}
