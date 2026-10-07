/**
 * Messaging connections: a chat platform workspace, such as a Slack workspace that installed the
 * OpenBot app, where the agents of this computer answer. Each new conversation goes to the
 * workspace's orchestrator agent, which asks its teammates and answers. The connection belongs to the
 * computer that runs the agents. Tokens travel only towards that host; no result carries one.
 */

import { INPUT_LIMITS } from "./input-limits";
import type { AgentModelId, AgentReasoningEffort } from "./ipc-agent-identity";
import type { AgentProviderId } from "./ipc-agent-status";
import { isBoundedString, isIdentifier, isNullableBoundedString } from "./ipc-bounded-values";
import type { ConversationPageAnchor } from "./ipc-conversations";
import { isBoolean, isDynamicRecord, isNumber, isOneOf } from "./runtime-values";

export const MESSAGING_PLATFORMS = ["slack"] as const;
export type MessagingPlatform = (typeof MESSAGING_PLATFORMS)[number];

export const MESSAGING_CONNECTION_STATES = [
  "connecting",
  "connected",
  "reconnecting",
  "paused",
  "invalid_token",
  "missing_scope",
  "rate_limited",
  "secret_storage_unavailable",
  "error",
  // Slack sends the workspace's events through Signal, and this host cannot reach it: it is signed
  // out, has no name yet, or Signal is down.
  "relay_unavailable",
] as const;
export type MessagingConnectionState = (typeof MESSAGING_CONNECTION_STATES)[number];

export const MESSAGING_CREDENTIAL_STATES = ["missing", "saved", "unreadable"] as const;
export type MessagingCredentialState = (typeof MESSAGING_CREDENTIAL_STATES)[number];

export const MESSAGING_LIMITS = {
  name: 256,
  scope: 64,
  scopes: 32,
  connections: 32,
  threads: 200,
  /** The channels the person can pick for the inbox, and how many they may pick. */
  channelOptions: 1_000,
  watchedChannels: 50,
  drafts: 100,
  inboxConversations: 200,
  inboxMessages: 100,
} as const;

export interface MessagingConnection {
  workspaceId: string;
  platform: MessagingPlatform;
  enabled: boolean;
  state: MessagingConnectionState;
  workspaceName: string;
  /** The platform user that OpenBot posts as. */
  botUserId: string | null;
  /** The person who connected the workspace, when the install gave their token: the host can act as them. */
  userId: string | null;
  /** That person's handle, known while the connection is live. */
  userName: string | null;
  missingScopes: string[];
  /** When the connection tries again after a rate limit, as an ISO time. */
  retryAt: string | null;
  credentials: MessagingCredentialState;
  /** The agent that receives every new conversation. Null until the user adds it: nothing answers. */
  orchestratorAgentId: string | null;
  /** The channels the person picked for GoAhead's local inbox, besides their direct messages and mentions. */
  watchedChannels: SlackChannelChoice[];
  sendGuards: SlackSendGuards;
}

/** A daily time range in the host computer's time zone, as `HH:MM`. It can cross midnight. */
export interface SlackQuietHours {
  start: string;
  end: string;
}

/** What limits the messages GoAhead sends in a workspace. */
export interface SlackSendGuards {
  /** Nothing is sent while it is set. */
  paused: boolean;
  /** Null when the person set none. In them, sends wait as drafts and approvals wait too. */
  quietHours: SlackQuietHours | null;
  /** The most messages GoAhead sends in any hour, and how many it sent in the last one. */
  hourlyLimit: number;
  sentLastHour: number;
}

export interface SetSlackSendGuardsInput {
  workspaceId: string;
  paused?: boolean;
  quietHours?: SlackQuietHours | null;
}

const QUIET_TIME = /^([01]\d|2[0-3]):[0-5]\d$/u;

export function isSlackQuietHours(value: unknown): value is SlackQuietHours {
  return (
    isDynamicRecord(value) &&
    typeof value.start === "string" &&
    typeof value.end === "string" &&
    QUIET_TIME.test(value.start) &&
    QUIET_TIME.test(value.end) &&
    value.start !== value.end
  );
}

