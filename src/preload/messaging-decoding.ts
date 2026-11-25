import {
  type AddMessagingOrchestratorResult,
  type AskOrchestratorAboutInboxResult,
  type DiscordAccess,
  type DiscordRoleList,
  isAddMessagingOrchestratorResult,
  isAskOrchestratorAboutInboxResult,
  isDiscordAccess,
  isDiscordRoleList,
  isMessagingDrafts,
  isMessagingInbox,
  isMessagingInboxChanged,
  isMessagingInboxPage,
  isMessagingOverview,
  isMessagingThreadSummaries,
  isMessagingThreadsChanged,
  isSlackChannelList,
  isSlackRoutingStatus,
  isTelegramOverview,
  isWhatsAppGroupList,
  isWhatsAppLinkState,
  isWhatsAppOverview,
  type MessagingDraft,
  type MessagingInboxChanged,
  type MessagingInboxPage,
  type MessagingInboxWorkspace,
  type MessagingOverview,
  type MessagingThreadSummary,
  type MessagingThreadsChanged,
  type SlackChannelList,
  type SlackRoutingStatus,
  type TelegramOverview,
  type WhatsAppGroupList,
  type WhatsAppLinkState,
  type WhatsAppOverview,
} from "@openbot/contracts/ipc";

export function decodeAddOrchestratorReply(value: unknown): AddMessagingOrchestratorResult {
  if (!isAddMessagingOrchestratorResult(value)) throw new Error("Invalid messaging orchestrator response.");
  return value;
}

export function decodeMessagingOverviewReply(value: unknown): MessagingOverview {
  if (!isMessagingOverview(value)) throw new Error("Invalid messaging overview response.");
  return value;
}

export function decodeTelegramOverviewReply(value: unknown): TelegramOverview {
  if (!isTelegramOverview(value)) throw new Error("Invalid Telegram overview response.");
  return value;
}

export function decodeDiscordAccessReply(value: unknown): DiscordAccess {
  if (!isDiscordAccess(value)) throw new Error("Invalid Discord access response.");
  return value;
}

export function decodeDiscordRolesReply(value: unknown): DiscordRoleList {
  if (!isDiscordRoleList(value)) throw new Error("Invalid Discord roles response.");
  return value;
}

export function decodeWhatsAppOverviewReply(value: unknown): WhatsAppOverview {
  if (!isWhatsAppOverview(value)) throw new Error("Invalid WhatsApp overview response.");
  return value;
}

export function decodeWhatsAppLinkStateReply(value: unknown): WhatsAppLinkState {
  if (!isWhatsAppLinkState(value)) throw new Error("Invalid WhatsApp link response.");
  return value;
}

export function decodeAskOrchestratorAboutInboxReply(value: unknown): AskOrchestratorAboutInboxResult {
  if (!isAskOrchestratorAboutInboxResult(value)) throw new Error("Invalid Slack Orchestrator response.");
  return value;
}

export function decodeWhatsAppGroupsReply(value: unknown): WhatsAppGroupList {
  if (!isWhatsAppGroupList(value)) throw new Error("Invalid WhatsApp groups response.");
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
