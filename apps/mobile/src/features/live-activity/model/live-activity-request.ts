import { AGENT_RUNTIME_TEXT_LIMIT } from "@openbot/contracts/ipc";
import type { DynamicIslandCoordinator } from "@openbot/team-client/dynamic-island-coordinator";
import {
  DYNAMIC_ISLAND_TEXT_LIMIT,
  type DynamicIslandText,
  normalizeQuestions,
} from "@openbot/team-client/dynamic-island-presentation";
import type { LiveActivityRequest } from "./live-activity-link";

/** What the app does with a signed button request after it has the current host state. */
export type LiveActivityRequestCheck = "confirm" | "perform" | "changed";

type ServerState = ReturnType<DynamicIslandCoordinator["serverState"]>;

/**
 * The lengths at which a copy of a command is cut, with `slice` and no mark. A runtime snapshot keeps
 * `AGENT_RUNTIME_TEXT_LIMIT` characters (`compactRuntimeApproval`), and the island, so a button link,
 * keeps `DYNAMIC_ISLAND_TEXT_LIMIT`.
 */
const COMMAND_CUTS: ReadonlySet<number> = new Set([AGENT_RUNTIME_TEXT_LIMIT, DYNAMIC_ISLAND_TEXT_LIMIT]);

/** Whether the request answers a prompt, so the app must know the current prompts before it acts. */
export function liveActivityRequestNeedsState({ action }: LiveActivityRequest): boolean {
  return action.type === "respond-approval" || action.type === "answer-prompt";
}

/**
 * Checks a signed button request against the current host state. The host finds an approval or a
 * prompt by its request id only, and a provider can use an id again for a newer request. So the app
 * acts only when the same agent waits for the same request, with the same command or question, and
 * Approve still asks the user first. `null` state means the state is not known: the app does not act.
 */
export function checkLiveActivityRequest(
  { action, command }: LiveActivityRequest,
  state: ServerState,
  text: DynamicIslandText,
): LiveActivityRequestCheck {
  if (action.type === "respond-approval") {
    const approval = state?.pendingApprovals[action.agentId];
    if (!approval || String(approval.requestId) !== String(action.requestId)) return "changed";
    if (action.decision === "accept") {
      // The user approves the command that the confirmation shows, so it must be the waiting one, whole
      // and equal. A cut copy is never enough: the host would run more than the confirmation shows.
      return command !== null && approval.truncated !== true && approval.command === command ? "confirm" : "changed";
    }
    return sameCommand(approval.command, command) ? "perform" : "changed";
  }
  if (action.type === "answer-prompt") {
    const prompt = state?.pendingPrompts[action.agentId];
    if (prompt?.type !== "prompt" || String(prompt.requestId) !== String(action.requestId)) return "changed";
    const questions = normalizeQuestions(prompt.questions, text);
    const matches = Object.entries(action.answers).every(([questionId, labels]) => {
      const options = questions.find((question) => question.id === questionId)?.options ?? [];
      return labels.every((label) => options.some((option) => option.label === label));
    });
    return matches ? "perform" : "changed";
  }
  return "perform";
}

/**
 * Whether two copies of a command can be the same command, for Deny only. The host state and the signed link can
 * hold copies cut at different lengths. Copies of different lengths match only when the shorter one
 * has a cut length and starts the longer one.
 */
export function sameCommand(held: string | null, signed: string | null): boolean {
  // The island shows an empty command as none.
  const a = held || null;
  const b = signed || null;
  if (a === null || b === null) return a === b;
  if (a.length === b.length) return a === b;
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  return COMMAND_CUTS.has(shorter.length) && longer.startsWith(shorter);
}