function isCount(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value >= 0;
}

export function isSlackSendGuards(value: unknown): value is SlackSendGuards {
  return (
    isDynamicRecord(value) &&
    isBoolean(value.paused) &&
    (value.quietHours === null || isSlackQuietHours(value.quietHours)) &&
    isCount(value.hourlyLimit) &&
    isCount(value.sentLastHour)
  );
}

/** A channel of the person's workspace, by id and name (without the #). */
export interface SlackChannelChoice {
  channelId: string;
  name: string;
}

/** A channel the person is in, which they can pick for the inbox. */
export interface SlackChannelOption extends SlackChannelChoice {
  isPrivate: boolean;
}

export interface SlackChannelList {
  channels: SlackChannelOption[];
}

/** Replaces the picked channels. A channel left out loses the messages GoAhead kept from it. */
export interface SetSlackWatchedChannelsInput {
  workspaceId: string;
  channels: SlackChannelChoice[];
}

/** The Slack workspaces connected on this computer. */
export interface SlackOverview {
  connections: MessagingConnection[];
}

export interface SlackWorkspaceInput {
  workspaceId: string;
}

export interface SetSlackEnabledInput {
  workspaceId: string;
  enabled: boolean;
}

/** Creates the workspace's orchestrator agent. Absent, the provider and model are a new agent's default. */
export interface AddSlackOrchestratorInput {
  workspaceId: string;
  provider?: AgentProviderId;
  model?: AgentModelId;
  reasoningEffort?: AgentReasoningEffort;
}

/** The new orchestrator, and the sidebar section it went to, which the screen shows collapsed. */
export interface AddSlackOrchestratorResult {
  agentId: string;
  sectionId: string | null;
}

/**
 * One external conversation, such as a Slack direct message or channel thread, that an agent answers
 * in its own thread. The sidebar lists these under the agent; the user can read them but not write.
 */
export interface MessagingThreadSummary {
  threadId: string;
  agentId: string;
  workspaceId: string;
  platform: MessagingPlatform;
  /** The person's name for a direct message, or the place and the first words for a channel thread. */
  title: string;
  /** The start of the newest message, from either side. Null before the first message. */
  preview: string | null;
  isDirect: boolean;
  /** The newest activity, as an ISO time. The list is newest first. */
  updatedAt: string;
  unreadCount: number;
  /** Messages an agent drafted from this conversation that wait for the person's approval. */
  pendingDrafts: number;
}

/**
 * A message an agent drafted to send in Slack, which waits for the person who connected the
 * workspace. The desktop and the Slack buttons answer the same draft; the first answer counts.
 */
export interface MessagingDraft {
  draftId: string;
  workspaceId: string;
  /** The conversation where the agent was asked, and where the answer is posted. */
  threadId: string;
  agentId: string;
  /** Who gets the message: people's names, or a channel such as #general. */
  recipient: string;
  /** `user`: it goes out as the person; `bot`: as GoAhead. */
  sender: "user" | "bot";
  /** Who asked the agent for the message, when it is known. */
  requestedBy: string | null;
  text: string;
  /** ISO time. */
  createdAt: string;
}

/** Approves a draft, with the person's edited text when given, or denies it. */
export interface AnswerMessagingDraftInput {
  draftId: string;
  decision: "approve" | "deny";
  text?: string;
}

export interface MessagingThreadPageInput {
  threadId: string;
  anchor?: ConversationPageAnchor;
  limit?: number;
}

export interface MarkMessagingThreadReadInput {
  threadId: string;
  throughMessageId: string | null;
}

/** A messaging thread got new messages or a new title. The renderer reads the list again. */
export interface MessagingThreadsChanged {
  threadId: string;
}

