// Work that one agent hands to another with `send_message`, as the sender's conversation and the
// Slack thread it came from show it. Local only: no Team API protocol carries it.

import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord, isOneOf } from "./runtime-values";

export const AGENT_HANDOFF_LIMITS = {
  /** The task text, redacted and cut. */
  task: 500,
  /** The answer text, redacted and cut. */
  reply: 2_000,
  /** The newest steps of the recipient's turn that are kept. */
  steps: 20,
  /** One step's name, such as a command, a file name or a tool. */
  stepName: 80,
  /** The hand-offs of one sender that a list returns. */
  list: 50,
} as const;

export const AGENT_HANDOFF_STATUSES = ["queued", "working", "done", "failed"] as const;
export type AgentHandoffStatus = (typeof AGENT_HANDOFF_STATUSES)[number];

/** `command` runs a program, `edit` changes a file, `search` searches the web, `tool` is any other tool. */
export const AGENT_HANDOFF_STEP_KINDS = ["command", "edit", "search", "tool"] as const;
export type AgentHandoffStepKind = (typeof AGENT_HANDOFF_STEP_KINDS)[number];

/** A label of one step, never its arguments or output. */
export interface AgentHandoffStep {
  kind: AgentHandoffStepKind;
  name: string;
}

export interface AgentHandoff {
  /** The delivery id: one hand-off per recipient of a request. */
  id: string;
  /** The mailbox message of the request, which the sender's conversation shows. */
  messageId: string;
  fromAgentId: string;
  toAgentId: string;
  task: string;
  startedAt: string;
  status: AgentHandoffStatus;
  /** The recipient's steps, oldest first. Only in memory: empty after a restart. */
  steps: AgentHandoffStep[];
  reply: string | null;
}

export interface AgentHandoffsChanged {
  /** The sender whose hand-offs changed. */
  agentId: string;
}

function isAgentHandoffStep(value: unknown): value is AgentHandoffStep {
  return (
    isDynamicRecord(value) &&
    isOneOf(AGENT_HANDOFF_STEP_KINDS, value.kind) &&
    isBoundedString(value.name, AGENT_HANDOFF_LIMITS.stepName) &&
    value.name.length > 0
  );
}

export function isAgentHandoff(value: unknown): value is AgentHandoff {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.messageId) &&
    isIdentifier(value.fromAgentId) &&
    isIdentifier(value.toAgentId) &&
    isBoundedString(value.task, AGENT_HANDOFF_LIMITS.task) &&
    isBoundedString(value.startedAt, 64) &&
    isOneOf(AGENT_HANDOFF_STATUSES, value.status) &&
    Array.isArray(value.steps) &&
    value.steps.length <= AGENT_HANDOFF_LIMITS.steps &&
    value.steps.every(isAgentHandoffStep) &&
    (value.reply === null || isBoundedString(value.reply, AGENT_HANDOFF_LIMITS.reply))
  );
}

export function isAgentHandoffList(value: unknown): value is AgentHandoff[] {
  return Array.isArray(value) && value.length <= AGENT_HANDOFF_LIMITS.list && value.every(isAgentHandoff);
}

export function isAgentHandoffsChanged(value: unknown): value is AgentHandoffsChanged {
  return isDynamicRecord(value) && isIdentifier(value.agentId);
}
