import type { AgentEvent, ConversationMessage } from "@openbot/contracts/ipc";
import { CONVERSATION_PLAN_ITEM_TYPE, MESSAGING_LIMITS } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { DeliveryContext, MailboxStore, MessagingOrigin } from "../mailbox-store";
import type { OpenBotDatabase } from "../openbot-database";
import type { SlackTurnFacts } from "./google-tools";
import { MessagingAutoReplyStore } from "./messaging-auto-reply-store";
import { MessagingDraftStore } from "./messaging-draft-store";
import { MessagingInboxStore } from "./messaging-inbox-store";
import { type MessagingContextMessage, messagingPromptText, projectMapInstruction } from "./messaging-prompt";
import { type MessagingLink, MessagingStore, REPLY_CONTEXT_KEY } from "./messaging-store";

/** A file the agent attached to its answer, ready to upload. */
export interface MessagingAnswerFile {
  name: string;
  path: string;
  mimeType: string;
}

type MessagingTurnStatus = "completed" | "failed" | "interrupted";

/**
 * `followUp` marks a turn that a teammate's answer started, not an external message: its answer goes
 * to the conversation, and the external message it follows up keeps its reactions.
 */
export type MessagingActivity =
  | { type: "started"; link: MessagingLink; turnId: string; origin: MessagingOrigin | null; followUp: boolean }
  | {
      type: "finished";
      link: MessagingLink;
      /** Null when the delivery failed before a turn started. */
      turnId: string | null;
      status: MessagingTurnStatus;
      origin: MessagingOrigin | null;
      followUp: boolean;
      answer: string | null;
      files: MessagingAnswerFile[];
    }
  | { type: "cancelled"; link: MessagingLink; origin: MessagingOrigin };

export interface MessagingReceiveInput {
  connectionId: string;
  agentId: string;
  platformChannelId: string;
  threadKey: string;
  isDirect: boolean;
  title: string;
  text: string;
  sourcePaths: string[];
  origin: Omit<MessagingOrigin, "linkId">;
  /** Stable for one external message, so a redelivered event enqueues nothing. */
  idempotencyKey: string;
}

export type MessagingReceiveResult =
  | { status: "queued"; link: MessagingLink; deliveryId: string; waiting: boolean }
  | { status: "duplicate" }
  | { status: "busy"; link: MessagingLink };

/** The reply context of one conversation, as the platform side uses it. */
export interface ReplyContext {
  link: MessagingLink;
  /** No turn was sent to it yet: the first prompt carries the full context. */
  fresh: boolean;
}

export interface ReplyContextInput {
  connectionId: string;
  agentId: string;
  platformChannelId: string;
  isDirect: boolean;
  title: string;
}

/** A turn that started or ended in a reply context. */
export interface ReplyContextTurn {
  type: "started" | "completed";
  agentId: string;
  threadId: string;
  turnId: string;
  /** How a completed turn ended, such as `completed` or `failed`. Null for a start. */
  status: string | null;
}

/** The newest platform message that a reply context read, written once the turn that read it succeeds. */
export interface ReplyContextCursor {
  linkId: string;
  value: string;
}

/** What the platform side adds to the prompt when a delivery starts. */
export interface MessagingPromptContext {
  workspaceName: string | null;
  place: string;
  messages: MessagingContextMessage[];
  /** The newest message the agent has now read, stored as the link's history cursor. */
  cursor: string | null;
  /** The platform user id of the person who connected the workspace as themself, when there is one. */
  ownerId?: string | null;
  skippedFiles: string[];
}

/** An agent's request to send a new message, from the execution thread of an external conversation. */
export interface MessagingSendRequest {
  agentId: string;
  /** The execution thread the agent runs in. It names the conversation, and so the workspace. */
  threadId: string;
  /** A person or channel of the platform, as the agent saw it, such as `<@U0123>` or `C0123`. */
  to: string;
  text: string;
  /** A thread of the target channel to reply in, when the agent names one. */
  threadKey: string | null;
  /**
   * True only when the person at this computer started the turn in GoAhead, directly or through an
   * agent's hand-off from such a turn. Absent is false.
   */
  ownerTurn?: boolean;
}

