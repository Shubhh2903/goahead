/**
 * The Slack client: every conversation of the person who connected a Slack workspace, read from the
 * host's local cache and loaded from Slack on demand. Actions go out as that person. No result
 * carries a token or a Slack file URL: a file preview is main's own `openbot-attachment://slack/…`
 * address.
 */

import { isBoundedString, isIdentifier, isNullableBoundedString } from "./ipc-bounded-values";
import { isBoolean, isDynamicRecord, isHttpsUrl, isNumber, isOneOf } from "./runtime-values";

export const SLACK_CONVERSATION_KINDS = ["channel", "private", "im", "mpim"] as const;
export type SlackConversationKind = (typeof SLACK_CONVERSATION_KINDS)[number];

export interface SlackClientConversation {
  workspaceId: string;
  channelId: string;
  kind: SlackConversationKind;
  /** A channel name without `#`, or empty for a direct message: the renderer names it from `memberIds`. */
  name: string;
  /** The other members of a direct or group direct message. Empty for a channel. */
  memberIds: string[];
  unreadCount: number;
  lastActivityTs: string | null;
  isMember: boolean;
}

export interface SlackClientReaction {
  name: string;
  count: number;
  /** The connected person reacted with it. */
  mine: boolean;
}

/** A file a message shared. Its bytes stay in Slack; `previewUrl` is main's cache, only for an image. */
export interface SlackClientFile {
  id: string;
  name: string;
  mimetype: string;
  size: number;
  previewUrl: string | null;
  /** The file's page in Slack, which opens in the browser. */
  permalink: string | null;
}

export const SLACK_CLIENT_PENDING = ["sending", "editing", "deleting"] as const;

export interface SlackClientMessage {
  ts: string;
  /** The thread the message replies in, or null at the top of the conversation. */
  threadTs: string | null;
  replyCount: number;
  latestReplyTs: string | null;
  authorId: string;
  /** Raw Slack mrkdwn. */
  text: string;
  files: SlackClientFile[];
  reactions: SlackClientReaction[];
  editedAt: string | null;
  deleted: boolean;
  /** Written by the connected person: only these can be edited or deleted. */
  mine: boolean;
  /** Set only in the renderer, for an optimistic action that Slack has not confirmed. */
  pending?: (typeof SLACK_CLIENT_PENDING)[number];
  /** An agent sent it as the person with no approval, because the conversation is on the auto-reply list. */
  autoSent?: boolean;
}

/** Messages of one conversation, oldest first, with the names they need. */
export interface SlackClientPage {
  workspaceId: string;
  channelId: string;
  messages: SlackClientMessage[];
  /** Older messages exist in Slack or in the cache. */
  hasOlder: boolean;
  /** Display names by Slack user id. */
  people: Record<string, string>;
  /** Channel names by channel id, without `#`. */
  channels: Record<string, string>;
  /** Workspace emoji: an https image address, or `alias:<name>`. */
  customEmoji: Record<string, string>;
  /** Slack could not be reached: the messages come from the cache only. */
  offline: boolean;
  /** Slack refused the last read of the newest messages: the messages come from the cache only. */
  loadError?: boolean;
  /** An agent's message to this conversation goes out as the person with no approval. Off when absent. */
  autoReply?: boolean;
}

export interface SlackClientThread {
  workspaceId: string;
  channelId: string;
  parent: SlackClientMessage;
  replies: SlackClientMessage[];
  people: Record<string, string>;
  channels: Record<string, string>;
  customEmoji: Record<string, string>;
}

/** The cache of a workspace changed. `channelId` is null when the conversation list changed. */
export interface SlackClientChanged {
  workspaceId: string;
  channelId: string | null;
}

