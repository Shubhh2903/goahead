// The seam between the platform-agnostic messaging core and one chat platform. A platform is one
// `MessagingDriver`: an adapter for its API and a transport for its inbound events. The OpenBot
// Slack app uses the Events API: Slack posts to Signal, Signal checks Slack's signature, and passes
// each request of a workspace linked to this host over the `MessagingIngress` socket, which the host
// opens. A Discord driver would use the Gateway and a Telegram driver long polling (`getUpdates`).
// No transport needs a public endpoint on the host.

import type { MessagingConnectionState, MessagingPlatform, SlackConversationKind } from "@openbot/contracts/ipc";
import type { MessagingAnswerFile } from "./messaging-threads";

/** Where a post goes: a platform channel, and the thread in it or the top level. */
export interface MessageTarget {
  platformChannelId: string;
  replyThreadId: string | null;
}

export interface InboundFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
}

/**
 * The key of a direct message conversation: one per person, so every direct message from them goes
 * to the same agent thread. It is not a platform message id: the answer still goes under each message.
 */
export const DIRECT_CONVERSATION_KEY = "direct";

/** One message that addresses OpenBot, in the same shape for every platform. */
export interface InboundMessage {
  /** Stable for one message across redeliveries. */
  dedupKey: string;
  platformChannelId: string;
  /** Names the conversation: one link, and so one execution thread, per key and channel. */
  threadKey: string;
  target: MessageTarget;
  platformMessageId: string;
  isDirect: boolean;
  /** True for a reply that does not name OpenBot: it counts only in a conversation that already has an agent. */
  requiresLink: boolean;
  authorId: string;
  text: string;
  files: InboundFile[];
  /** Set for a reply to a message OpenBot sent as the user, already turned into a message of its conversation. */
  observed?: boolean;
  /**
   * A message in a group direct message that does not name OpenBot. It never starts a conversation;
   * it only comes back as a reply after OpenBot sent a message to that group.
   */
  groupDirect?: boolean;
}

/**
 * A message that the connected person can see, before the inbox decides to keep it. It does not
 * address OpenBot and starts no work.
 */
export interface InboxCandidate {
  platformChannelId: string;
  platformMessageId: string;
  /** The thread the message is in, or null at the top of the conversation. */
  threadKey: string | null;
  place: "direct" | "group" | "channel";
  authorId: string;
  text: string;
  sentAt: string;
  /** The people the text mentions, by platform user id. */
  mentionedUserIds: string[];
  /** The files the message shared. */
  files?: InboxFile[];
}

/** A file that a message in the person's inbox shared, as the platform described it. */
export interface InboxFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  /** The private address of the whole file. It needs the token. */
  url: string;
  /** A smaller image of an image file, or null. It needs the token too. */
  thumbnailUrl: string | null;
  /** The file's page on the platform, for a browser. */
  permalink: string | null;
}

/** One emoji reaction on a history message. `userIds` can be shorter than `count`: Slack cuts the list. */
export interface HistoryReaction {
  name: string;
  count: number;
  userIds: string[];
  /** The connected person reacted with it. */
  mine: boolean;
}

/**
 * One message of a conversation's history, as the Slack client's cache keeps it. `text` stays in
 * Slack's markup. The files keep the platform's private addresses: they stay in main and backend.
 */
export interface HistoryMessage {
  ts: string;
  /** The thread the message replies in, or null at the top of the conversation and for a thread parent. */
  threadTs: string | null;
  replyCount: number;
  latestReplyTs: string | null;
  /** A user id, or a bot id for a bot message, or empty when the platform gives neither. */
  authorId: string;
  text: string;
  files: InboxFile[];
  reactions: HistoryReaction[];
  /** ISO time of the last edit, or null. */
  editedAt: string | null;
  /** A deleted thread parent that Slack keeps as a placeholder. */
  deleted: boolean;
  subtype: string | null;
}

/** One conversation the connected person is in. */
export interface HistoryConversation {
  channelId: string;
  kind: SlackConversationKind;
  /** The channel name. Empty for a direct message: the caller names it from `memberIds`. */
  name: string;
  /**
   * The people of a direct message (the other person, then the connected person). Empty otherwise,
   * and empty for a group DM until `conversationMembers` reads them.
   */
  memberIds: string[];
  isMember: boolean;
}

