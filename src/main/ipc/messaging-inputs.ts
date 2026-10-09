// The messaging payloads. No message here quotes the input.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AddSlackOrchestratorInput,
  AnswerMessagingDraftInput,
  AskOrchestratorAboutInboxInput,
  HandOverSlackDefaultInput,
  HideMessagingThreadsInput,
  MarkMessagingThreadReadInput,
  MessagingThreadPageInput,
  ReadInboxConversationInput,
  SendInboxReplyInput,
  SetSlackEnabledInput,
  SetSlackSendGuardsInput,
  SetSlackWatchedChannelsInput,
  SlackWorkspaceInput,
} from "@openbot/contracts/ipc";
import {
  isAgentModel,
  isAgentProvider,
  isReasoningEffort,
  isSlackChannelChoice,
  isSlackQuietHours,
  MESSAGING_LIMITS,
} from "@openbot/contracts/ipc";
import { isBoolean, isString } from "@openbot/contracts/runtime-values";
import { parsePageAnchor, parsePageLimit } from "./agent-inputs";
import { isObject, requireString } from "./validation";

export function parseSlackWorkspaceInput(value: unknown): SlackWorkspaceInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id") };
}

export function parseSetSlackEnabledInput(value: unknown): SetSlackEnabledInput {
  if (!isObject(value) || !isBoolean(value.enabled)) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id"), enabled: value.enabled };
}

export function parseAddSlackOrchestratorInput(value: unknown): AddSlackOrchestratorInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  const result: AddSlackOrchestratorInput = { workspaceId: requireString(value.workspaceId, "Workspace id") };
  if (value.provider !== undefined) {
    if (!isAgentProvider(value.provider)) throw new Error("A messaging request is invalid.");
    result.provider = value.provider;
  }
  if (value.model !== undefined) {
    if (!isAgentModel(value.model)) throw new Error("A messaging request is invalid.");
    result.model = value.model;
  }
  if (value.reasoningEffort !== undefined) {
    if (!isReasoningEffort(value.reasoningEffort)) throw new Error("A messaging request is invalid.");
    result.reasoningEffort = value.reasoningEffort;
  }
  return result;
}

export function parseMessagingThreadPageInput(value: unknown): MessagingThreadPageInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  return {
    threadId: requireString(value.threadId, "Thread id", INPUT_LIMITS.identifier),
    anchor: parsePageAnchor(value.anchor),
    limit: parsePageLimit(value.limit),
  };
}

export function parseMarkMessagingThreadReadInput(value: unknown): MarkMessagingThreadReadInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  const throughMessageId = value.throughMessageId;
  if (throughMessageId !== null && !isString(throughMessageId)) throw new Error("A messaging request is invalid.");
  return {
    threadId: requireString(value.threadId, "Thread id", INPUT_LIMITS.identifier),
    throughMessageId:
      throughMessageId === null ? null : requireString(throughMessageId, "Message id", INPUT_LIMITS.identifier),
  };
}

export function parseHideMessagingThreadsInput(value: unknown): HideMessagingThreadsInput {
  if (
    !isObject(value) ||
    !Array.isArray(value.threadIds) ||
    value.threadIds.length === 0 ||
    value.threadIds.length > MESSAGING_LIMITS.hiddenThreads
  )
    throw new Error("A messaging request is invalid.");
  return {
    threadIds: value.threadIds.map((threadId) => requireString(threadId, "Thread id", INPUT_LIMITS.identifier)),
  };
}

export function parseSetSlackWatchedChannelsInput(value: unknown): SetSlackWatchedChannelsInput {
  if (
    !isObject(value) ||
    !Array.isArray(value.channels) ||
    value.channels.length > MESSAGING_LIMITS.watchedChannels ||
    !value.channels.every(isSlackChannelChoice)
  )
    throw new Error("A messaging request is invalid.");
  return {
    workspaceId: requireString(value.workspaceId, "Workspace id"),
    channels: value.channels.map((channel) => ({ channelId: channel.channelId, name: channel.name })),
  };
}

export function parseAnswerMessagingDraftInput(value: unknown): AnswerMessagingDraftInput {
  if (!isObject(value) || (value.decision !== "approve" && value.decision !== "deny"))
    throw new Error("A messaging request is invalid.");
  const result: AnswerMessagingDraftInput = {
    draftId: requireString(value.draftId, "Draft id", INPUT_LIMITS.identifier),
    decision: value.decision,
  };
  if (value.text !== undefined) result.text = requireString(value.text, "Text", INPUT_LIMITS.messageText);
  return result;
}

export function parseSetSlackSendGuardsInput(value: unknown): SetSlackSendGuardsInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  const result: SetSlackSendGuardsInput = { workspaceId: requireString(value.workspaceId, "Workspace id") };
  if (value.paused !== undefined) {
    if (!isBoolean(value.paused)) throw new Error("A messaging request is invalid.");
    result.paused = value.paused;
  }
  if (value.quietHours !== undefined) {
    if (value.quietHours !== null && !isSlackQuietHours(value.quietHours))
      throw new Error("A messaging request is invalid.");
    result.quietHours = value.quietHours === null ? null : { start: value.quietHours.start, end: value.quietHours.end };
  }
  return result;
}

export function parseReadInboxConversationInput(value: unknown): ReadInboxConversationInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  const result: ReadInboxConversationInput = {
    workspaceId: requireString(value.workspaceId, "Workspace id"),
    conversation: requireString(value.conversation, "Conversation", INPUT_LIMITS.identifier),
  };
  if (value.limit !== undefined) result.limit = parsePageLimit(value.limit);
  return result;
}

export function parseSendInboxReplyInput(value: unknown): SendInboxReplyInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  const result: SendInboxReplyInput = {
    workspaceId: requireString(value.workspaceId, "Workspace id"),
    conversation: requireString(value.conversation, "Conversation", INPUT_LIMITS.identifier),
    // Untrimmed: the service trims and then holds the reply to `MESSAGING_LIMITS.inboxReply`.
    text: requireString(value.text, "Text", INPUT_LIMITS.messageText),
  };
  if (value.threadKey !== undefined)
    result.threadKey = requireString(value.threadKey, "Thread", INPUT_LIMITS.identifier);
  return result;
}

export function parseAskOrchestratorAboutInboxInput(value: unknown): AskOrchestratorAboutInboxInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  const result: AskOrchestratorAboutInboxInput = {
    workspaceId: requireString(value.workspaceId, "Workspace id"),
    conversation: requireString(value.conversation, "Conversation", INPUT_LIMITS.identifier),
    // Untrimmed: the service takes the `@chief` prefix off and trims.
    text: requireString(value.text, "Text", INPUT_LIMITS.messageText),
  };
  if (value.threadKey !== undefined)
    result.threadKey = requireString(value.threadKey, "Thread", INPUT_LIMITS.identifier);
  return result;
}

export function parseHandOverSlackDefaultInput(value: unknown): HandOverSlackDefaultInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  return {
    workspaceId: requireString(value.workspaceId, "Workspace id"),
    slackUserId: requireString(value.slackUserId, "Slack user id", INPUT_LIMITS.identifier),
  };
}