export interface SlackClientListInput {
  workspaceId: string;
}
export interface SlackClientOpenInput {
  workspaceId: string;
  channelId: string;
}
export interface SlackClientOlderInput {
  workspaceId: string;
  channelId: string;
  beforeTs: string;
}
export interface SlackClientThreadInput {
  workspaceId: string;
  channelId: string;
  threadTs: string;
}
export interface SlackClientSendInput {
  workspaceId: string;
  channelId: string;
  text: string;
  threadTs?: string;
  /** Also send a thread reply to the channel. A file goes with an upload, which takes the text. */
  broadcast?: boolean;
}
/** Puts the conversation on the auto-reply list, or takes it off. Main checks the person owns the workspace. */
export interface SlackClientAutoReplyInput {
  workspaceId: string;
  channelId: string;
  on: boolean;
}
export interface SlackClientEditInput {
  workspaceId: string;
  channelId: string;
  ts: string;
  text: string;
}
export interface SlackClientDeleteInput {
  workspaceId: string;
  channelId: string;
  ts: string;
}
export interface SlackClientReactInput {
  workspaceId: string;
  channelId: string;
  ts: string;
  name: string;
  on: boolean;
}
/** Shares a file as the person, with an optional text, in the channel or in a thread. Main opens the file picker. */
export interface SlackClientUploadInput {
  workspaceId: string;
  channelId: string;
  threadTs?: string;
  text?: string;
}
/**
 * The same upload for a file the person dropped on the composer: the renderer sends its name and
 * bytes, never a path. Main refuses more than `SLACK_CLIENT_LIMITS.uploadBytes`.
 */
export interface SlackClientUploadBytesInput extends SlackClientUploadInput {
  name: string;
  bytes: Uint8Array;
}
export interface SlackClientUploadResult {
  fileId: string;
  name: string;
  size: number;
}
export interface SlackClientMentionInput {
  workspaceId: string;
  query: string;
}
export interface SlackClientMentionCandidate {
  id: string;
  name: string;
}

export const SLACK_CLIENT_LIMITS = {
  pageSize: 100,
  uploadBytes: 50 * 1024 * 1024,
  textLength: 4000,
  cacheBytesPerWorkspace: 1024 * 1024 * 1024,
} as const;

// Bounds for the guards only: what one IPC result may hold before the renderer refuses it.
const GUARD_LIMITS = {
  conversations: 10_000,
  members: 1_000,
  messages: 2_000,
  replies: 10_000,
  files: 100,
  reactions: 200,
  lookups: 5_000,
  name: 1_024,
  text: 100_000,
  emojiUrl: 1_024,
  url: 2_048,
} as const;

const SLACK_TS = /^\d{1,12}\.\d{1,9}$/u;
/** `previewUrl` names only main's own Slack image scheme, so the renderer loads nothing else from it. */
const FILE_PREVIEW = /^openbot-attachment:\/\/slack\/[^/?#]+\/[^/?#]+$/u;

function isSlackTs(value: unknown): value is string {
  return isBoundedString(value, 32) && SLACK_TS.test(value);
}

function isNullableSlackTs(value: unknown): value is string | null {
  return value === null || isSlackTs(value);
}

function isCount(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value >= 0;
}

function isListOf(value: unknown, maximum: number, check: (entry: unknown) => boolean): boolean {
  return Array.isArray(value) && value.length <= maximum && value.every(check);
}

function isNameMap(value: unknown, maximum: number, check: (entry: string) => boolean = () => true): boolean {
  if (!isDynamicRecord(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= GUARD_LIMITS.lookups &&
    entries.every(
      ([key, entry]) =>
        key.length > 0 && key.length <= GUARD_LIMITS.name && isBoundedString(entry, maximum) && check(entry),
    )
  );
}

function isCustomEmojiValue(value: string): boolean {
  return value.startsWith("alias:") || isHttpsUrl(value);
}

function isSlackClientFile(value: unknown): value is SlackClientFile {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isBoundedString(value.name, GUARD_LIMITS.name) &&
    isBoundedString(value.mimetype, 255) &&
    isCount(value.size) &&
    (value.previewUrl === null ||
      (isBoundedString(value.previewUrl, GUARD_LIMITS.url) && FILE_PREVIEW.test(value.previewUrl))) &&
    (value.permalink === null || (isBoundedString(value.permalink, GUARD_LIMITS.url) && isHttpsUrl(value.permalink)))
  );
}

function isSlackClientReaction(value: unknown): value is SlackClientReaction {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.name, 255) &&
    value.name.length > 0 &&
    isCount(value.count) &&
    isBoolean(value.mine)
  );
}