export interface HistoryConversationPage {
  conversations: HistoryConversation[];
  nextCursor: string | null;
}

export interface HistoryPage {
  /** Oldest first. */
  messages: HistoryMessage[];
  hasMore: boolean;
}

/** One page of a thread: the parent is on the first page. Pass `nextCursor` back for the next page. */
export interface HistoryThreadPage {
  /** Oldest first. */
  messages: HistoryMessage[];
  nextCursor: string | null;
}

export interface HistoryConversationState {
  lastReadTs: string | null;
  /** Null when the platform does not give it for this conversation. */
  unreadCount: number | null;
}

/**
 * A live change to the history the Slack client keeps: a new message, an edit, a deletion, a
 * reaction, or the connected person joining or leaving a conversation. It updates the cache only;
 * it never starts an agent turn.
 */
export type HistoryEvent =
  | { type: "message"; channelId: string; message: HistoryMessage }
  | { type: "edited"; channelId: string; ts: string; text: string; editedAt: string }
  | { type: "deleted"; channelId: string; ts: string }
  | {
      type: "reaction";
      channelId: string;
      ts: string;
      name: string;
      userId: string;
      on: boolean;
      /** The connected person, whose own reaction sets `mine`. */
      ownerUserId: string | null;
    }
  | { type: "membership"; channelId: string; kind: SlackConversationKind; isMember: boolean };

export interface HistoryUpload {
  channel: string;
  threadTs?: string;
  name: string;
  bytes: Uint8Array;
  mimeType?: string;
  /**
   * The text of the message that shares the file, as client text: plain text plus `<@U…>` user
   * mentions. Every other `<`, `>` and `&` is escaped. A send with a file is this one call; no later
   * post attaches the file.
   */
  initialComment?: string;
}

export type InboundAction =
  | {
      type: "approval";
      token: string;
      decision: "accept" | "decline";
      actorId: string;
      target: MessageTarget;
      platformMessageId: string;
    }
  | { type: "stop"; token: string; actorId: string; target: MessageTarget; platformMessageId: string };

interface MessageButton {
  action: "accept" | "decline" | "stop";
  label: string;
  /** Opaque and single use. It maps to the request only in the host's memory. */
  token: string;
  style?: "primary" | "danger";
}

export interface MessageBody {
  text: string;
  buttons?: MessageButton[];
}

export type StatusReaction = "received" | "done" | "failed" | "stopped";

/** Whose token a post uses: the person who connected the workspace, or the OpenBot bot. */
export type MessageSender = "user" | "bot";

export interface ConnectionIdentity {
  workspaceId: string;
  workspaceName: string;
  botUserId: string;
  appId: string;
  missingScopes: string[];
  /** The person whose token came with the install, when there is one: the host can act as them. */
  user: { id: string; name: string } | null;
}

export interface ContextEntry {
  id: string;
  authorName: string;
  text: string;
  sentAt: string;
}

/** A failure the connection cannot recover from alone. The user must act. */
export class MessagingConnectionError extends Error {
  constructor(readonly state: Extract<MessagingConnectionState, "invalid_token">) {
    super(state);
  }
}