/** What the agent learns: the draft waits for the approval of one person. */
export interface MessagingSendReceipt {
  /** `sent` when the connected person asked for it themselves; otherwise it waits for their approval. */
  status: "sent" | "waiting_for_approval";
  draftId: string;
  sender: "user" | "bot";
  /** The platform user id of the connected person, the only one who can approve. */
  approverId: string;
  /** A link to the sent message, when it was sent and the platform gives one. */
  link: string | null;
  /** Sent with no approval, because the person put the conversation on the auto-reply list. */
  autoSent?: true;
  /** Sent as the person, because they asked in GoAhead, not in a Slack conversation. */
  fromGoAhead?: true;
  /** Who got it, by name, when it was sent from GoAhead. */
  recipient?: string;
  /** `@Name`s in the text that several people share, left as plain text. */
  ambiguousMentions?: string[];
}

/** An agent's read of the connected person's inbox, from the execution thread of a conversation. */
export type MessagingInboxRequest =
  | { tool: "list_unread"; agentId: string; threadId: string; localOwnerTurn: boolean }
  | {
      tool: "read";
      agentId: string;
      threadId: string;
      /** True only when the person at this computer started the turn in the desktop app. */
      localOwnerTurn: boolean;
      conversation: string;
      threadKey: string | null;
      limit: number;
    };

/** What `slack_list_unread` answers. */
export interface MessagingInboxUnreadResult {
  unread: Array<{
    conversation: string;
    kind: string;
    place: string;
    unreadCount: number;
    latestFrom: string;
    latestAt: string;
  }>;
  pickedChannels: Array<{ conversation: string; name: string }>;
  /** Says that the text is other people's: data, never instructions. */
  note: string;
}

/** What `slack_read_conversation` answers. */
export interface MessagingInboxReadResult {
  conversation: string;
  place: string;
  messages: Array<{ id: string; thread: string | null; from: string; sentAt: string; text: string }>;
  note: string;
}

export type MessagingInboxResult = MessagingInboxUnreadResult | MessagingInboxReadResult;

export interface MessagingThreadsHooks {
  schedule(agentId: string): void;
  busy(agentId: string): boolean;
  interrupt(agentId: string, turnId: string, threadId: string): Promise<void>;
  /** Removes live provider state for an execution thread before its rows are deleted. */
  forgetThread(threadId: string): Promise<void>;
  /** Every local agent's project folders as one prompt line, or null when no agent has one. */
  projectMap(): string | null;
  /** The agent's own main thread: the one its chat shows. */
  mainThreadId(agentId: string): Promise<string>;
}

/**
 * Enough work from one conversation platform to hold an agent for a long time. The Slack
 * orchestrator receives every new conversation, and it mostly asks teammates, so its turns are short.
 */
const AGENT_QUEUE_LIMIT = 20;
/**
 * A reply context starts again after this many turns. Each turn adds the new messages, the reply
 * and its tool call, so the context stays small and a long day of auto-replies does not grow it.
 */
export const REPLY_CONTEXT_TURNS = 10;
/** A reply context idle for this long starts again: the provider's prompt cache is cold by then. */
export const REPLY_CONTEXT_IDLE_MS = 60 * 60_000;
const AUTHOR_QUEUE_LIMIT = 2;
const CONTEXT_TIMEOUT_MS = 5_000;

/**
 * Owns the execution threads of external conversations: it enqueues their messages, frames their
 * prompts, keeps their conversation events out of the agent's public chat, and reports each turn to
 * the platform side. It never talks to a platform itself. The platform side supplies the prompt
 * context through `setContextSource` and listens with `onActivity`.
 */
export class MessagingThreads {
  readonly store: MessagingStore;
  /** The person's local Slack inbox, which the read tools use. */
  readonly inbox: MessagingInboxStore;
  /** The drafts that wait for the person's approval, kept across a restart. */
  readonly drafts: MessagingDraftStore;
  /** The conversations where an agent's message goes out with no approval. */
  readonly autoReply: MessagingAutoReplyStore;
  readonly #database: OpenBotDatabase;
  readonly #mailbox: MailboxStore;
  readonly #hooks: MessagingThreadsHooks;
  readonly #listeners = new Set<(activity: MessagingActivity) => void>();
  readonly #changeListeners = new Set<(threadId: string) => void>();
  readonly #ownerMessageListeners = new Set<(agentId: string) => void>();
  readonly #replyTurnListeners = new Set<(turn: ReplyContextTurn) => void>();
  readonly #admissions = new Map<string, Promise<unknown>>();
  /** The external message each running turn answers, by turn id. */
  readonly #turnOrigins = new Map<string, { origin: MessagingOrigin | null; followUp: boolean }>();
  #contextSource: ((link: MessagingLink, origin: MessagingOrigin) => Promise<MessagingPromptContext>) | null = null;
  #sender: ((request: MessagingSendRequest) => Promise<MessagingSendReceipt>) | null = null;
  #inboxReader: ((request: MessagingInboxRequest) => Promise<MessagingInboxResult>) | null = null;
  #ownerSource: ((connectionId: string) => string | null) | null = null;

