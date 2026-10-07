// The seam between the platform-agnostic messaging core and one chat platform. A platform is one
// `MessagingDriver`: an adapter for its API and a transport for its inbound events. The OpenBot
// Slack app uses the Events API: Slack posts to Signal, Signal checks Slack's signature, and passes
// each request of a workspace linked to this host over the `MessagingIngress` socket, which the host
// opens. A Discord driver would use the Gateway and a Telegram driver long polling (`getUpdates`).
// No transport needs a public endpoint on the host.

import type { MessagingConnectionState, MessagingPlatform } from "@openbot/contracts/ipc";
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
  /** Posts markdown text as the sender, outside the status flow. Returns the message id. */
  postAs?(target: MessageTarget, markdown: string, as: MessageSender): Promise<string>;
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
  /** Earlier messages of the conversation, oldest first, after `afterId` and before `beforeId`. */
  history(
    platformChannelId: string,
    threadKey: string,
    afterId: string | null,
    beforeId: string,
  ): Promise<ContextEntry[]>;
  /** Downloads one file to `destination`. Refuses a file larger than `maxBytes`. */
  download(file: InboundFile, destination: string, maxBytes: number): Promise<void>;
  authorName(userId: string): Promise<string>;
  placeName(platformChannelId: string): Promise<string>;
  mention(userId: string): string;
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