export interface MessagingAdapter {
  readonly platform: MessagingPlatform;
  identify(): Promise<ConnectionIdentity>;
  post(target: MessageTarget, body: MessageBody): Promise<string>;
  edit(target: MessageTarget, messageId: string, body: MessageBody): Promise<void>;
  /**
   * Posts a reply that the person typed, as them, with the user token. Only Slack has it. The text is
   * escaped as a whole; with `keepMentions` it is client text, and `<@U…>` user mentions stay. With
   * `broadcast`, a thread reply also shows in the conversation.
   */
  postAsUser?(input: {
    channel: string;
    threadTs?: string;
    text: string;
    keepMentions?: boolean;
    broadcast?: boolean;
  }): Promise<{ ts: string }>;
  /** Moves the person's read mark of a conversation to `ts`, with the user token. Only Slack has it. */
  markReadAsUser?(channel: string, ts: string): Promise<void>;
  postPrivate(target: MessageTarget, userId: string, text: string): Promise<void>;
  react(target: MessageTarget, messageId: string, reaction: StatusReaction, on: boolean): Promise<void>;
  /**
   * Posts the agent's answer, in as many posts as the platform needs. The first part replaces
   * `replaceMessageId` when it is given.
   */
  postAnswer(target: MessageTarget, markdown: string, replaceMessageId: string | null): Promise<void>;
  /** Uploads files to the conversation, and returns the names it did not send. */
  upload(target: MessageTarget, files: MessagingAnswerFile[]): Promise<string[]>;
  /**
   * The direct message with one person, or the group direct message with several (ids joined with
   * commas), opened when needed, as the sender. Returns its channel id.
   */
  openDirectMessage?(userIds: string, as: MessageSender): Promise<string>;
  /**
   * Posts markdown text as the sender, outside the status flow. Returns the message id. With
   * `keepMentions`, user mentions such as `<@U0123>` ping; all other markup stays escaped.
   */
  postAs?(
    target: MessageTarget,
    markdown: string,
    as: MessageSender,
    options?: { keepMentions?: boolean },
  ): Promise<string>;
  /** A link to one posted message, or null when the platform gives none. */
  permalink?(platformChannelId: string, messageId: string): Promise<string | null>;
  /** The channels the connected person is in, read as them. */
  listPersonPlaces?(): Promise<Array<{ id: string; name: string; isPrivate: boolean }>>;
  /** The newest messages at the top of one channel, read as the connected person, newest first. */
  recentMessages?(platformChannelId: string, limit: number): Promise<InboxCandidate[]>;
  /**
   * Whether OpenBot's bot is in the conversation. With the user's events, a direct message between
   * the user and someone else arrives too, and it must never be answered as a request to OpenBot.
   */
  isOwnConversation?(platformChannelId: string): Promise<boolean>;
  /**
   * Whether the connected person is in the conversation. Slack sends one workspace's user events to
   * one host, so another installed person's private messages can arrive too; they must never be kept.
   */
  isPersonConversation?(platformChannelId: string): Promise<boolean>;
  /**
   * The Slack user ids of a direct or group direct message, read as the connected person. Null for a
   * channel, or when the people cannot be read.
   */
  conversationPeople?(platformChannelId: string): Promise<string[] | null>;
  /** Earlier messages of the conversation, oldest first, after `afterId` and before `beforeId`. */
  history(
    platformChannelId: string,
    threadKey: string,
    afterId: string | null,
    beforeId: string,
  ): Promise<ContextEntry[]>;
  /** Downloads one file to `destination`. Refuses a file larger than `maxBytes`. */
  download(file: InboundFile, destination: string, maxBytes: number): Promise<void>;
  /**
   * Downloads a file of the person's inbox to `destination`, with the person's token first and then
   * the bot's. Refuses an address that is not the platform's, a page instead of a file, and a file
   * larger than `maxBytes`.
   */
  downloadInboxFile?(url: string, destination: string, maxBytes: number): Promise<void>;
  /** The workspace's own emoji: an https image address or `alias:<name>`, by name. Empty when not readable. */
  customEmoji?(): Promise<Record<string, string>>;
  /** Inbox text, kept in the platform's markup, as plain text for an agent or a preview. */
  plainText?(text: string): string;
  authorName(userId: string): Promise<string>;
  placeName(platformChannelId: string): Promise<string>;
  mention(userId: string): string;
  // The Slack client. Every method below acts as the connected person, with the user token, and fails
  // without it. Reads throw `SlackRateLimitError` on a 429 at once, so the client's queue waits; each
  // read is one Slack call, so the queue schedules and repeats one page at a time. Text that these
  // methods send is client text: plain text plus `<@U…>` user mentions, with all other markup escaped.
  /** One page of the person's conversations of every kind. */
  listConversations?(cursor?: string): Promise<HistoryConversationPage>;
  /** Messages before `latest` (all the newest without it), oldest first. */
  historyPage?(channel: string, options: { latest?: string; limit: number }): Promise<HistoryPage>;
  /** One page of a thread (the parent and replies), oldest first. Without `cursor`, the first page. */
  threadReplies?(channel: string, threadTs: string, cursor?: string): Promise<HistoryThreadPage>;
  /** The person's read mark and unread count of one conversation. */
  conversationInfo?(channel: string): Promise<HistoryConversationState>;
  /** The people of a group DM (at most 100; a group DM has at most 9). */
  conversationMembers?(channel: string): Promise<string[]>;
  /** Changes the text of one of the person's own messages. The caller checks the author first. */
  updateAsUser?(channel: string, ts: string, text: string): Promise<void>;
  /** Deletes one of the person's own messages. The caller checks the author first. */
  deleteAsUser?(channel: string, ts: string): Promise<void>;
  /** Adds or removes the person's reaction. A reaction already in that state is not an error. */
  reactAsUser?(channel: string, ts: string, name: string, on: boolean): Promise<void>;
  /** Uploads one file and shares it in the conversation as the person. Refuses a file over the client limit. */
  uploadFileAsUser?(input: HistoryUpload): Promise<{ fileId: string }>;
  /** People of the workspace whose names match `query`, for a mention. Not queued: it waits on a 429 itself. */
  searchPeople?(query: string): Promise<Array<{ id: string; name: string }>>;
  /**
   * People of the workspace whose display, real, first or handle name is `name`, without case.
   * Deleted people and bots are left out. Read from the platform, not only from a local cache.
   */
  findPeople?(name: string): Promise<Array<{ id: string; name: string; title: string }>>;
  /** Joins every public place the platform lets OpenBot join without an invitation. */
  joinPublicPlaces?(): Promise<void>;
  /** Joins one public place, such as a channel that was just created. */
  joinPlace?(platformChannelId: string): Promise<void>;
}

