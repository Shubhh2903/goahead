// What main answers for the Slack workspaces of this computer. These guard the renderer.

import {
  type AddSlackOrchestratorResult,
  isAddSlackOrchestratorResult,
  isMessagingDrafts,
  isMessagingInbox,
  isMessagingInboxChanged,
  isMessagingInboxPage,
  isMessagingThreadSummaries,
  isMessagingThreadsChanged,
  isSlackChannelList,
  isSlackOverview,
  isSlackRoutingStatus,
  type MessagingDraft,
  type MessagingInboxChanged,
  type MessagingInboxPage,
  type MessagingInboxWorkspace,
  type MessagingThreadSummary,
  type MessagingThreadsChanged,
  type SlackChannelList,
  type SlackOverview,
  type SlackRoutingStatus,
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

export function decodeMessagingDraftsReply(value: unknown): MessagingDraft[] {
  if (!isMessagingDrafts(value)) throw new Error("Invalid Slack draft list response.");
  return value;
}

export function decodeMessagingInboxReply(value: unknown): MessagingInboxWorkspace[] {
  if (!isMessagingInbox(value)) throw new Error("Invalid Slack inbox response.");
  return value;
}

export function decodeMessagingInboxPageReply(value: unknown): MessagingInboxPage {
  if (!isMessagingInboxPage(value)) throw new Error("Invalid Slack inbox conversation response.");
  return value;
}

export function decodeMessagingInboxChanged(value: unknown): MessagingInboxChanged | null {
  return isMessagingInboxChanged(value) ? value : null;
}

export function decodeSlackRoutingStatusReply(value: unknown): SlackRoutingStatus {
  if (!isSlackRoutingStatus(value)) throw new Error("Invalid Slack routing response.");
  return value;
}