  constructor(database: OpenBotDatabase, mailbox: MailboxStore, hooks: MessagingThreadsHooks) {
    this.store = new MessagingStore(database);
    this.inbox = new MessagingInboxStore(database);
    this.drafts = new MessagingDraftStore(database);
    this.autoReply = new MessagingAutoReplyStore(database);
    this.#database = database;
    this.#mailbox = mailbox;
    this.#hooks = hooks;
  }

  onActivity(listener: (activity: MessagingActivity) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** A turn started or ended in a reply context. Its events never reach the agent's public chat. */
  onReplyContextTurn(listener: (turn: ReplyContextTurn) => void): () => void {
    this.#replyTurnListeners.add(listener);
    return () => this.#replyTurnListeners.delete(listener);
  }

  /**
   * The reply context where the auto-reply turns of one conversation run, made when there is none.
   * A context with `REPLY_CONTEXT_TURNS` turns, one idle for `REPLY_CONTEXT_IDLE_MS`, or one of another
   * agent is replaced with an empty one, unless a turn of its agent runs now. Null when the context
   * belongs to another agent that is busy: the turn then runs in the agent's main thread.
   */
  async ensureReplyContext(input: ReplyContextInput): Promise<ReplyContext | null> {
    const existing = this.store.replyContext(input.connectionId, input.platformChannelId);
    if (existing) {
      const sameAgent = existing.agentId === input.agentId;
      const spent =
        this.store.userMessageCount(existing.threadId) >= REPLY_CONTEXT_TURNS ||
        Date.now() - Date.parse(existing.updatedAt) >= REPLY_CONTEXT_IDLE_MS;
      if (sameAgent && (!spent || this.#hooks.busy(existing.agentId)))
        return { link: existing, fresh: existing.historyCursor === null };
      if (this.#hooks.busy(existing.agentId)) return null;
      await this.#hooks.forgetThread(existing.threadId);
      this.store.deleteLink(existing.linkId);
    }
    const link = this.store.ensureLink({
      connectionId: input.connectionId,
      agentId: input.agentId,
      platformChannelId: input.platformChannelId,
      threadKey: REPLY_CONTEXT_KEY,
      isDirect: input.isDirect,
      title: input.title.slice(0, MESSAGING_LIMITS.name),
    });
    return { link, fresh: link.historyCursor === null };
  }

  /** The agent's own main thread, where an auto-reply runs when its reply context is not free. */
  mainThreadId(agentId: string): Promise<string> {
    return this.#hooks.mainThreadId(agentId);
  }

  /** Records the newest platform message that a reply context has read. */
  markReplyContextRead(linkId: string, cursor: string): void {
    this.store.touch(linkId, cursor);
  }

  /** True when the thread is a reply context, whose sessions use the lean Slack reply profile. */
  isReplyContextThread(threadId: string): boolean {
    return this.store.replyContextForThread(threadId) !== null;
  }

  /**
   * The reply context of an auto-reply delivery: GoAhead wrote it with an `auto-reply` card, and the
   * context of that conversation belongs to the recipient. Null for any other delivery.
   */
  #replyContextFor(deliveryId: string): MessagingLink | null {
    const slackAsk = this.#mailbox.slackAskFor(deliveryId);
    if (slackAsk?.kind !== "auto-reply") return null;
    const connection = this.store.connectionForWorkspace("slack", slackAsk.workspaceId);
    const link = connection ? this.store.replyContext(connection.connectionId, slackAsk.channelId) : null;
    const recipient = this.#mailbox.getDelivery(deliveryId)?.delivery.recipientAgentId;
    return link && link.agentId === recipient ? link : null;
  }

  /** The person at this computer sent a message to the agent from the desktop app. */
  onLocalOwnerMessage(listener: (agentId: string) => void): () => void {
    this.#ownerMessageListeners.add(listener);
    return () => this.#ownerMessageListeners.delete(listener);
  }

  /** Only the trusted desktop path calls this, after the message is queued. */
  localOwnerMessage(agentId: string): void {
    for (const listener of this.#ownerMessageListeners) listener(agentId);
  }

  /** A linked thread was created or got new messages. The thread list reads again. */
  onThreadChanged(listener: (threadId: string) => void): () => void {
    this.#changeListeners.add(listener);
    return () => this.#changeListeners.delete(listener);
  }

  setContextSource(
    source: ((link: MessagingLink, origin: MessagingOrigin) => Promise<MessagingPromptContext>) | null,
  ): void {
    this.#contextSource = source;
  }

  /** The platform side takes the send requests of agents. Without it, no agent can send. */
  setMessageSender(sender: ((request: MessagingSendRequest) => Promise<MessagingSendReceipt>) | null): void {
    this.#sender = sender;
  }

  /** The platform side answers the inbox reads of agents. Without it, no agent can read the inbox. */
  setInboxReader(reader: ((request: MessagingInboxRequest) => Promise<MessagingInboxResult>) | null): void {
    this.#inboxReader = reader;
  }

  /**
   * The Slack user who connected each workspace as themself, from the messaging service. The service
   * sets it when it starts and clears it when it stops, as it does the inbox reader.
   */
  setOwnerSource(source: ((connectionId: string) => string | null) | null): void {
    this.#ownerSource = source;
  }

  readInbox(request: MessagingInboxRequest): Promise<MessagingInboxResult> {
    if (!this.#inboxReader) throw new Error(sourceText("error.messaging.inboxNeedsUser"));
    return this.#inboxReader(request);
  }

  /** An agent asks to send a new message. The platform side makes a draft that a person approves. */
  requestSend(request: MessagingSendRequest): Promise<MessagingSendReceipt> {
    if (!this.#sender) throw new Error(sourceText("error.messaging.sendUnavailable"));
    return this.#sender(request);
  }

  async receive(input: MessagingReceiveInput): Promise<MessagingReceiveResult> {
    if (this.#mailbox.deliveryForKey(input.idempotencyKey)) return { status: "duplicate" };
    const link = this.store.ensureLink({
      connectionId: input.connectionId,
      agentId: input.agentId,
      platformChannelId: input.platformChannelId,
      threadKey: input.threadKey,
      isDirect: input.isDirect,
      title: input.title.slice(0, MESSAGING_LIMITS.name),
    });
    // The link decides the agent: a conversation that already has one keeps it, even when another
    // message routed it elsewhere at the same time.
    const agentId = link.agentId;
    // One admission at a time for each agent: the enqueue awaits file copies, and the queue limits
    // must count the requests before it.
    const previous = this.#admissions.get(agentId) ?? Promise.resolve();
    const admission = previous.then(() => this.#admit(agentId, link, input));
    const settled = admission.catch(() => undefined);
    this.#admissions.set(agentId, settled);
    try {
      return await admission;
    } finally {
      if (this.#admissions.get(agentId) === settled) this.#admissions.delete(agentId);
    }
  }

  async #admit(agentId: string, link: MessagingLink, input: MessagingReceiveInput): Promise<MessagingReceiveResult> {
    // Only external messages count: a teammate's answer to a request from here is the agent's own work.
    const pending = this.store
      .links(agentId)
      .flatMap((candidate) => this.#mailbox.unresolvedMessagingDeliveries(candidate.linkId))
      .filter((context) => context.delivery.sender.kind === "user");
    const byAuthor = pending.filter(
      (context) => this.#mailbox.messagingOrigin(context.delivery.id)?.authorId === input.origin.authorId,
    );
    if (pending.length >= AGENT_QUEUE_LIMIT || byAuthor.length >= AUTHOR_QUEUE_LIMIT) return { status: "busy", link };
    const waiting = this.#hooks.busy(agentId);
    const receipt = await this.#mailbox.enqueue({
      sender: { kind: "user" },
      messaging: { ...input.origin, linkId: link.linkId },
      recipientAgentIds: [agentId],
      text: input.text || "(The message has no text.)",
      sourcePaths: input.sourcePaths,
      idempotencyKey: input.idempotencyKey,
    });
    const deliveryId = receipt.deliveries[0]?.id;
    if (!deliveryId) throw new Error(sourceText("error.agent.queuedMessageCreateFailed"));
    this.store.touch(link.linkId);
    this.#changed(link.threadId);
    this.#hooks.schedule(agentId);
    return { status: "queued", link, deliveryId, waiting };
  }

  /** The execution thread of a messaging or auto-reply delivery, or null for any other delivery. */
  threadForDelivery(deliveryId: string): string | null {
    const origin = this.#mailbox.messagingOrigin(deliveryId);
    if (origin) return this.store.link(origin.linkId)?.threadId ?? null;
    return this.#replyContextFor(deliveryId)?.threadId ?? null;
  }

  ownsDelivery(deliveryId: string): boolean {
    return this.#mailbox.messagingOrigin(deliveryId) !== null || this.#replyContextFor(deliveryId) !== null;
  }

  /** The orchestrator of each enabled workspace. Each one is a mail agent of the Google tools. */
  orchestratorAgentIds(): string[] {
    return [
      ...new Set(
        this.store
          .connections()
          .filter((connection) => connection.enabled)
          .map((connection) => connection.orchestratorAgentId)
          .filter((agentId): agentId is string => agentId !== null),
      ),
    ];
  }

  /**
   * The facts of a turn that runs in an external conversation, or null when `threadId` is no
   * conversation's thread. `isSlackOwnerDirectTurn` decides on them. A delivery that a teammate
   * sent, such as an answer that goes back to the conversation, has no origin here: it carries the
   * origin of the request, but the person did not write it.
   */
  slackTurnFacts(threadId: string, deliveryIds: readonly string[]): SlackTurnFacts | null {
    const link = this.store.linkForThread(threadId);
    if (!link) return null;
    return {
      isDirect: link.isDirect,
      ownerId: this.#ownerSource?.(link.connectionId) ?? null,
      origins: deliveryIds.map((deliveryId) => {
        const origin = this.#mailbox.messagingOrigin(deliveryId);
        const fromPerson = this.#mailbox.getDelivery(deliveryId)?.delivery.sender.kind === "user";
        return origin && fromPerson
          ? { authorId: origin.authorId, sameLink: origin.linkId === link.linkId, isReply: origin.isReply === true }
          : null;
      }),
    };
  }

  /**
   * The project map for a turn of a Slack orchestrator outside its Slack conversations, such as the
   * owner's message in the app, or null for any other agent. Read per turn, so it is never stale.
   */
  orchestratorProjectMap(agentId: string): string | null {
    if (!this.store.connections().some((connection) => connection.orchestratorAgentId === agentId)) return null;
    const projectMap = this.#hooks.projectMap();
    return projectMap ? projectMapInstruction(projectMap) : null;
  }

  async prepare(context: DeliveryContext): Promise<{ threadId: string; text: string } | null> {
    const origin = this.#mailbox.messagingOrigin(context.delivery.id);
    if (!origin) {
      // An auto-reply: GoAhead already wrote the whole prompt, with only the new messages.
      const replyContext = this.#replyContextFor(context.delivery.id);
      return replyContext ? { threadId: replyContext.threadId, text: context.delivery.text } : null;
    }
    const link = this.store.link(origin.linkId);
    if (!link) return null;
    // A teammate's answer to a request the agent sent from this conversation. The delivery framing
    // presents it as a teammate's reply, and the turn's answer is posted to the conversation.
    if (context.delivery.sender.kind === "agent") return { threadId: link.threadId, text: context.delivery.text };
    const connection = this.store.connection(link.connectionId);
    const prompt = await this.#promptContext(link, origin);
    if (prompt.cursor) this.store.touch(link.linkId, prompt.cursor);
    return {
      threadId: link.threadId,
      text: messagingPromptText({
        platform: connection?.platform ?? "slack",
        workspaceName: prompt.workspaceName ?? connection?.workspaceName ?? null,
        isDirect: link.isDirect,
        place: prompt.place,
        authorName: origin.authorName,
        authorId: origin.authorId,
        fromGoAheadUser: prompt.ownerId != null && prompt.ownerId === origin.authorId,
        isReply: origin.isReply === true,
        text: context.delivery.text,
        context: prompt.messages,
        skippedFiles: prompt.skippedFiles,
        // Only the workspace's orchestrator delegates, so only it gets the map. Read per turn.
        projectMap: connection?.orchestratorAgentId === link.agentId ? this.#hooks.projectMap() : null,
      }),
    };
  }

  /** The prompt context from the platform, or none when it is slow or fails: the message still runs. */
  async #promptContext(link: MessagingLink, origin: MessagingOrigin): Promise<MessagingPromptContext> {
    const fallback: MessagingPromptContext = {
      workspaceName: null,
      place: link.title,
      messages: [],
      cursor: null,
      skippedFiles: [],
    };
    const source = this.#contextSource;
    if (!source) return fallback;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        source(link, origin),
        new Promise<MessagingPromptContext>((resolve) => {
          timer = setTimeout(() => resolve(fallback), CONTEXT_TIMEOUT_MS);
        }),
      ]);
    } catch {
      return fallback;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Takes the conversation events of a messaging thread, so the agent's public chat and the Team
   * API never see them, and reports turn starts and ends. Approvals are not taken: the host still
   * shows them.
   */
  event(event: AgentEvent): boolean {
    switch (event.type) {
      case "conversation": {
        const threadId = event.snapshot.threadId;
        const owner = threadId === null ? null : this.store.executionLink(threadId);
        if (!owner || threadId === null) return false;
        if (owner.threadKey !== REPLY_CONTEXT_KEY) this.#changed(threadId);
        return true;
      }
      case "conversation-delta":
      case "turn-progress":
        // One lookup: these come for every streamed piece of every turn.
        return this.store.executionLink(event.threadId) !== null;
      case "turn-started": {
        const link = this.store.executionLink(event.threadId);
        if (!link) return false;
        if (link.threadKey === REPLY_CONTEXT_KEY) {
          this.#replyContextTurn(link, event);
          return true;
        }
        const running = this.#mailbox
          .unresolvedMessagingDeliveries(link.linkId)
          .find((context) => context.delivery.status !== "queued");
        const origin = running ? this.#mailbox.messagingOrigin(running.delivery.id) : null;
        const followUp = running?.delivery.sender.kind === "agent";
        this.#turnOrigins.set(event.turnId, { origin, followUp });
        this.#publish({ type: "started", link, turnId: event.turnId, origin, followUp });
        return true;
      }
      case "turn-completed": {
        const link = this.store.executionLink(event.threadId);
        if (!link) return false;
        if (link.threadKey === REPLY_CONTEXT_KEY) {
          this.#replyContextTurn(link, event);
          return true;
        }
        const started = this.#turnOrigins.get(event.turnId) ?? { origin: null, followUp: false };
        this.#turnOrigins.delete(event.turnId);
        this.store.touch(link.linkId);
        void this.#finished(link, event.turnId, event.status, started.origin, started.followUp);
        return true;
      }
      default:
        return false;
    }
  }

  /** Tells the listeners about a turn of a reply context. */
  #replyContextTurn(
    context: MessagingLink,
    event: Extract<AgentEvent, { type: "turn-started" | "turn-completed" }>,
  ): void {
    if (event.type === "turn-completed") this.store.touch(context.linkId);
    const turn: ReplyContextTurn = {
      type: event.type === "turn-started" ? "started" : "completed",
      agentId: context.agentId,
      threadId: context.threadId,
      turnId: event.turnId,
      status: event.type === "turn-completed" ? event.status : null,
    };
    for (const listener of this.#replyTurnListeners) listener(turn);
  }

  /** A messaging delivery that failed before its turn started ends like a failed turn. */
  deliveryFailed(deliveryId: string): void {
    const origin = this.#mailbox.messagingOrigin(deliveryId);
    const link = origin ? this.store.link(origin.linkId) : null;
    if (!origin || !link) return;
    const followUp = this.#mailbox.getDelivery(deliveryId)?.delivery.sender.kind === "agent";
    this.#publish({
      type: "finished",
      link,
      turnId: null,
      status: "failed",
      origin,
      followUp,
      answer: null,
      files: [],
    });
  }

  /**
   * The requester of the turn that runs now in this link, if one runs. `fromPerson` is true only when
   * every delivery of that turn is a person's message: a teammate's answer carries the requester's
   * origin, but its words are the teammate's.
   */
  runningOrigin(linkId: string): { turnId: string; origin: MessagingOrigin; fromPerson: boolean } | null {
    const running = this.#mailbox
      .unresolvedMessagingDeliveries(linkId)
      .find((context) => context.delivery.status === "running" && context.delivery.turnId);
    const origin = running ? this.#mailbox.messagingOrigin(running.delivery.id) : null;
    if (!running?.delivery.turnId || !origin) return null;
    const turnId = running.delivery.turnId;
    const deliveries = this.#mailbox.findDeliveriesByTurn(running.delivery.recipientAgentId, turnId);
    const fromPerson = deliveries.length > 0 && deliveries.every(({ delivery }) => delivery.sender.kind === "user");
    return { turnId, origin, fromPerson };
  }

  /** Stops what one author asked for in this link: the running turn and queued messages. */
  async stop(linkId: string, authorId: string): Promise<boolean> {
    const link = this.store.link(linkId);
    if (!link) return false;
    let stopped = false;
    for (const context of this.#mailbox.unresolvedMessagingDeliveries(linkId)) {
      const origin = this.#mailbox.messagingOrigin(context.delivery.id);
      if (!origin || origin.authorId !== authorId) continue;
      if (context.delivery.status === "queued") {
        await this.#mailbox.cancel(link.agentId, context.delivery.id);
        this.#publish({ type: "cancelled", link, origin });
        stopped = true;
      } else if (context.delivery.status === "running" && context.delivery.turnId) {
        await this.#hooks.interrupt(link.agentId, context.delivery.turnId, link.threadId);
        stopped = true;
      }
    }
    if (stopped) this.#hooks.schedule(link.agentId);
    return stopped;
  }

  /** True while a teammate works on a request that the agent sent from this conversation. */
  awaitsTeammate(linkId: string): boolean {
    return this.#mailbox.pendingMessagingReturns(linkId) > 0;
  }

  /** Removes the agent's links and execution threads, and takes it out of every connection. The mailbox leaves separately. */
  async deleteForAgent(agentId: string): Promise<void> {
    for (const threadId of this.store.threadIdsForAgent(agentId)) await this.#hooks.forgetThread(threadId);
    this.store.deleteForAgent(agentId);
  }

  async #finished(
    link: MessagingLink,
    turnId: string,
    status: string,
    origin: MessagingOrigin | null,
    followUp: boolean,
  ): Promise<void> {
    const messages = this.#turnMessages(link, turnId);
    const answer = [...messages].reverse().find(isAnswer)?.text ?? null;
    const files: MessagingAnswerFile[] = [];
    for (const message of messages) {
      if (message.author === "user") continue;
      for (const attachment of message.attachments ?? []) {
        const resolved = await this.#mailbox.resolveAttachment(attachment.id);
        if (resolved) files.push(resolved);
      }
    }
    this.#publish({
      type: "finished",
      link,
      turnId,
      status: status === "completed" ? "completed" : status === "interrupted" ? "interrupted" : "failed",
      origin,
      followUp,
      answer,
      files,
    });
  }

  #turnMessages(link: MessagingLink, turnId: string): ConversationMessage[] {
    return this.#database
      .readConversation(link.agentId, link.threadId)
      .messages.filter((message) => message.turnId === turnId);
  }

  #publish(activity: MessagingActivity): void {
    for (const listener of this.#listeners) listener(activity);
  }

  /** Tells the thread list that a conversation changed outside its messages, such as a new draft. */
  notifyChanged(threadId: string): void {
    this.#changed(threadId);
  }

  #changed(threadId: string): void {
    for (const listener of this.#changeListeners) listener(threadId);
  }
}

/** The same test the turn lifecycle uses for the answer of a turn. */
function isAnswer(message: ConversationMessage): boolean {
  return (
    message.author === "assistant" &&
    message.itemType !== "commentary" &&
    message.itemType !== "question_prompt" &&
    message.itemType !== CONVERSATION_PLAN_ITEM_TYPE &&
    Boolean(message.text.trim())
  );
}