export interface TransportSink {
  state(state: MessagingConnectionState, detail?: { retryAt?: string }): void;
  message(message: InboundMessage): void;
  action(action: InboundAction): void;
  /** A public place was created that OpenBot can join. */
  placeCreated?(platformChannelId: string): void;
  /** A message the connected person can see. The inbox decides whether to keep it. */
  inbox?(candidate: InboxCandidate): void;
  /** A live change to a conversation's history, for the Slack client's cache. Only Slack has it. */
  history?(event: HistoryEvent): void;
  /**
   * The platform says that a token was revoked or the app was removed. The event can be late: a
   * disconnect revokes the old tokens, and the event can arrive after a new install. Without this
   * hook the transport reports `invalid_token` at once.
   */
  revoked?(): void;
}

export interface MessagingTransport {
  start(sink: TransportSink): void;
  /** Reconnects now, such as after the computer wakes. */
  reconnect(): void;
  stop(): Promise<void>;
  /** Handles one request that the ingress relay brought, for a transport that gets its events that way. */
  deliver?(delivery: IngressDelivery): Promise<IngressAnswer>;
}

/**
 * One HTTP request that a platform sent to its request URL, as Signal passed it on. Signal has
 * already checked the platform's signature.
 */
export interface IngressDelivery {
  kind: "events" | "interactivity";
  retryNum: number | null;
  body: Uint8Array;
}

/** The HTTP answer the platform gets. A body only for a URL check or a button reply. */
export interface IngressAnswer {
  status: 200 | 400 | 401 | 404 | 503;
  contentType?: "application/json" | "text/plain";
  body?: string;
}

/** `unavailable` has a reason the user can act on: sign in, name this computer, or wait for Signal. */
export type IngressState = "online" | "connecting" | "signed_out" | "no_host" | "unavailable";

/** Handles one request for a workspace, by the platform's workspace id. */
export type IngressHandler = (workspaceId: string, delivery: IngressDelivery) => Promise<IngressAnswer>;

/**
 * The relay that brings a platform's HTTP requests to this host: Signal's `ingress` socket, which
 * the main process owns. It is open while anything holds it.
 */
export interface MessagingIngress {
  /** Keeps the relay open until the returned function runs. */
  acquire(): () => void;
  state(): IngressState;
  onState(listener: (state: IngressState) => void): () => void;
  /** Sets the one handler of the requests the relay receives, or removes it. */
  handle(handler: IngressHandler | null): void;
  /**
   * Opens the socket again, such as after the computer wakes, or after a workspace was connected or
   * disconnected: Signal learns the workspaces of this host when the socket connects.
   */
  reconnect(): void;
}

export interface MessagingDriverOptions {
  /** Called when the platform asks the host to wait, with the time it can try again. */
  rateLimited(retryAt: string): void;
}

export interface MessagingDriver {
  readonly platform: MessagingPlatform;
  createAdapter(credentials: Record<string, string>, options: MessagingDriverOptions): MessagingAdapter;
  createTransport(credentials: Record<string, string>, identity: ConnectionIdentity): MessagingTransport;
}
