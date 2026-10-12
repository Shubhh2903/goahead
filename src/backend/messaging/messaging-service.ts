import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { ATTACHMENT_LIMITS, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AddSlackOrchestratorInput,
  AddSlackOrchestratorResult,
  AgentApproval,
  AgentEvent,
  AgentHandoff,
  AgentSummary,
  AskOrchestratorAboutInboxInput,
  AskOrchestratorAboutInboxResult,
  MessagingConnection,
  MessagingConnectionState,
  MessagingCredentialState,
  MessagingDraft,
  MessagingInboxFile,
  MessagingInboxPage,
  MessagingInboxWorkspace,
  MessagingPlatform,
  MessagingThreadSummary,
  RespondToApprovalInput,
  SendInboxReplyInput,
  SlackChannelChoice,
  SlackChannelList,
  SlackClientAutoReplyInput,
  SlackClientChanged,
  SlackClientConversation,
  SlackClientDeleteInput,
  SlackClientEditInput,
  SlackClientListInput,
  SlackClientMentionCandidate,
  SlackClientMentionInput,
  SlackClientMessage,
  SlackClientOlderInput,
  SlackClientOpenInput,
  SlackClientPage,
  SlackClientReactInput,
  SlackClientSendInput,
  SlackClientThread,
  SlackClientThreadInput,
  SlackClientUploadResult,
  SlackOverview,
  SlackRoutingStatus,
} from "@openbot/contracts/ipc";
import {
  type ConversationSlackAsk,
  MESSAGING_CONNECTION_STATES,
  MESSAGING_LIMITS,
  SLACK_ASK_PLACE_LIMIT,
  SLACK_ASK_TEXT_LIMIT,
  SLACK_ASK_TRIGGER_LIMIT,
  type SlackAskKind,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { SLACK_ORCHESTRATOR_AVATAR } from "@openbot/contracts/slack-app";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import type { HandoffRecord } from "../agent/handoff-activity";
import type { MessagingOrigin } from "../mailbox-store";
import type { SidebarLayoutStore } from "../sidebar-layout-store";
import { MessagingAutoReplyLoop } from "./messaging-auto-reply-loop";
import type { SendDraft } from "./messaging-draft-store";
import { MessagingHiddenThreadStore } from "./messaging-hidden-threads";
import { type InboxImage, isInboxImage, MessagingInboxFiles } from "./messaging-inbox-files";
import type { InboxKind } from "./messaging-inbox-store";
import { projectMapInstruction } from "./messaging-prompt";
import { SLACK_INBOX_UNTRUSTED_NOTE } from "./messaging-read-tools";
import { inQuietHours, MessagingSendGuardStore, type QuietHours, SEND_COUNT_WINDOW_MS } from "./messaging-send-guards";
import { parseSlackSendTarget, type SlackSendTarget, slackTargetPeople } from "./messaging-send-tool";
import type { MessagingConnectionRecord, MessagingLink } from "./messaging-store";
import type {
  MessagingActivity,
  MessagingInboxRequest,
  MessagingInboxResult,
  MessagingSendReceipt,
  MessagingSendRequest,
  MessagingThreads,
} from "./messaging-threads";
import {
  type ConnectionIdentity,
  DIRECT_CONVERSATION_KEY,
  type HistoryEvent,
  type InboundAction,
  type InboundMessage,
  type InboxCandidate,
  type InboxFile,
  type IngressAnswer,
  type IngressDelivery,
  type MessageSender,
  type MessageTarget,
  type MessagingAdapter,
  MessagingConnectionError,
  type MessagingDriver,
  type MessagingIngress,
  type MessagingTransport,
} from "./messaging-types";
import { type SlackAppPort, SlackConnect } from "./slack/slack-connect";
import {
  slackOrchestratorMemories,
  slackOrchestratorProfile,
  upgradeSlackOrchestratorDescription,
} from "./slack/slack-orchestrator";
import { SlackWebApi } from "./slack/slack-web-api";
import { SlackClientActions, type SlackClientUploadAction } from "./slack-client/actions";
import { applySlackClientEvent } from "./slack-client/events";
import { SlackRequestQueue } from "./slack-client/request-queue";
import { SlackClientSync } from "./slack-client/sync-service";

const logger = createOpenBotLogger("messaging");

/** The tokens of each connection, kept by the main process in encrypted storage, by connection id. */
export interface MessagingCredentials {
  keys(): string[];
  status(connectionId: string): MessagingCredentialState;
  get(connectionId: string): Record<string, string> | null;
  set(connectionId: string, values: Record<string, string>): Promise<void>;
  /** `discardUnreadable` also drops a file that cannot be decrypted; see `MessagingCredentialStore.clear`. */
  clear(connectionId: string, options?: { discardUnreadable?: boolean }): Promise<void>;
  /** Removes the tokens of every key that is not listed. */
  retain(connectionIds: ReadonlySet<string>): Promise<void>;
}

export interface MessagingAgents {
  listAgents(): AgentSummary[];
  respondToApproval(input: RespondToApprovalInput): Promise<void>;
  onEvent(listener: (event: AgentEvent) => void): () => void;
  /** Creates an agent with no first message, on the named model or a new agent's default. */
  createAgentProfile(
    input: Pick<AddSlackOrchestratorInput, "provider" | "model" | "reasoningEffort"> & {
      name: string;
      title: string;
      description: string;
      avatarSeed: string;
      avatarHue: AgentSummary["avatarHue"];
    },
  ): Promise<AgentSummary>;
  createMemory(input: { agentId: string; text: string }): unknown;
  /**
   * Changes only the agent's description. The agent keeps its id, thread and workspace. Without it,
   * an orchestrator keeps the rules of the build that added it.
   */
  updateAgentDescription?(agentId: string, description: string): Promise<unknown>;
  /**
   * A message from the local person to the agent's own conversation, as the desktop sends one. The
   * agent gets `text`; the chat shows `slackAsk`, when there is one, as a card.
   */
  sendMessage(input: { agentId: string; text: string; slackAsk?: ConversationSlackAsk }): Promise<unknown>;
  /** Every local agent's project folders as one prompt line, or null when no agent has one. */
  projectMap?(): string | null;
  /** The newest hand-offs an agent sent, each with the conversation its answer goes back to. */
  handoffRecords?(agentId: string): HandoffRecord[];
  /** Calls `listener` with the sender whose hand-offs changed. */
  onHandoffs?(listener: (agentId: string) => void): () => void;
}

/** What the account service says about a workspace's default computer, before names are added. */
export interface SlackDefaultStatus {
  isDefault: boolean;
  people: Array<{ slackUserId: string }>;
}

/**
 * The account service half of a workspace with several people: which computer answers the people
 * who do not use GoAhead, and the person routes of this host.
 */
export interface SlackRoutingPort {
  /**
   * Unlinks only this person from the workspace. The default moves on when they had it.
   * `workspaceRemains` is true when another host still answers the workspace, or when it is unknown.
   */
  unlinkPerson(workspaceId: string, slackUserId: string): Promise<{ workspaceRemains: boolean }>;
  status(workspaceId: string): Promise<SlackDefaultStatus>;
  /** The default's owner gives the default to another connected person. Answers the status after. */
  handOver(workspaceId: string, slackUserId: string): Promise<SlackDefaultStatus>;
}

export interface MessagingServiceOptions {
  threads: MessagingThreads;
  agents: MessagingAgents;
  credentials: MessagingCredentials;
  drivers: readonly MessagingDriver[];
  /** A private folder for files that arrive, until the mailbox has copied them. */
  downloadsRoot: string;
  /**
   * A private folder for what the inbox knows about files that Slack messages shared, and their
   * cached image bytes. Without it the inbox shows no files.
   */
  inboxFilesRoot?: string;
  /** The Signal relay of the OpenBot Slack app. Without it and `slackApp`, no workspace can connect. */
  ingress?: MessagingIngress;
  slackApp?: SlackAppPort;
  /** Only tests change this. */
  slackOrigin?: string;
  /** Where the Slack Orchestrator goes in the sidebar: an Integrations section. */
  sidebar?: Pick<SidebarLayoutStore, "getSnapshot" | "mutate">;
  /** The person's send guards: pause and quiet hours. Without it, they live in memory only. */
  sendGuards?: MessagingSendGuardStore;
  /** The conversations the person hid from the sidebar. Without it, they live in memory only. */
  hiddenThreads?: MessagingHiddenThreadStore;
  /** Without it, a disconnect unlinks the whole host, and the routing status is not available. */
  slackRouting?: SlackRoutingPort;
  /** The shortest time between two edits of one hand-off status message. Only tests change this. */
  handoffStatusIntervalMs?: number;
  /** The timers of the auto-reply wait. Only tests change this. */
  autoReplyTimers?: AutoReplyTimers;
}

/** Starts a timer and returns what cancels it. */
export interface AutoReplyTimers {
  start(callback: () => void, delayMs: number): () => void;
}

const REAL_TIMERS: AutoReplyTimers = {
  start(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    timer.unref?.();
    return () => clearTimeout(timer);
  },
};

/**
 * New messages from other people in one auto-reply conversation, until the orchestrator gets one
 * turn for them. At most one turn runs; messages during it wait for one more.
 */
interface AutoReplyWait {
  connectionId: string;
  channelId: string;
  /** The threads the new messages are in; null is the top of the conversation. */
  threadKeys: Set<string | null>;
  /** The people who wrote since the last turn started. */
  authorIds: Set<string>;
  /** The messages that came since the last turn started, which its card shows. */
  messageIds: Set<string>;
  /** When the first message of this wait arrived: the wait never lasts longer than the cap. */
  firstAt: number | null;
  cancelWait: (() => void) | null;
  running: { agentId: string; turnId: string | null; cancelLimit: () => void } | null;
  /** A message arrived while the turn ran: one more turn follows it. */
  again: boolean;
}

interface LiveConnection {
  record: MessagingConnectionRecord;
  adapter: MessagingAdapter;
  transport: MessagingTransport | null;
  identity: ConnectionIdentity | null;
  state: MessagingConnectionState;
  retryAt: string | null;
}

/** The status post of one external message, which the answer replaces. */
interface StatusPost {
  connectionId: string;
  target: MessageTarget;
  messageId: string | null;
  stopToken: string | null;
}

/**
 * The one status message of a conversation while teammates work on requests from it. Each change
 * edits it, at most once per interval.
 */
interface HandoffStatusPost {
  connectionId: string;
  target: MessageTarget;
  messageId: string | null;
  /** The hand-offs it shows, by delivery id: only the ones seen before they ended. */
  shown: Set<string>;
  text: string;
  sentText: string | null;
  lastSentAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  sending: boolean;
  /** Every hand-off it shows has ended. After the last edit, the post is forgotten. */
  finished: boolean;
}

/** A post with Approve and Deny buttons, and who may press them. */
interface PendingBase {
  connectionId: string;
  target: MessageTarget;
  /** Null until Slack answers the post. A button press can arrive first, and it names its message. */
  messageId: string | null;
  /** The only Slack user who may press. Null when it is not known, then only the host answers. */
  allowedUserId: string | null;
  text: string;
  answered: boolean;
}

/** An agent's approval request, answered through the agent service. The requester may press. */
interface PendingAgentApproval extends PendingBase {
  kind: "agent";
  requestId: string | number;
}

/**
 * A message an agent drafted, sent by this service once approved. Only the person who connected the
 * workspace may press: the message goes out as them, or as OpenBot, and never on a stranger's word.
 */
interface PendingSend extends PendingBase {
  kind: "send";
  allowedUserId: string;
  draft: SendDraft;
}

type PendingApproval = PendingAgentApproval | PendingSend;

/** A draft as it is sent. An auto-reply from the orchestrator's app conversation has no Slack conversation. */
type DeliveryDraft = Omit<SendDraft, "linkId"> & { linkId: string | null };

const FATAL_STATES = new Set<MessagingConnectionState>(["invalid_token"]);
const LIVE_STATES = new Set<MessagingConnectionState>(["connecting", "connected", "reconnecting", "rate_limited"]);
const APPROVAL_TEXT_LIMIT = 2_500;
/** At most one edit of a hand-off status message in this time. Slack limits edits per channel. */
const HANDOFF_STATUS_INTERVAL_MS = 2_000;
/** The most characters of a task that a status line shows. */
const HANDOFF_TASK_CHARACTERS = 120;
/** How long a reply to a message OpenBot sent as the user still comes back to the conversation. */
const REPLY_WATCH_MS = 14 * 24 * 60 * 60_000;
const SENT_PREVIEW = 300;
/** How much of the newest message the desktop inbox list shows. */
const PREVIEW_CHARACTERS = 200;
/** How long every direct message after a send by the app counts as an answer to it. */
const APP_SEND_REPLY_MS = 24 * 60 * 60_000;
const CANCEL_TEXT = /^(cancel|stop)$/i;
/** The prefix of an inbox text that asks the Slack Orchestrator instead of sending to Slack. */
const CHIEF_PREFIX = /^@chief(?:\s|$)/i;
/** How many of the conversation's newest inbox messages an `@chief` instruction carries. */
const CHIEF_CONTEXT_MESSAGES = 20;
const RECENT_MESSAGES = 2_000;
/** How long a connection waits before it tries Slack again after Slack was unreachable. */
const IDENTIFY_RETRY_MS = 30_000;
/** How long the local inbox keeps a message, and how often it deletes older ones. */
const INBOX_RETENTION_MS = 30 * 24 * 60 * 60_000;
const INBOX_PURGE_INTERVAL_MS = 6 * 60 * 60_000;
/** A newly picked channel starts with its newest messages, read in the workspace's request queue. */
const HISTORY_FILL_MESSAGES = 15;
/** History-type calls of one workspace, as the Slack client's request queue allows them. */
const SLACK_HISTORY_CALLS_PER_MINUTE = 40;
/** The most people, channels and emoji one inbox page looks up. */
const INBOX_LOOKUPS = 50;
/** The marker `mention` uses. Text that did not come from the host has it taken out. */
const MENTION_MARKERS = /[\uE000-\uE001]/g;
/** The most people one `@` search of the Slack client offers. */
const MENTION_CANDIDATES = 20;
/** An `@` that starts a name in message text: at the start, or after a space or an opening bracket. */
const TEXT_MENTION = /(?:^|[\s(])@(?=[^\s@<>])/u;
/** How long an auto-reply conversation waits after a new message, so several quick messages get one turn. */
const AUTO_REPLY_WAIT_MS = 10_000;
/** The longest wait from the first message, however many follow. */
const AUTO_REPLY_WAIT_CAP_MS = 60_000;
/** After this, an auto-reply turn whose end GoAhead did not see no longer holds the conversation. */
const AUTO_REPLY_TURN_LIMIT_MS = 15 * 60_000;

/**
 * Owns the live connections to chat platform workspaces: it starts and stops each one's transport,
 * picks the agent of each new conversation with the router agent, turns inbound messages into agent
 * work through `MessagingThreads`, posts status and answers back as OpenBot, and relays approvals
 * and stop requests. It never stores a token: `MessagingCredentials` does. It is platform-agnostic;
 * everything a platform does goes through its `MessagingDriver`.
 */
export class MessagingService {
  readonly #threads: MessagingThreads;
  readonly #agents: MessagingAgents;
  readonly #credentials: MessagingCredentials;
  readonly #drivers: ReadonlyMap<MessagingPlatform, MessagingDriver>;
  readonly #downloadsRoot: string;
  readonly #live = new Map<string, LiveConnection>();
  /** Status posts by `linkId:platformMessageId`, until the turn that answers the message ends. */
  readonly #posts = new Map<string, StatusPost>();
  /** The reply target of each external message, by `linkId:platformMessageId`. */
  readonly #targets = new Map<string, MessageTarget>();
  /** The hand-off status message of each conversation, by link id. */
  readonly #handoffPosts = new Map<string, HandoffStatusPost>();
  readonly #handoffIntervalMs: number;
  readonly #approvals = new Map<string, PendingApproval>();
  readonly #stops = new Map<string, { linkId: string; authorId: string; connectionId: string }>();
  readonly #chains = new Map<string, Promise<void>>();
  readonly #recent = new Set<string>();
  /** Who hears that a workspace's inbox got a new message. */
  readonly #inboxListeners = new Set<(workspaceId: string) => void>();
  /** The request queue of each connection's history-type Slack calls. */
  readonly #slackQueues = new Map<string, SlackRequestQueue>();
  /** The Slack client's loads from Slack into the cache, for every connection. */
  readonly #slackSync: SlackClientSync;
  /** The person's own actions in the Slack client, by connection. */
  readonly #slackActions = new Map<string, SlackClientActions>();
  /** How many times each connection was disconnected: an action that outlives one clears what it cached. */
  readonly #slackDisconnects = new Map<string, number>();
  /** Who hears that a workspace's Slack client cache changed. */
  readonly #slackClientListeners = new Set<(change: SlackClientChanged) => void>();
  readonly #unsubscribe: Array<() => void> = [];
  readonly #ingress: MessagingIngress | null;
  readonly #connect: SlackConnect | null;
  readonly #slackOrigin: string | undefined;
  readonly #sidebar: Pick<SidebarLayoutStore, "getSnapshot" | "mutate"> | null;
  readonly #guards: MessagingSendGuardStore;
  readonly #hidden: MessagingHiddenThreadStore;
  readonly #routing: SlackRoutingPort | null;
  readonly #inboxFiles: MessagingInboxFiles | null;
  readonly #autoReplyTimers: AutoReplyTimers;
  /** The auto-reply waits and turns, by `connectionId\nchannelId`. */
  readonly #autoReplyWaits = new Map<string, AutoReplyWait>();
  /** Fast auto-reply exchanges, by the same key. A loop pauses auto-reply in its conversation. */
  readonly #autoReplyLoop = new MessagingAutoReplyLoop();
  #started = false;

  constructor(options: MessagingServiceOptions) {
    this.#threads = options.threads;
    this.#agents = options.agents;
    this.#credentials = options.credentials;
    this.#drivers = new Map(options.drivers.map((driver) => [driver.platform, driver]));
    this.#downloadsRoot = options.downloadsRoot;
    this.#ingress = options.ingress ?? null;
    this.#connect = options.ingress && options.slackApp ? new SlackConnect(options.slackApp) : null;
    this.#slackOrigin = options.slackOrigin;
    this.#sidebar = options.sidebar ?? null;
    this.#guards = options.sendGuards ?? new MessagingSendGuardStore(null);
    this.#hidden = options.hiddenThreads ?? new MessagingHiddenThreadStore(null);
    this.#routing = options.slackRouting ?? null;
    this.#inboxFiles = options.inboxFilesRoot ? new MessagingInboxFiles(options.inboxFilesRoot) : null;
    this.#handoffIntervalMs = options.handoffStatusIntervalMs ?? HANDOFF_STATUS_INTERVAL_MS;
    this.#autoReplyTimers = options.autoReplyTimers ?? REAL_TIMERS;
    this.#slackSync = new SlackClientSync({
      store: this.#threads.inbox.cache,
      queueFor: (connectionId) => this.#slackQueue(connectionId),
      adapterFor: (connectionId) => this.#slackClientLive(connectionId)?.adapter ?? null,
      names: {
        workspaceId: (connectionId) => this.#threads.store.connection(connectionId)?.workspaceId ?? null,
        ownerUserId: (connectionId) => this.#slackOwner(connectionId),
      },
      onChanged: (change) => this.#slackClientChanged(change),
      warn: (error) => this.#warn(error),
    });
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    await this.#guards.load();
    await this.#hidden.load();
    this.#loadDrafts();
    this.#unsubscribe.push(
      this.#threads.onActivity((activity) => this.#serial(activity.link.linkId, () => this.#activity(activity))),
      this.#agents.onEvent((event) => this.#agentEvent(event)),
      this.#threads.onLocalOwnerMessage((agentId) => this.#localOwnerMessage(agentId)),
      this.#agents.onHandoffs?.((agentId) => this.#handoffsChanged(agentId)) ?? (() => undefined),
    );
    this.#threads.setContextSource((link, origin) => this.#promptContext(link, origin));
    this.#threads.setMessageSender((request) => this.#requestSend(request));
    this.#threads.setInboxReader((request) => this.#readInbox(request));
    this.#ingress?.handle((workspaceId, delivery) => this.deliverSlack(workspaceId, delivery));
    this.#purgeInbox();
    const purge = setInterval(() => this.#purgeInbox(), INBOX_PURGE_INTERVAL_MS);
    purge.unref?.();
    this.#unsubscribe.push(() => clearInterval(purge));
    const records = this.#threads.store.connections();
    await this.#upgradeOrchestrators(records);
    await this.#credentials.retain(new Set(records.map((record) => record.connectionId)));
    await Promise.all(records.filter((record) => record.enabled).map((record) => this.#startConnection(record)));
  }

  async stop(): Promise<void> {
    this.#started = false;
    for (const unsubscribe of this.#unsubscribe.splice(0)) unsubscribe();
    for (const post of this.#handoffPosts.values()) if (post.timer) clearTimeout(post.timer);
    this.#handoffPosts.clear();
    this.#clearAutoReplyWaits(() => true);
    this.#threads.setContextSource(null);
    this.#threads.setMessageSender(null);
    this.#threads.setInboxReader(null);
    this.#ingress?.handle(null);
    for (const connectionId of this.#live.keys()) this.#slackSync.stop(connectionId);
    await Promise.all([...this.#live.values()].map((live) => live.transport?.stop()));
    this.#live.clear();
  }

  /** After the computer wakes, every socket may be dead without knowing it. */
  resume(): void {
    this.#ingress?.reconnect();
    for (const live of this.#live.values()) live.transport?.reconnect();
  }

  hasLiveConnection(): boolean {
    return [...this.#live.values()].some((live) => LIVE_STATES.has(live.state));
  }

  /**
   * The external conversations, newest first, without the ones the person hid. The caller adds each
   * one's read state.
   */
  threadSummaries(): Array<Omit<MessagingThreadSummary, "unreadCount">> {
    const links = this.#threads.store
      .recentLinks()
      .filter((link) => !this.#hidden.isHidden(link.threadId, link.updatedAt));
    return links.map((link) => ({
      threadId: link.threadId,
      agentId: link.agentId,
      workspaceId: link.workspaceId,
      platform: link.platform,
      title: link.title,
      preview: link.preview,
      isDirect: link.isDirect,
      updatedAt: link.updatedAt,
      pendingDrafts: this.#pendingSends().filter((pending) => pending.draft.linkId === link.linkId).length,
    }));
  }

  /** The drafts that wait for the person, oldest first, for the desktop. */
  listDrafts(): MessagingDraft[] {
    return this.#pendingSends().flatMap((pending) => {
      const record = this.#threads.store.connection(pending.connectionId);
      const link = this.#threads.store.link(pending.draft.linkId);
      if (!record || !link) return [];
      const { draft } = pending;
      return [
        {
          draftId: draft.draftId,
          workspaceId: record.workspaceId,
          threadId: link.threadId,
          agentId: draft.agentId,
          recipient: draft.recipient,
          sender: draft.sender,
          requestedBy: draft.requestedBy,
          text: draft.text,
          createdAt: draft.createdAt,
        },
      ];
    });
  }

  /**
   * The person answers a draft on the desktop: the same answer as their Slack button. Approved, it
   * is sent once, with their edited text when they changed it. The draft post in Slack shows the
   * result. A draft that was answered already is refused.
   */
  async answerDraft(draftId: string, decision: "approve" | "deny", editedText?: string): Promise<void> {
    const pending = this.#pendingSends().find((candidate) => candidate.draft.draftId === draftId);
    if (!pending) throw new Error(sourceText("status.messaging.requestInactive"));
    const live = this.#live.get(pending.connectionId);
    const approverId = this.#credentials.get(pending.connectionId)?.userId;
    if (!live || !approverId) throw new Error(sourceText("error.messaging.notConnected"));
    const blocked = decision === "approve" ? this.#sendBlock(live.record) : null;
    if (blocked) throw new Error(blocked);
    if (decision === "approve" && editedText !== undefined) {
      const text = editedText.replace(MENTION_MARKERS, "").trim().slice(0, INPUT_LIMITS.messageText);
      if (!text) throw new Error(sourceText("error.messaging.sendTextEmpty"));
      pending.draft.text = text;
    }
    await this.#finishApproval(live, pending, decision === "approve" ? "accept" : "decline", approverId, null);
  }

  /**
   * Puts the drafts that waited through a restart back under their Slack button tokens, so the
   * desktop lists them and a press or an approval still finds them. A draft already here is kept.
   */
  #loadDrafts(): void {
    for (const stored of this.#threads.drafts.all()) {
      if (this.#approvals.has(stored.acceptToken)) continue;
      const pending: PendingSend = {
        kind: "send",
        connectionId: stored.connectionId,
        target: stored.target,
        messageId: stored.messageId,
        allowedUserId: stored.allowedUserId,
        text: stored.postText,
        answered: false,
        draft: stored.draft,
      };
      this.#approvals.set(stored.acceptToken, pending);
      this.#approvals.set(stored.declineToken, pending);
    }
  }

  #pendingSends(): PendingSend[] {
    const unique = new Set<PendingSend>();
    for (const pending of this.#approvals.values())
      if (pending.kind === "send" && !pending.answered) unique.add(pending);
    return [...unique].sort((left, right) => left.draft.createdAt.localeCompare(right.draft.createdAt));
  }

  /** The agent that answers one external conversation. Any other thread id is refused. */
  /**
   * Hides the conversations from the sidebar. Nothing is deleted, and a conversation shows again
   * when a newer message arrives. An id that is not an external conversation is skipped.
   */
  async hideThreads(threadIds: readonly string[]): Promise<void> {
    const known = threadIds.filter((threadId) => this.#threads.store.linkForThread(threadId) !== null);
    if (known.length === 0) return;
    const saved = this.#hidden.hide(known);
    for (const threadId of known) this.#threads.notifyChanged(threadId);
    await saved;
  }

  threadAgent(threadId: string): string {
    const link = this.#threads.store.linkForThread(threadId);
    if (!link) throw new Error(sourceText("error.messaging.threadUnavailable"));
    return link.agentId;
  }

  onThreadChanged(listener: (threadId: string) => void): () => void {
    return this.#threads.onThreadChanged(listener);
  }

  /** The Slack workspaces of this computer, for Server settings > Connectors. A disconnected one is left out. */
  slackOverview(): SlackOverview {
    return {
      connections: this.#threads.store
        .connections()
        .filter((record) => record.platform === "slack" && this.#credentials.status(record.connectionId) !== "missing")
        .map((record) => this.#summary(record)),
    };
  }

  /** The channels the connected person is in, for the inbox picker. Read from Slack as the person. */
  async listSlackChannels(workspaceId: string): Promise<SlackChannelList> {
    const live = this.#personConnection(workspaceId);
    if (!live.adapter.listPersonPlaces) throw new Error(sourceText("error.messaging.unsupported"));
    const places = await live.adapter.listPersonPlaces();
    return {
      channels: places
        .sort((left, right) => left.name.localeCompare(right.name))
        .slice(0, MESSAGING_LIMITS.channelOptions)
        .map((place) => ({ channelId: place.id, name: place.name, isPrivate: place.isPrivate })),
    };
  }

  /**
   * Replaces the channels the inbox keeps. A channel no longer picked loses its kept messages; a new
   * one starts with its newest messages, read in the background.
   */
  setSlackWatchedChannels(workspaceId: string, channels: SlackChannelChoice[]): void {
    const live = this.#personConnection(workspaceId);
    const connectionId = live.record.connectionId;
    const added = this.#threads.inbox.setWatched(
      connectionId,
      channels.map((channel) => ({
        platformChannelId: channel.channelId,
        name: `#${channel.name.replace(/^#/u, "")}`,
      })),
    );
    for (const channel of added) this.#fillHistory(live, channel.platformChannelId);
    // A channel no longer picked lost its kept messages.
    this.#inboxChanged(workspaceId);
  }

  /**
   * Changes the person's send guards. The change holds at once, so a pause stops the next send before
   * the setting reaches the disk.
   */
  async setSendGuards(
    workspaceId: string,
    change: { paused?: boolean; quietHours?: QuietHours | null },
  ): Promise<void> {
    const record = this.#requireConnection(workspaceId);
    await this.#guards
      .set(record.workspaceId, {
        ...(change.paused === undefined ? {} : { paused: change.paused }),
        ...(change.quietHours === undefined ? {} : { quietHours: change.quietHours }),
      })
      .catch((error) => this.#warn(error));
  }

  async reconnect(workspaceId: string): Promise<void> {
    const record = this.#requireConnection(workspaceId);
    await this.#stopConnection(record.connectionId);
    this.#threads.store.updateConnection(record.connectionId, { enabled: true, lastErrorCode: null });
    const updated = this.#threads.store.connection(record.connectionId);
    if (updated) await this.#startConnection(updated);
    this.#ingress?.reconnect();
  }

  async setEnabled(workspaceId: string, enabled: boolean): Promise<void> {
    const record = this.#requireConnection(workspaceId);
    await this.#stopConnection(record.connectionId);
    this.#threads.store.updateConnection(record.connectionId, { enabled, lastErrorCode: null });
    const updated = this.#threads.store.connection(record.connectionId);
    if (enabled && updated) await this.#startConnection(updated);
  }

  /**
   * Adds the workspace's Slack Orchestrator: a new agent with its standing remit and the facts it
   * starts with, on the model the user picked. It receives every new conversation of the workspace.
   * A workspace that already has one keeps it.
   */
  async addOrchestrator(input: AddSlackOrchestratorInput): Promise<AddSlackOrchestratorResult> {
    const record = this.#requireConnection(input.workspaceId);
    const current = this.#agents.listAgents().find((agent) => agent.id === record.orchestratorAgentId);
    if (current) return { agentId: current.id, sectionId: null };
    const agent = await this.#agents.createAgentProfile({
      ...slackOrchestratorProfile(),
      ...SLACK_ORCHESTRATOR_AVATAR,
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.model ? { model: input.model } : {}),
      // The orchestrator answers in chat: medium effort keeps it quick. The user can change it.
      reasoningEffort: input.reasoningEffort ?? "medium",
    });
    for (const text of slackOrchestratorMemories(record.workspaceName))
      this.#agents.createMemory({ agentId: agent.id, text });
    this.#threads.store.updateConnection(record.connectionId, { orchestratorAgentId: agent.id });
    // The live connection keeps its own copy of the record: without this, it knows no orchestrator
    // until the next restart, and the new orchestrator cannot send or read the inbox.
    const live = this.#live.get(record.connectionId);
    if (live) live.record = this.#threads.store.connection(record.connectionId) ?? live.record;
    // The Slack inbox row sits under the orchestrator: the desktop reads the inbox list again.
    this.#inboxChanged(record.workspaceId);
    // A sidebar it cannot reach leaves the agent where new agents go; the orchestrator still answers.
    const sectionId = await this.#placeInIntegrations(agent.id).catch((error) => {
      this.#warn(error);
      return null;
    });
    return { agentId: agent.id, sectionId };
  }

  /**
   * Gives each orchestrator that an earlier build added the current built-in rules. Text the person
   * wrote around the rules stays, and rules the person changed stay as they are. One agent that
   * cannot be changed does not stop the others or the start.
   */
  async #upgradeOrchestrators(records: readonly MessagingConnectionRecord[]): Promise<void> {
    if (!this.#agents.updateAgentDescription) return;
    const ids = new Set(records.map((record) => record.orchestratorAgentId).filter((id) => id !== null));
    for (const agent of this.#agents.listAgents()) {
      if (!ids.has(agent.id)) continue;
      const upgrade = upgradeSlackOrchestratorDescription(agent.description);
      if (upgrade.status === "edited")
        logger.info("The Slack Orchestrator keeps its changed rules.", { agentId: agent.id });
      if (upgrade.status !== "upgraded") continue;
      await this.#agents
        .updateAgentDescription?.(agent.id, upgrade.description)
        .catch((error: unknown) => this.#warn(error));
    }
  }

  /**
   * Puts the orchestrator in the sidebar's Integrations section, which it creates the first time, so
   * the agents that serve an integration stay apart from the user's own. Returns the section id.
   */
  async #placeInIntegrations(agentId: string): Promise<string | null> {
    const sidebar = this.#sidebar;
    if (!sidebar) return null;
    const name = sourceText("status.messaging.integrationsSection");
    const agentIds = new Set(this.#agents.listAgents().map((agent) => agent.id));
    const existing = sidebar.getSnapshot().sections.find((section) => section.name === name);
    const layout = await sidebar.mutate(
      existing ? { type: "assign", agentId, sectionId: existing.id } : { type: "create", name, agentId },
      agentIds,
    );
    return layout.agentAssignments[agentId] ?? null;
  }

  /** Opens the OpenBot Slack app's install in the browser. A deep link to `completeSlackWorkspace` ends it. */
  async connectSlackWorkspace(): Promise<void> {
    await this.#requireConnect().start();
  }

  /**
   * Saves the tokens of a workspace that installed the OpenBot app, the bot's and the installer's
   * when the install gave one, and starts its connection. A workspace connected before keeps its
   * conversations. False for a link that this run did not start.
   */
  async completeSlackWorkspace(nonce: string, grant: string): Promise<boolean> {
    const opened = await this.#requireConnect().complete(nonce, grant);
    if (!opened) return false;
    const record = this.#threads.store.ensureConnection("slack", opened.workspaceId, opened.workspaceName);
    await this.#stopConnection(record.connectionId);
    await this.#credentials.set(record.connectionId, {
      botToken: opened.botToken,
      botUserId: opened.botUserId,
      appId: opened.appId,
      workspaceId: opened.workspaceId,
      ...(opened.user ? { userToken: opened.user.token, userId: opened.user.id } : {}),
    });
    this.#threads.store.updateConnection(record.connectionId, {
      enabled: true,
      workspaceName: opened.workspaceName,
      botUserId: opened.botUserId,
      appId: opened.appId,
      lastErrorCode: null,
    });
    const updated = this.#threads.store.connection(record.connectionId);
    if (updated) await this.#startConnection(updated);
    // Signal learns the workspaces of this host when the socket connects.
    this.#ingress?.reconnect();
    return true;
  }

  /**
   * Stops the workspace's connection, asks Slack to revoke the person's user token, removes the
   * tokens, and unlinks the workspace from this host. The conversations stay, for a later connect.
   * The bot token is shared by every host of the workspace: it is revoked only when the account
   * service says that no host answers the workspace any more.
   */
  async disconnectSlackWorkspace(workspaceId: string): Promise<void> {
    const record = this.#requireConnection(workspaceId);
    const unreadable = this.#credentials.status(record.connectionId) === "unreadable";
    this.#slackDisconnects.set(record.connectionId, (this.#slackDisconnects.get(record.connectionId) ?? 0) + 1);
    // Stops the Slack client's reads too: a read that is queued or in flight writes nothing after this.
    await this.#stopConnection(record.connectionId);
    if (unreadable) await this.#discardUnreadableAccess(record);
    else await this.#revokeAndUnlink(record);
    // The inbox is a copy of the person's Slack messages, read with the access this revokes.
    this.#threads.inbox.deleteForConnection(record.connectionId);
    await this.#inboxFiles?.deleteForConnection(record.connectionId).catch((error) => this.#warn(error));
    // The Slack client's cache too, and its timers, actions and request queue.
    this.#slackActions.delete(record.connectionId);
    this.#slackQueues.delete(record.connectionId);
    this.#threads.inbox.cache.clearConnection(record.connectionId);
    this.#threads.autoReply.clearConnection(record.connectionId);
    this.#autoReplyLoop.forget((key) => key.startsWith(`${record.connectionId}\n`));
    this.#inboxChanged(record.workspaceId);
    this.#slackClientChanged({ workspaceId: record.workspaceId, channelId: null });
    this.#threads.store.updateConnection(record.connectionId, { enabled: false, lastErrorCode: null });
    this.#ingress?.reconnect();
  }

  /**
   * The saved access cannot be decrypted on this computer, for example after the Keychain key changed.
   * No token is known, so nothing is revoked, and no person id is known, so this host unlinks the whole
   * workspace. The unreadable file goes too: nothing in it can be read again.
   */
  async #discardUnreadableAccess(record: MessagingConnectionRecord): Promise<void> {
    await this.#connect?.unlink(record.workspaceId).catch((error) => this.#warn(error));
    await this.#credentials.clear(record.connectionId, { discardUnreadable: true });
  }

  async #revokeAndUnlink(record: MessagingConnectionRecord): Promise<void> {
    const workspaceId = record.workspaceId;
    const values = this.#credentials.get(record.connectionId);
    const revoke = (token: string | undefined) =>
      token
        ? new SlackWebApi({ token, origin: this.#slackOrigin }).call("auth.revoke").then(
            () => undefined,
            (error) => this.#warn(error),
          )
        : Promise.resolve();
    await revoke(values?.userToken);
    // Connected as a person, only that person leaves: the other people of the workspace keep their routes.
    const owner = values?.userId;
    let workspaceRemains = false;
    if (owner && this.#routing) {
      // Unknown (the account service did not answer) counts as "remains": a lost shared bot token
      // stops every other person's GoAhead.
      workspaceRemains = await this.#routing.unlinkPerson(workspaceId, owner).then(
        (result) => result.workspaceRemains,
        (error) => {
          this.#warn(error);
          return true;
        },
      );
    } else {
      // A bot-only disconnect: the bot token is revoked only when the account service says that no
      // other host answers the workspace. Unknown keeps it.
      const connect = this.#connect;
      workspaceRemains = connect
        ? await connect.unlink(workspaceId).then(
            (result) => result.workspaceRemains,
            (error) => {
              this.#warn(error);
              return true;
            },
          )
        : true;
    }
    if (!workspaceRemains) await revoke(values?.botToken);
    await this.#credentials.clear(record.connectionId);
  }

  /**
   * Whether this computer answers the workspace's people who do not use GoAhead, and the other
   * connected people its owner can hand that to, with their Slack names.
   */
  async slackRouting(workspaceId: string): Promise<SlackRoutingStatus> {
    const record = this.#requireConnection(workspaceId);
    return this.#routingStatus(record, await this.#requireRouting().status(workspaceId));
  }

  /** The default's owner gives the default to another connected person of the workspace. */
  async handOverSlackDefault(workspaceId: string, slackUserId: string): Promise<SlackRoutingStatus> {
    const record = this.#requireConnection(workspaceId);
    const status = await this.#requireRouting().handOver(workspaceId, slackUserId);
    // The route ticket of this host changes: Signal learns it when the socket connects again.
    this.#ingress?.reconnect();
    return this.#routingStatus(record, status);
  }

  async #routingStatus(record: MessagingConnectionRecord, status: SlackDefaultStatus): Promise<SlackRoutingStatus> {
    const live = this.#live.get(record.connectionId);
    const owner = this.#credentials.get(record.connectionId)?.userId;
    const people = status.isDefault
      ? status.people.filter((person) => person.slackUserId !== owner).slice(0, MESSAGING_LIMITS.connections)
      : [];
    return {
      isDefault: status.isDefault,
      people: await Promise.all(
        people.map(async ({ slackUserId }) => ({
          slackUserId,
          displayName: (
            (await live?.adapter.authorName(slackUserId).catch((error) => {
              this.#warn(error);
              return null;
            })) || slackUserId
          ).slice(0, MESSAGING_LIMITS.name),
        })),
      ),
    };
  }

  /**
   * A reply that the person typed in an inbox conversation, posted as them. Their own words need no
   * approval, so pause and quiet hours do not hold it. The send is on record.
   */
  async sendInboxReply(input: SendInboxReplyInput): Promise<void> {
    const live = this.#personConnection(input.workspaceId);
    const user = live.identity?.user;
    if (!user || !live.adapter.postAsUser) throw new Error(sourceText("error.messaging.inboxNeedsUser"));
    const text = input.text.trim();
    if (!text) throw new Error(sourceText("error.messaging.sendTextEmpty"));
    // Only a malformed request gets here: the desktop box stops at the limit.
    if (text.length > MESSAGING_LIMITS.inboxReply) throw new Error("The reply is too long.");
    const connectionId = live.record.connectionId;
    // Only a conversation the inbox holds: the person answers what they read.
    const [latest] = this.#threads.inbox.read(connectionId, input.conversation, null, 1);
    if (!latest) throw new Error(sourceText("error.messaging.inboxUnknownConversation"));
    const { ts } = await live.adapter.postAsUser({
      channel: input.conversation,
      ...(input.threadKey ? { threadTs: input.threadKey } : {}),
      text,
    });
    const now = new Date().toISOString();
    // The reply shows in the conversation at once. Slack may also send it back as an event later;
    // the inbox keeps one row per message ID, so that copy changes nothing.
    this.#threads.inbox.add({
      connectionId,
      platformChannelId: input.conversation,
      platformMessageId: ts,
      threadKey: input.threadKey ?? null,
      kind: latest.kind,
      authorId: user.id,
      authorName: user.name,
      // Kept as Slack keeps it, escaped, as every inbox text is.
      text: text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
      sentAt: now,
    });
    this.#markInboxRead(live, input.conversation, ts);
    this.#inboxChanged(live.record.workspaceId);
    this.#threads.store.recordSend({
      draftId: randomUUID(),
      connectionId,
      linkId: null,
      agentId: "",
      approvedBy: user.id,
      approvedAt: now,
      sender: "user",
      to: `channel:${input.conversation}`,
      platformChannelId: input.conversation,
      platformMessageId: ts,
      text,
      link: null,
    });
  }

  /**
   * One request that Slack sent for a workspace, which Signal has checked. A paused connection answers
   * 200, so Slack does not send it again, and does nothing. An unknown workspace answers 404.
   */
  async deliverSlack(workspaceId: string, delivery: IngressDelivery): Promise<IngressAnswer> {
    const record = this.#threads.store.connectionForWorkspace("slack", workspaceId);
    if (!record) return { status: 404 };
    if (!record.enabled) return { status: 200 };
    const transport = this.#live.get(record.connectionId)?.transport;
    if (!transport?.deliver) return { status: 503 };
    return transport.deliver(delivery);
  }

  // Connection lifecycle.

  async #startConnection(record: MessagingConnectionRecord): Promise<void> {
    const credentials = this.#credentials.get(record.connectionId);
    const driver = this.#drivers.get(record.platform);
    if (!credentials?.botToken || !driver) return;
    const live: LiveConnection = {
      record,
      adapter: driver.createAdapter(credentials, {
        rateLimited: (retryAt) => {
          live.retryAt = retryAt;
          this.#setState(live, "rate_limited");
        },
      }),
      transport: null,
      identity: null,
      state: "connecting",
      retryAt: null,
    };
    this.#live.set(record.connectionId, live);
    try {
      live.identity = await live.adapter.identify();
    } catch (error) {
      if (this.#live.get(record.connectionId) !== live) return;
      if (error instanceof MessagingConnectionError) return this.#setState(live, error.state);
      // Slack is unreachable now. Try again later; Reconnect and a wake from sleep do it at once.
      const retry = setTimeout(() => {
        if (this.#live.get(record.connectionId) === live) void this.#restart(record.connectionId);
      }, IDENTIFY_RETRY_MS);
      retry.unref?.();
      live.transport = {
        start: () => undefined,
        reconnect: () => void this.#restart(record.connectionId),
        stop: async () => clearTimeout(retry),
      };
      return this.#setState(live, "reconnecting");
    }
    if (this.#live.get(record.connectionId) !== live) return;
    // A connection as the person adds a Slack inbox: the desktop reads the inbox list again, and the
    // Slack client reads the person's conversation list.
    if (live.identity.user) {
      this.#inboxChanged(record.workspaceId);
      void this.#slackSync.refreshConversations(record.connectionId).catch((error) => this.#warn(error));
    }
    const identity = live.identity;
    this.#threads.store.updateConnection(record.connectionId, {
      workspaceName: identity.workspaceName,
      botUserId: identity.botUserId,
      appId: identity.appId,
    });
    live.record = this.#threads.store.connection(record.connectionId) ?? record;
    const transport = driver.createTransport(credentials, identity);
    live.transport = transport;
    transport.start({
      state: (state) => {
        if (state === "connected") live.retryAt = null;
        this.#setState(live, state);
      },
      message: (message) => void this.#receive(live, message).catch((error) => this.#warn(error)),
      action: (action) => void this.#action(live, action).catch((error) => this.#warn(error)),
      placeCreated: (platformChannelId) =>
        void live.adapter.joinPlace?.(platformChannelId).catch((error) => this.#warn(error)),
      inbox: (candidate) => {
        void this.#keep(live, candidate).catch((error) => this.#warn(error));
        this.#autoReplyHeard(live, candidate);
      },
      history: (event) => this.#slackHistory(live, event),
      revoked: () => void this.#verifyTokens(live).catch((error) => this.#warn(error)),
    });
    // So people can mention OpenBot in any public channel without inviting it first. Channels made
    // while the host was off are joined here too.
    void live.adapter.joinPublicPlaces?.().catch((error) => this.#warn(error));
  }

  /**
   * Slack said that a token was revoked or the app was removed. Only the current tokens decide: a
   * late event about the tokens of an earlier install must not stop the connection and unlink the
   * workspace that was just connected again. A refused token stops it, as before.
   */
  async #verifyTokens(live: LiveConnection): Promise<void> {
    try {
      await live.adapter.identify();
    } catch (error) {
      if (this.#live.get(live.record.connectionId) !== live) return;
      if (error instanceof MessagingConnectionError) this.#setState(live, error.state);
      else throw error;
    }
  }

  /**
   * A message that does not address OpenBot. When it answers a message OpenBot sent as the user (in
   * that direct message, or in the thread under a channel post), it goes to the conversation where
   * the user asked for the send, so the agent tells the user there. Anything else is dropped.
   */
  /**
   * Whether a direct message answers a message that OpenBot sent there as the app: a reply in the
   * thread under it, or any message in the next day. After that, the person talks to OpenBot again.
   */
  #answersAppSend(live: LiveConnection, message: InboundMessage): boolean {
    const user = live.identity?.user;
    if (!user || message.authorId === user.id) return false;
    const sent = this.#threads.store.latestSendTo(live.record.connectionId, message.platformChannelId);
    if (sent?.sender !== "bot" || !sent.linkId) return false;
    if (message.target.replyThreadId === sent.platformMessageId) return true;
    return Date.now() - Date.parse(sent.approvedAt) <= APP_SEND_REPLY_MS;
  }

  async #observe(live: LiveConnection, message: InboundMessage): Promise<void> {
    const user = live.identity?.user;
    if (!user || message.authorId === user.id || message.authorId === live.identity?.botUserId) return;
    const sent = this.#threads.store.latestSendTo(live.record.connectionId, message.platformChannelId);
    if (!sent?.linkId || Date.now() - Date.parse(sent.approvedAt) > REPLY_WATCH_MS) return;
    // A direct or group direct message is one conversation; in a channel, only the thread under the send.
    if (!message.isDirect && !message.groupDirect && message.threadKey !== sent.platformMessageId) return;
    const link = this.#threads.store.link(sent.linkId);
    if (!link) return;
    const authorName = await live.adapter.authorName(message.authorId);
    await this.#receive(live, {
      dedupKey: `reply:${message.dedupKey}`,
      platformChannelId: link.platformChannelId,
      threadKey: link.threadKey,
      target: linkTarget(link),
      platformMessageId: message.platformMessageId,
      isDirect: link.isDirect,
      requiresLink: true,
      authorId: message.authorId,
      text: [
        `${authorName} replied to the message that was sent for the GoAhead user ("${sent.text.slice(0, SENT_PREVIEW)}"):`,
        message.text || "(The reply has no text.)",
      ].join("\n"),
      files: [],
      observed: true,
    });
  }

  /**
   * Keeps a message in the person's local inbox when it is theirs to read: a direct message with
   * someone other than OpenBot, a group direct message, a message that mentions them, or a message in
   * a channel they picked. Without the person's own connection, nothing is kept.
   */
  async #keep(live: LiveConnection, candidate: InboxCandidate): Promise<void> {
    const user = live.identity?.user;
    if (!user) return;
    const inbox = this.#threads.inbox;
    const connectionId = live.record.connectionId;
    // Another installed person's direct and group messages reach this host too. Keep only the
    // person's own: Slack must say, to their token, that they are in the conversation.
    if (
      (candidate.place === "direct" || candidate.place === "group") &&
      !(await (live.adapter.isPersonConversation?.(candidate.platformChannelId) ?? Promise.resolve(false)))
    )
      return;
    let kind: InboxKind | null = null;
    if (candidate.place === "group") kind = "group";
    else if (candidate.place === "direct") {
      // The direct message with OpenBot is an agent conversation already.
      const withOpenBot = await (live.adapter.isOwnConversation?.(candidate.platformChannelId) ??
        Promise.resolve(true));
      if (!withOpenBot) kind = "direct";
    } else if (inbox.isWatched(connectionId, candidate.platformChannelId)) kind = "channel";
    else if (candidate.mentionedUserIds.includes(user.id)) kind = "mention";
    if (!kind) return;
    const added = inbox.add({
      connectionId,
      platformChannelId: candidate.platformChannelId,
      platformMessageId: candidate.platformMessageId,
      threadKey: candidate.threadKey,
      kind,
      authorId: candidate.authorId,
      authorName: await live.adapter.authorName(candidate.authorId),
      text: candidate.text,
      sentAt: candidate.sentAt,
    });
    if (candidate.files?.length)
      await this.#inboxFiles
        ?.remember(
          connectionId,
          candidate.platformChannelId,
          candidate.platformMessageId,
          candidate.sentAt,
          candidate.files,
        )
        .catch((error) => this.#warn(error));
    if (added) this.#inboxChanged(live.record.workspaceId);
  }

  /** Inbox text in the platform's markup, as plain text for an agent or a preview. */
  #readable(live: LiveConnection, text: string): string {
    return live.adapter.plainText?.(text) ?? text;
  }

  /**
   * An agent's read of the person's inbox. Only the connected person may ask: in their direct message
   * with OpenBot, or in the app, to the workspace's orchestrator, in a turn that the person at this
   * computer started. Anyone else who mentions OpenBot must never read their private messages, and an
   * answer in a channel is posted where everyone there reads it.
   */
  async #readInbox(request: MessagingInboxRequest): Promise<MessagingInboxResult> {
    const live = this.#inboxConnection(request);
    const user = live.identity?.user;
    if (!user) throw new Error(sourceText("error.messaging.inboxNeedsUser"));
    const inbox = this.#threads.inbox;
    const connectionId = live.record.connectionId;
    const watched = inbox.watched(connectionId);
    const place = this.#inboxPlace(live, watched);
    if (request.tool === "list_unread") {
      const unread = inbox.unread(connectionId, user.id);
      return {
        unread: await Promise.all(
          unread.map(async (item) => ({
            conversation: item.platformChannelId,
            kind: item.kind,
            place: await place(item.platformChannelId, item.kind, item.latestAuthorName),
            unreadCount: item.count,
            latestFrom: item.latestAuthorName,
            latestAt: item.latestAt,
          })),
        ),
        pickedChannels: watched.map((channel) => ({ conversation: channel.platformChannelId, name: channel.name })),
        note: SLACK_INBOX_UNTRUSTED_NOTE,
      };
    }
    const conversation = inboxConversation(request.conversation, watched);
    if (!conversation) throw new Error(sourceText("error.messaging.inboxUnknownConversation"));
    const messages = inbox.readForAgent(connectionId, conversation, request.threadKey, request.limit);
    if (messages.length === 0 && !watched.some((channel) => channel.platformChannelId === conversation))
      throw new Error(sourceText("error.messaging.inboxUnknownConversation"));
    const newest = messages.at(-1);
    if (newest && !request.threadKey) inbox.markRead(connectionId, conversation, newest.platformMessageId);
    const kind = messages[0]?.kind ?? "channel";
    const other = messages.find((message) => message.authorId !== user.id)?.authorName ?? "";
    return {
      conversation,
      place: await place(conversation, kind, other),
      messages: messages.map((message) => ({
        id: message.platformMessageId,
        thread: message.threadKey,
        from: message.authorId === user.id ? `${message.authorName} (the GoAhead user)` : message.authorName,
        sentAt: message.sentAt,
        text: this.#readable(live, message.text),
      })),
      note: SLACK_INBOX_UNTRUSTED_NOTE,
    };
  }

  /** The connection whose inbox this request may read. Each case that is not proven fails closed. */
  #inboxConnection(request: MessagingInboxRequest): LiveConnection {
    const link = this.#threads.store.linkForThread(request.threadId);
    if (link?.isDirect) {
      const live = this.#live.get(link.connectionId);
      const user = live?.identity?.user;
      if (!live || !user) throw new Error(sourceText("error.messaging.inboxNeedsUser"));
      if (this.#threads.runningOrigin(link.linkId)?.origin.authorId !== user.id)
        throw new Error(sourceText("error.messaging.inboxOwnerOnly"));
      return live;
    }
    // In the app: only a turn that the person at this computer started, never a Slack thread, a Team
    // API member, a remote client or a routine. The agent must be the orchestrator of one workspace.
    if (link || !request.localOwnerTurn) throw new Error(sourceText("error.messaging.inboxNeedsSlack"));
    const owned = [...this.#live.values()].filter(
      (candidate) => candidate.record.platform === "slack" && candidate.record.orchestratorAgentId === request.agentId,
    );
    const [live] = owned;
    if (owned.length !== 1 || !live) throw new Error(sourceText("error.messaging.inboxNeedsSlack"));
    return live;
  }

  /**
   * Marks an inbox conversation read for GoAhead, then in Slack as the person, so Slack shows it read
   * too. The Slack mark does not wait and is not retried: a failure, such as a missing scope, only warns.
   */
  #markInboxRead(live: LiveConnection, conversation: string, throughMessageId: string): void {
    this.#threads.inbox.markRead(live.record.connectionId, conversation, throughMessageId);
    if (!live.identity?.user || !live.adapter.markReadAsUser) return;
    void live.adapter.markReadAsUser(conversation, throughMessageId).catch((error) => this.#warn(error));
  }

  /**
   * An `@chief` instruction that the person typed in an inbox conversation. Nothing goes to Slack: the
   * workspace's orchestrator gets the instruction in its own conversation, with the conversation's
   * newest messages as context. The orchestrator's own rules decide what it does next.
   */
  async askOrchestratorAboutInbox(input: AskOrchestratorAboutInboxInput): Promise<AskOrchestratorAboutInboxResult> {
    const live = this.#personConnection(input.workspaceId);
    const instruction = input.text.trim().replace(CHIEF_PREFIX, "").trim();
    if (!instruction) throw new Error(sourceText("error.messaging.sendTextEmpty"));
    const agentId = await this.#askOrchestrator(live, {
      conversation: input.conversation,
      threadKey: input.threadKey ?? null,
      lead: "The GoAhead user asks about a Slack conversation",
      instructionTitle: "the GoAhead user's instruction",
      instruction,
      card: "inbox-ask",
    });
    return { agentId };
  }

  /**
   * Gives the workspace's orchestrator one instruction about one conversation, in its own
   * conversation, with the conversation's newest messages as context. Answers the orchestrator's id.
   */
  async #askOrchestrator(
    live: LiveConnection,
    ask: {
      conversation: string;
      threadKey: string | null;
      lead: string;
      instructionTitle: string;
      /** The text, or a function that writes it with the conversation's name. */
      instruction: string | ((place: string) => string);
      /** The card that the orchestrator's chat shows in place of the text. */
      card: SlackAskKind;
      /** For an auto-reply: the new messages, which the card shows. */
      newMessageIds?: ReadonlySet<string>;
    },
  ): Promise<string> {
    const user = live.identity?.user;
    if (!user) throw new Error(sourceText("error.messaging.inboxNeedsUser"));
    const connectionId = live.record.connectionId;
    const inbox = this.#threads.inbox;
    const messages = inbox.readForAgent(connectionId, ask.conversation, ask.threadKey, CHIEF_CONTEXT_MESSAGES);
    if (messages.length === 0) throw new Error(sourceText("error.messaging.inboxUnknownConversation"));
    const agentId = this.#orchestrator(live.record);
    if (!agentId) throw new Error(sourceText("error.messaging.inboxNeedsOrchestrator"));
    const kind = messages[0]?.kind ?? "channel";
    const other = messages.find((message) => message.authorId !== user.id)?.authorName ?? "";
    const place = await this.#inboxPlace(live, inbox.watched(connectionId))(ask.conversation, kind, other);
    const where =
      kind === "direct"
        ? `direct message with ${place}`
        : kind === "group"
          ? `group direct message with ${place}`
          : `channel ${place}`;
    const people = new Map<string, string>();
    for (const message of messages)
      if (message.authorId !== user.id && !people.has(message.authorId))
        people.set(message.authorId, message.authorName);
    const projectMap = this.#agents.projectMap?.() ?? null;
    const text = [
      `${ask.lead} in ${live.record.workspaceName}: ${where} (conversation ${ask.conversation}${ask.threadKey ? `, thread ${ask.threadKey}` : ""}).`,
      kind === "channel" ? `Channel ID: ${ask.conversation}.` : "",
      ...[...people].map(([id, name]) => `Person: ${name}, Slack user ID ${id}.`),
      "To answer in this conversation, call openbot.slack_send_message with to: <@USER_ID> (direct message) or <#CHANNEL_ID> (channel).",
      SLACK_INBOX_UNTRUSTED_NOTE,
      projectMap ? projectMapInstruction(projectMap) : "",
      "--- newest messages, oldest first ---",
      ...messages.map(
        (message) =>
          `${message.authorId === user.id ? `${message.authorName} (the GoAhead user)` : message.authorName}: ${this.#readable(live, message.text)}`,
      ),
      `--- ${ask.instructionTitle} ---`,
      typeof ask.instruction === "function" ? ask.instruction(place) : ask.instruction,
    ]
      .filter(Boolean)
      .join("\n");
    const clip = (value: string, limit: number) => (value.length > limit ? `${value.slice(0, limit - 1)}…` : value);
    const line = (author: string, value: string) => ({
      author: clip(author, INPUT_LIMITS.accountName),
      text: clip(value, SLACK_ASK_TEXT_LIMIT),
    });
    // The new messages of an auto-reply. When the context does not hold them, the newest from
    // someone else stands in.
    const listed = messages.filter((message) => ask.newMessageIds?.has(message.platformMessageId));
    const fromOthers = messages.filter((message) => message.authorId !== user.id);
    const newMessages = ask.card !== "auto-reply" ? [] : listed.length > 0 ? listed : fromOthers.slice(-1);
    const slackAsk: ConversationSlackAsk = {
      kind: ask.card,
      workspaceId: live.record.workspaceId,
      channelId: ask.conversation,
      place: clip(place, SLACK_ASK_PLACE_LIMIT),
      trigger:
        ask.card === "inbox-ask" && typeof ask.instruction === "string"
          ? [line(user.name, ask.instruction)]
          : newMessages
              .slice(-SLACK_ASK_TRIGGER_LIMIT)
              .map((message) => line(message.authorName, this.#readable(live, message.text))),
    };
    await this.#agents.sendMessage({ agentId, text, slackAsk });
    return agentId;
  }

  /**
   * A new message from someone else in a conversation on the auto-reply list. It waits a short time,
   * so several quick messages get one orchestrator turn. A paused workspace, quiet hours, the person's
   * own messages and GoAhead's sends as them start nothing; bots and edits never reach here. In a
   * conversation that a reply loop paused, the messages wait for the end of the pause.
   */
  #autoReplyHeard(live: LiveConnection, candidate: InboxCandidate): void {
    const user = live.identity?.user;
    const connectionId = live.record.connectionId;
    if (!user || this.#live.get(connectionId) !== live || !this.#started) return;
    const key = `${connectionId}\n${candidate.platformChannelId}`;
    if (candidate.authorId === user.id) {
      this.#ownSlackMessage(connectionId, key, candidate);
      return;
    }
    if (candidate.authorId === live.identity?.botUserId) return;
    if (!this.#autoReplyAllowed(live, candidate.platformChannelId)) return;
    this.#autoReplyLoop.heard(key, Date.now());
    let wait = this.#autoReplyWaits.get(key);
    if (!wait) {
      wait = {
        connectionId,
        channelId: candidate.platformChannelId,
        threadKeys: new Set(),
        authorIds: new Set(),
        messageIds: new Set(),
        firstAt: null,
        cancelWait: null,
        running: null,
        again: false,
      };
      this.#autoReplyWaits.set(key, wait);
    }
    wait.authorIds.add(candidate.authorId);
    wait.messageIds.add(candidate.platformMessageId);
    wait.threadKeys.add(candidate.threadKey);
    if (wait.running) wait.again = true;
    else if (!this.#autoReplyLoop.isPaused(key)) this.#restartAutoReplyWait(key, wait);
  }

  /**
   * The person's own message in a conversation starts the loop count again and ends a loop pause.
   * GoAhead's sends as the person come back the same way, so a message while an auto-reply turn runs
   * there, or one on record as auto-sent, is not counted as the person's.
   */
  #ownSlackMessage(connectionId: string, key: string, candidate: InboxCandidate): void {
    if (this.#autoReplyWaits.get(key)?.running) return;
    const autoSent = this.#threads.store.autoSentMessageIds(connectionId, candidate.platformChannelId);
    if (autoSent.has(candidate.platformMessageId)) return;
    if (this.#autoReplyLoop.reset(key)) this.#autoReplyResumed(key);
  }

  /** The person wrote to an orchestrator in GoAhead: every loop pause in its workspaces ends. */
  #localOwnerMessage(agentId: string): void {
    for (const key of this.#autoReplyLoop.pausedKeys()) {
      const record = this.#threads.store.connection(key.split("\n")[0] ?? "");
      if (!record || this.#orchestrator(record) !== agentId) continue;
      this.#autoReplyLoop.reset(key);
      this.#autoReplyResumed(key);
    }
  }

  /** After a loop pause, the messages that came during it get one turn. */
  #autoReplyResumed(key: string): void {
    const wait = this.#autoReplyWaits.get(key);
    if (wait && !wait.running && !wait.cancelWait && wait.authorIds.size > 0) this.#restartAutoReplyWait(key, wait);
  }

  /** An auto-reply went out. The reply that completes a loop pauses the conversation and tells the person. */
  #autoReplySent(live: LiveConnection, channelId: string): void {
    if (!this.#autoReplyLoop.replied(`${live.record.connectionId}\n${channelId}`, Date.now())) return;
    void this.#askOrchestrator(live, {
      conversation: channelId,
      threadKey: null,
      lead: "GoAhead paused auto-reply in a Slack conversation",
      instructionTitle: "GoAhead's instruction",
      card: "auto-reply-paused",
      instruction: (place) =>
        `Do not reply in Slack. Tell the GoAhead user this in one line, as it is: ${sourceText("status.messaging.autoReplyLoopPaused", { conversation: place })}`,
    }).catch((error) => this.#warn(error));
  }

  /** Whether an auto-reply turn may start in the conversation now. */
  #autoReplyAllowed(live: LiveConnection, channelId: string): boolean {
    const record = live.record;
    if (!this.#credentials.get(record.connectionId)?.userToken || !this.#orchestrator(record)) return false;
    if (!this.#threads.autoReply.isOn(record.connectionId, channelId)) return false;
    const guards = this.#guards.get(record.workspaceId);
    return !guards.paused && !inQuietHours(guards.quietHours, new Date());
  }

  #restartAutoReplyWait(key: string, wait: AutoReplyWait): void {
    wait.cancelWait?.();
    const now = Date.now();
    wait.firstAt ??= now;
    const delay = Math.max(0, Math.min(AUTO_REPLY_WAIT_MS, wait.firstAt + AUTO_REPLY_WAIT_CAP_MS - now));
    wait.cancelWait = this.#autoReplyTimers.start(
      () => void this.#startAutoReplyTurn(key, wait).catch((error) => this.#warn(error)),
      delay,
    );
  }

  async #startAutoReplyTurn(key: string, wait: AutoReplyWait): Promise<void> {
    wait.cancelWait = null;
    wait.firstAt = null;
    // A loop pause keeps the messages for one turn after it ends.
    if (this.#autoReplyLoop.isPaused(key) && this.#autoReplyWaits.get(key) === wait) return;
    const live = this.#live.get(wait.connectionId);
    const agentId = live ? this.#orchestrator(live.record) : null;
    if (this.#autoReplyWaits.get(key) !== wait || !live || !agentId || !this.#autoReplyAllowed(live, wait.channelId)) {
      if (this.#autoReplyWaits.get(key) === wait) this.#autoReplyWaits.delete(key);
      return;
    }
    const authorIds = [...wait.authorIds];
    const threads = [...wait.threadKeys].filter((threadKey) => threadKey !== null);
    // One thread: its messages are the context. Otherwise the top of the conversation is.
    const threadKey = wait.threadKeys.size === 1 ? (threads[0] ?? null) : null;
    const newMessageIds = new Set(wait.messageIds);
    wait.messageIds.clear();
    wait.authorIds.clear();
    wait.threadKeys.clear();
    wait.running = {
      agentId,
      turnId: null,
      cancelLimit: this.#autoReplyTimers.start(() => this.#autoReplyTurnEnded(key, wait), AUTO_REPLY_TURN_LIMIT_MS),
    };
    try {
      const names = (await Promise.all(authorIds.map((id) => live.adapter.authorName(id)))).join(", ");
      const thread =
        threads.length > 0
          ? ` New messages are in ${threads.length === 1 ? "the thread" : "the threads"} ${threads.join(", ")}: to reply in a thread, pass its threadTs.`
          : "";
      await this.#askOrchestrator(live, {
        conversation: wait.channelId,
        threadKey,
        lead: "Auto-reply is on for a Slack conversation",
        instructionTitle: "GoAhead's instruction",
        card: "auto-reply",
        newMessageIds,
        instruction: `Auto-reply is on for this conversation. Read the new messages from ${names} and reply in this conversation as the GoAhead user, the way they would answer in chat: a short, natural reply to every message written to them.${thread} Send nothing anywhere else. Send nothing only when the new messages are just an acknowledgement, such as an emoji, "ok", "thanks" or a thumbs up.`,
      });
    } catch (error) {
      this.#autoReplyTurnEnded(key, wait);
      throw error;
    }
  }

  /** The orchestrator's turns: the first one that starts after an auto-reply request is that request's. */
  #autoReplyTurn(event: Extract<AgentEvent, { type: "turn-started" | "turn-completed" }>): void {
    for (const [key, wait] of this.#autoReplyWaits) {
      const running = wait.running;
      if (running?.agentId !== event.agentId) continue;
      if (event.type === "turn-started" && running.turnId === null) running.turnId = event.turnId;
      else if (event.type === "turn-completed" && running.turnId === event.turnId) this.#autoReplyTurnEnded(key, wait);
    }
  }

  #autoReplyTurnEnded(key: string, wait: AutoReplyWait): void {
    if (this.#autoReplyWaits.get(key) !== wait || !wait.running) return;
    wait.running.cancelLimit();
    wait.running = null;
    if (wait.again) {
      wait.again = false;
      this.#restartAutoReplyWait(key, wait);
    } else if (!wait.cancelWait) this.#autoReplyWaits.delete(key);
  }

  /** Forgets the waits and turns that `match` names, and cancels their timers. */
  #clearAutoReplyWaits(match: (wait: AutoReplyWait) => boolean): void {
    for (const [key, wait] of this.#autoReplyWaits) {
      if (!match(wait)) continue;
      wait.cancelWait?.();
      wait.running?.cancelLimit();
      this.#autoReplyWaits.delete(key);
    }
  }

  /** The auto-reply turn that runs now for this agent in this conversation, if any. */
  #runningAutoReply(agentId: string, connectionId: string, channelId: string): AutoReplyWait | null {
    for (const wait of this.#autoReplyWaits.values())
      if (wait.running?.agentId === agentId && wait.connectionId === connectionId && wait.channelId === channelId)
        return wait;
    return null;
  }

  /** The live connection of a workspace that is connected as the person. */
  #personConnection(workspaceId: string): LiveConnection {
    const record = this.#requireConnection(workspaceId);
    const live = this.#live.get(record.connectionId);
    if (!live?.identity?.user) throw new Error(sourceText("error.messaging.inboxNeedsUser"));
    return live;
  }

  /** The request queue of one connection's history-type Slack calls, shared with the Slack client. */
  #slackQueue(connectionId: string): SlackRequestQueue {
    let queue = this.#slackQueues.get(connectionId);
    if (!queue) {
      queue = new SlackRequestQueue({ perMinute: SLACK_HISTORY_CALLS_PER_MINUTE });
      this.#slackQueues.set(connectionId, queue);
    }
    return queue;
  }

  /** Reads a newly picked channel's newest messages into the inbox, as background work in the queue. */
  #fillHistory(live: LiveConnection, platformChannelId: string): void {
    const connectionId = live.record.connectionId;
    const recentMessages = live.adapter.recentMessages?.bind(live.adapter);
    if (!recentMessages) return;
    const fill = this.#slackQueue(connectionId).run("background", async () => {
      if (this.#live.get(connectionId) !== live) return [];
      if (!this.#threads.inbox.isWatched(connectionId, platformChannelId)) return [];
      return recentMessages(platformChannelId, HISTORY_FILL_MESSAGES);
    });
    void fill
      .then(async (messages) => {
        for (const candidate of messages) await this.#keep(live, candidate).catch((error) => this.#warn(error));
      })
      .catch((error) => this.#warn(error));
  }

  // The Slack client: the person's conversations from the local cache, loaded from Slack on demand.
  // Every method needs a workspace connected as the person. Reads work offline from the cache.

  /** The person's conversations, newest activity first. */
  async slackClientConversations({ workspaceId }: SlackClientListInput): Promise<SlackClientConversation[]> {
    return this.#slackSync.listConversations(this.#slackClientConnection(workspaceId));
  }

  /** The newest page of a conversation from the cache; the newest messages from Slack follow as a change. */
  async slackClientOpen({ workspaceId, channelId }: SlackClientOpenInput): Promise<SlackClientPage> {
    const connectionId = this.#slackClientConnection(workspaceId);
    return this.#withAutoReply(connectionId, await this.#slackSync.open(connectionId, channelId));
  }

  async slackClientOlder({ workspaceId, channelId, beforeTs }: SlackClientOlderInput): Promise<SlackClientPage> {
    const connectionId = this.#slackClientConnection(workspaceId);
    return this.#withAutoReply(connectionId, await this.#slackSync.older(connectionId, channelId, beforeTs));
  }

  async slackClientThread({ workspaceId, channelId, threadTs }: SlackClientThreadInput): Promise<SlackClientThread> {
    const connectionId = this.#slackClientConnection(workspaceId);
    const thread = await this.#slackSync.thread(connectionId, channelId, threadTs);
    const autoSent = this.#threads.store.autoSentMessageIds(connectionId, channelId);
    return {
      ...thread,
      parent: markAutoSent(thread.parent, autoSent),
      replies: thread.replies.map((reply) => markAutoSent(reply, autoSent)),
    };
  }

  /**
   * Puts one of the person's conversations on the auto-reply list, or takes it off. Only a workspace
   * connected as the person has a list, so only that person changes it. The next agent send reads it.
   */
  async slackClientSetAutoReply({ workspaceId, channelId, on }: SlackClientAutoReplyInput): Promise<void> {
    const connectionId = this.#slackClientConnection(workspaceId);
    if (on && !this.#threads.inbox.cache.conversations(connectionId).some((item) => item.channelId === channelId))
      throw new Error(sourceText("error.messaging.threadUnavailable"));
    this.#threads.autoReply.set(connectionId, channelId, on);
    this.#autoReplyLoop.reset(`${connectionId}\n${channelId}`);
    if (!on) this.#clearAutoReplyWaits((wait) => wait.connectionId === connectionId && wait.channelId === channelId);
    this.#slackClientChanged({ workspaceId, channelId });
  }

  /** The page with its conversation's auto-reply state, and the messages that went out with no approval. */
  #withAutoReply(connectionId: string, page: SlackClientPage): SlackClientPage {
    const autoSent = this.#threads.store.autoSentMessageIds(connectionId, page.channelId);
    return {
      ...page,
      messages: page.messages.map((message) => markAutoSent(message, autoSent)),
      autoReply: this.#threads.autoReply.isOn(connectionId, page.channelId),
    };
  }

  /**
   * Sends as the person, with no approval and no send guard: the person writes it in GoAhead. A file
   * goes with `slackClientUpload`, which takes the text.
   */
  async slackClientSend({ workspaceId, channelId, text, threadTs, broadcast }: SlackClientSendInput): Promise<void> {
    await this.#slackClientAct(workspaceId, (actions) =>
      actions.send({
        channelId,
        text,
        ...(threadTs === undefined ? {} : { threadTs }),
        ...(broadcast === undefined ? {} : { broadcast }),
      }),
    );
  }

  /** Refused before any Slack call unless the cached message is the person's own. */
  async slackClientEdit({ workspaceId, channelId, ts, text }: SlackClientEditInput): Promise<void> {
    await this.#slackClientAct(workspaceId, (actions) => actions.edit({ channelId, ts, text }));
  }

  /** Refused before any Slack call unless the cached message is the person's own. */
  async slackClientDelete({ workspaceId, channelId, ts }: SlackClientDeleteInput): Promise<void> {
    await this.#slackClientAct(workspaceId, (actions) => actions.delete({ channelId, ts }));
  }

  async slackClientReact({ workspaceId, channelId, ts, name, on }: SlackClientReactInput): Promise<void> {
    await this.#slackClientAct(workspaceId, (actions) => actions.react({ channelId, ts, name, on }));
  }

  /**
   * Shares a file as the person, with an optional text, in the channel or a thread: a path main
   * picked, or the name and bytes of a file the person dropped.
   */
  async slackClientUpload(workspaceId: string, upload: SlackClientUploadAction): Promise<SlackClientUploadResult> {
    return this.#slackClientAct(workspaceId, (actions) => actions.upload(upload));
  }

  /** People whose name matches, for an `@` mention. Empty while Slack cannot be read. */
  async slackClientMentionCandidates({
    workspaceId,
    query,
  }: SlackClientMentionInput): Promise<SlackClientMentionCandidate[]> {
    const live = this.#slackClientLive(this.#slackClientConnection(workspaceId));
    const search = live?.adapter.searchPeople?.bind(live.adapter);
    if (!search) return [];
    return (await search(query.trim())).slice(0, MENTION_CANDIDATES);
  }

  onSlackClientChanged(listener: (change: SlackClientChanged) => void): () => void {
    this.#slackClientListeners.add(listener);
    return () => this.#slackClientListeners.delete(listener);
  }

  #slackClientChanged(change: SlackClientChanged): void {
    for (const listener of this.#slackClientListeners) listener(change);
  }

  /** The connection of a workspace connected as the person, connected now or not. */
  #slackClientConnection(workspaceId: string): string {
    const record = this.#requireConnection(workspaceId);
    if (record.platform !== "slack" || !this.#slackOwner(record.connectionId))
      throw new Error(sourceText("error.messaging.clientNeedsUser"));
    return record.connectionId;
  }

  /** The live connection as the person, or null while it is not connected. */
  #slackClientLive(connectionId: string): LiveConnection | null {
    const live = this.#live.get(connectionId);
    return live?.identity?.user ? live : null;
  }

  /** The person who connected the workspace. The saved access names them while Slack is unreachable. */
  #slackOwner(connectionId: string): string | null {
    return this.#live.get(connectionId)?.identity?.user?.id ?? this.#credentials.get(connectionId)?.userId ?? null;
  }

  /**
   * Runs one action of the person. An action can write the cache after its Slack call; when the
   * workspace was disconnected meanwhile and is not connected again, that write is removed, so a
   * disconnected workspace keeps no cached messages.
   */
  async #slackClientAct<T>(workspaceId: string, act: (actions: SlackClientActions) => Promise<T>): Promise<T> {
    const connectionId = this.#slackClientConnection(workspaceId);
    const disconnects = this.#slackDisconnects.get(connectionId) ?? 0;
    try {
      return await act(this.#slackClientActions(workspaceId, connectionId));
    } finally {
      if ((this.#slackDisconnects.get(connectionId) ?? 0) !== disconnects && !this.#slackClientLive(connectionId))
        this.#threads.inbox.cache.clearConnection(connectionId);
    }
  }

  #slackClientActions(workspaceId: string, connectionId: string): SlackClientActions {
    let actions = this.#slackActions.get(connectionId);
    if (!actions) {
      actions = new SlackClientActions({
        connectionId,
        store: this.#threads.inbox.cache,
        adapter: () => this.#slackClientLive(connectionId)?.adapter ?? null,
        ownerUserId: () => this.#slackOwner(connectionId),
        onChanged: (channelId) => this.#slackClientChanged({ workspaceId, channelId }),
      });
      this.#slackActions.set(connectionId, actions);
    }
    return actions;
  }

  /** A live change from Slack: the cache takes it, and the open view hears of it. Never an agent turn. */
  #slackHistory(live: LiveConnection, event: HistoryEvent): void {
    const connectionId = live.record.connectionId;
    if (this.#live.get(connectionId) !== live || !live.identity?.user) return;
    try {
      if (!applySlackClientEvent(this.#threads.inbox.cache, connectionId, event)) return;
    } catch (error) {
      this.#warn(error);
      return;
    }
    // A joined or left conversation changes the list; anything else changes one conversation.
    this.#slackClientChanged({
      workspaceId: live.record.workspaceId,
      channelId: event.type === "membership" ? null : event.channelId,
    });
  }

  /**
   * The name of an inbox conversation: the other person for a direct or group direct message, the
   * picked name or the channel name otherwise.
   */
  #inboxPlace(
    live: LiveConnection,
    watched: Array<{ platformChannelId: string; name: string }>,
  ): (platformChannelId: string, kind: InboxKind, fallback: string) => Promise<string> {
    return async (platformChannelId, kind, fallback) =>
      kind === "direct" || kind === "group"
        ? fallback || platformChannelId
        : (watched.find((channel) => channel.platformChannelId === platformChannelId)?.name ??
          (await live.adapter.placeName(platformChannelId)));
  }

  /** The inbox of every workspace connected as the person, for the desktop. It only reads. */
  async listInbox(): Promise<MessagingInboxWorkspace[]> {
    const workspaces: MessagingInboxWorkspace[] = [];
    for (const live of this.#live.values()) {
      const user = live.identity?.user;
      if (!user || live.record.platform !== "slack") continue;
      const connectionId = live.record.connectionId;
      const place = this.#inboxPlace(live, this.#threads.inbox.watched(connectionId));
      const conversations = await Promise.all(
        this.#threads.inbox.conversations(connectionId, user.id).map(async (item) => ({
          conversation: item.platformChannelId,
          kind: item.kind,
          place: await place(item.platformChannelId, item.kind, item.latestFrom),
          unreadCount: item.unreadCount,
          latestAt: item.latestAt,
          latestFrom: item.latestFrom,
          preview: this.#readable(live, item.preview).slice(0, PREVIEW_CHARACTERS),
        })),
      );
      workspaces.push({
        workspaceId: live.record.workspaceId,
        workspaceName: live.record.workspaceName,
        agentId: live.record.orchestratorAgentId,
        conversations,
      });
    }
    return workspaces;
  }

  /**
   * The newest messages of one inbox conversation, for the desktop, and marks them read for GoAhead.
   * Only a conversation the inbox holds can be read.
   */
  async readInboxConversation(workspaceId: string, conversation: string, limit = 50): Promise<MessagingInboxPage> {
    const live = this.#personConnection(workspaceId);
    const user = live.identity?.user;
    if (!user) throw new Error(sourceText("error.messaging.inboxNeedsUser"));
    const connectionId = live.record.connectionId;
    const inbox = this.#threads.inbox;
    const messages = inbox.read(connectionId, conversation, null, Math.min(limit, MESSAGING_LIMITS.inboxMessages));
    if (messages.length === 0) throw new Error(sourceText("error.messaging.inboxUnknownConversation"));
    const newest = messages.at(-1);
    if (newest) this.#markInboxRead(live, conversation, newest.platformMessageId);
    const other = messages.find((message) => message.authorId !== user.id)?.authorName ?? "";
    const files =
      (await this.#inboxFiles
        ?.forMessages(
          connectionId,
          conversation,
          messages.map((message) => message.platformMessageId),
        )
        .catch((error) => {
          this.#warn(error);
          return null;
        })) ?? new Map<string, InboxFile[]>();
    const lookups = await this.#inboxLookups(
      live,
      messages.map((message) => message.text),
    );
    return {
      workspaceId,
      conversation,
      place: await this.#inboxPlace(live, inbox.watched(connectionId))(
        conversation,
        messages[0]?.kind ?? "channel",
        other,
      ),
      messages: messages.map((message) => {
        const shared = files.get(message.platformMessageId) ?? [];
        return {
          id: message.platformMessageId,
          from: message.authorName,
          isOwn: message.authorId === user.id,
          text: message.text,
          sentAt: message.sentAt,
          thread: message.threadKey,
          ...(shared.length
            ? { files: shared.slice(0, MESSAGING_LIMITS.inboxFiles).map((file) => inboxFileView(workspaceId, file)) }
            : {}),
        };
      }),
      ...lookups,
    };
  }

  /**
   * The names of the people and channels the texts mention, and the workspace emoji they use, so the
   * desktop shows them as Slack does. Each lookup is cached per connection by the adapter; an id
   * that cannot be read is left out, and the desktop shows the id.
   */
  async #inboxLookups(
    live: LiveConnection,
    texts: readonly string[],
  ): Promise<Pick<MessagingInboxPage, "people" | "channels" | "customEmoji">> {
    const references = inboxReferences(texts);
    const people: Record<string, string> = {};
    const channels: Record<string, string> = {};
    await Promise.all([
      ...[...references.users].slice(0, INBOX_LOOKUPS).map(async (id) => {
        const name = await live.adapter.authorName(id).catch(() => id);
        if (name && name !== id) people[id] = name;
      }),
      ...[...references.channels].slice(0, INBOX_LOOKUPS).map(async (id) => {
        const name = (await live.adapter.placeName(id).catch(() => id)).replace(/^#/u, "");
        if (name && name !== id) channels[id] = name;
      }),
    ]);
    const customEmoji: Record<string, string> = {};
    if (references.emoji.size > 0 && live.adapter.customEmoji) {
      const all: Record<string, string> = await live.adapter.customEmoji().catch(() => ({}));
      // Only the emoji on the page, and the emoji an alias of theirs names.
      const wanted = [...references.emoji];
      for (let index = 0; index < wanted.length && index < INBOX_LOOKUPS; index += 1) {
        const name = wanted[index] ?? "";
        const value = Object.hasOwn(all, name) ? all[name] : undefined;
        if (value === undefined || Object.hasOwn(customEmoji, name)) continue;
        customEmoji[name] = value;
        if (value.startsWith("alias:")) wanted.push(value.slice("alias:".length));
      }
    }
    return { people, channels, customEmoji };
  }

  /**
   * The cached image of a file that an inbox message shared, downloaded with the person's token the
   * first time. Null for a workspace that is not connected as the person, a file the inbox does not
   * hold, or a file that is not an image.
   */
  async resolveInboxFile(workspaceId: string, fileId: string): Promise<InboxImage | null> {
    const live = [...this.#live.values()].find(
      (candidate) => candidate.record.workspaceId === workspaceId && candidate.identity?.user,
    );
    const download = live?.adapter.downloadInboxFile?.bind(live.adapter);
    if (!live || !download || !this.#inboxFiles) return null;
    const connectionId = live.record.connectionId;
    const image = await this.#inboxFiles.image(connectionId, fileId, download);
    if (image) return image;
    // An image of a Slack client conversation the inbox does not keep: the file index learns it from
    // the cached message, so the same download, size cap and Slack-host check apply. It ages from now.
    const cached = this.#threads.inbox.cache.messageWithFile(connectionId, fileId);
    if (!cached) return null;
    const indexed = (await this.#inboxFiles.forMessages(connectionId, cached.channelId, [cached.ts])).get(cached.ts);
    // The index holds this file already, so its download failed: do not try again here.
    if (indexed?.some((file) => file.id === fileId)) return null;
    const known = new Set(indexed?.map((file) => file.id));
    const files = [...(indexed ?? []), ...cached.files.filter((file) => !known.has(file.id))];
    await this.#inboxFiles.remember(connectionId, cached.channelId, cached.ts, new Date().toISOString(), files);
    return this.#inboxFiles.image(connectionId, fileId, download);
  }

  onInboxChanged(listener: (workspaceId: string) => void): () => void {
    this.#inboxListeners.add(listener);
    return () => this.#inboxListeners.delete(listener);
  }

  #inboxChanged(workspaceId: string): void {
    for (const listener of this.#inboxListeners) listener(workspaceId);
  }

  #purgeInbox(): void {
    try {
      const before = new Date(Date.now() - INBOX_RETENTION_MS).toISOString();
      this.#threads.inbox.purgeBefore(before);
      void this.#inboxFiles?.purgeBefore(before).catch((error) => this.#warn(error));
    } catch (error) {
      this.#warn(error);
    }
  }

  async #restart(connectionId: string): Promise<void> {
    await this.#stopConnection(connectionId);
    const record = this.#threads.store.connection(connectionId);
    if (record?.enabled) await this.#startConnection(record);
  }

  async #stopConnection(connectionId: string): Promise<void> {
    const live = this.#live.get(connectionId);
    this.#live.delete(connectionId);
    this.#clearAutoReplyWaits((wait) => wait.connectionId === connectionId);
    this.#slackSync.stop(connectionId);
    await live?.transport?.stop();
  }

  #setState(live: LiveConnection, state: MessagingConnectionState): void {
    const wasFatal = FATAL_STATES.has(live.state);
    live.state = state;
    if (FATAL_STATES.has(state)) {
      this.#threads.store.updateConnection(live.record.connectionId, { lastErrorCode: state });
      // A second fatal report for a stopped connection must not unlink the workspace again.
      if (wasFatal) return;
      logger.warn("A messaging connection stopped.", { platform: live.record.platform, state });
      // As on a disconnect: a later connect, perhaps as another person, must not auto-send.
      this.#threads.autoReply.clearConnection(live.record.connectionId);
      this.#autoReplyLoop.forget((key) => key.startsWith(`${live.record.connectionId}\n`));
      // The workspace uninstalled OpenBot or revoked its token: Signal stops routing it here.
      void this.#connect?.unlink(live.record.workspaceId).catch((error) => this.#warn(error));
    }
  }

  #summary(record: MessagingConnectionRecord): MessagingConnection {
    const live = this.#live.get(record.connectionId);
    const credentials = this.#credentials.status(record.connectionId);
    const values = credentials === "saved" ? this.#credentials.get(record.connectionId) : null;
    const stored = isOneOf(MESSAGING_CONNECTION_STATES, record.lastErrorCode) ? record.lastErrorCode : null;
    const state: MessagingConnectionState = !record.enabled
      ? "paused"
      : credentials === "unreadable" || (values && !values.botToken)
        ? "secret_storage_unavailable"
        : (live?.state ?? stored ?? "connecting");
    return {
      workspaceId: record.workspaceId,
      platform: record.platform,
      enabled: record.enabled,
      state,
      workspaceName: record.workspaceName,
      botUserId: record.botUserId,
      userId: values?.userId ?? null,
      userName: live?.identity?.user?.name ?? null,
      missingScopes: live?.identity?.missingScopes ?? [],
      retryAt: state === "rate_limited" ? (live?.retryAt ?? null) : null,
      credentials,
      orchestratorAgentId: record.orchestratorAgentId,
      sendGuards: {
        ...this.#guards.get(record.workspaceId),
        hourlyLimit: null,
        sentLastHour: this.#threads.store.sendsSince(
          record.connectionId,
          new Date(Date.now() - SEND_COUNT_WINDOW_MS).toISOString(),
        ),
      },
      watchedChannels: this.#threads.inbox.watched(record.connectionId).map((channel) => ({
        channelId: channel.platformChannelId,
        name: channel.name.replace(/^#/u, ""),
      })),
    };
  }

  // Inbound.

  async #receive(live: LiveConnection, message: InboundMessage): Promise<void> {
    if (!live.identity) return;
    // With the user's events, a direct message between the user and someone else arrives like one
    // to OpenBot. It is never a request: at most a reply to a message OpenBot sent as the user.
    if (
      !message.observed &&
      message.isDirect &&
      live.identity.user &&
      !(await (live.adapter.isOwnConversation?.(message.platformChannelId) ?? Promise.resolve(true)))
    )
      return this.#observe(live, message);
    // OpenBot sent a message here for someone, as the app, a moment ago: an answer goes back to where
    // the send was asked for, not to a new conversation with OpenBot.
    if (!message.observed && (message.isDirect || message.groupDirect) && this.#answersAppSend(live, message))
      return this.#observe(live, message);
    // Before any await below: a redelivered event can arrive while the first copy is still
    // downloading its files, before the mailbox holds its idempotency key. The mailbox key covers a restart.
    const store = this.#threads.store;
    const existing = store.linkByKey(live.record.connectionId, message.platformChannelId, message.threadKey);
    // Before the dedup key: a reply with a mention also arrives as `app_mention`, which must still run.
    if (message.requiresLink && !existing) {
      if (!message.observed) await this.#observe(live, message);
      return;
    }
    const dedupKey = `${live.record.connectionId}:${message.dedupKey}`;
    if (this.#recent.has(dedupKey)) return;
    this.#recent.add(dedupKey);
    if (this.#recent.size > RECENT_MESSAGES) {
      const oldest = this.#recent.values().next().value;
      if (oldest !== undefined) this.#recent.delete(oldest);
    }
    if (existing && CANCEL_TEXT.test(message.text) && message.files.length === 0) {
      if (await this.#threads.stop(existing.linkId, message.authorId)) {
        await live.adapter.react(message.target, message.platformMessageId, "stopped", true).catch(() => undefined);
        return;
      }
    }
    const { adapter } = live;
    const authorName = await adapter.authorName(message.authorId);
    const place = message.isDirect ? null : await adapter.placeName(message.platformChannelId);
    // A conversation keeps its agent. A new one goes to the workspace's orchestrator, which asks its
    // teammates; without one, nothing answers.
    const agentId = existing?.agentId ?? this.#orchestrator(live.record);
    if (!agentId) {
      await adapter.post(message.target, { text: sourceText("status.messaging.noAgent") });
      return;
    }
    const staging = join(this.#downloadsRoot, randomUUID());
    try {
      const { paths, skipped } = await this.#download(adapter, message, staging);
      const text = skipped.length
        ? `${message.text}\n\n(Files that did not arrive: ${skipped.join(", ")})`
        : message.text;
      const result = await this.#threads.receive({
        connectionId: live.record.connectionId,
        agentId,
        platformChannelId: message.platformChannelId,
        threadKey: message.threadKey,
        isDirect: message.isDirect,
        title: message.isDirect ? authorName : `${place} · ${message.text.slice(0, 80) || authorName}`,
        text,
        sourcePaths: paths,
        origin: {
          authorId: message.authorId,
          authorName,
          platformMessageId: message.platformMessageId,
          ...(message.observed ? { isReply: true } : {}),
        },
        idempotencyKey: `messaging:${live.record.connectionId}:${message.dedupKey}`,
      });
      if (result.status === "duplicate") return;
      const key = `${result.link.linkId}:${message.platformMessageId}`;
      if (result.status === "busy") {
        await adapter.post(message.target, { text: sourceText("status.messaging.busy") });
        await adapter.react(message.target, message.platformMessageId, "failed", true).catch(() => undefined);
        return;
      }
      this.#targets.set(key, message.target);
      await adapter.react(message.target, message.platformMessageId, "received", true).catch(() => undefined);
      // In the same order as the turn's own posts: a turn that already started has its status post.
      if (result.waiting)
        this.#serial(result.link.linkId, async () => {
          if (this.#posts.has(key) || !this.#targets.has(key)) return;
          const messageId = await adapter.post(message.target, { text: sourceText("status.messaging.queued") });
          this.#posts.set(key, {
            connectionId: live.record.connectionId,
            target: message.target,
            messageId,
            stopToken: null,
          });
        });
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  #orchestrator(record: MessagingConnectionRecord): string | null {
    const id = this.#threads.store.connection(record.connectionId)?.orchestratorAgentId ?? null;
    return id && this.#agents.listAgents().some((agent) => agent.id === id) ? id : null;
  }

  /** Downloads the files of a message into `staging`, within the attachment limits. */
  async #download(
    adapter: MessagingAdapter,
    message: InboundMessage,
    staging: string,
  ): Promise<{ paths: string[]; skipped: string[] }> {
    const paths: string[] = [];
    const skipped: string[] = [];
    let total = 0;
    for (const [index, file] of message.files.entries()) {
      if (
        paths.length >= INPUT_LIMITS.attachments ||
        file.size > ATTACHMENT_LIMITS.fileBytes ||
        total + file.size > ATTACHMENT_LIMITS.totalBytes
      ) {
        skipped.push(file.name);
        continue;
      }
      try {
        await mkdir(join(staging, String(index)), { recursive: true, mode: 0o700 });
        // The name comes from another person, so only its last segment is used.
        const destination = join(staging, String(index), basename(file.name) || "file");
        await adapter.download(
          file,
          destination,
          Math.min(ATTACHMENT_LIMITS.fileBytes, ATTACHMENT_LIMITS.totalBytes - total),
        );
        total += file.size;
        paths.push(destination);
      } catch {
        skipped.push(file.name);
      }
    }
    return { paths, skipped };
  }

  async #promptContext(link: MessagingLink, origin: MessagingOrigin) {
    const live = this.#live.get(link.connectionId);
    const workspaceName = live?.record.workspaceName ?? null;
    if (!live) return { workspaceName, place: link.title, messages: [], cursor: null, skippedFiles: [] };
    const place = link.isDirect ? "direct message" : await live.adapter.placeName(link.platformChannelId);
    // Every message of a person's direct message conversation already reached the agent's thread.
    const messages =
      link.threadKey === DIRECT_CONVERSATION_KEY
        ? []
        : await live.adapter
            .history(link.platformChannelId, link.threadKey, link.historyCursor, origin.platformMessageId)
            .catch(() => []);
    return {
      workspaceName,
      place,
      messages,
      cursor: origin.platformMessageId,
      skippedFiles: [],
      ownerId: live.identity?.user?.id ?? null,
    };
  }

  // Outbound.

  async #activity(activity: MessagingActivity): Promise<void> {
    const live = this.#live.get(activity.link.connectionId);
    if (!live || !activity.origin) return;
    const { adapter } = live;
    const key = `${activity.link.linkId}:${activity.origin.platformMessageId}`;
    const target = this.#targets.get(key) ?? linkTarget(activity.link);
    const post = this.#posts.get(key);
    if (activity.type === "started") {
      const stopToken = token();
      this.#stops.set(stopToken, {
        linkId: activity.link.linkId,
        authorId: activity.origin.authorId,
        connectionId: live.record.connectionId,
      });
      const body = {
        text: sourceText("status.messaging.working"),
        buttons: [{ action: "stop" as const, label: sourceText("status.messaging.stop"), token: stopToken }],
      };
      const messageId = post?.messageId
        ? await adapter.edit(target, post.messageId, body).then(() => post.messageId)
        : await adapter.post(target, body);
      this.#posts.set(key, { connectionId: live.record.connectionId, target, messageId, stopToken });
      return;
    }
    this.#posts.delete(key);
    this.#targets.delete(key);
    if (post?.stopToken) this.#stops.delete(post.stopToken);
    const placeholder = post?.messageId ?? null;
    const reaction =
      activity.type === "cancelled"
        ? "stopped"
        : activity.status === "completed"
          ? "done"
          : activity.status === "interrupted"
            ? "stopped"
            : "failed";
    // A follow-up turn answers a teammate's reply: the person's message already shows how its own turn ended.
    if (activity.type === "cancelled" || !activity.followUp) {
      await adapter.react(target, activity.origin.platformMessageId, "received", false).catch(() => undefined);
      await adapter.react(target, activity.origin.platformMessageId, reaction, true).catch(() => undefined);
    }
    if (activity.type === "cancelled" || activity.status === "interrupted") {
      await this.#say(adapter, target, placeholder, sourceText("status.messaging.stopped"));
      return;
    }
    if (activity.status === "failed") {
      // The provider's error can hold local paths or MCP values, so Slack gets a fixed sentence.
      await this.#say(adapter, target, placeholder, sourceText("status.messaging.failed"));
      return;
    }
    // Slack is outside this computer, so a secret in the answer must not reach it.
    if (activity.answer) await adapter.postAnswer(target, redactText(activity.answer), placeholder);
    // A turn that only asked a teammate has nothing to say yet: the answer comes back to this thread.
    else if (!activity.followUp && this.#threads.awaitsTeammate(activity.link.linkId))
      await this.#say(adapter, target, placeholder, sourceText("status.messaging.delegated"));
    else await this.#say(adapter, target, placeholder, sourceText("status.messaging.noAnswer"));
    if (activity.files.length) {
      const skipped = await adapter.upload(target, activity.files);
      if (skipped.length)
        await adapter.post(target, {
          text: sourceText("status.messaging.filesSkipped", { names: skipped.join(", ") }),
        });
    }
  }

  async #say(
    adapter: MessagingAdapter,
    target: MessageTarget,
    placeholder: string | null,
    text: string,
  ): Promise<void> {
    if (placeholder) await adapter.edit(target, placeholder, { text });
    else await adapter.post(target, { text });
  }

  /**
   * Keeps one status message per Slack conversation in step with the teammates that work on its
   * requests. Only labels go out: names, the start of the task, and a program, file or tool name.
   * A hand-off that had ended before this service saw it, such as after a restart, is not posted.
   */
  #handoffsChanged(agentId: string): void {
    const byLink = new Map<string, HandoffRecord[]>();
    for (const record of this.#agents.handoffRecords?.(agentId) ?? []) {
      if (!record.messagingReturn) continue;
      const records = byLink.get(record.messagingReturn.linkId) ?? [];
      records.push(record);
      byLink.set(record.messagingReturn.linkId, records);
    }
    for (const [linkId, records] of byLink) {
      const link = this.#threads.store.link(linkId);
      const live = link ? this.#live.get(link.connectionId) : undefined;
      if (!link || !live) continue;
      const running = records.filter((record) => !handoffEnded(record.handoff));
      let post = this.#handoffPosts.get(linkId);
      if (!post) {
        const first = running[0]?.messagingReturn;
        if (!first) continue;
        post = {
          connectionId: live.record.connectionId,
          target: this.#targets.get(`${linkId}:${first.platformMessageId}`) ?? linkTarget(link),
          messageId: null,
          shown: new Set(),
          text: "",
          sentText: null,
          lastSentAt: 0,
          timer: null,
          sending: false,
          finished: false,
        };
        this.#handoffPosts.set(linkId, post);
      }
      for (const record of running) post.shown.add(record.handoff.id);
      const shown = records.filter((record) => post.shown.has(record.handoff.id)).map((record) => record.handoff);
      post.text = this.#handoffText(shown);
      post.finished = shown.every(handoffEnded);
      this.#flushHandoffPost(linkId);
    }
  }

  #handoffText(handoffs: AgentHandoff[]): string {
    const names = new Map(this.#agents.listAgents().map((agent) => [agent.id, agent.name]));
    const lines = handoffs.flatMap((handoff) => {
      const agent = names.get(handoff.toAgentId) ?? handoff.toAgentId;
      const from = names.get(handoff.fromAgentId) ?? handoff.fromAgentId;
      return [
        sourceText("status.messaging.handoffTask", { from, agent, task: handoffTaskLine(handoff.task) }),
        handoffStateLine(handoff, agent),
      ];
    });
    // The hand-off view already redacted each part. Slack is outside this computer, so once more.
    return redactText(lines.join("\n"));
  }

  /** Posts or edits the status message, at most once per interval; later changes join the next edit. */
  #flushHandoffPost(linkId: string): void {
    const post = this.#handoffPosts.get(linkId);
    if (!post || post.timer || post.sending) return;
    if (post.text === post.sentText) {
      if (post.finished) this.#handoffPosts.delete(linkId);
      return;
    }
    const wait = post.lastSentAt + this.#handoffIntervalMs - Date.now();
    if (wait > 0) {
      post.timer = setTimeout(() => {
        post.timer = null;
        this.#flushHandoffPost(linkId);
      }, wait);
      post.timer.unref?.();
      return;
    }
    post.sending = true;
    const text = post.text;
    this.#serial(linkId, async () => {
      try {
        const adapter = this.#live.get(post.connectionId)?.adapter;
        if (!adapter) return;
        if (post.messageId) await adapter.edit(post.target, post.messageId, { text });
        else post.messageId = await adapter.post(post.target, { text });
      } finally {
        // Also after a failure: the next change tries again, and a failing edit is not repeated.
        post.sentText = text;
        post.lastSentAt = Date.now();
        post.sending = false;
        this.#flushHandoffPost(linkId);
      }
    });
  }

  #agentEvent(event: AgentEvent): void {
    if (event.type === "turn-started" || event.type === "turn-completed") this.#autoReplyTurn(event);
    if (event.type === "approval") void this.#approval(event.approval).catch((error) => this.#warn(error));
    else if (event.type === "agent-input-resolved" && event.kind === "approval")
      void this.#approvalResolved(event.requestId).catch((error) => this.#warn(error));
  }

  async #approval(approval: AgentApproval): Promise<void> {
    const link = this.#threads.store.linkForThread(approval.threadId);
    const live = link ? this.#live.get(link.connectionId) : undefined;
    if (!link || !live) return;
    const running = this.#threads.runningOrigin(link.linkId);
    const key = running ? `${link.linkId}:${running.origin.platformMessageId}` : null;
    const target = (key && this.#targets.get(key)) || (key && this.#posts.get(key)?.target) || linkTarget(link);
    const kind =
      approval.kind === "command"
        ? sourceText("status.messaging.approvalCommand")
        : approval.kind === "file-change"
          ? sourceText("status.messaging.approvalFileChange")
          : sourceText("status.messaging.approvalPermissions");
    const detail = redactText([approval.command, approval.cwd, approval.reason].filter(Boolean).join("\n"))
      .replace(MENTION_MARKERS, "")
      .slice(0, APPROVAL_TEXT_LIMIT);
    const text = [
      sourceText("status.messaging.approvalTitle"),
      `**${kind}**`,
      detail ? `\`\`\`\n${detail}\n\`\`\`` : "",
    ]
      .filter(Boolean)
      .join("\n");
    // Known before the post: a person can press a button before Slack's answer to the post arrives.
    await this.#postWithButtons(live, {
      kind: "agent",
      requestId: approval.requestId,
      connectionId: live.record.connectionId,
      target,
      messageId: null,
      allowedUserId: running?.origin.authorId ?? null,
      text,
      answered: false,
    });
  }

  /** Posts a request with Approve and Deny, and keeps it under both button tokens. */
  async #postWithButtons(live: LiveConnection, pending: PendingApproval): Promise<void> {
    const accept = token();
    const decline = token();
    this.#approvals.set(accept, pending);
    this.#approvals.set(decline, pending);
    // A draft is stored before its post, so a press that arrives before Slack's answer finds it too.
    if (pending.kind === "send")
      this.#threads.drafts.add({
        connectionId: pending.connectionId,
        acceptToken: accept,
        declineToken: decline,
        target: pending.target,
        messageId: null,
        allowedUserId: pending.allowedUserId,
        postText: pending.text,
        draft: pending.draft,
      });
    try {
      pending.messageId = await live.adapter.post(pending.target, {
        text: pending.text,
        buttons: [
          { action: "accept", label: sourceText("status.messaging.approve"), token: accept, style: "primary" },
          { action: "decline", label: sourceText("status.messaging.deny"), token: decline, style: "danger" },
        ],
      });
      if (pending.kind === "send" && pending.messageId && !pending.answered)
        this.#threads.drafts.setMessageId(pending.draft.draftId, pending.messageId);
    } catch (error) {
      this.#approvals.delete(accept);
      this.#approvals.delete(decline);
      if (pending.kind === "send") this.#threads.drafts.claim(pending.draft.draftId);
      throw error;
    }
  }

  /**
   * An agent asks to send a new message. It needs a Slack conversation, so the draft has a place to
   * ask for approval, and a workspace connected as a person, who is the only one allowed to approve.
   */
  async #requestSend(request: MessagingSendRequest): Promise<MessagingSendReceipt> {
    const link = this.#threads.store.linkForThread(request.threadId);
    if (!link) return request.ownerTurn ? this.#sendFromGoAhead(request) : this.#autoReplyFromApp(request);
    const live = this.#live.get(link.connectionId);
    if (!live?.identity) throw new Error(sourceText("error.messaging.notConnected"));
    const credentials = this.#credentials.get(link.connectionId);
    const approverId = credentials?.userId;
    if (!approverId) throw new Error(sourceText("error.messaging.sendNeedsUser"));
    const { to, text } = await this.#sendTarget(live, credentials, approverId, {
      ...request,
      to: await this.#namedTarget(live, request.to),
    });
    // A pause refuses at once, with no draft: the agent learns that nothing went out.
    const refused = this.#sendRefusal(live.record);
    if (refused) throw new Error(refused);
    const { adapter } = live;
    const running = this.#threads.runningOrigin(link.linkId);
    // Only the person's own request goes out as them. Anyone else's goes out as the GoAhead app.
    const ownRequest = running?.origin.authorId === approverId;
    // Even the person's own request waits for them when it goes to someone GoAhead never wrote to, or
    // in quiet hours: an agent that a message tricked must not reach a stranger as them.
    const quiet = inQuietHours(this.#guards.get(live.record.workspaceId).quietHours, new Date());
    const known = this.#threads.store.hasSentTo(live.record.connectionId, `${to.kind}:${to.id}`);
    // The person put the conversation on the auto-reply list: the message goes out as them with no
    // approval, whoever asked. Quiet hours still hold it as a draft.
    const autoReplyChannel = quiet ? null : await this.#autoReplyChannel(live, credentials.userToken, to);
    const autoReply = autoReplyChannel !== null;
    const sender: MessageSender = (ownRequest || autoReply) && credentials.userToken ? "user" : "bot";
    const draftId = randomUUID();
    const draft: SendDraft = {
      draftId,
      linkId: link.linkId,
      agentId: request.agentId,
      to,
      text,
      threadKey: request.threadKey,
      sender,
      recipient:
        to.kind === "channel"
          ? await adapter.placeName(to.id).catch(() => to.id)
          : (await Promise.all(slackTargetPeople(to).map((id) => adapter.authorName(id)))).join(", "),
      requestedBy: running?.origin.authorName ?? null,
      onBehalfOf: ownRequest || autoReply ? null : (running?.origin.authorName ?? null),
      createdAt: new Date().toISOString(),
    };
    if (autoReplyChannel !== null) {
      const sentLink = await this.#deliver(live, draft, approverId, "autoSent");
      this.#autoReplySent(live, autoReplyChannel);
      return { status: "sent", draftId, sender, approverId, link: sentLink, autoSent: true };
    }
    // The connected person asked for it themselves: their own request is their approval. Anyone
    // else's request, or a turn with no known author, waits for them to press Approve.
    if (ownRequest && known && !quiet) {
      const sentLink = await this.#deliver(live, draft, approverId);
      return { status: "sent", draftId, sender, approverId, link: sentLink };
    }
    const key = running ? `${link.linkId}:${running.origin.platformMessageId}` : null;
    const target = (key && this.#targets.get(key)) || (key && this.#posts.get(key)?.target) || linkTarget(link);
    const toLabel =
      to.kind === "channel"
        ? await adapter.placeName(to.id).catch(() => to.id)
        : slackTargetPeople(to)
            .map((id) => adapter.mention(id))
            .join(", ");
    const draftText = [
      sourceText("status.messaging.sendDraftTitle"),
      sourceText("status.messaging.sendDraftTo", { to: toLabel }),
      sender === "user"
        ? sourceText("status.messaging.sendAsUser", { user: adapter.mention(approverId) })
        : sourceText("status.messaging.sendAsBot"),
      `\`\`\`\n${redactText(text).slice(0, APPROVAL_TEXT_LIMIT)}\n\`\`\``,
    ].join("\n");
    await this.#postWithButtons(live, {
      kind: "send",
      connectionId: live.record.connectionId,
      target,
      messageId: null,
      allowedUserId: approverId,
      text: draftText,
      answered: false,
      draft,
    });
    this.#threads.notifyChanged(link.threadId);
    return { status: "waiting_for_approval", draftId, sender, approverId, link: null };
  }

  /** Who a send goes to, with the person left out, and its clean text. */
  async #sendTarget(
    live: LiveConnection,
    credentials: Record<string, string>,
    approverId: string,
    request: MessagingSendRequest,
  ): Promise<{ to: SlackSendTarget; text: string }> {
    const parsed = await this.#sendTargetPeople(live, credentials.userToken, parseSlackSendTarget(request.to));
    if (!parsed) throw new Error(sourceText("error.messaging.sendTargetInvalid"));
    // The user reads the conversation the agent answers in: a message to them is that answer. In a
    // group, the sender is always a member, so naming them changes nothing.
    const others = slackTargetPeople(parsed).filter((id) => id !== approverId);
    if (parsed.kind !== "channel" && others.length === 0) throw new Error(sourceText("error.messaging.sendToSelf"));
    const to: SlackSendTarget =
      parsed.kind === "channel"
        ? parsed
        : others.length === 1
          ? { kind: "user", id: others[0] ?? "" }
          : { kind: "group", id: others.join(",") };
    const text = request.text.replace(MENTION_MARKERS, "").trim().slice(0, INPUT_LIMITS.messageText);
    if (!text) throw new Error(sourceText("error.messaging.sendTextEmpty"));
    return { to, text };
  }

  /**
   * A send from the orchestrator's own conversation in the app, which has no Slack conversation for
   * a draft. Only an auto-reply turn that GoAhead started may send from there, and only to the
   * conversation it is about, while that conversation is still on the auto-reply list. Anything else
   * is refused as before.
   */
  async #autoReplyFromApp(request: MessagingSendRequest): Promise<MessagingSendReceipt> {
    const live = [...this.#live.values()].find(
      (candidate) =>
        candidate.record.platform === "slack" &&
        candidate.record.orchestratorAgentId === request.agentId &&
        [...this.#autoReplyWaits.values()].some(
          (wait) => wait.connectionId === candidate.record.connectionId && wait.running?.agentId === request.agentId,
        ),
    );
    if (!live?.identity) throw new Error(sourceText("error.messaging.sendNeedsSlack"));
    const connectionId = live.record.connectionId;
    const credentials = this.#credentials.get(connectionId);
    const approverId = credentials?.userId;
    if (!approverId || !credentials.userToken) throw new Error(sourceText("error.messaging.sendNeedsUser"));
    const { to, text } = await this.#sendTarget(live, credentials, approverId, request);
    const channelId =
      to.kind === "channel" ? to.id : await live.adapter.openDirectMessage?.(to.id, "user").catch(() => undefined);
    if (
      !channelId ||
      !this.#runningAutoReply(request.agentId, connectionId, channelId) ||
      !this.#threads.autoReply.isOn(connectionId, channelId)
    )
      throw new Error(sourceText("error.messaging.sendNeedsSlack"));
    // A pause or quiet hours refuse at once: with no Slack conversation, no draft can wait.
    const blocked = this.#sendBlock(live.record);
    if (blocked) throw new Error(blocked);
    const recipient =
      to.kind === "channel"
        ? await live.adapter.placeName(to.id).catch(() => to.id)
        : (await Promise.all(slackTargetPeople(to).map((id) => live.adapter.authorName(id)))).join(", ");
    const draftId = randomUUID();
    const draft: DeliveryDraft = {
      draftId,
      linkId: null,
      agentId: request.agentId,
      to,
      text,
      threadKey: request.threadKey,
      sender: "user",
      recipient,
      requestedBy: null,
      onBehalfOf: null,
      createdAt: new Date().toISOString(),
    };
    const sentLink = await this.#deliver(live, draft, approverId, "autoSent");
    this.#autoReplySent(live, channelId);
    return { status: "sent", draftId, sender: "user", approverId, link: sentLink, autoSent: true };
  }

  /**
   * The person asked the orchestrator in GoAhead, in its own conversation or through another agent's
   * hand-off: the message goes out as them, at once, as if they sent it in Slack. A pause refuses.
   * Quiet hours refuse too: with no Slack conversation, there is no place for a draft to wait.
   */
  async #sendFromGoAhead(request: MessagingSendRequest): Promise<MessagingSendReceipt> {
    const owned = [...this.#live.values()].filter(
      (candidate) =>
        candidate.record.platform === "slack" &&
        candidate.record.orchestratorAgentId === request.agentId &&
        candidate.identity !== null,
    );
    if (owned.length === 0) throw new Error(this.#notOrchestratorError());
    const asUser = owned.filter((candidate) => {
      const credentials = this.#credentials.get(candidate.record.connectionId);
      return Boolean(credentials?.userId && credentials.userToken);
    });
    const [only] = asUser;
    if (!only) throw new Error(sourceText("error.messaging.sendNeedsUser"));
    const chosen = asUser.length === 1 ? { live: only, to: await this.#namedTarget(only, request.to) } : null;
    const { live, to: target } = chosen ?? (await this.#workspaceOfTarget(asUser, request));
    const credentials = this.#credentials.get(live.record.connectionId) ?? {};
    const approverId = credentials.userId ?? "";
    const refused = this.#sendRefusal(live.record);
    if (refused) throw new Error(refused);
    const quietHours = this.#guards.get(live.record.workspaceId).quietHours;
    if (quietHours && inQuietHours(quietHours, new Date()))
      throw new Error(sourceText("error.messaging.sendQuietHoursNoDraft", { time: quietHours.end }));
    const mentions = await this.#textMentions(live, request.text);
    const { to, text } = await this.#sendTarget(live, credentials, approverId, {
      ...request,
      to: target,
      text: mentions.text,
    });
    const recipient = await this.#recipientName(live, to);
    const draftId = randomUUID();
    const draft: DeliveryDraft = {
      draftId,
      linkId: null,
      agentId: request.agentId,
      to,
      text,
      threadKey: request.threadKey,
      sender: "user",
      recipient,
      requestedBy: null,
      onBehalfOf: null,
      createdAt: new Date().toISOString(),
    };
    const sentLink = await this.#deliver(live, draft, approverId, "fromGoAhead");
    return {
      status: "sent",
      draftId,
      sender: "user",
      approverId,
      link: sentLink,
      fromGoAhead: true,
      recipient,
      ...(mentions.ambiguous.length > 0 ? { ambiguousMentions: mentions.ambiguous } : {}),
    };
  }

  /**
   * The one workspace, of several that the agent orchestrates, that knows every person or the
   * channel of the target. Slack ids do not name their workspace, so a lookup decides. Any doubt refuses.
   */
  async #workspaceOfTarget(
    candidates: LiveConnection[],
    request: MessagingSendRequest,
  ): Promise<{ live: LiveConnection; to: string }> {
    const known = await Promise.all(
      candidates.map(async (live) => {
        const credentials = this.#credentials.get(live.record.connectionId) ?? {};
        try {
          const target = await this.#namedTarget(live, request.to);
          const { to } = await this.#sendTarget(live, credentials, credentials.userId ?? "", {
            ...request,
            to: target,
          });
          const ids = to.kind === "channel" ? [to.id] : slackTargetPeople(to);
          const names = await Promise.all(
            ids.map((id) => (to.kind === "channel" ? live.adapter.placeName(id) : live.adapter.authorName(id))),
          );
          return names.every((name, index) => name !== ids[index]) ? { live, to: target } : null;
        } catch {
          return null;
        }
      }),
    );
    const matches = known.filter((match) => match !== null);
    const [match] = matches;
    if (matches.length !== 1 || !match) throw new Error(sourceText("error.messaging.sendWorkspaceUnclear"));
    return match;
  }

  /**
   * A person or channel that the agent names, such as "Harsh Patel" or "#general", becomes its id:
   * people from the workspace's member list, read from Slack, channels from the person's conversation
   * list. A target that is already an id stays. No match, or several, refuses with the names.
   */
  async #namedTarget(live: LiveConnection, to: string): Promise<string> {
    if (parseSlackSendTarget(to)) return to;
    const trimmed = to.trim();
    if (trimmed.startsWith("#")) return `<#${await this.#namedChannel(live, trimmed.slice(1).trim())}>`;
    const name = trimmed.replace(/^@/u, "").trim();
    if (!name || !live.adapter.findPeople) throw new Error(sourceText("error.messaging.sendTargetInvalid"));
    const people = await live.adapter.findPeople(name);
    const [person] = people;
    if (!person) throw new Error(sourceText("error.messaging.sendNameUnknown", { name }));
    if (people.length > 1)
      throw new Error(
        sourceText("error.messaging.sendNameAmbiguous", {
          name,
          people: people.map((match) => (match.title ? `${match.name} (${match.title})` : match.name)).join(", "),
        }),
      );
    return `<@${person.id}>`;
  }

  /** The one channel of the person's conversation list with this name. The list is read again on a miss. */
  async #namedChannel(live: LiveConnection, name: string): Promise<string> {
    const connectionId = live.record.connectionId;
    const needle = name.toLowerCase();
    const matches = () =>
      this.#threads.inbox.cache
        .conversations(connectionId)
        .filter((conversation) => conversation.name && conversation.name.toLowerCase() === needle);
    let found = matches();
    if (found.length === 0) {
      await this.#slackSync.refreshConversations(connectionId, "visible");
      found = matches();
    }
    const [channel] = found;
    if (!channel) throw new Error(sourceText("error.messaging.sendChannelUnknown", { name }));
    if (found.length > 1)
      throw new Error(sourceText("error.messaging.sendNameAmbiguous", { name, people: `#${name}` }));
    return channel.channelId;
  }

  /**
   * Turns `@Name` in the text into a real mention, `<@U…>`, when exactly one person of the workspace
   * has that name. Up to four words after `@` are tried, longest first. A name that several people
   * share stays as written, and is returned so the agent can tell the person.
   */
  async #textMentions(live: LiveConnection, text: string): Promise<{ text: string; ambiguous: string[] }> {
    const find = live.adapter.findPeople?.bind(live.adapter);
    if (!find) return { text, ambiguous: [] };
    const ambiguous: string[] = [];
    let result = "";
    let rest = text;
    for (let at = rest.search(TEXT_MENTION); at >= 0; at = rest.search(TEXT_MENTION)) {
      const start = at + (rest[at] === "@" ? 0 : 1);
      result += rest.slice(0, start);
      const words = rest
        .slice(start + 1)
        .split(/(\s+)/u)
        .slice(0, 7);
      let replaced = false;
      for (let count = 4; count >= 1 && !replaced; count -= 1) {
        const phrase = words.slice(0, count * 2 - 1).join("");
        const name = phrase.replace(/[,.:;!?)]+$/u, "");
        if (!name || words.length < count * 2 - 1) continue;
        const people = await find(name);
        if (people.length === 0) continue;
        const [person] = people;
        if (people.length === 1 && person) {
          result += `<@${person.id}>`;
          rest = rest.slice(start + 1 + name.length);
        } else {
          ambiguous.push(name);
          result += `@${name}`;
          rest = rest.slice(start + 1 + name.length);
        }
        replaced = true;
      }
      if (!replaced) {
        result += "@";
        rest = rest.slice(start + 1);
      }
    }
    return { text: result + rest, ambiguous };
  }

  /**
   * The send error for an agent that is not the orchestrator of a live workspace. In the person's own
   * request, it names the orchestrator, so the agent hands the message on instead of giving up.
   */
  #notOrchestratorError(): string {
    const orchestrator = [...this.#live.values()]
      .map((live) => live.record.orchestratorAgentId)
      .map((id) => this.#agents.listAgents().find((agent) => agent.id === id))
      .find((agent) => agent !== undefined);
    return orchestrator
      ? sourceText("error.messaging.sendUseOrchestrator", { name: orchestrator.name, agentId: orchestrator.id })
      : sourceText("error.messaging.sendNeedsSlack");
  }

  /** The name of a send target for the agent and the desktop: a channel name, or the people's names. */
  async #recipientName(live: LiveConnection, to: SlackSendTarget): Promise<string> {
    return to.kind === "channel"
      ? await live.adapter.placeName(to.id).catch(() => to.id)
      : (await Promise.all(slackTargetPeople(to).map((id) => live.adapter.authorName(id)))).join(", ");
  }

  /**
   * A direct or group direct message that an agent names by its conversation id becomes its people:
   * the bot is not in the person's own direct messages, so only a send to the people reaches them.
   * Without the person's token, a target stays as the agent named it.
   */
  async #sendTargetPeople(
    live: LiveConnection,
    userToken: string | undefined,
    parsed: SlackSendTarget | null,
  ): Promise<SlackSendTarget | null> {
    if (parsed?.kind !== "channel" || !userToken || !live.adapter.conversationPeople) return parsed;
    const people = [...new Set(await live.adapter.conversationPeople(parsed.id))].sort();
    if (people.length === 0) {
      if (parsed.id.startsWith("D")) throw new Error(sourceText("error.messaging.sendDirectNeedsUser"));
      return parsed;
    }
    return people.length === 1 ? { kind: "user", id: people[0] ?? "" } : { kind: "group", id: people.join(",") };
  }

  /**
   * The conversation that a send goes to, when it is on the person's auto-reply list; else null. A
   * direct or group direct message is the person's own conversation with those people. Any doubt is
   * null, so the send waits for approval.
   */
  async #autoReplyChannel(
    live: LiveConnection,
    userToken: string | undefined,
    to: SlackSendTarget,
  ): Promise<string | null> {
    const connectionId = live.record.connectionId;
    if (!userToken || !this.#threads.autoReply.hasAny(connectionId)) return null;
    const channelId =
      to.kind === "channel" ? to.id : await live.adapter.openDirectMessage?.(to.id, "user").catch(() => undefined);
    return channelId && this.#threads.autoReply.isOn(connectionId, channelId) ? channelId : null;
  }

  /** Sends a draft once and records it. Returns the link to the sent message, when Slack gives one. */
  async #deliver(
    live: LiveConnection,
    draft: DeliveryDraft,
    approvedBy: string,
    mark: "autoSent" | "fromGoAhead" | null = null,
  ): Promise<string | null> {
    // The last check, right before the post: a pause set a moment ago stops this send too.
    const blocked = this.#sendBlock(live.record);
    if (blocked) throw new Error(blocked);
    const { adapter } = live;
    if (!adapter.postAs) throw new Error(sourceText("error.messaging.unsupported"));
    const channel =
      draft.to.kind === "channel" ? draft.to.id : await adapter.openDirectMessage?.(draft.to.id, draft.sender);
    if (!channel) throw new Error(sourceText("error.messaging.unsupported"));
    const text = draft.onBehalfOf
      ? `${sourceText("status.messaging.sentFor", { name: draft.onBehalfOf })}\n${draft.text}`
      : draft.text;
    const messageId = await adapter.postAs(
      { platformChannelId: channel, replyThreadId: draft.threadKey },
      text,
      draft.sender,
      // The person asked in GoAhead for this message: its user mentions ping, as their own would.
      { keepMentions: mark === "fromGoAhead" },
    );
    const link = (await adapter.permalink?.(channel, messageId)) ?? null;
    this.#threads.store.recordSend({
      draftId: draft.draftId,
      connectionId: live.record.connectionId,
      linkId: draft.linkId,
      agentId: draft.agentId,
      approvedBy,
      approvedAt: new Date().toISOString(),
      sender: draft.sender,
      to: `${draft.to.kind}:${draft.to.id}`,
      platformChannelId: channel,
      platformMessageId: messageId,
      text,
      link,
      ...(mark === "autoSent" ? { autoSent: true as const } : {}),
      ...(mark === "fromGoAhead" ? { fromGoAhead: true as const } : {}),
    });
    return link;
  }

  /** Sends an approved draft once, and returns the line that replaces the buttons. */
  async #sendDraft(live: LiveConnection, pending: PendingSend, approvedBy: string): Promise<string> {
    try {
      const link = await this.#deliver(live, pending.draft, approvedBy);
      const sent = sourceText("status.messaging.sent", { user: live.adapter.mention(approvedBy) });
      return link ? `${sent}\n${link}` : sent;
    } catch (error) {
      this.#warn(error);
      return sourceText("status.messaging.sendFailed", {
        reason: redactText(error instanceof Error ? error.message : String(error)),
      });
    }
  }

  async #approvalResolved(requestId: string | number): Promise<void> {
    const entries = [...this.#approvals.entries()].filter(
      ([, pending]) => pending.kind === "agent" && pending.requestId === requestId,
    );
    const pending = entries[0]?.[1];
    for (const [key] of entries) this.#approvals.delete(key);
    if (!pending || pending.answered) return;
    const live = this.#live.get(pending.connectionId);
    if (!pending.messageId) return;
    await live?.adapter.edit(pending.target, pending.messageId, {
      text: `${pending.text}\n${sourceText("status.messaging.answeredOnHost")}`,
    });
  }

  async #action(live: LiveConnection, action: InboundAction): Promise<void> {
    const { adapter } = live;
    if (action.type === "stop") {
      const stop = this.#stops.get(action.token);
      if (!stop || stop.connectionId !== live.record.connectionId) return;
      if (action.actorId !== stop.authorId) {
        await adapter.postPrivate(
          action.target,
          action.actorId,
          sourceText("status.messaging.onlyRequester", { user: adapter.mention(stop.authorId) }),
        );
        return;
      }
      await this.#threads.stop(stop.linkId, stop.authorId);
      return;
    }
    const pending = this.#approvals.get(action.token);
    // A second press while the first one still runs must not send or answer twice.
    if (!pending || pending.connectionId !== live.record.connectionId || pending.answered) {
      await adapter
        .edit(action.target, action.platformMessageId, { text: sourceText("status.messaging.requestInactive") })
        .catch(() => undefined);
      return;
    }
    if (!pending.allowedUserId || action.actorId !== pending.allowedUserId) {
      await adapter.postPrivate(
        action.target,
        action.actorId,
        pending.allowedUserId
          ? sourceText("status.messaging.onlyRequester", { user: adapter.mention(pending.allowedUserId) })
          : sourceText("status.messaging.hostOnly"),
      );
      return;
    }
    // An approval that cannot send now leaves the draft waiting; a denial always counts.
    const blocked = pending.kind === "send" && action.decision === "accept" ? this.#sendBlock(live.record) : null;
    if (blocked) {
      await adapter.postPrivate(action.target, action.actorId, blocked);
      return;
    }
    await this.#finishApproval(live, pending, action.decision, action.actorId, action.platformMessageId);
  }

  /** Why no send can go out now: the pause. Quiet hours turn sends into drafts. Sends have no count limit. */
  #sendRefusal(record: MessagingConnectionRecord): string | null {
    return this.#guards.get(record.workspaceId).paused ? sourceText("error.messaging.sendPaused") : null;
  }

  /** Why a message cannot be sent now, approved or not. */
  #sendBlock(record: MessagingConnectionRecord): string | null {
    const refused = this.#sendRefusal(record);
    if (refused) return refused;
    const quietHours = this.#guards.get(record.workspaceId).quietHours;
    return quietHours && inQuietHours(quietHours, new Date())
      ? sourceText("error.messaging.sendQuietHours", { time: quietHours.end })
      : null;
  }

  /**
   * Answers one approval once, from a Slack button or the desktop, and shows the result in place of
   * the buttons. `answered` is set before any await, so a second answer finds it taken.
   */
  async #finishApproval(
    live: LiveConnection,
    pending: PendingApproval,
    decision: "accept" | "decline",
    actorId: string,
    pressedMessageId: string | null,
  ): Promise<void> {
    const { adapter } = live;
    // A stored draft is taken from the database first: if its row is gone, another answer, before or
    // after a restart, already took it, and it must not be sent again.
    const claimed = pending.kind !== "send" || this.#threads.drafts.claim(pending.draft.draftId);
    pending.answered = true;
    let outcome: string;
    if (pending.kind === "send") {
      outcome = !claimed
        ? sourceText("status.messaging.requestInactive")
        : decision === "accept"
          ? await this.#sendDraft(live, pending, actorId)
          : sourceText("status.messaging.deniedBy", { user: adapter.mention(actorId) });
    } else {
      try {
        await this.#agents.respondToApproval({ requestId: pending.requestId, decision });
        outcome = sourceText(decision === "accept" ? "status.messaging.approvedBy" : "status.messaging.deniedBy", {
          user: adapter.mention(actorId),
        });
      } catch {
        outcome = sourceText("status.messaging.requestInactive");
      }
    }
    for (const [key, candidate] of this.#approvals) if (candidate === pending) this.#approvals.delete(key);
    if (pending.kind === "send") {
      const link = this.#threads.store.link(pending.draft.linkId);
      if (link) this.#threads.notifyChanged(link.threadId);
    }
    const messageId = pending.messageId ?? pressedMessageId;
    if (messageId) await adapter.edit(pending.target, messageId, { text: `${pending.text}\n${outcome}` });
  }

  // Helpers.

  /**
   * Runs the posts of one conversation in order. A turn can start and end while the post that
   * announced it is still on its way, and the answer must replace that post, not race it.
   */
  #serial(linkId: string, task: () => Promise<void>): void {
    const next = (this.#chains.get(linkId) ?? Promise.resolve())
      .then(task)
      .catch((error) => this.#warn(error))
      .finally(() => {
        if (this.#chains.get(linkId) === next) this.#chains.delete(linkId);
      });
    this.#chains.set(linkId, next);
  }

  #requireConnection(workspaceId: string): MessagingConnectionRecord {
    const record = this.#threads.store.connectionForWorkspace("slack", workspaceId);
    if (!record) throw new Error(sourceText("error.messaging.notConnected"));
    return record;
  }

  #requireRouting(): SlackRoutingPort {
    if (!this.#routing) throw new Error(sourceText("error.messaging.unsupported"));
    return this.#routing;
  }

  #requireConnect(): SlackConnect {
    if (!this.#connect) throw new Error(sourceText("error.messaging.unsupported"));
    return this.#connect;
  }

  #warn(error: unknown): void {
    // Only the kind of failure and the platform's error code: a Slack error message can quote
    // message text, and its code cannot.
    const code = isDynamicRecord(error) && isString(error.code) ? error.code : undefined;
    logger.warn("A messaging action failed.", {
      error: error instanceof Error ? error.name : "unknown",
      ...(code ? { code } : {}),
    });
  }
}