export function isMessagingThreadSummary(value: unknown): value is MessagingThreadSummary {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.threadId) &&
    isIdentifier(value.agentId) &&
    isIdentifier(value.workspaceId) &&
    isOneOf(MESSAGING_PLATFORMS, value.platform) &&
    isBoundedString(value.title, MESSAGING_LIMITS.name) &&
    isNullableBoundedString(value.preview, MESSAGING_LIMITS.name) &&
    isBoolean(value.isDirect) &&
    isBoundedString(value.updatedAt, 64) &&
    isNumber(value.unreadCount) &&
    Number.isInteger(value.unreadCount) &&
    value.unreadCount >= 0 &&
    isNumber(value.pendingDrafts) &&
    Number.isInteger(value.pendingDrafts) &&
    value.pendingDrafts >= 0
  );
}

export const MESSAGING_INBOX_KINDS = ["direct", "group", "mention", "channel"] as const;
export type MessagingInboxKind = (typeof MESSAGING_INBOX_KINDS)[number];

/**
 * One conversation of the person's local Slack inbox, for the desktop: a direct or group direct
 * message, the messages that mention them in a channel, or a channel they picked.
 */
export interface MessagingInboxConversation {
  conversation: string;
  kind: MessagingInboxKind;
  /** A person's name for a direct message, or a channel such as #general. */
  place: string;
  unreadCount: number;
  latestAt: string;
  /** The newest author other than the person. */
  latestFrom: string;
  preview: string;
}

/** The inbox of one workspace connected as the person. */
export interface MessagingInboxWorkspace {
  workspaceId: string;
  workspaceName: string;
  /** The agent whose sidebar row holds the inbox: the workspace's orchestrator. */
  agentId: string | null;
  conversations: MessagingInboxConversation[];
}

export interface ReadInboxConversationInput {
  workspaceId: string;
  conversation: string;
  limit?: number;
}

export interface MessagingInboxMessage {
  id: string;
  from: string;
  /** Written by the person who connected the workspace. */
  isOwn: boolean;
  text: string;
  sentAt: string;
  /** The thread the message is in, or null at the top of the conversation. */
  thread: string | null;
}

/** The newest messages of one inbox conversation, oldest first. Reading them marks them read. */
export interface MessagingInboxPage {
  workspaceId: string;
  conversation: string;
  place: string;
  messages: MessagingInboxMessage[];
}

/** The inbox of a workspace got a new message. The desktop reads it again. */
export interface MessagingInboxChanged {
  workspaceId: string;
}

function isInboxConversation(value: unknown): value is MessagingInboxConversation {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.conversation) &&
    isOneOf(MESSAGING_INBOX_KINDS, value.kind) &&
    isBoundedString(value.place, MESSAGING_LIMITS.name * 4) &&
    isNumber(value.unreadCount) &&
    Number.isInteger(value.unreadCount) &&
    value.unreadCount >= 0 &&
    isBoundedString(value.latestAt, 64) &&
    isBoundedString(value.latestFrom, MESSAGING_LIMITS.name) &&
    isBoundedString(value.preview, INPUT_LIMITS.messageText)
  );
}

export function isMessagingInbox(value: unknown): value is MessagingInboxWorkspace[] {
  return (
    Array.isArray(value) &&
    value.length <= MESSAGING_LIMITS.connections &&
    value.every(
      (workspace) =>
        isDynamicRecord(workspace) &&
        isIdentifier(workspace.workspaceId) &&
        isBoundedString(workspace.workspaceName, MESSAGING_LIMITS.name) &&
        (workspace.agentId === null || isIdentifier(workspace.agentId)) &&
        Array.isArray(workspace.conversations) &&
        workspace.conversations.length <= MESSAGING_LIMITS.inboxConversations &&
        workspace.conversations.every(isInboxConversation),
    )
  );
}

export function isMessagingInboxPage(value: unknown): value is MessagingInboxPage {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.workspaceId) &&
    isIdentifier(value.conversation) &&
    isBoundedString(value.place, MESSAGING_LIMITS.name * 4) &&
    Array.isArray(value.messages) &&
    value.messages.length <= MESSAGING_LIMITS.inboxMessages &&
    value.messages.every(
      (message) =>
        isDynamicRecord(message) &&
        isIdentifier(message.id) &&
        isBoundedString(message.from, MESSAGING_LIMITS.name * 2) &&
        isBoolean(message.isOwn) &&
        isBoundedString(message.text, INPUT_LIMITS.messageText) &&
        isBoundedString(message.sentAt, 64) &&
        (message.thread === null || isIdentifier(message.thread)),
    )
  );
}

