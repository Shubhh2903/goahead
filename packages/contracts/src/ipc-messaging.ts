/**
 * Messaging connections: a chat platform workspace, such as a Slack workspace that installed the
 * OpenBot app, where the agents of this computer answer. Each new conversation goes to the
 * workspace's orchestrator agent, which asks its teammates and answers. The connection belongs to the
 * computer that runs the agents. Tokens travel only towards that host; no result carries one.
 */

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
    value.unreadCount >= 0
  );
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
    value.watchedChannels.every(isSlackChannelChoice)
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
