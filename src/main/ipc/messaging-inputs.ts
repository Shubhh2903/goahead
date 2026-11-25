import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AddMessagingOrchestratorInput,
  AddTelegramOrchestratorInput,
  AnswerMessagingDraftInput,
  AnswerWhatsAppRequestInput,
  AskOrchestratorAboutInboxInput,
  ConnectorMessagingPlatform,
  ConnectTelegramChatInput,
  HandOverSlackDefaultInput,
  HideMessagingThreadsInput,
  HostAddMessagingOrchestratorInput,
  HostMessagingConnectInput,
  HostMessagingPlatformInput,
  HostMessagingWorkspaceInput,
  HostSetMessagingEnabledInput,
  MarkMessagingThreadReadInput,
  MessagingThreadPageInput,
  MessagingWorkspaceInput,
  ReadInboxConversationInput,
  RemoveWhatsAppSenderInput,
  SendInboxReplyInput,
  SetDiscordAccessInput,
  SetMessagingEnabledInput,
  SetSlackSendGuardsInput,
  SetSlackWatchedChannelsInput,
  SetWhatsAppOwnNumberInput,
  SetWhatsAppSenderReadOnlyInput,
  SetWhatsAppStatusReactionsInput,
  SetWhatsAppWorkingMessageInput,
  StartWhatsAppLinkInput,
  WhatsAppSenderInput,
} from "@openbot/contracts/ipc";
import {
  CONNECTOR_MESSAGING_PLATFORMS,
  isAgentModel,
  isAgentProvider,
  isReasoningEffort,
  isSlackChannelChoice,
  isSlackQuietHours,
  isWhatsAppSender,
  MESSAGING_LIMITS,
  parseDiscordAllowedRoles,
  parseWhatsAppPhoneNumber,
  parseWhatsAppRequestCode,
} from "@openbot/contracts/ipc";
import { isBoolean, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { parsePageAnchor, parsePageLimit } from "./agent-inputs";
import { isObject, requireString } from "./validation";

export function parseMessagingWorkspaceInput(value: unknown): MessagingWorkspaceInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id") };
}

export function parseSetMessagingEnabledInput(value: unknown): SetMessagingEnabledInput {
  if (!isObject(value) || !isBoolean(value.enabled)) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id"), enabled: value.enabled };
}

export function parseConnectTelegramChatInput(value: unknown): ConnectTelegramChatInput {
  if (!isObject(value) || (value.place !== "group" && value.place !== "direct"))
    throw new Error("A messaging request is invalid.");
  return { place: value.place };
}

export function parseAddMessagingOrchestratorInput(value: unknown): AddMessagingOrchestratorInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id"), ...parseAddTelegramOrchestratorInput(value) };
}

export function parseAddTelegramOrchestratorInput(value: unknown): AddTelegramOrchestratorInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  const result: AddTelegramOrchestratorInput = {};
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

function parsePlatform(value: unknown): ConnectorMessagingPlatform {
  if (!isOneOf(CONNECTOR_MESSAGING_PLATFORMS, value)) throw new Error("A messaging request is invalid.");
  return value;
}

export function parseHostMessagingPlatformInput(value: unknown): HostMessagingPlatformInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  return { platform: parsePlatform(value.platform) };
}

export function parseHostMessagingConnectInput(value: unknown): HostMessagingConnectInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  if (value.place !== null && value.place !== "group" && value.place !== "direct")
    throw new Error("A messaging request is invalid.");
  return { platform: parsePlatform(value.platform), place: value.place };
}

export function parseHostMessagingWorkspaceInput(value: unknown): HostMessagingWorkspaceInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  return { platform: parsePlatform(value.platform), ...parseMessagingWorkspaceInput(value) };
}

export function parseHostSetMessagingEnabledInput(value: unknown): HostSetMessagingEnabledInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  return { platform: parsePlatform(value.platform), ...parseSetMessagingEnabledInput(value) };
}

export function parseHostAddMessagingOrchestratorInput(value: unknown): HostAddMessagingOrchestratorInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  return {
    platform: parsePlatform(value.platform),
    workspaceId: value.workspaceId === null ? null : requireString(value.workspaceId, "Workspace id"),
  };
}

export function parseSetDiscordAccessInput(value: unknown): SetDiscordAccessInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  const allowedRoles = parseDiscordAllowedRoles(value.allowedRoles);
  if (!allowedRoles) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id"), allowedRoles };
}

export function parseStartWhatsAppLinkInput(value: unknown): StartWhatsAppLinkInput {
  if (!isObject(value) || (value.method !== "qr" && value.method !== "code") || !isBoolean(value.ownNumber))
    throw new Error("A messaging request is invalid.");
  if (value.method === "qr") return { method: "qr", phoneNumber: null, ownNumber: value.ownNumber };
  const phoneNumber = parseWhatsAppPhoneNumber(value.phoneNumber);
  if (!phoneNumber) throw new Error("A messaging request is invalid.");
  return { method: "code", phoneNumber, ownNumber: value.ownNumber };
}

export function parseWhatsAppSenderInput(value: unknown): WhatsAppSenderInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  const sender =
    isObject(value.sender) && value.sender.kind === "contact"
      ? { ...value.sender, id: parseWhatsAppPhoneNumber(value.sender.id) ?? "" }
      : value.sender;
  if (!isWhatsAppSender(sender)) throw new Error("A messaging request is invalid.");
  return {
    workspaceId: requireString(value.workspaceId, "Workspace id"),
    sender: { id: sender.id, kind: sender.kind, name: sender.name.trim() || sender.id },
  };
}

export function parseRemoveWhatsAppSenderInput(value: unknown): RemoveWhatsAppSenderInput {
  if (!isObject(value)) throw new Error("A messaging request is invalid.");
  return {
    workspaceId: requireString(value.workspaceId, "Workspace id"),
    senderId: requireString(value.senderId, "Sender id"),
  };
}

export function parseAnswerWhatsAppRequestInput(value: unknown): AnswerWhatsAppRequestInput {
  if (!isObject(value) || !isBoolean(value.approve)) throw new Error("A messaging request is invalid.");
  const code = parseWhatsAppRequestCode(value.code);
  if (!code) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id"), code, approve: value.approve };
}

export function parseSetWhatsAppOwnNumberInput(value: unknown): SetWhatsAppOwnNumberInput {
  if (!isObject(value) || !isBoolean(value.ownNumber)) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id"), ownNumber: value.ownNumber };
}

export function parseSetWhatsAppWorkingMessageInput(value: unknown): SetWhatsAppWorkingMessageInput {
  if (!isObject(value) || !isBoolean(value.workingMessage)) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id"), workingMessage: value.workingMessage };
}

export function parseSetWhatsAppStatusReactionsInput(value: unknown): SetWhatsAppStatusReactionsInput {
  if (!isObject(value) || !isBoolean(value.statusReactions)) throw new Error("A messaging request is invalid.");
  return { workspaceId: requireString(value.workspaceId, "Workspace id"), statusReactions: value.statusReactions };
}

export function parseSetWhatsAppSenderReadOnlyInput(value: unknown): SetWhatsAppSenderReadOnlyInput {
  if (!isObject(value) || !isBoolean(value.readOnly)) throw new Error("A messaging request is invalid.");
  return {
    workspaceId: requireString(value.workspaceId, "Workspace id"),
    senderId: requireString(value.senderId, "Sender id"),
    readOnly: value.readOnly,
  };
}