export function isSlackClientMessage(value: unknown): value is SlackClientMessage {
  return (
    isDynamicRecord(value) &&
    isSlackTs(value.ts) &&
    isNullableSlackTs(value.threadTs) &&
    isCount(value.replyCount) &&
    isNullableSlackTs(value.latestReplyTs) &&
    isBoundedString(value.authorId, GUARD_LIMITS.name) &&
    isBoundedString(value.text, GUARD_LIMITS.text) &&
    isListOf(value.files, GUARD_LIMITS.files, isSlackClientFile) &&
    isListOf(value.reactions, GUARD_LIMITS.reactions, isSlackClientReaction) &&
    isNullableBoundedString(value.editedAt, 64) &&
    isBoolean(value.deleted) &&
    isBoolean(value.mine) &&
    (value.pending === undefined || isOneOf(SLACK_CLIENT_PENDING, value.pending)) &&
    (value.autoSent === undefined || isBoolean(value.autoSent))
  );
}

function hasLookups(value: { readonly [key: string]: unknown }): boolean {
  return (
    isNameMap(value.people, GUARD_LIMITS.name) &&
    isNameMap(value.channels, GUARD_LIMITS.name) &&
    isNameMap(value.customEmoji, GUARD_LIMITS.emojiUrl, isCustomEmojiValue)
  );
}

function isSlackClientConversation(value: unknown): value is SlackClientConversation {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.workspaceId) &&
    isIdentifier(value.channelId) &&
    isOneOf(SLACK_CONVERSATION_KINDS, value.kind) &&
    isBoundedString(value.name, GUARD_LIMITS.name) &&
    isListOf(value.memberIds, GUARD_LIMITS.members, isIdentifier) &&
    isCount(value.unreadCount) &&
    isNullableSlackTs(value.lastActivityTs) &&
    isBoolean(value.isMember)
  );
}

export function isSlackClientConversations(value: unknown): value is SlackClientConversation[] {
  return isListOf(value, GUARD_LIMITS.conversations, isSlackClientConversation);
}

export function isSlackClientPage(value: unknown): value is SlackClientPage {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.workspaceId) &&
    isIdentifier(value.channelId) &&
    isListOf(value.messages, GUARD_LIMITS.messages, isSlackClientMessage) &&
    isBoolean(value.hasOlder) &&
    hasLookups(value) &&
    isBoolean(value.offline) &&
    (value.loadError === undefined || isBoolean(value.loadError)) &&
    (value.autoReply === undefined || isBoolean(value.autoReply))
  );
}

export function isSlackClientThread(value: unknown): value is SlackClientThread {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.workspaceId) &&
    isIdentifier(value.channelId) &&
    isSlackClientMessage(value.parent) &&
    isListOf(value.replies, GUARD_LIMITS.replies, isSlackClientMessage) &&
    hasLookups(value)
  );
}

export function isSlackClientUploadResult(value: unknown): value is SlackClientUploadResult {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.fileId) &&
    isBoundedString(value.name, GUARD_LIMITS.name) &&
    isCount(value.size) &&
    value.size <= SLACK_CLIENT_LIMITS.uploadBytes
  );
}

export function isSlackClientMentionCandidates(value: unknown): value is SlackClientMentionCandidate[] {
  return isListOf(
    value,
    GUARD_LIMITS.lookups,
    (entry) => isDynamicRecord(entry) && isIdentifier(entry.id) && isBoundedString(entry.name, GUARD_LIMITS.name),
  );
}

export function isSlackClientChanged(value: unknown): value is SlackClientChanged {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.workspaceId) &&
    (value.channelId === null || isIdentifier(value.channelId))
  );
}