export function isMessagingInboxChanged(value: unknown): value is MessagingInboxChanged {
  return isDynamicRecord(value) && isIdentifier(value.workspaceId);
}

export function isMessagingDraft(value: unknown): value is MessagingDraft {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.draftId) &&
    isIdentifier(value.workspaceId) &&
    isIdentifier(value.threadId) &&
    isIdentifier(value.agentId) &&
    isBoundedString(value.recipient, MESSAGING_LIMITS.name * 4) &&
    isOneOf(["user", "bot"] as const, value.sender) &&
    isNullableBoundedString(value.requestedBy, MESSAGING_LIMITS.name) &&
    isBoundedString(value.text, INPUT_LIMITS.messageText) &&
    isBoundedString(value.createdAt, 64)
  );
}

export function isMessagingDrafts(value: unknown): value is MessagingDraft[] {
  return Array.isArray(value) && value.length <= MESSAGING_LIMITS.drafts && value.every(isMessagingDraft);
}

export function isMessagingThreadSummaries(value: unknown): value is MessagingThreadSummary[] {
  return Array.isArray(value) && value.length <= MESSAGING_LIMITS.threads && value.every(isMessagingThreadSummary);
}

export function isMessagingThreadsChanged(value: unknown): value is MessagingThreadsChanged {
  return isDynamicRecord(value) && isIdentifier(value.threadId);
}

export function isSlackChannelChoice(value: unknown): value is SlackChannelChoice {
  return isDynamicRecord(value) && isIdentifier(value.channelId) && isBoundedString(value.name, MESSAGING_LIMITS.name);
}

export function isSlackChannelList(value: unknown): value is SlackChannelList {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.channels) &&
    value.channels.length <= MESSAGING_LIMITS.channelOptions &&
    value.channels.every(
      (channel) => isSlackChannelChoice(channel) && isDynamicRecord(channel) && isBoolean(channel.isPrivate),
    )
  );
}

function isScopeList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MESSAGING_LIMITS.scopes &&
    value.every((scope) => isBoundedString(scope, MESSAGING_LIMITS.scope))
  );
}

export function isMessagingConnection(value: unknown): value is MessagingConnection {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.workspaceId) &&
    isOneOf(MESSAGING_PLATFORMS, value.platform) &&
    isBoolean(value.enabled) &&
    isOneOf(MESSAGING_CONNECTION_STATES, value.state) &&
    isBoundedString(value.workspaceName, MESSAGING_LIMITS.name) &&
    isNullableBoundedString(value.botUserId, MESSAGING_LIMITS.name) &&
    isNullableBoundedString(value.userId, MESSAGING_LIMITS.name) &&
    isNullableBoundedString(value.userName, MESSAGING_LIMITS.name) &&
    isScopeList(value.missingScopes) &&
    isNullableBoundedString(value.retryAt, 64) &&
    isOneOf(MESSAGING_CREDENTIAL_STATES, value.credentials) &&
    (value.orchestratorAgentId === null || isIdentifier(value.orchestratorAgentId)) &&
    Array.isArray(value.watchedChannels) &&
    value.watchedChannels.length <= MESSAGING_LIMITS.watchedChannels &&
    value.watchedChannels.every(isSlackChannelChoice) &&
    isSlackSendGuards(value.sendGuards)
  );
}

export function isSlackOverview(value: unknown): value is SlackOverview {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.connections) &&
    value.connections.length <= MESSAGING_LIMITS.connections &&
    value.connections.every(isMessagingConnection)
  );
}

export function isAddSlackOrchestratorResult(value: unknown): value is AddSlackOrchestratorResult {
  return (
    isDynamicRecord(value) && isIdentifier(value.agentId) && (value.sectionId === null || isIdentifier(value.sectionId))
  );
}
