// What main answers for the Slack workspaces of this computer. These guard the renderer.

import {
  type AddSlackOrchestratorResult,
  isAddSlackOrchestratorResult,
  isMessagingThreadSummaries,
  isMessagingThreadsChanged,
  isSlackChannelList,
  isSlackOverview,
  type MessagingThreadSummary,
  type MessagingThreadsChanged,
  type SlackChannelList,
  type SlackOverview,
} from "@openbot/contracts/ipc";

/** The orchestrator that main created, and the sidebar section it went to. */
export function decodeAddSlackOrchestratorReply(value: unknown): AddSlackOrchestratorResult {
  if (!isAddSlackOrchestratorResult(value)) throw new Error("Invalid Slack orchestrator response.");
  return value;
}

export function decodeSlackOverviewReply(value: unknown): SlackOverview {
  if (!isSlackOverview(value)) throw new Error("Invalid Slack overview response.");
  return value;
}

export function decodeMessagingThreadsReply(value: unknown): MessagingThreadSummary[] {
  if (!isMessagingThreadSummaries(value)) throw new Error("Invalid Slack thread list response.");
  return value;
}

export function decodeMessagingThreadsChanged(value: unknown): MessagingThreadsChanged | null {
  return isMessagingThreadsChanged(value) ? value : null;
}

export function decodeSlackChannelListReply(value: unknown): SlackChannelList {
  if (!isSlackChannelList(value)) throw new Error("Invalid Slack channel list response.");
  return value;
}