/** The conversation id that an agent names: an id, a channel link, or a picked channel's name. */
function inboxConversation(value: string, watched: Array<{ platformChannelId: string; name: string }>): string | null {
  const trimmed = value.trim();
  const link = /^<#([A-Z0-9]+)(?:\|[^>]*)?>$/u.exec(trimmed)?.[1];
  if (link) return link;
  // Only looked up in the local inbox, so a stricter id check would protect nothing.
  if (/^[A-Z0-9][A-Z0-9-]{1,63}$/u.test(trimmed)) return trimmed;
  const name = trimmed.replace(/^#/u, "").toLowerCase();
  return watched.find((channel) => channel.name.replace(/^#/u, "").toLowerCase() === name)?.platformChannelId ?? null;
}

/** Where to answer when the message that started the work is not known: the conversation's thread. */
/** Marks a message that an agent sent as the person with no approval. */
function markAutoSent(message: SlackClientMessage, autoSent: ReadonlySet<string>): SlackClientMessage {
  return autoSent.has(message.ts) ? { ...message, autoSent: true } : message;
}

function linkTarget(link: MessagingLink): MessageTarget {
  return {
    platformChannelId: link.platformChannelId,
    // A person's direct message conversation is not one Slack thread: answer in the direct message.
    replyThreadId: link.threadKey === DIRECT_CONVERSATION_KEY ? null : link.threadKey,
  };
}

/** The first line of a task, short enough for one status line. */
function handoffTaskLine(task: string): string {
  const line =
    task
      .split("\n")
      .find((candidate) => candidate.trim())
      ?.trim() ?? "";
  return line.length > HANDOFF_TASK_CHARACTERS ? `${line.slice(0, HANDOFF_TASK_CHARACTERS - 1)}…` : line;
}

function handoffEnded(handoff: AgentHandoff): boolean {
  return handoff.status === "done" || handoff.status === "failed";
}

function handoffStateLine(handoff: AgentHandoff, agent: string): string {
  if (handoff.status === "queued") return sourceText("status.messaging.handoffQueued", { agent });
  if (handoff.status === "done") return sourceText("status.messaging.handoffDone", { agent });
  if (handoff.status === "failed") return sourceText("status.messaging.handoffFailed", { agent });
  const step = handoff.steps.at(-1);
  if (!step) return sourceText("status.messaging.handoffThinking", { agent });
  switch (step.kind) {
    case "command":
      return sourceText("status.messaging.handoffRunning", { agent, name: step.name });
    case "edit":
      return sourceText("status.messaging.handoffEditing", { agent, name: step.name });
    case "search":
      return sourceText("status.messaging.handoffSearching", { agent });
    default:
      return sourceText("status.messaging.handoffUsing", { agent, name: step.name });
  }
}

function token(): string {
  return randomBytes(16).toString("hex");
}

/**
 * The user and channel ids and the emoji names that inbox texts name, in Slack's markup or in the
 * plain form older rows keep (`@U…`). Code is not read: Slack does not render markup inside it.
 */
function inboxReferences(texts: readonly string[]): { users: Set<string>; channels: Set<string>; emoji: Set<string> } {
  const references = { users: new Set<string>(), channels: new Set<string>(), emoji: new Set<string>() };
  for (const text of texts) {
    const outsideCode = text.replace(/```[\s\S]*?```|`[^`\n]*`/gu, " ");
    for (const match of outsideCode.matchAll(
      /<@([UWB][A-Z0-9]+)(?:\|[^>]*)?>|(?<![\p{L}\p{N}])@([UW][A-Z0-9]{6,})(?![A-Za-z0-9])/gu,
    )) {
      const id = match[1] ?? match[2];
      if (id) references.users.add(id);
    }
    for (const match of outsideCode.matchAll(
      /<#([CGD][A-Z0-9]+)(?:\|[^>]*)?>|(?<![\p{L}\p{N}])#([CG][A-Z0-9]{6,})(?![A-Za-z0-9])/gu,
    )) {
      const id = match[1] ?? match[2];
      if (id) references.channels.add(id);
    }
    for (const match of outsideCode.matchAll(/:([a-z0-9_+'-]+):/gu)) if (match[1]) references.emoji.add(match[1]);
  }
  return references;
}

/** A file for the desktop. Only an image gets a preview, served by main from its own cache. */
function inboxFileView(workspaceId: string, file: InboxFile): MessagingInboxFile {
  return {
    id: file.id,
    name: file.name.slice(0, MESSAGING_LIMITS.name * 2),
    mimeType: file.mimeType.slice(0, 255),
    size: file.size,
    previewUrl: isInboxImage(file.mimeType)
      ? `openbot-attachment://slack/${encodeURIComponent(workspaceId)}/${encodeURIComponent(file.id)}`
      : null,
    permalink: file.permalink?.startsWith("https://") ? file.permalink : null,
  };
}
