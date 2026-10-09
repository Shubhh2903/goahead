// What main answers for the Slack client. These guard the renderer: a file preview may only name
// main's own `openbot-attachment://slack/…` address, so no Slack file address reaches the page.

import {
  isSlackClientChanged,
  isSlackClientConversations,
  isSlackClientMentionCandidates,
  isSlackClientPage,
  isSlackClientThread,
  isSlackClientUploadResult,
  type SlackClientChanged,
  type SlackClientConversation,
  type SlackClientMentionCandidate,
  type SlackClientPage,
  type SlackClientThread,
  type SlackClientUploadResult,
} from "@openbot/contracts/ipc";

export function decodeSlackClientConversationsReply(value: unknown): SlackClientConversation[] {
  if (!isSlackClientConversations(value)) throw new Error("Invalid Slack conversation list response.");
  return value;
}

export function decodeSlackClientPageReply(value: unknown): SlackClientPage {
  if (!isSlackClientPage(value)) throw new Error("Invalid Slack conversation response.");
  return value;
}

export function decodeSlackClientThreadReply(value: unknown): SlackClientThread {
  if (!isSlackClientThread(value)) throw new Error("Invalid Slack thread response.");
  return value;
}

/** Null when the person closed the file picker. */
export function decodeSlackClientUploadReply(value: unknown): SlackClientUploadResult | null {
  if (value === null) return null;
  if (!isSlackClientUploadResult(value)) throw new Error("Invalid Slack upload response.");
  return value;
}

/** A dropped file's upload: always a result. */
export function decodeSlackClientUploadBytesReply(value: unknown): SlackClientUploadResult {
  if (!isSlackClientUploadResult(value)) throw new Error("Invalid Slack upload response.");
  return value;
}

export function decodeSlackClientMentionCandidatesReply(value: unknown): SlackClientMentionCandidate[] {
  if (!isSlackClientMentionCandidates(value)) throw new Error("Invalid Slack people response.");
  return value;
}

export function decodeSlackClientChanged(value: unknown): SlackClientChanged | null {
  return isSlackClientChanged(value) ? value : null;
}
