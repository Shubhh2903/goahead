import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { DISCORD_ORCHESTRATOR_AVATAR } from "@openbot/contracts/discord-app";
import { ATTACHMENT_LIMITS, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AddMessagingOrchestratorInput,
  AddTelegramOrchestratorInput,
  AgentApproval,
  AgentEvent,
  AgentHandoff,
  AgentSummary,
  AskOrchestratorAboutInboxInput,
  AskOrchestratorAboutInboxResult,
  ConnectTelegramChatInput,
  DiscordAccess,
  DiscordRoleList,
  MessagingConnection,
  MessagingConnectionState,
  MessagingConnectPage,
  MessagingCredentialState,
  MessagingDraft,
  MessagingInboxFile,
  MessagingInboxPage,
  MessagingInboxWorkspace,
  MessagingOverview,
  MessagingPlatform,
  MessagingThreadSummary,
  RespondToApprovalInput,
  SendInboxReplyInput,
  SetDiscordAccessInput,
  SidebarLayoutSnapshot,
  SidebarSection,
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
  SlackRoutingStatus,
  StartWhatsAppLinkInput,
  WhatsAppLinkState,
  WhatsAppOverview,
  WhatsAppSender,
} from "@openbot/contracts/ipc";
import {
  type ConversationSlackAsk,
  isLocalOnlyApprovalRequestId,
  MESSAGING_CONNECTION_STATES,
  MESSAGING_LIMITS,
  SLACK_ASK_PLACE_LIMIT,
  SLACK_ASK_TEXT_LIMIT,
  SLACK_ASK_TRIGGER_LIMIT,
  type SlackAskKind,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import type { DiscordEmbed } from "@openbot/contracts/signal-protocol/discord-api";
import { TELEGRAM_LINK_CODE_TTL_SECONDS } from "@openbot/contracts/signal-protocol/telegram-route";
import { SLACK_ORCHESTRATOR_AVATAR } from "@openbot/contracts/slack-app";
import { TELEGRAM_ORCHESTRATOR_AVATAR } from "@openbot/contracts/telegram-app";
import { WHATSAPP_ORCHESTRATOR_AVATAR } from "@openbot/contracts/whatsapp-app";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactPostText, redactText } from "@openbot/logging";
import { Deferred, Effect, Exit, Result, Schedule, Schema, Scope } from "effect";
import type { HandoffRecord } from "../agent/handoff-activity";
import type { AgentLifecycleFailed } from "../agent-service";
import { causeHelpers, runCauseEffect } from "../effect-boundary";
import type { MessagingOrigin } from "../mailbox-store";
import type { SidebarLayoutStore } from "../sidebar-layout-store";
import { type DiscordAppPort, DiscordConnect, type DiscordConnectFailed } from "./discord/discord-connect";
import { discordOrchestratorMemories, discordOrchestratorProfile } from "./discord/discord-orchestrator";
import { MessagingAutoReplyLoop } from "./messaging-auto-reply-loop";
import { type AutoReplyRoute, autoReplyRouteAccepts } from "./messaging-auto-reply-route";
import type { SendDraft } from "./messaging-draft-store";
import { MessagingHiddenThreadStore } from "./messaging-hidden-threads";
import { matchesHistoryFilter } from "./messaging-history-store";
import { type InboxImage, isInboxImage, MessagingInboxFiles } from "./messaging-inbox-files";
import type { InboxKind } from "./messaging-inbox-store";
import { mentionNames, withMentionNames } from "./messaging-mentions";
import { projectMapInstruction, QUIET_ANSWER } from "./messaging-prompt";
import { SLACK_INBOX_UNTRUSTED_NOTE } from "./messaging-read-tools";
import { inQuietHours, MessagingSendGuardStore, type QuietHours, SEND_COUNT_WINDOW_MS } from "./messaging-send-guards";
import { parseSlackSendTarget, type SlackSendTarget, slackTargetPeople } from "./messaging-send-tool";
import { MessagingStatusPosts, type PendingFinal, type StatusPost, type StopButton } from "./messaging-status-posts";
import type { MessagingConnectionRecord, MessagingLink } from "./messaging-store";
import type {
  MessagingInboxRequest,
  MessagingInboxResult,
  MessagingSendReceipt,
  MessagingSendRequest,
  ReplyContextCursor,
  ReplyContextTurn,
} from "./messaging-threads";
import {
  MESSAGING_NOT_RUNNING,
  type MessagingActivity,
  type MessagingAnswerFile,
  type MessagingDiscordSend,
  type MessagingHistory,
  type MessagingHistoryScope,
  type MessagingSlackSend,
  type MessagingTelegramSend,
  type MessagingThreads,
} from "./messaging-threads";
import {
  CANCEL_TEXT,
  type ConnectionIdentity,
  DIRECT_CONVERSATION_KEY,
  DiscordApiError,
  type HistoryEvent,
  type HistoryFilter,
  type InboundAction,
  type InboundFile,
  type InboundMessage,
  type InboxCandidate,
  type InboxFile,
  type IngressAnswer,
  type IngressDelivery,
  type IngressState,
  type MessageSender,
  type MessageTarget,
  type MessagingAdapter,
  type MessagingAdapterError,
  MessagingConnectionError,
  type MessagingDriver,
  type MessagingIngress,
  type MessagingTransport,
  type RecentMessages,
  type StatusReaction,
  TelegramCallError,
  WhatsAppAnswerPartlySent,
  WhatsAppRefusedError,
} from "./messaging-types";
import { type SlackAppPort, SlackConnect, type SlackConnectFailed } from "./slack/slack-connect";
import {
  slackOrchestratorMemories,
  slackOrchestratorProfile,
  upgradeSlackOrchestratorDescription,
} from "./slack/slack-orchestrator";
import { slackPingedUsers } from "./slack/slack-render";
import { SlackApiError, SlackWebApi } from "./slack/slack-web-api";
import { SlackClientActions, type SlackClientUploadAction } from "./slack-client/actions";
import { applySlackClientEvent } from "./slack-client/events";
import { SlackRequestQueue } from "./slack-client/request-queue";
import { SlackClientSync } from "./slack-client/sync-service";
import { type TelegramAppPort, telegramLinkUrl } from "./telegram/telegram-connect";
import { telegramOrchestratorMemories, telegramOrchestratorProfile } from "./telegram/telegram-orchestrator";
import { parseTelegramUpdate, telegramLink, telegramRemoval } from "./telegram/telegram-updates";
import { WHATSAPP_HISTORY_KEEP_MS } from "./whatsapp/whatsapp-archive";
import { WhatsAppConnect } from "./whatsapp/whatsapp-connect";
import { whatsAppOrchestratorMemories, whatsAppOrchestratorProfile } from "./whatsapp/whatsapp-orchestrator";
import type { WhatsAppRuntime } from "./whatsapp/whatsapp-runtime";

const logger = createOpenBotLogger("messaging");

export interface MessagingCredentials {
  keys(): string[];
  status(connectionId: string): MessagingCredentialState;
  get(connectionId: string): Record<string, string> | null;
  set(connectionId: string, values: Record<string, string>): Effect.Effect<void, MessagingOperationFailed>;
  clear(connectionId: string): Effect.Effect<void, MessagingOperationFailed>;
  retain(connectionIds: ReadonlySet<string>): Effect.Effect<void, MessagingOperationFailed>;
}

export interface MessagingAgents {
  listAgents(): AgentSummary[];
  respondToApproval(input: RespondToApprovalInput): Effect.Effect<void, AgentLifecycleFailed>;
  approvalExecutionThreadId(requestId: string | number): string | undefined;
  onEvent(listener: (event: AgentEvent) => void): () => void;
  createAgentProfile(
    input: Pick<AddMessagingOrchestratorInput, "provider" | "model" | "reasoningEffort"> & {
      name: string;
      title: string;
      description: string;
      avatarSeed: string;
      avatarHue: AgentSummary["avatarHue"];
      startOnRunnableProvider: boolean;
    },
  ): Effect.Effect<AgentSummary, AgentLifecycleFailed>;
  createMemory(input: { agentId: string; text: string }): unknown;
  ensureDeletable(agentId: string): Effect.Effect<void, AgentLifecycleFailed>;
  deleteAgent(agentId: string): Effect.Effect<void, AgentLifecycleFailed>;
  sidebarChatIds(): ReadonlySet<string>;
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
  /**
   * A card in the agent's own conversation that starts no turn, such as a paused auto-reply. Without
   * it, such a notice is only logged.
   */
  postNotice?(input: { agentId: string; text: string; slackAsk: ConversationSlackAsk }): Promise<unknown>;
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
  downloadsRoot: string;
  /**
   * A private folder for what the inbox knows about files that Slack messages shared, and their
   * cached image bytes. Without it the inbox shows no files.
   */
  inboxFilesRoot?: string;
  /** The Signal relay of the OpenBot Slack app. Without it and `slackApp`, no workspace can connect. */
  ingress?: MessagingIngress;
  slackApp?: SlackAppPort;
  discordApp?: DiscordAppPort;
  slackOrigin?: string;
  telegramApp?: TelegramAppPort;
  whatsapp?: WhatsAppRuntime;
  sidebar?: Pick<SidebarLayoutStore, "getSnapshot" | "mutate" | "removeAgent">;
  statusPath?: string;
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
  /**
   * `route` is where the turn runs: a send or a turn event is the turn's only from that thread, and
   * none is while it is pending. `readMark` is what the turn read; only a completed turn or an
   * auto-sent reply writes it to the reply context.
   */
  running: {
    agentId: string;
    route: AutoReplyRoute;
    readMark: ReplyContextCursor | null;
    turnId: string | null;
    cancelLimit: () => void;
  } | null;
  /** A message arrived while the turn ran: one more turn follows it. */
  again: boolean;
}

interface LiveConnection {
  record: MessagingConnectionRecord;
  adapter: MessagingAdapter;
  transport: MessagingTransport | null;
  identity: ConnectionIdentity | null;
  state: MessagingConnectionState;
  reported: MessagingConnectionState;
  retryAt: string | null;
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

interface PendingApproval {
  requestId: string | number;
  connectionId: string;
  target: MessageTarget;
  messageId: string | null;
  /** The only Slack user who may press. Null when it is not known, then only the host answers. */
  allowedUserId: string | null;
  text: string;
  answered: boolean;
  accept: string;
  decline: string;
  posting: boolean;
}

/**
 * A message an agent drafted, sent by this service once approved. Only the person who connected the
 * workspace may press: the message goes out as them, or as OpenBot, and never on a stranger's word.
 */
interface PendingSend extends Omit<PendingApproval, "requestId" | "accept" | "decline" | "posting"> {
  kind: "send";
  allowedUserId: string;
  draft: SendDraft;
}

/** A draft as it is sent. An auto-reply from the orchestrator's app conversation has no Slack conversation. */
type DeliveryDraft = Omit<SendDraft, "linkId"> & { linkId: string | null };

const FATAL_STATES = new Set<MessagingConnectionState>(["invalid_token", "removed"]);
const APPROVAL_TEXT_LIMIT = 2_500;
const PROGRESS_TEXT_LIMIT = 1_000;
const LIVE_STATES = new Set<MessagingConnectionState>(["connecting", "connected", "reconnecting", "rate_limited"]);
const STARTING_STATES = new Set<MessagingConnectionState>(["connecting", "reconnecting", "rate_limited"]);
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
/** The prefix of an inbox text that asks the Slack Orchestrator instead of sending to Slack. */
const CHIEF_PREFIX = /^@chief(?:\s|$)/i;
/** How many of the conversation's newest inbox messages an `@chief` instruction carries. */
const CHIEF_CONTEXT_MESSAGES = 20;
const RECENT_MESSAGES = 2_000;
const HISTORY_PRUNE_INTERVAL = "1 hour";
const QUEUED_TRANSPORT_WAIT_MS = 60_000;
const TELEGRAM_READY_TIMEOUT_MS = 15_000;
const IDENTIFY_RETRY_MS = 30_000;
const SETTLE_RETRY_MS = 60_000;
const FINAL_POST_ATTEMPTS = 5;
const RECEIVE_NAME_DEADLINE_MS = 5_000;
const RECEIVE_CONTEXT_DEADLINE_MS = 5_000;
const MENTION_MARKERS = /[\uE000-\uE001]/g;
const RESULT_REPORT = /^\s*[*_]*Status:?[*_]*:?\s*(?:done|partial|blocked)\b/i;

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
/** The most people one `@` search of the Slack client offers. */
const MENTION_CANDIDATES = 20;
/** An `@` that starts a name in message text: at the start, or after a space or an opening bracket. */
const TEXT_MENTION = /(?:^|[\s(])@(?=[^\s@<>])/u;
/**
 * How long an auto-reply conversation waits after a new message, so several quick messages get one
 * turn. People send a burst of 2-4 chat lines within 10-20 s, so 20 s puts most bursts in one turn.
 */
const AUTO_REPLY_WAIT_MS = 20_000;
/** The longest wait from the first message, however many follow: a reply is at most 1.5 min late. */
const AUTO_REPLY_WAIT_CAP_MS = 90_000;
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
  readonly #transportWaiters = new Map<string, Set<() => void>>();
  readonly #transportDeadlines = new Map<string, number>();
  readonly #status: MessagingStatusPosts;
  readonly #posts: Map<string, StatusPost>;
  readonly #targets = new Map<string, MessageTarget>();
  /** The hand-off status message of each conversation, by link id. */
  readonly #handoffPosts = new Map<string, HandoffStatusPost>();
  readonly #handoffIntervalMs: number;
  readonly #approvals = new Map<string, PendingApproval>();
  /** GoAhead: the drafted messages that wait for the connected person, by button token. */
  readonly #sendApprovals = new Map<string, PendingSend>();
  readonly #stops: Map<string, StopButton>;
  readonly #settleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #finalFailures = new Map<string, number>();
  readonly #chains = new Map<string, Deferred.Deferred<void>>();
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
  readonly #discordConnect: DiscordConnect | null;
  readonly #slackOrigin: string | undefined;
  readonly #telegramApp: TelegramAppPort | null;
  readonly #whatsapp: WhatsAppConnect | null;
  readonly #whatsappRuntime: WhatsAppRuntime | null;
  readonly #sidebar: Pick<SidebarLayoutStore, "getSnapshot" | "mutate" | "removeAgent"> | null;
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
  #connectionsStarted = false;
  #telegramLinkLease: { release: () => void; timer: ReturnType<typeof setTimeout> } | null = null;
  #scope = Scope.makeUnsafe();

  constructor(options: MessagingServiceOptions) {
    this.#threads = options.threads;
    this.#agents = options.agents;
    this.#credentials = options.credentials;
    this.#drivers = new Map(options.drivers.map((driver) => [driver.platform, driver]));
    this.#downloadsRoot = options.downloadsRoot;
    this.#ingress = options.ingress ?? null;
    this.#connect = options.ingress && options.slackApp ? new SlackConnect(options.slackApp) : null;
    this.#discordConnect = options.ingress && options.discordApp ? new DiscordConnect(options.discordApp) : null;
    this.#slackOrigin = options.slackOrigin;
    this.#telegramApp = options.ingress && options.telegramApp ? options.telegramApp : null;
    this.#whatsappRuntime = options.whatsapp ?? null;
    this.#whatsapp = options.whatsapp
      ? new WhatsAppConnect({
          runtime: options.whatsapp,
          store: options.threads.store,
          history: options.threads.history,
          credentials: options.credentials,
          hooks: {
            prepare: (workspaceId, workspaceName) => this.#prepareWhatsApp(workspaceId, workspaceName),
            finish: (connectionId, values) => this.#finishWhatsApp(connectionId, values),
            dispatch: (operation) => this.#dispatch(operation),
          },
        })
      : null;
    this.#sidebar = options.sidebar ?? null;
    this.#status = new MessagingStatusPosts(options.statusPath ?? null);
    this.#posts = this.#status.posts;
    this.#stops = this.#status.stops;
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

  readonly start = Effect.fn("MessagingService.start")(function* (
    this: MessagingService,
  ): Effect.fn.Return<void, MessagingOperationFailed> {
    if (this.#started) return;
    this.#started = true;
    this.#scope = Scope.makeUnsafe();
    yield* Effect.forkIn(
      Effect.sync(() => this.#pruneHistory()).pipe(Effect.repeat(Schedule.spaced(HISTORY_PRUNE_INTERVAL))),
      this.#scope,
      { startImmediately: true },
    );
    this.#status.load(new Set(this.#threads.store.connections().map((record) => record.connectionId)));
    yield* Effect.promise(() => this.#guards.load());
    yield* Effect.promise(() => this.#hidden.load());
    this.#loadDrafts();
    this.#unsubscribe.push(
      this.#threads.onActivity((activity) => {
        this.#dispatch(this.#serial(activity.link.linkId, this.#activity(activity)));
      }),
      this.#agents.onEvent((event) => this.#agentEvent(event)),
      this.#threads.onLocalOwnerMessage((agentId) => this.#localOwnerMessage(agentId)),
      this.#threads.onReplyContextTurn((turn) => this.#autoReplyTurn(turn)),
      this.#agents.onHandoffs?.((agentId) => this.#handoffsChanged(agentId)) ?? (() => undefined),
    );
    const ingress = this.#ingress;
    if (ingress)
      this.#unsubscribe.push(
        ingress.onState((state) => {
          if (state === "online") this.#transportDeadlines.clear();
        }),
      );
    this.#threads.setContextSource((link, origin) => this.#promptContext(link, origin));
    this.#threads.setOwnerPostSource(
      (link) => this.#whatsapp?.postsAsOwner(link.connectionId, link.platformChannelId) === true,
    );
    this.#threads.setHistorySource((link, scope, limit, filter) => this.#recentMessages(link, scope, limit, filter));
    this.#threads.setOutbound({
      keysUnreadable: (connectionId) => {
        const record = this.#threads.store.connection(connectionId);
        return record ? this.#summary(record).state === "secret_storage_unavailable" : false;
      },
      places: (connectionId) => this.#outboundPlaces(connectionId),
      history: (connectionId, placeId, limit, filter) => this.#outboundHistory(connectionId, placeId, limit, filter),
      post: (connectionId, target, markdown, files, embeds) =>
        this.#outboundPost(connectionId, target, markdown, files, embeds),
      discord: (connectionId, send) => this.#outboundDiscord(connectionId, send),
      telegram: (connectionId, send) => this.#outboundTelegram(connectionId, send),
      slack: (connectionId, send) => this.#outboundSlack(connectionId, send),
    });
    this.#ingress?.handle((workspaceId, delivery) => this.deliver(workspaceId, delivery));
    this.#threads.setMessageSender((request) => this.#requestSend(request));
    this.#threads.setInboxReader((request) => this.#readInbox(request));
    this.#threads.setOwnerSource((connectionId) => this.#slackOwner(connectionId));
    this.#purgeInbox();
    const purge = setInterval(() => this.#purgeInbox(), INBOX_PURGE_INTERVAL_MS);
    purge.unref?.();
    this.#unsubscribe.push(() => clearInterval(purge));
    const records = this.#threads.store.connections();
    yield* Effect.promise(() => this.#upgradeOrchestrators(records));
    yield* this.#credentials.retain(new Set(records.map((record) => record.connectionId)));
    yield* Effect.forEach(
      records.filter((record) => record.enabled),
      (record) => this.#startConnection(record),
      { concurrency: "unbounded", discard: true },
    );
    this.#connectionsStarted = true;
    for (const [connectionId, waiters] of [...this.#transportWaiters]) {
      if (!this.#live.has(connectionId)) for (const ready of [...waiters]) ready();
    }
  }).bind(this);

  readonly stop = Effect.fn("MessagingService.stop")(function* (
    this: MessagingService,
  ): Effect.fn.Return<void, MessagingOperationFailed> {
    this.#started = false;
    this.#connectionsStarted = false;
    for (const unsubscribe of this.#unsubscribe.splice(0)) unsubscribe();
    for (const post of this.#handoffPosts.values()) if (post.timer) clearTimeout(post.timer);
    this.#handoffPosts.clear();
    this.#clearAutoReplyWaits(() => true);
    this.#threads.setMessageSender(null);
    this.#threads.setInboxReader(null);
    this.#threads.setOwnerSource(null);
    for (const connectionId of this.#live.keys()) this.#slackSync.stop(connectionId);
    for (const waiters of [...this.#transportWaiters.values()]) for (const ready of [...waiters]) ready();
    this.#threads.setContextSource(null);
    this.#threads.setOwnerPostSource(null);
    this.#threads.setHistorySource(null);
    this.#threads.setOutbound(null);
    this.#ingress?.handle(null);
    this.#endTelegramLinkLease();
    if (this.#whatsapp) yield* this.#whatsapp.cancelLink();
    for (const timer of this.#settleTimers.values()) clearTimeout(timer);
    this.#settleTimers.clear();
    yield* Effect.forEach(
      [...this.#live.values()],
      (live) => {
        const transport = live.transport;
        return transport ? transport.stop() : Effect.void;
      },
      { concurrency: "unbounded", discard: true },
    );
    this.#live.clear();
    this.#whatsappRuntime?.closeAll();
    yield* Scope.close(this.#scope, Exit.void);
  }, Effect.uninterruptible).bind(this);

  hasLiveConnection(): boolean {
    return [...this.#live.values()].some((live) => LIVE_STATES.has(live.state));
  }

  resume(): void {
    this.#ingress?.reconnect();
    for (const live of this.#live.values()) live.transport?.reconnect();
  }

  slackOverview(): MessagingOverview {
    return this.#overview("slack");
  }

  discordOverview(): MessagingOverview {
    return this.#overview("discord");
  }

  telegramOverview(): MessagingOverview {
    return this.#overview("telegram");
  }

  whatsappOverview(): WhatsAppOverview {
    return { ...this.#overview("whatsapp"), accounts: this.#whatsapp?.accounts() ?? [] };
  }

  whatsappLinkState(): WhatsAppLinkState {
    return this.#whatsapp?.linkState() ?? { status: "idle", qr: null, code: null, workspaceId: null, error: null };
  }

  readonly startWhatsAppLink = Effect.fn("MessagingService.startWhatsAppLink")(function* (
    this: MessagingService,
    input: StartWhatsAppLinkInput,
  ) {
    const whatsapp = yield* messagingStep(() => this.#requireWhatsApp());
    return yield* whatsapp.startLink(input);
  }).bind(this);

  readonly cancelWhatsAppLink = Effect.fn("MessagingService.cancelWhatsAppLink")(function* (this: MessagingService) {
    if (this.#whatsapp) yield* this.#whatsapp.cancelLink();
  }).bind(this);

  readonly listWhatsAppGroups = Effect.fn("MessagingService.listWhatsAppGroups")(function* (
    this: MessagingService,
    workspaceId: string,
  ) {
    const whatsapp = yield* messagingStep(() => this.#requireWhatsApp());
    return yield* whatsapp.groups(workspaceId).pipe(toMessagingOperationFailed);
  }).bind(this);

  readonly addWhatsAppSender = Effect.fn("MessagingService.addWhatsAppSender")(function* (
    this: MessagingService,
    workspaceId: string,
    sender: WhatsAppSender,
  ) {
    const whatsapp = yield* messagingStep(() => this.#requireWhatsApp());
    yield* whatsapp.addSender(workspaceId, sender).pipe(toMessagingOperationFailed);
  }).bind(this);

  readonly removeWhatsAppSender = Effect.fn("MessagingService.removeWhatsAppSender")(function* (
    this: MessagingService,
    workspaceId: string,
    senderId: string,
  ) {
    const whatsapp = yield* messagingStep(() => this.#requireWhatsApp());
    yield* whatsapp.removeSender(workspaceId, senderId).pipe(toMessagingOperationFailed);
  }).bind(this);

  readonly setWhatsAppSenderReadOnly = Effect.fn("MessagingService.setWhatsAppSenderReadOnly")(function* (
    this: MessagingService,
    workspaceId: string,
    senderId: string,
    readOnly: boolean,
  ) {
    const whatsapp = yield* messagingStep(() => this.#requireWhatsApp());
    yield* whatsapp.setSenderReadOnly(workspaceId, senderId, readOnly).pipe(toMessagingOperationFailed);
  }).bind(this);

  readonly answerWhatsAppRequest = Effect.fn("MessagingService.answerWhatsAppRequest")(function* (
    this: MessagingService,
    workspaceId: string,
    code: string,
    approve: boolean,
  ) {
    const whatsapp = yield* messagingStep(() => this.#requireWhatsApp());
    yield* whatsapp.answerRequest(workspaceId, code, approve).pipe(toMessagingOperationFailed);
  }).bind(this);

  readonly setWhatsAppOwnNumber = Effect.fn("MessagingService.setWhatsAppOwnNumber")(function* (
    this: MessagingService,
    workspaceId: string,
    ownNumber: boolean,
  ) {
    const whatsapp = yield* messagingStep(() => this.#requireWhatsApp());
    yield* whatsapp.setOwnNumber(workspaceId, ownNumber).pipe(toMessagingOperationFailed);
  }).bind(this);

  readonly setWhatsAppStatusReactions = Effect.fn("MessagingService.setWhatsAppStatusReactions")(function* (
    this: MessagingService,
    workspaceId: string,
    statusReactions: boolean,
  ) {
    const whatsapp = yield* messagingStep(() => this.#requireWhatsApp());
    yield* whatsapp.setStatusReactions(workspaceId, statusReactions).pipe(toMessagingOperationFailed);
  }).bind(this);

  readonly setWhatsAppWorkingMessage = Effect.fn("MessagingService.setWhatsAppWorkingMessage")(function* (
    this: MessagingService,
    workspaceId: string,
    workingMessage: boolean,
  ) {
    const whatsapp = yield* messagingStep(() => this.#requireWhatsApp());
    yield* whatsapp.setWorkingMessage(workspaceId, workingMessage).pipe(toMessagingOperationFailed);
  }).bind(this);

  readonly disconnectWhatsAppNumber = Effect.fn("MessagingService.disconnectWhatsAppNumber")(function* (
    this: MessagingService,
    workspaceId: string,
  ) {
    const runtime = yield* messagingStep(() => this.#requireWhatsApp() && this.#whatsappRuntime);
    const record = yield* messagingStep(() => this.#requireConnection("whatsapp", workspaceId));
    const orphan = yield* this.#orphanedOrchestrator(record);
    const storeId = this.#credentials.get(record.connectionId)?.storeId;
    const handle = storeId ? runtime?.get(storeId) : null;
    if (handle) yield* handle.session.logout();
    yield* this.#stopConnection(record.connectionId);
    if (storeId) runtime?.delete(storeId);
    yield* messagingStep(() => {
      this.#threads.history.forget(record.connectionId);
      runtime?.deleteFiles(record.connectionId);
    });
    yield* this.#credentials.clear(record.connectionId);
    yield* messagingStep(() =>
      this.#threads.store.updateConnection(record.connectionId, { enabled: false, lastErrorCode: null }),
    );
    this.#whatsapp?.forget(workspaceId);
    if (orphan) yield* this.#deleteOrchestrator(orphan);
  }, Effect.uninterruptible).bind(this);

  readonly #prepareWhatsApp = Effect.fn("MessagingService.prepareWhatsApp")(function* (
    this: MessagingService,
    workspaceId: string,
    workspaceName: string,
  ) {
    const record = yield* messagingStep(() =>
      this.#threads.store.ensureConnection("whatsapp", workspaceId, workspaceName),
    );
    yield* this.#stopConnection(record.connectionId);
    return record.connectionId;
  });

  readonly #finishWhatsApp = Effect.fn("MessagingService.finishWhatsApp")(function* (
    this: MessagingService,
    connectionId: string,
    values: Record<string, string>,
  ) {
    yield* this.#credentials.set(connectionId, values);
    const record = this.#threads.store.connection(connectionId);
    if (!record) return;
    this.#threads.store.updateConnection(connectionId, {
      enabled: true,
      lastErrorCode: null,
      orchestratorAgentId: this.#orchestrator(record) ?? this.#platformOrchestrator("whatsapp"),
    });
    const updated = this.#threads.store.connection(connectionId);
    if (updated) yield* this.#startConnection(updated);
  }, Effect.uninterruptible);

  #withoutStatusPost(connectionId: string): boolean {
    return this.#whatsapp?.workingMessage(connectionId) === false;
  }

  #react(
    live: LiveConnection,
    target: MessageTarget,
    messageId: string,
    reaction: StatusReaction,
    on: boolean,
  ): Effect.Effect<void> {
    if (on && this.#whatsapp?.statusReactions(live.record.connectionId) === false) return Effect.void;
    return live.adapter.react(target, messageId, reaction, on).pipe(Effect.catch(() => Effect.void));
  }

  #quietEnd(connectionId: string, target: MessageTarget): boolean {
    return this.#whatsapp?.postsAsOwner(connectionId, target.platformChannelId) === true;
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
      if (this.#sendApprovals.has(stored.acceptToken)) continue;
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
      this.#sendApprovals.set(stored.acceptToken, pending);
      this.#sendApprovals.set(stored.declineToken, pending);
    }
  }

  #pendingSends(): PendingSend[] {
    const unique = new Set<PendingSend>();
    for (const pending of this.#sendApprovals.values()) if (!pending.answered) unique.add(pending);
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

  #requireWhatsApp(): WhatsAppConnect {
    if (!this.#whatsapp) throw new Error(sourceText("error.messaging.whatsappUnsupported"));
    return this.#whatsapp;
  }

  #overview(platform: MessagingPlatform): MessagingOverview {
    return {
      connections: this.#threads.store
        .connections()
        .filter((record) => record.platform === platform && this.#credentials.status(record.connectionId) !== "missing")
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
    const record = this.#requireConnection("slack", workspaceId);
    await this.#guards
      .set(record.workspaceId, {
        ...(change.paused === undefined ? {} : { paused: change.paused }),
        ...(change.quietHours === undefined ? {} : { quietHours: change.quietHours }),
      })
      .catch((error) => this.#warn(error));
  }

  readonly reconnect = Effect.fn("MessagingService.reconnect")(function* (
    this: MessagingService,
    platform: MessagingPlatform,
    workspaceId: string,
    opensPage: boolean,
  ): Effect.fn.Return<MessagingConnectPage | null, MessagingOperationFailed> {
    const record = yield* messagingStep(() => this.#requireLinked(platform, workspaceId));
    if (platform === "discord" && record.lastErrorCode === "invalid_token")
      return yield* this.connectDiscordGuild(opensPage);
    if (this.#live.get(record.connectionId)?.state === "not_linked") {
      if (platform === "slack") return yield* this.connectSlackWorkspace(opensPage);
      if (platform === "discord") return yield* this.connectDiscordGuild(opensPage);
      if (platform === "telegram")
        return yield* this.connectTelegramChat(workspaceId.startsWith("-") ? "group" : "direct", opensPage);
    }
    yield* this.#stopConnection(record.connectionId);
    this.#threads.store.updateConnection(record.connectionId, { enabled: true, lastErrorCode: null });
    const updated = this.#threads.store.connection(record.connectionId);
    if (updated) yield* this.#startConnection(updated);
    this.#ingress?.reconnect();
    return null;
  }, Effect.uninterruptible).bind(this);

  readonly setEnabled = Effect.fn("MessagingService.setEnabled")(function* (
    this: MessagingService,
    platform: MessagingPlatform,
    workspaceId: string,
    enabled: boolean,
  ): Effect.fn.Return<void, MessagingOperationFailed> {
    const record = yield* messagingStep(() => this.#requireLinked(platform, workspaceId));
    yield* this.#stopConnection(record.connectionId);
    this.#threads.store.updateConnection(record.connectionId, { enabled, lastErrorCode: null });
    const updated = this.#threads.store.connection(record.connectionId);
    if (enabled && updated) yield* this.#startConnection(updated);
  }, Effect.uninterruptible).bind(this);

  readonly addOrchestrator = Effect.fn("MessagingService.addOrchestrator")(function* (
    this: MessagingService,
    platform: MessagingPlatform,
    input: AddMessagingOrchestratorInput,
  ) {
    if (platform === "whatsapp") return yield* this.#addSharedOrchestrator(platform, input);
    const record = yield* messagingStep(() => this.#requireConnection(platform, input.workspaceId));
    const current = this.#orchestrator(record) ?? this.#platformOrchestrator(platform);
    if (current) {
      this.#shareOrchestrator(platform, current);
      return { agentId: current, sectionId: null };
    }
    const discord = platform === "discord";
    const agent = yield* this.#agents
      .createAgentProfile({
        ...(discord ? discordOrchestratorProfile() : slackOrchestratorProfile()),
        ...(discord ? DISCORD_ORCHESTRATOR_AVATAR : SLACK_ORCHESTRATOR_AVATAR),
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
        startOnRunnableProvider: true,
      })
      .pipe(toMessagingOperationFailed);
    const memories = discord ? discordOrchestratorMemories() : slackOrchestratorMemories();
    for (const text of memories) this.#agents.createMemory({ agentId: agent.id, text });
    this.#shareOrchestrator(platform, agent.id);
    // The live connection keeps its own copy of the record: without this, it knows no orchestrator
    // until the next restart, and the new orchestrator cannot send or read the inbox.
    const live = this.#live.get(record.connectionId);
    if (live) live.record = this.#threads.store.connection(record.connectionId) ?? live.record;
    // The Slack inbox row sits under the orchestrator: the desktop reads the inbox list again.
    if (platform === "slack") this.#inboxChanged(record.workspaceId);
    const sectionId = yield* this.#placeInIntegrations(agent.id).pipe(
      Effect.catch((failure) => {
        this.#warn(failure.cause);
        return Effect.succeed(null);
      }),
    );
    return { agentId: agent.id, sectionId };
  }, Effect.uninterruptible).bind(this);

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

  readonly #placeInIntegrations = Effect.fn("MessagingService.placeInIntegrations")(function* (
    this: MessagingService,
    agentId: string,
  ) {
    const sidebar = this.#sidebar;
    if (!sidebar) return null;
    const name = sourceText("status.messaging.integrationsSection");
    const agentIds = new Set(this.#agents.listAgents().map((agent) => agent.id));
    const existing = integrationsSection(sidebar.getSnapshot());
    const layout = yield* sidebar
      .mutate(
        existing ? { type: "assign", agentId, sectionId: existing.id } : { type: "create", name, agentId },
        agentIds,
      )
      .pipe(toMessagingOperationFailed);
    return layout.agentAssignments[agentId] ?? null;
  });

  readonly #orphanedOrchestrator = Effect.fn("MessagingService.orphanedOrchestrator")(function* (
    this: MessagingService,
    record: MessagingConnectionRecord,
  ) {
    const agentId = this.#orchestrator(record);
    if (!agentId) return null;
    const shared = this.#threads.store
      .connections()
      .some(
        (other) =>
          other.connectionId !== record.connectionId &&
          other.orchestratorAgentId === agentId &&
          this.#credentials.status(other.connectionId) !== "missing",
      );
    if (shared) return null;
    yield* this.#agents.ensureDeletable(agentId).pipe(toMessagingOperationFailed);
    return agentId;
  });

  readonly #deleteOrchestrator = Effect.fn("MessagingService.deleteOrchestrator")(function* (
    this: MessagingService,
    agentId: string,
  ) {
    yield* Effect.gen({ self: this }, function* () {
      yield* this.#agents.deleteAgent(agentId).pipe(toMessagingOperationFailed);
      const sidebar = this.#sidebar;
      if (!sidebar) return;
      const layout = yield* sidebar.removeAgent(agentId).pipe(toMessagingOperationFailed);
      const section = integrationsSection(layout);
      const chatIds = this.#agents.sidebarChatIds();
      if (
        section &&
        !Object.entries(layout.agentAssignments).some(([id, sectionId]) => sectionId === section.id && chatIds.has(id))
      )
        yield* sidebar.mutate({ type: "delete", sectionId: section.id }, chatIds).pipe(toMessagingOperationFailed);
    }).pipe(Effect.catch((failure) => Effect.sync(() => this.#warn(failure.cause))));
  });

  readonly connectSlackWorkspace = Effect.fn("MessagingService.connectSlackWorkspace")(function* (
    this: MessagingService,
    opensPage: boolean,
  ): Effect.fn.Return<MessagingConnectPage, MessagingOperationFailed> {
    const connect = yield* messagingStep(() => this.#requireConnect());
    return yield* connect.start(opensPage).pipe(toMessagingOperationFailed);
  }).bind(this);

  readonly completeSlackWorkspace = Effect.fn("MessagingService.completeSlackWorkspace")(function* (
    this: MessagingService,
    nonce: string,
    grant: string,
  ): Effect.fn.Return<boolean, MessagingOperationFailed> {
    const connect = yield* messagingStep(() => this.#requireConnect());
    const opened = yield* connect.complete(nonce, grant).pipe(toMessagingOperationFailed);
    if (!opened) return false;
    const record = this.#threads.store.ensureConnection("slack", opened.workspaceId, opened.workspaceName);
    yield* this.#stopConnection(record.connectionId);
    yield* this.#credentials.set(record.connectionId, {
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
      orchestratorAgentId: this.#orchestrator(record) ?? this.#platformOrchestrator("slack"),
    });
    this.#ingress?.reconnect();
    const updated = this.#threads.store.connection(record.connectionId);
    if (updated) yield* this.#startConnection(updated);
    return true;
  }, Effect.uninterruptible).bind(this);

  readonly #discardUnreadableAccess = Effect.fn("MessagingService.discardUnreadableAccess")(function* (
    this: MessagingService,
    record: MessagingConnectionRecord,
  ) {
    if (this.#connect)
      yield* this.#connect
        .unlink(record.workspaceId)
        .pipe(Effect.catch((failure) => Effect.sync(() => this.#warn(failure.cause))));
    yield* this.#credentials.clear(record.connectionId);
  });

  readonly #revokeAndUnlink = Effect.fn("MessagingService.revokeAndUnlink")(function* (
    this: MessagingService,
    record: MessagingConnectionRecord,
  ) {
    const workspaceId = record.workspaceId;
    const values = this.#credentials.get(record.connectionId);
    const revoke = (token: string | undefined) =>
      token
        ? new SlackWebApi({ token, origin: this.#slackOrigin }).call("auth.revoke").pipe(
            Effect.asVoid,
            Effect.catch((failure) => Effect.sync(() => this.#warn(failure.cause))),
          )
        : Effect.void;
    yield* revoke(values?.userToken);
    const owner = values?.userId;
    const routing = this.#routing;
    const connect = this.#connect;
    const workspaceRemains =
      owner && routing
        ? yield* Effect.tryPromise({
            try: () => routing.unlinkPerson(workspaceId, owner),
            catch: (cause) => cause,
          }).pipe(
            Effect.map((result) => result.workspaceRemains),
            Effect.catch((error) =>
              Effect.sync(() => {
                this.#warn(error);
                return true;
              }),
            ),
          )
        : connect
          ? yield* connect.unlink(workspaceId).pipe(
              Effect.map((result) => result.workspaceRemains),
              Effect.catch((failure) =>
                Effect.sync(() => {
                  this.#warn(failure.cause);
                  return true;
                }),
              ),
            )
          : true;
    if (!workspaceRemains) yield* revoke(values?.botToken);
    yield* this.#credentials.clear(record.connectionId);
  });

  /**
   * Whether this computer answers the workspace's people who do not use GoAhead, and the other
   * connected people its owner can hand that to, with their Slack names.
   */
  async slackRouting(workspaceId: string): Promise<SlackRoutingStatus> {
    const record = this.#requireConnection("slack", workspaceId);
    return this.#routingStatus(record, await this.#requireRouting().status(workspaceId));
  }

  /** The default's owner gives the default to another connected person of the workspace. */
  async handOverSlackDefault(workspaceId: string, slackUserId: string): Promise<SlackRoutingStatus> {
    const record = this.#requireConnection("slack", workspaceId);
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
            (live
              ? await runCauseEffect(live.adapter.authorName(slackUserId)).catch((error) => {
                  this.#warn(error);
                  return null;
                })
              : null) || slackUserId
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
  // Connection lifecycle.
  /**
   * Slack said that a token was revoked or the app was removed. Only the current tokens decide: a
   * late event about the tokens of an earlier install must not stop the connection and unlink the
   * workspace that was just connected again. A refused token stops it, as before.
   */
  async #verifyTokens(live: LiveConnection): Promise<void> {
    try {
      await runCauseEffect(live.adapter.identify());
    } catch (error) {
      if (this.#live.get(live.record.connectionId) !== live) return;
      if (error instanceof MessagingConnectionError) this.#dispatch(this.#setState(live, error.state));
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
    const authorName = await runCauseEffect(live.adapter.authorName(message.authorId));
    await runCauseEffect(
      this.#receive(live, {
        dedupKey: `reply:${message.dedupKey}`,
        platformChannelId: link.platformChannelId,
        threadKey: link.threadKey,
        target: linkTarget(link),
        platformMessageId: message.platformMessageId,
        isDirect: link.isDirect,
        requiresLink: true,
        authorId: message.authorId,
        mentionedUserIds: [],
        text: [
          `${authorName} replied to the message that was sent for the GoAhead user ("${sent.text.slice(0, SENT_PREVIEW)}"):`,
          message.text || "(The reply has no text.)",
        ].join("\n"),
        files: [],
        observed: true,
      }),
    );
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
      authorName: await runCauseEffect(live.adapter.authorName(candidate.authorId)),
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
      // Only the person's own words: a teammate's answer here carries their origin, not their words.
      const running = this.#threads.runningOrigin(link.linkId);
      if (!running?.fromPerson || running.origin.authorId !== user.id)
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
    const { agentId } = await this.#askOrchestrator(live, {
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
   * Gives the workspace's orchestrator one instruction about one conversation, with the
   * conversation's newest messages as context. An inbox ask goes to the orchestrator's own
   * conversation. An auto-reply goes to the reply context of the conversation: a new context gets the
   * newest messages, and a context that already read some gets only the messages after them.
   * Answers the orchestrator's id and the reply context thread, if any.
   */
  async #askOrchestrator(
    live: LiveConnection,
    ask: {
      conversation: string;
      threadKey: string | null;
      lead: string;
      instructionTitle: string;
      instruction: string;
      /** The card that the orchestrator's chat shows in place of the text. */
      card: Exclude<SlackAskKind, "auto-reply-paused">;
      /** For an auto-reply: the new messages, which the card shows. */
      newMessageIds?: ReadonlySet<string>;
      /**
       * For an auto-reply: called before the turn is queued, with the reply context thread (null when
       * the turn runs in the main thread) and the read mark that the turn commits once it completes.
       */
      onReplyContext?: (threadId: string | null, cursor: ReplyContextCursor | null) => Promise<void>;
    },
  ): Promise<{ agentId: string; threadId: string | null }> {
    const user = live.identity?.user;
    if (!user) throw new Error(sourceText("error.messaging.inboxNeedsUser"));
    const connectionId = live.record.connectionId;
    const inbox = this.#threads.inbox;
    // An auto-reply reads the whole conversation, threads included, so one read mark covers every
    // thread of it. An inbox ask reads the thread it is about.
    const readKey = ask.card === "auto-reply" ? null : ask.threadKey;
    const messages = inbox.readForAgent(connectionId, ask.conversation, readKey, CHIEF_CONTEXT_MESSAGES);
    if (messages.length === 0) throw new Error(sourceText("error.messaging.inboxUnknownConversation"));
    const agentId = this.#orchestrator(live.record);
    if (!agentId) throw new Error(sourceText("error.messaging.inboxNeedsOrchestrator"));
    const { kind, place } = await this.#conversationPlace(live, user.id, ask.conversation, messages);
    const where =
      kind === "direct"
        ? `direct message with ${place}`
        : kind === "group"
          ? `group direct message with ${place}`
          : `channel ${place}`;
    const replyContext =
      ask.card === "auto-reply"
        ? await this.#threads.ensureReplyContext({
            connectionId,
            agentId,
            platformChannelId: ask.conversation,
            isDirect: kind === "direct",
            title: place,
          })
        : null;
    // A context that already read the conversation gets only what came after, without GoAhead's own
    // auto-replies: the context holds them already.
    const cursor = replyContext && !replyContext.fresh ? replyContext.link.historyCursor : null;
    const autoSent = cursor ? this.#threads.store.autoSentMessageIds(connectionId, ask.conversation) : null;
    const after =
      cursor === null
        ? messages
        : messages.filter((message) => message.platformMessageId > cursor && !autoSent?.has(message.platformMessageId));
    // Never an empty list: a message that Slack edited in place keeps its old `ts`.
    const prompted = after.length > 0 ? after : messages.slice(-1);
    const people = new Map<string, string>();
    for (const message of prompted)
      if (message.authorId !== user.id && !people.has(message.authorId))
        people.set(message.authorId, message.authorName);
    // The map is for delegation. A continued context has it already, and a reply context has no tool
    // to delegate with: the tool router refuses every tool but the Slack send tool there.
    const projectMap = cursor === null && replyContext === null ? (this.#agents.projectMap?.() ?? null) : null;
    const text = [
      `${ask.lead} in ${live.record.workspaceName}: ${where} (conversation ${ask.conversation}${ask.threadKey ? `, thread ${ask.threadKey}` : ""}).`,
      kind === "channel" ? `Channel ID: ${ask.conversation}.` : "",
      ...[...people].map(([id, name]) => `Person: ${name}, Slack user ID ${id}.`),
      "To answer in this conversation, call openbot.slack_send_message with to: <@USER_ID> (direct message) or <#CHANNEL_ID> (channel).",
      SLACK_INBOX_UNTRUSTED_NOTE,
      projectMap ? projectMapInstruction(projectMap) : "",
      cursor === null
        ? "--- newest messages, oldest first ---"
        : "--- new messages since your last turn, oldest first ---",
      ...prompted.map(
        (message) =>
          `${message.authorId === user.id ? `${message.authorName} (the GoAhead user)` : message.authorName}${readKey === null && message.threadKey ? ` (in thread ${message.threadKey})` : ""}: ${this.#readable(live, message.text)}`,
      ),
      `--- ${ask.instructionTitle} ---`,
      ask.instruction,
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
        ask.card === "inbox-ask"
          ? [line(user.name, ask.instruction)]
          : newMessages
              .slice(-SLACK_ASK_TRIGGER_LIMIT)
              .map((message) => line(message.authorName, this.#readable(live, message.text))),
    };
    const threadId = replyContext?.link.threadId ?? null;
    // Not written here: the turn commits it when it completes, so a failed turn reads them again.
    const newest = messages.at(-1)?.platformMessageId;
    const readMark =
      replyContext && newest && (cursor === null || newest > cursor)
        ? { linkId: replyContext.link.linkId, value: newest }
        : null;
    await ask.onReplyContext?.(threadId, readMark);
    await this.#agents.sendMessage({ agentId, text, slackAsk });
    return { agentId, threadId };
  }

  /** The kind of a conversation and the name that GoAhead shows for it. */
  async #conversationPlace(
    live: LiveConnection,
    userId: string,
    conversation: string,
    messages: ReadonlyArray<{ kind: InboxKind; authorId: string; authorName: string }>,
  ): Promise<{ kind: InboxKind; place: string }> {
    const kind = messages[0]?.kind ?? "channel";
    const other = messages.find((message) => message.authorId !== userId)?.authorName ?? "";
    const inbox = this.#threads.inbox;
    const place = await this.#inboxPlace(live, inbox.watched(live.record.connectionId))(conversation, kind, other);
    return { kind, place };
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

  /**
   * An auto-reply went out. The reply that completes a loop pauses the conversation and tells the
   * person with a card in the orchestrator's chat. The card starts no turn.
   */
  #autoReplySent(live: LiveConnection, channelId: string): void {
    if (!this.#autoReplyLoop.replied(`${live.record.connectionId}\n${channelId}`, Date.now())) return;
    void this.#autoReplyPausedNotice(live, channelId).catch((error) => this.#warn(error));
  }

  async #autoReplyPausedNotice(live: LiveConnection, channelId: string): Promise<void> {
    const user = live.identity?.user;
    const agentId = this.#orchestrator(live.record);
    if (!user || !agentId) return;
    const messages = this.#threads.inbox.readForAgent(live.record.connectionId, channelId, null, 1);
    const { place } = await this.#conversationPlace(live, user.id, channelId, messages);
    const text = sourceText("status.messaging.autoReplyLoopPaused", { conversation: place });
    const slackAsk: ConversationSlackAsk = {
      kind: "auto-reply-paused",
      workspaceId: live.record.workspaceId,
      channelId,
      place: place.length > SLACK_ASK_PLACE_LIMIT ? `${place.slice(0, SLACK_ASK_PLACE_LIMIT - 1)}…` : place,
      trigger: [],
    };
    if (!this.#agents.postNotice) {
      logger.info("Auto-reply paused after a reply loop.", { channelId });
      return;
    }
    await this.#agents.postNotice({ agentId, text, slackAsk });
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
      route: { kind: "pending" },
      readMark: null,
      turnId: null,
      cancelLimit: this.#autoReplyTimers.start(
        () => this.#autoReplyTurnEnded(key, wait, false),
        AUTO_REPLY_TURN_LIMIT_MS,
      ),
    };
    try {
      const names = (await Promise.all(authorIds.map((id) => runCauseEffect(live.adapter.authorName(id))))).join(", ");
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
        onReplyContext: async (threadId, readMark) => {
          const route: AutoReplyRoute = threadId
            ? { kind: "context", threadId }
            : { kind: "main", threadId: await this.#threads.mainThreadId(agentId) };
          if (!wait.running) return;
          wait.running.route = route;
          wait.running.readMark = readMark;
        },
        instruction: `Auto-reply is on for this conversation. Read the new messages from ${names} and reply in this conversation as the GoAhead user, the way they would answer in chat: a short, natural reply to every message written to them.${thread} Send nothing anywhere else. Send nothing only when the new messages are just an acknowledgement, such as an emoji, "ok", "thanks" or a thumbs up.`,
      });
    } catch (error) {
      this.#autoReplyTurnEnded(key, wait, false);
      throw error;
    }
  }

  /**
   * The orchestrator's turns: the first one that starts in the reply context after an auto-reply
   * request is that request's. A request with no reply context runs in the main thread, and takes
   * the first turn that starts there.
   */
  #autoReplyTurn(turn: ReplyContextTurn): void {
    for (const [key, wait] of this.#autoReplyWaits) {
      const running = wait.running;
      if (running?.agentId !== turn.agentId || !autoReplyRouteAccepts(running.route, turn.threadId)) continue;
      if (turn.type === "started" && running.turnId === null) running.turnId = turn.turnId;
      else if (turn.type === "completed" && running.turnId === turn.turnId)
        this.#autoReplyTurnEnded(key, wait, turn.status === "completed");
    }
  }

  /** The turn ended. Only a completed one writes its read mark; after any other, the messages are read again. */
  #autoReplyTurnEnded(key: string, wait: AutoReplyWait, completed: boolean): void {
    if (this.#autoReplyWaits.get(key) !== wait || !wait.running) return;
    wait.running.cancelLimit();
    if (completed) this.#commitReadMark(wait);
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

  /**
   * The auto-reply turn that runs now for this agent in this conversation, if any. When the turn
   * runs in a reply context, only a request from that thread is the turn's.
   */
  #runningAutoReply(agentId: string, connectionId: string, channelId: string, threadId: string): AutoReplyWait | null {
    for (const wait of this.#autoReplyWaits.values()) {
      const running = wait.running;
      if (running?.agentId !== agentId || wait.connectionId !== connectionId || wait.channelId !== channelId) continue;
      if (autoReplyRouteAccepts(running.route, threadId)) return wait;
    }
    return null;
  }

  /** Writes what the running turn read to its reply context. */
  #commitReadMark(wait: AutoReplyWait): void {
    const mark = wait.running?.readMark;
    if (!mark || !wait.running) return;
    wait.running.readMark = null;
    this.#threads.markReplyContextRead(mark.linkId, mark.value);
  }

  /** The live connection of a workspace that is connected as the person. */
  #personConnection(workspaceId: string): LiveConnection {
    const record = this.#requireConnection("slack", workspaceId);
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
    const record = this.#requireConnection("slack", workspaceId);
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
          (await runCauseEffect(live.adapter.placeName(platformChannelId))));
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
        const name = await runCauseEffect(live.adapter.authorName(id)).catch(() => id);
        if (name && name !== id) people[id] = name;
      }),
      ...[...references.channels].slice(0, INBOX_LOOKUPS).map(async (id) => {
        const name = (await runCauseEffect(live.adapter.placeName(id)).catch(() => id)).replace(/^#/u, "");
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

  readonly disconnectSlackWorkspace = Effect.fn("MessagingService.disconnectSlackWorkspace")(function* (
    this: MessagingService,
    workspaceId: string,
  ) {
    const record = yield* messagingStep(() => this.#requireConnection("slack", workspaceId));
    const orphan = yield* this.#orphanedOrchestrator(record);
    const unreadable = this.#credentials.status(record.connectionId) === "unreadable";
    this.#slackDisconnects.set(record.connectionId, (this.#slackDisconnects.get(record.connectionId) ?? 0) + 1);
    yield* this.#stopConnection(record.connectionId);
    if (unreadable) yield* this.#discardUnreadableAccess(record);
    else yield* this.#revokeAndUnlink(record);
    yield* messagingStep(() => this.#threads.inbox.deleteForConnection(record.connectionId));
    const inboxFiles = this.#inboxFiles;
    if (inboxFiles)
      yield* Effect.tryPromise({
        try: () => inboxFiles.deleteForConnection(record.connectionId),
        catch: (cause) => cause,
      }).pipe(Effect.catch((error) => Effect.sync(() => this.#warn(error))));
    yield* messagingStep(() => {
      this.#slackActions.delete(record.connectionId);
      this.#slackQueues.delete(record.connectionId);
      this.#threads.inbox.cache.clearConnection(record.connectionId);
      this.#threads.autoReply.clearConnection(record.connectionId);
      this.#autoReplyLoop.forget((key) => key.startsWith(`${record.connectionId}\n`));
      this.#inboxChanged(record.workspaceId);
      this.#slackClientChanged({ workspaceId: record.workspaceId, channelId: null });
      this.#threads.store.updateConnection(record.connectionId, { enabled: false, lastErrorCode: null });
    });
    this.#ingress?.reconnect();
    if (orphan) yield* this.#deleteOrchestrator(orphan);
  }, Effect.uninterruptible).bind(this);

  readonly discordAccess = Effect.fn("MessagingService.discordAccess")(function* (
    this: MessagingService,
    guildId: string,
  ): Effect.fn.Return<DiscordAccess, MessagingOperationFailed> {
    const record = yield* messagingStep(() => this.#requireConnection("discord", guildId));
    return { allowedRoles: this.#threads.store.allowedRoles(record.connectionId) };
  }).bind(this);

  readonly listDiscordRoles = Effect.fn("MessagingService.listDiscordRoles")(function* (
    this: MessagingService,
    guildId: string,
  ): Effect.fn.Return<DiscordRoleList, MessagingOperationFailed> {
    const record = yield* messagingStep(() => this.#requireConnection("discord", guildId));
    const live = this.#live.get(record.connectionId);
    const roles = live?.identity ? live.adapter.roles?.() : undefined;
    if (!roles)
      return yield* new MessagingOperationFailed({
        cause: new Error(sourceText("error.messaging.discordRelayUnavailable")),
      });
    return {
      roles: (yield* roles.pipe(
        Effect.mapError((failure) => {
          const code = failure.cause instanceof DiscordApiError ? failure.cause.code : null;
          return new MessagingOperationFailed({
            cause: new Error(
              sourceText(
                code === "invalid_request"
                  ? "error.messaging.discordRolesUnsupported"
                  : "error.messaging.discordRelayUnavailable",
              ),
            ),
          });
        }),
      )).map((role) => ({ id: role.id, name: roleName(role.name) })),
    };
  }).bind(this);

  readonly setDiscordAccess = Effect.fn("MessagingService.setDiscordAccess")(function* (
    this: MessagingService,
    input: SetDiscordAccessInput,
  ): Effect.fn.Return<DiscordAccess, MessagingOperationFailed> {
    const record = yield* messagingStep(() => this.#requireConnection("discord", input.workspaceId));
    yield* messagingStep(() => this.#threads.store.replaceAllowedRoles(record.connectionId, input.allowedRoles));
    return { allowedRoles: this.#threads.store.allowedRoles(record.connectionId) };
  }).bind(this);

  readonly connectDiscordGuild = Effect.fn("MessagingService.connectDiscordGuild")(function* (
    this: MessagingService,
    opensPage: boolean,
  ): Effect.fn.Return<MessagingConnectPage, MessagingOperationFailed> {
    const connect = yield* messagingStep(() => this.#requireDiscordConnect());
    return yield* connect.start(opensPage).pipe(toMessagingOperationFailed);
  }).bind(this);

  readonly completeDiscordGuild = Effect.fn("MessagingService.completeDiscordGuild")(function* (
    this: MessagingService,
    nonce: string,
    grant: string,
  ): Effect.fn.Return<boolean, MessagingOperationFailed> {
    const connect = yield* messagingStep(() => this.#requireDiscordConnect());
    const opened = yield* connect.complete(nonce, grant).pipe(toMessagingOperationFailed);
    if (!opened) return false;
    const record = this.#threads.store.ensureConnection("discord", opened.guildId, opened.guildName);
    yield* this.#stopConnection(record.connectionId);
    yield* this.#credentials.set(record.connectionId, {
      guildId: opened.guildId,
      guildName: opened.guildName,
      appId: opened.appId,
    });
    this.#threads.store.updateConnection(record.connectionId, {
      enabled: true,
      workspaceName: opened.guildName,
      appId: opened.appId,
      lastErrorCode: null,
      orchestratorAgentId: this.#orchestrator(record) ?? this.#platformOrchestrator("discord"),
    });
    const updated = this.#threads.store.connection(record.connectionId);
    if (updated) yield* this.#startConnection(updated);
    this.#ingress?.reconnect();
    return true;
  }, Effect.uninterruptible).bind(this);

  readonly disconnectDiscordGuild = Effect.fn("MessagingService.disconnectDiscordGuild")(function* (
    this: MessagingService,
    guildId: string,
  ) {
    const record = yield* messagingStep(() => this.#requireConnection("discord", guildId));
    const orphan = yield* this.#orphanedOrchestrator(record);
    if (this.#discordConnect) yield* this.#discordConnect.unlink(guildId).pipe(toMessagingOperationFailed);
    yield* this.#stopConnection(record.connectionId);
    yield* this.#credentials.clear(record.connectionId);
    yield* messagingStep(() =>
      this.#threads.store.updateConnection(record.connectionId, { enabled: false, lastErrorCode: null }),
    );
    this.#ingress?.reconnect();
    if (orphan) yield* this.#deleteOrchestrator(orphan);
  }, Effect.uninterruptible).bind(this);

  readonly deliver = Effect.fn("MessagingService.deliver")(function* (
    this: MessagingService,
    workspaceId: string,
    delivery: IngressDelivery,
  ): Effect.fn.Return<IngressAnswer> {
    if (delivery.platform === "telegram") {
      yield* this.#deliverTelegram(workspaceId, delivery).pipe(
        Effect.catch((failure) => Effect.sync(() => this.#warn(failure.cause))),
      );
      return { status: 200 };
    }
    const record = this.#threads.store.connectionForWorkspace(delivery.platform, workspaceId);
    if (!record) return { status: 404 };
    if (!record.enabled) return { status: 200 };
    const transport = yield* this.#transportFor(record, delivery.queued === true);
    if (!transport?.deliver) return { status: 503 };
    return yield* transport.deliver(delivery);
  }).bind(this);

  readonly addTelegramOrchestrator = Effect.fn("MessagingService.addTelegramOrchestrator")(function* (
    this: MessagingService,
    input: AddTelegramOrchestratorInput,
  ) {
    return yield* this.#addSharedOrchestrator("telegram", input);
  }, Effect.uninterruptible).bind(this);

  readonly addWhatsAppOrchestrator = Effect.fn("MessagingService.addWhatsAppOrchestrator")(function* (
    this: MessagingService,
    input: AddTelegramOrchestratorInput,
  ) {
    return yield* this.#addSharedOrchestrator("whatsapp", input);
  }, Effect.uninterruptible).bind(this);

  readonly #addSharedOrchestrator = Effect.fn("MessagingService.addSharedOrchestrator")(function* (
    this: MessagingService,
    platform: "telegram" | "whatsapp",
    input: AddTelegramOrchestratorInput,
  ) {
    const records = this.#threads.store.connections().filter((record) => record.platform === platform);
    if (!records.length)
      return yield* new MessagingOperationFailed({
        cause: new Error(
          sourceText(
            platform === "telegram" ? "error.messaging.telegramNotConnected" : "error.messaging.whatsappNotConnected",
          ),
        ),
      });
    const current = this.#platformOrchestrator(platform);
    if (current) {
      this.#assignSharedOrchestrator(platform, current);
      return { agentId: current, sectionId: null };
    }
    const telegram = platform === "telegram";
    const agent = yield* this.#agents
      .createAgentProfile({
        ...(telegram ? telegramOrchestratorProfile() : whatsAppOrchestratorProfile()),
        ...(telegram ? TELEGRAM_ORCHESTRATOR_AVATAR : WHATSAPP_ORCHESTRATOR_AVATAR),
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
        startOnRunnableProvider: true,
      })
      .pipe(toMessagingOperationFailed);
    const memories = telegram ? telegramOrchestratorMemories() : whatsAppOrchestratorMemories();
    for (const text of memories) this.#agents.createMemory({ agentId: agent.id, text });
    this.#assignSharedOrchestrator(platform, agent.id);
    const sectionId = yield* this.#placeInIntegrations(agent.id).pipe(
      Effect.catch((failure) => {
        this.#warn(failure.cause);
        return Effect.succeed(null);
      }),
    );
    return { agentId: agent.id, sectionId };
  });

  readonly connectTelegramChat = Effect.fn("MessagingService.connectTelegramChat")(function* (
    this: MessagingService,
    place: ConnectTelegramChatInput["place"],
    opensPage: boolean,
  ): Effect.fn.Return<MessagingConnectPage, MessagingOperationFailed> {
    const { app, ingress } = yield* messagingStep(() => this.#requireTelegram());
    this.#endTelegramLinkLease();
    const release = ingress.acquire("telegram");
    const timer = setTimeout(() => this.#endTelegramLinkLease(), TELEGRAM_LINK_CODE_TTL_SECONDS * 1_000);
    timer.unref?.();
    this.#telegramLinkLease = { release, timer };
    const link = yield* Effect.all([this.#telegramReady(ingress), app.createLink()], { concurrency: "unbounded" }).pipe(
      Effect.map(([, created]) => created),
      Effect.onError(() => Effect.sync(() => this.#endTelegramLinkLease())),
    );
    const url = telegramLinkUrl(link.botUsername, link.code, place);
    if (opensPage) yield* messagingIo(() => app.openExternal(url));
    return { url, nonce: null };
  }).bind(this);

  #transportFor(
    record: { connectionId: string; enabled: boolean },
    queued: boolean,
  ): Effect.Effect<LiveConnection["transport"] | undefined> {
    const current = () => (record.enabled ? this.#live.get(record.connectionId)?.transport : undefined);
    const live = this.#live.get(record.connectionId);
    const starting = live ? STARTING_STATES.has(live.state) : !this.#connectionsStarted;
    if (current()?.deliver || !queued || !record.enabled || !starting) return Effect.sync(current);
    const deadline = this.#transportDeadlines.get(record.connectionId) ?? Date.now() + QUEUED_TRANSPORT_WAIT_MS;
    this.#transportDeadlines.set(record.connectionId, deadline);
    return Effect.callback<void>((resume) => {
      const waiters = this.#transportWaiters.get(record.connectionId) ?? new Set<() => void>();
      const ready = () => resume(Effect.void);
      waiters.add(ready);
      this.#transportWaiters.set(record.connectionId, waiters);
      return Effect.sync(() => {
        waiters.delete(ready);
        if (waiters.size === 0) this.#transportWaiters.delete(record.connectionId);
      });
    }).pipe(
      Effect.timeoutOrElse({ duration: Math.max(0, deadline - Date.now()), orElse: () => Effect.void }),
      Effect.map(current),
    );
  }

  #telegramReady(ingress: MessagingIngress): Effect.Effect<void, MessagingOperationFailed> {
    return Effect.callback<void, MessagingOperationFailed>((resume) => {
      const settled = (state: IngressState) => {
        if (ingress.telegram.available()) resume(Effect.void);
        else if (state === "online") resume(Effect.fail(telegramNotReady(state)));
        else return false;
        return true;
      };
      if (settled(ingress.state())) return;
      const stop = ingress.onState((state) => {
        if (settled(state)) stop();
      });
      return Effect.sync(stop);
    }).pipe(
      Effect.timeoutOrElse({
        duration: TELEGRAM_READY_TIMEOUT_MS,
        orElse: () =>
          Effect.suspend(() =>
            ingress.telegram.available() ? Effect.void : Effect.fail(telegramNotReady(ingress.state())),
          ),
      }),
    );
  }

  #endTelegramLinkLease(): void {
    const lease = this.#telegramLinkLease;
    this.#telegramLinkLease = null;
    if (!lease) return;
    clearTimeout(lease.timer);
    lease.release();
  }

  readonly disconnectTelegramChat = Effect.fn("MessagingService.disconnectTelegramChat")(function* (
    this: MessagingService,
    chatId: string,
  ) {
    const { app, ingress } = yield* messagingStep(() => this.#requireTelegram());
    const record = yield* messagingStep(() => this.#requireConnection("telegram", chatId));
    const orphan = yield* this.#orphanedOrchestrator(record);
    const botId = this.#credentials.get(record.connectionId)?.botId;
    yield* Effect.acquireUseRelease(
      Effect.sync(() => ingress.acquire("telegram")),
      () =>
        Effect.gen({ self: this }, function* () {
          yield* this.#stopConnection(record.connectionId);
          if (botId && record.lastErrorCode !== "removed")
            yield* ingress.telegram
              .call(botId, "leaveChat", { chat_id: Number(chatId) })
              .pipe(Effect.catch((failure) => Effect.sync(() => this.#warn(failure.cause))));
        }),
      (release) => Effect.sync(release),
    );
    yield* messagingStep(() => this.#threads.history.forget(record.connectionId));
    yield* this.#credentials.clear(record.connectionId);
    yield* messagingStep(() =>
      this.#threads.store.updateConnection(record.connectionId, { enabled: false, lastErrorCode: null }),
    );
    yield* app.unlink(chatId).pipe(Effect.catch((failure) => Effect.sync(() => this.#warn(failure.cause))));
    if (orphan) yield* this.#deleteOrchestrator(orphan);
  }, Effect.uninterruptible).bind(this);

  readonly #deliverTelegram = Effect.fn("MessagingService.deliverTelegram")(function* (
    this: MessagingService,
    chatId: string,
    delivery: Extract<IngressDelivery, { platform: "telegram" }>,
  ): Effect.fn.Return<void, MessagingOperationFailed> {
    const { botId } = delivery;
    const update = parseTelegramUpdate(delivery.body);
    if (!update) return;
    const link = delivery.linked ? telegramLink(update) : null;
    if (link) return yield* this.#linkTelegramChat(botId, chatId, link.title);
    const record = this.#threads.store.connectionForWorkspace("telegram", chatId);
    if (!record || (record.appId && record.appId !== botId)) return;
    const transport = yield* this.#transportFor(record, delivery.queued === true);
    if (transport?.deliver) {
      yield* transport.deliver(delivery);
      return;
    }
    if (
      record.lastErrorCode === "removed" ||
      this.#credentials.status(record.connectionId) === "missing" ||
      !telegramRemoval(update, botId, chatId)
    )
      return;
    yield* this.#stopConnection(record.connectionId);
    this.#threads.store.updateConnection(record.connectionId, { enabled: true, lastErrorCode: "removed" });
    if (this.#telegramApp)
      yield* this.#telegramApp
        .unlink(chatId)
        .pipe(Effect.catch((failure) => Effect.sync(() => this.#warn(failure.cause))));
  });

  readonly #linkTelegramChat = Effect.fn("MessagingService.linkTelegramChat")(function* (
    this: MessagingService,
    botId: string,
    chatId: string,
    title: string,
  ) {
    const { ingress } = yield* messagingStep(() => this.#requireTelegram());
    const record = yield* messagingStep(() => this.#threads.store.ensureConnection("telegram", chatId, title));
    yield* this.#stopConnection(record.connectionId);
    const me = yield* ingress.telegram.call(botId, "getMe", {}).pipe(Effect.catch(() => Effect.succeed({})));
    const botUsername = "username" in me && me.username ? me.username : "";
    yield* this.#credentials.set(record.connectionId, {
      botId,
      chatId,
      chatTitle: title,
      ...(botUsername ? { botUsername } : {}),
    });
    this.#threads.store.updateConnection(record.connectionId, {
      enabled: true,
      workspaceName: title,
      botUserId: botId,
      appId: botId,
      lastErrorCode: null,
      orchestratorAgentId: this.#orchestrator(record) ?? this.#platformOrchestrator("telegram"),
    });
    const updated = this.#threads.store.connection(record.connectionId);
    if (updated) yield* this.#startConnection(updated);
    this.#endTelegramLinkLease();
    const live = this.#live.get(record.connectionId);
    if (live)
      yield* live.adapter
        .post(
          { platformChannelId: chatId, replyThreadId: null },
          { text: sourceText("status.messaging.telegramLinked", { bot: botUsername ? `@${botUsername}` : "GoAhead" }) },
        )
        .pipe(Effect.catch((failure) => Effect.sync(() => this.#warn(failure.cause))));
  }, Effect.uninterruptible);

  #platformOrchestrator(platform: MessagingPlatform): string | null {
    const agents = new Set(this.#agents.listAgents().map((agent) => agent.id));
    for (const record of this.#threads.store.connections())
      if (record.platform === platform && record.orchestratorAgentId && agents.has(record.orchestratorAgentId))
        return record.orchestratorAgentId;
    return null;
  }

  #shareOrchestrator(platform: MessagingPlatform, agentId: string): void {
    for (const record of this.#threads.store.connections())
      if (record.platform === platform && !this.#orchestrator(record))
        this.#threads.store.updateConnection(record.connectionId, { orchestratorAgentId: agentId });
  }

  #assignSharedOrchestrator(platform: "telegram" | "whatsapp", agentId: string): void {
    for (const record of this.#threads.store.connections())
      if (record.platform === platform && record.orchestratorAgentId !== agentId)
        this.#threads.store.updateConnection(record.connectionId, { orchestratorAgentId: agentId });
  }

  readonly #startConnection = Effect.fn("MessagingService.startConnection")(function* (
    this: MessagingService,
    record: MessagingConnectionRecord,
  ) {
    const credentials = this.#credentials.get(record.connectionId);
    const driver = this.#drivers.get(record.platform);
    if (!driver || !credentials?.[driver.requiredCredential]) return;
    if (record.lastErrorCode === "removed") return;
    const live: LiveConnection = {
      record,
      adapter: driver.createAdapter(credentials, {
        connectionId: record.connectionId,
        rateLimited: (retryAt) => {
          live.retryAt = retryAt;
          this.#dispatch(this.#setState(live, "rate_limited"));
          const end = setTimeout(
            () => {
              if (this.#live.get(record.connectionId) !== live || live.retryAt !== retryAt) return;
              live.retryAt = null;
              if (live.state === "rate_limited") this.#dispatch(this.#setState(live, live.reported));
            },
            Math.max(0, Date.parse(retryAt) - Date.now()),
          );
          end.unref?.();
        },
      }),
      transport: null,
      identity: null,
      state: "connecting",
      reported: "connecting",
      retryAt: null,
    };
    this.#live.set(record.connectionId, live);
    const identified = yield* Effect.result(live.adapter.identify().pipe(toMessagingOperationFailed));
    if (Result.isFailure(identified)) {
      const error = identified.failure.cause;
      if (this.#live.get(record.connectionId) !== live) return;
      if (error instanceof MessagingConnectionError) return yield* this.#setState(live, error.state);
      const retry = setTimeout(() => {
        if (this.#live.get(record.connectionId) === live) this.#dispatch(this.#restart(record.connectionId));
      }, IDENTIFY_RETRY_MS);
      retry.unref?.();
      live.transport = {
        start: () => undefined,
        reconnect: () => this.#dispatch(this.#restart(record.connectionId)),
        stop: () => Effect.sync(() => clearTimeout(retry)),
      };
      return yield* this.#setState(live, "reconnecting");
    }
    live.identity = identified.success;
    if (this.#live.get(record.connectionId) !== live) return;
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
        live.reported = state;
        if (state === "connected") live.retryAt = null;
        this.#dispatch(this.#setState(live, state));
      },
      message: (message) => this.#dispatch(this.#receive(live, message)),
      action: (action) => this.#dispatch(this.#action(live, action)),
      renamed: (workspaceName) => this.#dispatch(this.#renamed(live, workspaceName)),
      placeCreated: (platformChannelId) => {
        const join = live.adapter.joinPlace?.(platformChannelId);
        if (join) this.#dispatch(join.pipe(toMessagingOperationFailed));
      },
      inbox: (candidate) => {
        void this.#keep(live, candidate).catch((error) => this.#warn(error));
        this.#autoReplyHeard(live, candidate);
      },
      history: (event) => this.#slackHistory(live, event),
      revoked: () => void this.#verifyTokens(live).catch((error) => this.#warn(error)),
    });
    this.#transportDeadlines.delete(record.connectionId);
    for (const ready of [...(this.#transportWaiters.get(record.connectionId) ?? [])]) ready();
    const join = live.adapter.joinPublicPlaces?.();
    if (join)
      yield* Effect.forkIn(
        join.pipe(Effect.catch((error) => Effect.sync(() => this.#warn(error.cause)))),
        this.#scope,
        { startImmediately: true },
      );
  });

  readonly #renamed = Effect.fn("MessagingService.renamed")(function* (
    this: MessagingService,
    live: LiveConnection,
    workspaceName: string,
  ) {
    const name = workspaceName.slice(0, 256);
    this.#threads.store.updateConnection(live.record.connectionId, { workspaceName: name });
    const values = this.#credentials.get(live.record.connectionId);
    if (values?.chatTitle !== undefined)
      yield* this.#credentials.set(live.record.connectionId, { ...values, chatTitle: name });
  });

  readonly #restart = Effect.fn("MessagingService.restart")(function* (
    this: MessagingService,
    connectionId: string,
  ): Effect.fn.Return<void, MessagingOperationFailed> {
    yield* this.#stopConnection(connectionId);
    const record = this.#threads.store.connection(connectionId);
    if (record?.enabled) yield* this.#startConnection(record);
  });

  readonly #stopConnection = Effect.fn("MessagingService.stopConnection")(function* (
    this: MessagingService,
    connectionId: string,
  ): Effect.fn.Return<void, MessagingOperationFailed> {
    const live = this.#live.get(connectionId);
    this.#live.delete(connectionId);
    this.#clearAutoReplyWaits((wait) => wait.connectionId === connectionId);
    this.#slackSync.stop(connectionId);
    const transport = live?.transport;
    if (transport) yield* transport.stop();
  });

  readonly #setState = Effect.fn("MessagingService.setState")(function* (
    this: MessagingService,
    live: LiveConnection,
    state: MessagingConnectionState,
  ) {
    const wasConnected = live.state === "connected";
    const wasFatal = FATAL_STATES.has(live.state);
    live.state = state;
    if (state === "connected" && !wasConnected && this.#live.get(live.record.connectionId) === live)
      this.#dispatch(this.#settleStatusPosts(live));
    if (FATAL_STATES.has(state)) {
      this.#threads.store.updateConnection(live.record.connectionId, { lastErrorCode: state });
      // A second fatal report for a stopped connection must not unlink the workspace again.
      if (wasFatal) return;
      logger.warn("A messaging connection stopped.", { platform: live.record.platform, state });
      // As on a disconnect: a later connect, perhaps as another person, must not auto-send.
      this.#threads.autoReply.clearConnection(live.record.connectionId);
      this.#autoReplyLoop.forget((key) => key.startsWith(`${live.record.connectionId}\n`));
      const unlink:
        | Effect.Effect<void, DiscordConnectFailed | SlackConnectFailed | MessagingOperationFailed>
        | undefined =
        live.record.platform === "whatsapp"
          ? undefined
          : live.record.platform === "telegram"
            ? this.#telegramApp?.unlink(live.record.workspaceId)
            : live.record.platform === "discord"
              ? this.#discordConnect?.unlink(live.record.workspaceId)
              : this.#connect?.unlink(live.record.workspaceId);
      if (unlink) yield* unlink.pipe(Effect.catch((error) => Effect.sync(() => this.#warn(error.cause))));
      if (state === "removed" && this.#live.get(live.record.connectionId) === live)
        yield* this.#stopConnection(live.record.connectionId);
    }
  });

  #summary(record: MessagingConnectionRecord): MessagingConnection {
    const live = this.#live.get(record.connectionId);
    const credentials = this.#credentials.status(record.connectionId);
    const values = credentials === "saved" ? this.#credentials.get(record.connectionId) : null;
    const stored = isOneOf(MESSAGING_CONNECTION_STATES, record.lastErrorCode) ? record.lastErrorCode : null;
    const required = this.#drivers.get(record.platform)?.requiredCredential;
    const state: MessagingConnectionState = !record.enabled
      ? "paused"
      : credentials === "unreadable" || (values && required && !values[required])
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

  readonly #receive = Effect.fn("MessagingService.receive")(function* (
    this: MessagingService,
    live: LiveConnection,
    message: InboundMessage,
  ) {
    if (!live.identity) return;
    // With the user's events, a direct message between the user and someone else arrives like one
    // to GoAhead. It is never a request: at most a reply to a message GoAhead sent as the user.
    if (
      !message.observed &&
      message.isDirect &&
      live.identity.user &&
      !(yield* Effect.promise(
        () => live.adapter.isOwnConversation?.(message.platformChannelId) ?? Promise.resolve(true),
      ))
    )
      return yield* Effect.promise(() => this.#observe(live, message));
    // GoAhead sent a message here for someone, as the app, a moment ago: an answer goes back to where
    // the send was asked for, not to a new conversation with GoAhead.
    if (!message.observed && (message.isDirect || message.groupDirect) && this.#answersAppSend(live, message))
      return yield* Effect.promise(() => this.#observe(live, message));
    if (!this.#authorAllowed(live.record.connectionId, message)) return;
    const store = this.#threads.store;
    const existing = store.linkByKey(live.record.connectionId, message.platformChannelId, message.threadKey);
    const pings =
      (live.record.platform === "slack" && !message.isDirect && (message.requiresLink || !existing)) ||
      (live.record.platform === "whatsapp" &&
        message.isDirect &&
        !existing &&
        message.authorId !== live.identity.botUserId)
        ? store.pings(live.record.connectionId, message.platformChannelId, message.threadKey)
        : [];
    const ping = pings.find((candidate) => candidate.userId === message.authorId) ?? null;
    const poster =
      live.record.platform === "whatsapp" &&
      ping &&
      this.#agents.listAgents().some((agent) => agent.id === ping.agentId)
        ? ping.agentId
        : null;
    if (message.requiresLink && (pings.length ? !ping : !existing)) return;
    const dedupKey = `${live.record.connectionId}:${message.dedupKey}`;
    if (this.#recent.has(dedupKey)) return;
    this.#recent.add(dedupKey);
    if (this.#recent.size > RECENT_MESSAGES) {
      const oldest = this.#recent.values().next().value;
      if (oldest !== undefined) this.#recent.delete(oldest);
    }
    if (existing && CANCEL_TEXT.test(message.text) && message.files.length === 0) {
      if (yield* this.#threads.stop(existing.linkId, message.authorId).pipe(toMessagingOperationFailed)) {
        yield* this.#react(live, message.target, message.platformMessageId, "stopped", true);
        return;
      }
    }
    const { adapter } = live;
    const [authorName, mentioned, place, earlier] = yield* Effect.all(
      [
        adapter.authorName(message.authorId).pipe(
          toMessagingOperationFailed,
          Effect.timeoutOrElse({
            duration: RECEIVE_NAME_DEADLINE_MS,
            orElse: () => Effect.succeed(message.authorId),
          }),
        ),
        mentionNames([...message.mentionedUserIds, ...(message.replyTo?.mentionedUserIds ?? [])], (userId) =>
          adapter.authorName(userId),
        ),
        message.isDirect
          ? Effect.succeed(null)
          : adapter.placeName(message.platformChannelId).pipe(
              toMessagingOperationFailed,
              Effect.timeoutOrElse({
                duration: RECEIVE_NAME_DEADLINE_MS,
                orElse: () => Effect.succeed(message.platformChannelId),
              }),
            ),
        (adapter.platform === "discord" || adapter.platform === "telegram") && !message.isDirect
          ? adapter
              .history(
                message.platformChannelId,
                message.threadKey,
                existing?.historyCursor ?? null,
                message.platformMessageId,
              )
              .pipe(
                Effect.timeoutOrElse({ duration: RECEIVE_CONTEXT_DEADLINE_MS, orElse: () => Effect.succeed([]) }),
                Effect.catch(() => Effect.succeed([])),
              )
          : Effect.succeed([]),
      ],
      { concurrency: "unbounded" },
    );
    const named = withMentionNames(message.text, mentioned);
    const quote = message.replyTo;
    const replyTo = quote
      ? { authorName: quote.authorName, text: withMentionNames(quote.text, mentioned), sentAt: quote.sentAt }
      : ping && !existing
        ? { authorName: this.#pingAuthor(live.record, ping.agentId), text: ping.text, sentAt: ping.createdAt }
        : null;
    if (live.record.platform === "discord" && !message.isDirect && !existing) {
      const workflows = yield* this.#threads.workflowMention({
        connectionId: live.record.connectionId,
        serverName: live.record.workspaceName,
        channelId: message.platformChannelId,
        channelName: place ?? message.platformChannelId,
        messageId: message.platformMessageId,
        authorId: message.authorId,
        authorName,
        authorRoleIds: message.authorRoleIds ?? [],
        text: named,
        files: message.files,
        receivedAt: new Date().toISOString(),
      });
      if (workflows === "skipped")
        yield* adapter
          .react(message.target, message.platformMessageId, "failed", true)
          .pipe(Effect.catch(() => Effect.void));
      if (workflows !== "none") return;
    }
    if (live.record.platform === "telegram" && !message.isDirect && !existing) {
      const workflows = yield* this.#threads.workflowTelegramMention({
        connectionId: live.record.connectionId,
        chatName: live.record.workspaceName,
        chatId: message.platformChannelId,
        threadKey: message.threadKey,
        messageId: message.platformMessageId,
        authorId: message.authorId,
        authorName,
        text: named,
        receivedAt: new Date().toISOString(),
      });
      if (workflows === "skipped")
        yield* adapter
          .react(message.target, message.platformMessageId, "failed", true)
          .pipe(Effect.catch(() => Effect.void));
      if (workflows !== "none") return;
    }
    if (live.record.platform === "slack" && !message.isDirect && !existing && !ping) {
      const workflows = yield* this.#threads.slackWorkflowMention({
        connectionId: live.record.connectionId,
        workspaceName: live.record.workspaceName,
        channelId: message.platformChannelId,
        channelName: place ?? message.platformChannelId,
        messageId: message.platformMessageId,
        threadId: message.threadKey,
        authorId: message.authorId,
        authorName,
        text: named,
        files: message.files,
        receivedAt: new Date().toISOString(),
      });
      if (workflows === "skipped")
        yield* adapter
          .react(message.target, message.platformMessageId, "failed", true)
          .pipe(Effect.catch(() => Effect.void));
      if (workflows !== "none") return;
    }
    const agentId = existing?.agentId ?? this.#orchestrator(live.record) ?? poster;
    if (!agentId) {
      if (live.record.platform === "whatsapp" && message.authorId !== live.identity.botUserId) return;
      const noAgent =
        live.record.platform === "discord"
          ? "status.messaging.discordNoAgent"
          : live.record.platform === "telegram"
            ? "status.messaging.telegramNoAgent"
            : live.record.platform === "whatsapp"
              ? "status.messaging.whatsappNoAgent"
              : "status.messaging.noAgent";
      yield* adapter.post(message.target, { text: sourceText(noAgent) }).pipe(toMessagingOperationFailed);
      return;
    }
    const staging = join(this.#downloadsRoot, randomUUID());
    yield* Effect.acquireUseRelease(
      Effect.succeed(staging),
      () =>
        Effect.gen({ self: this }, function* () {
          const delivered = (messageId: string) =>
            this.#threads.received(`messaging:${live.record.connectionId}:${message.platformChannelId}:${messageId}`);
          const gave = (messageId: string) => Boolean(existing) && delivered(messageId);
          const quoted =
            quote?.messageId && !gave(quote.messageId)
              ? (quote.files ?? []).map((file) => ({ file, label: `${quote.authorName}: ${file.name}` }))
              : [];
          const hasOwnFiles = message.files.length > 0 || quoted.length > 0;
          const earlierFiles = [
            ...quoted,
            ...(hasOwnFiles ? [] : earlier)
              .filter((entry) => !delivered(entry.id))
              .toReversed()
              .flatMap((entry) =>
                (entry.files ?? []).map((file) => ({ file, label: `${entry.authorName}: ${file.name}` })),
              ),
          ];
          const { paths, skipped } = yield* this.#download(
            adapter,
            [...message.files, ...earlierFiles.map((item) => item.file)],
            staging,
          );
          const given = earlierFiles.filter((item) => !skipped.has(item.file)).map((item) => item.label);
          const notGiven = earlierFiles.filter((item) => skipped.has(item.file)).map((item) => item.label);
          const missing = message.files.flatMap((file) => {
            const reason = skipped.get(file);
            return reason ? [`${file.name} (${reason})`] : [];
          });
          const notes = [
            given.length ? `(Files of earlier messages, given with this one: ${given.join(", ")})` : "",
            notGiven.length ? `(Files of earlier messages that were not given: ${notGiven.join(", ")})` : "",
            missing.length ? `(Files that did not arrive: ${missing.join(", ")})` : "",
          ].filter(Boolean);
          const text = notes.length ? `${named}\n\n${notes.join("\n")}` : named;
          const result = yield* this.#threads
            .receive({
              connectionId: live.record.connectionId,
              agentId,
              platformChannelId: message.platformChannelId,
              threadKey: message.threadKey,
              isDirect: message.isDirect,
              title: message.isDirect ? authorName : `${place} · ${named.slice(0, 80) || authorName}`,
              text,
              sourcePaths: paths,
              origin: {
                authorId: message.authorId,
                authorName,
                platformMessageId: message.platformMessageId,
                ...(replyTo ? { replyTo } : {}),
                ...(message.observed ? { isReply: true } : {}),
              },
              idempotencyKey: `messaging:${live.record.connectionId}:${message.dedupKey}`,
            })
            .pipe(toMessagingOperationFailed);
          if (result.status === "duplicate") return;
          const key = `${result.link.linkId}:${message.platformMessageId}`;
          if (result.status === "busy") {
            if (
              !this.#quietEnd(live.record.connectionId, message.target) &&
              !this.#withoutStatusPost(live.record.connectionId)
            )
              yield* adapter
                .post(message.target, { text: sourceText("status.messaging.busy") })
                .pipe(toMessagingOperationFailed);
            yield* this.#react(live, message.target, message.platformMessageId, "failed", true);
            return;
          }
          this.#targets.set(key, message.target);
          yield* this.#react(live, message.target, message.platformMessageId, "received", true);
          if (result.waiting)
            yield* this.#serial(
              result.link.linkId,
              Effect.gen({ self: this }, function* () {
                if (
                  this.#posts.has(key) ||
                  !this.#targets.has(key) ||
                  this.#withoutStatusPost(live.record.connectionId)
                )
                  return;
                const messageId = yield* adapter
                  .post(message.target, { text: sourceText("status.messaging.queued") })
                  .pipe(toMessagingOperationFailed);
                this.#posts.set(key, {
                  connectionId: live.record.connectionId,
                  target: message.target,
                  messageId,
                  stopToken: null,
                });
                this.#status.restored.delete(key);
                yield* this.#status.save();
              }),
            );
        }),
      () => messagingIo(() => rm(staging, { recursive: true, force: true })).pipe(Effect.orDie),
    );
  }, Effect.uninterruptible);

  #authorAllowed(connectionId: string, message: InboundMessage): boolean {
    const allowed = this.#threads.store.allowedRoles(connectionId);
    if (allowed.length === 0) return true;
    const roles = new Set(message.authorRoleIds ?? []);
    return allowed.some((role) => roles.has(role.id));
  }

  #pingAuthor(record: MessagingConnectionRecord, agentId: string): string {
    if (agentId === (this.#orchestrator(record) ?? agentId)) return "GoAhead, a post of yours";
    const name = this.#agents.listAgents().find((agent) => agent.id === agentId)?.name;
    return name ? `GoAhead, a post by your teammate ${name}` : "GoAhead";
  }

  #orchestrator(record: MessagingConnectionRecord): string | null {
    const id = this.#threads.store.connection(record.connectionId)?.orchestratorAgentId ?? null;
    return id && this.#agents.listAgents().some((agent) => agent.id === id) ? id : null;
  }

  readonly #download = Effect.fn("MessagingService.download")(function* (
    this: MessagingService,
    adapter: MessagingAdapter,
    files: readonly InboundFile[],
    staging: string,
  ) {
    const paths: string[] = [];
    const skipped = new Map<InboundFile, string>();
    let total = 0;
    for (const [index, file] of files.entries()) {
      if (paths.length >= INPUT_LIMITS.attachments) {
        skipped.set(file, `more than ${INPUT_LIMITS.attachments} files`);
        continue;
      }
      if (file.size > ATTACHMENT_LIMITS.fileBytes || total + file.size > ATTACHMENT_LIMITS.totalBytes) {
        skipped.set(file, "too large");
        continue;
      }
      const downloaded = yield* Effect.result(
        Effect.gen(function* () {
          yield* messagingIo(() => mkdir(join(staging, String(index)), { recursive: true, mode: 0o700 }));
          const destination = join(staging, String(index), basename(file.name) || "file");
          yield* adapter
            .download(file, destination, Math.min(ATTACHMENT_LIMITS.fileBytes, ATTACHMENT_LIMITS.totalBytes - total))
            .pipe(toMessagingOperationFailed);
          return destination;
        }),
      );
      if (Result.isFailure(downloaded)) {
        const cause = downloaded.failure.cause;
        skipped.set(file, tooLarge(cause) ? "too large" : "the download failed; the sender can send it again");
        this.#warn(cause, "A messaging file did not download.");
      } else {
        total += file.size;
        paths.push(downloaded.success);
      }
    }
    return { paths, skipped };
  });

  readonly #promptContext = Effect.fn("MessagingService.promptContext")(function* (
    this: MessagingService,
    link: MessagingLink,
    origin: MessagingOrigin,
  ) {
    const live = this.#live.get(link.connectionId);
    const workspaceName = live?.record.workspaceName ?? null;
    if (!live) return { workspaceName, place: link.title, messages: [], cursor: null, skippedFiles: [] };
    const place = link.isDirect
      ? "direct message"
      : yield* live.adapter.placeName(link.platformChannelId).pipe(toMessagingOperationFailed);
    // Every message of a person's direct message conversation already reached the agent's thread.
    const messages =
      link.threadKey === DIRECT_CONVERSATION_KEY
        ? []
        : yield* live.adapter
            .history(link.platformChannelId, link.threadKey, link.historyCursor, origin.platformMessageId)
            .pipe(Effect.catch(() => Effect.succeed([])));
    return {
      workspaceName,
      place,
      messages,
      cursor: origin.platformMessageId,
      skippedFiles: [],
      ownerId: live.identity?.user?.id ?? null,
    };
  });

  readonly #recentMessages = Effect.fn("MessagingService.recentMessages")(function* (
    this: MessagingService,
    link: MessagingLink,
    scope: MessagingHistoryScope,
    limit: number,
    filter: HistoryFilter,
  ): Effect.fn.Return<MessagingHistory | null, MessagingOperationFailed> {
    const live = this.#live.get(link.connectionId);
    if (!live?.identity) return null;
    const place = link.isDirect
      ? "direct message"
      : yield* live.adapter.placeName(link.platformChannelId).pipe(toMessagingOperationFailed);
    const recent = yield* filteredRecent(
      live.adapter,
      link.platformChannelId,
      scope === "conversation" ? link.threadKey : null,
      limit,
      filter,
    ).pipe(toMessagingOperationFailed);
    return { platform: live.record.platform, place, ...recent };
  });

  readonly #outboundPlaces = Effect.fn("MessagingService.outboundPlaces")(function* (
    this: MessagingService,
    connectionId: string,
  ) {
    const live = this.#live.get(connectionId);
    if (!live?.identity) return { error: MESSAGING_NOT_RUNNING };
    const whatsApp = live.record.platform === "whatsapp";
    return yield* live.adapter.places().pipe(
      Effect.map((list) => (whatsApp ? { ...list, note: WHATSAPP_ALLOWED_PLACES } : list)),
      Effect.catch((failure) => Effect.succeed({ error: refusal(failure) })),
    );
  });

  readonly #outboundHistory = Effect.fn("MessagingService.outboundHistory")(function* (
    this: MessagingService,
    connectionId: string,
    placeId: string,
    limit: number,
    filter: HistoryFilter,
  ) {
    const live = this.#live.get(connectionId);
    if (!live?.identity) return { error: MESSAGING_NOT_RUNNING };
    const platform = live.record.platform;
    return yield* Effect.gen(function* () {
      const place = (yield* live.adapter.places()).places.find((candidate) => candidate.id === placeId);
      if (!place)
        return {
          error:
            "This connection has no place with that id. Call openbot.messaging_list_places with the connection for the ids.",
        };
      const recent = yield* filteredRecent(live.adapter, placeId, null, limit, filter);
      return { history: { platform, place: place.name, ...recent } };
    }).pipe(
      Effect.catch((failure) =>
        Effect.succeed({ error: `${refusal(failure)} When the platform limits reads, try again in a minute.` }),
      ),
    );
  });

  readonly #outboundPost = Effect.fn("MessagingService.outboundPost")(function* (
    this: MessagingService,
    connectionId: string,
    named: MessageTarget,
    markdown: string,
    files: MessagingAnswerFile[] = [],
    embeds: DiscordEmbed[] = [],
  ) {
    const live = this.#live.get(connectionId);
    if (!live?.identity) return { error: MESSAGING_NOT_RUNNING, failure: "not-running" as const };
    const target = {
      ...named,
      platformChannelId: live.adapter.placeId?.(named.platformChannelId) ?? named.platformChannelId,
    };
    const postEmbeds = live.adapter.postEmbeds;
    if (embeds.length && !postEmbeds)
      return { error: "Only a Discord post can have embeds. Post the text alone.", failure: "refused" as const };
    if (live.record.platform === "telegram" && target.platformChannelId !== live.identity.workspaceId)
      return {
        error: "A Telegram connection posts only in its own chat. Use the connection of that chat.",
        failure: "refused" as const,
      };
    const guildId = live.record.platform === "discord" ? live.identity.workspaceId : null;
    const text = redactPostText(markdown);
    const botUserId = live.identity.botUserId;
    const pinged =
      live.record.platform === "slack" ? slackPingedUsers(text).filter((userId) => userId !== botUserId) : [];
    const direct = live.adapter.directChat?.(target) ?? null;
    const directPing = (posted: string) =>
      direct
        ? {
            ping: {
              userIds: [direct.userId],
              text: posted,
              platformChannelId: target.platformChannelId,
              threadKey: direct.threadKey,
            },
          }
        : {};
    if (!text.trim() && !embeds.length && files.length) {
      const result = yield* Effect.result(live.adapter.upload(target, files));
      if (Result.isFailure(result))
        return {
          error: `${refusal(result.failure)} A file can be in the place already. Do not post it again only because of this error.`,
          failure: "unknown" as const,
        };
      const uploaded = result.success;
      const sentFiles = files.map((file) => file.name).filter((name) => !uploaded.skipped.includes(name));
      if (!sentFiles.length)
        return {
          error:
            "No file was sent: a file can be empty, too large for the platform or not readable, or its send failed on the way. A file can be in the place already. Do not post it again only because of this error.",
          failure: "unknown" as const,
        };
      if (uploaded.firstId) live.adapter.rememberPost?.(target, uploaded.firstId, `Files: ${sentFiles.join(", ")}`);
      return {
        posted: true as const,
        ...(uploaded.firstId ? { messageId: uploaded.firstId } : {}),
        ...(uploaded.skipped.length ? { skippedFiles: uploaded.skipped } : {}),
        ...directPing(`Files: ${sentFiles.join(", ")}`),
      };
    }
    const single = files.length === 1 && !embeds.length ? files[0] : undefined;
    if (single && live.adapter.postFileWithText) {
      const captioned = yield* Effect.result(live.adapter.postFileWithText(target, text, single));
      if (Result.isFailure(captioned))
        return {
          error: refusal(captioned.failure),
          failure: "unknown" as const,
        };
      if (captioned.success) {
        live.adapter.rememberPost?.(target, captioned.success, `${text}\nFiles: ${single.name}`);
        return {
          posted: true as const,
          messageId: captioned.success,
          ...(guildId
            ? { url: `https://discord.com/channels/${guildId}/${target.platformChannelId}/${captioned.success}` }
            : {}),
          ...directPing(`${text}\nFiles: ${single.name}`),
        };
      }
    }
    const posted = yield* (
      postEmbeds && embeds.length
        ? postEmbeds.call(live.adapter, target, text, embeds.map(redactEmbed))
        : live.adapter.postAnswer(target, text, null)
    ).pipe(
      Effect.map((messageId) => ({
        posted: true as const,
        messageId,
        ...(guildId ? { url: `https://discord.com/channels/${guildId}/${target.platformChannelId}/${messageId}` } : {}),
        ...(pinged.length ? { ping: { userIds: pinged, text } } : directPing(text)),
      })),
      Effect.catch((failure) =>
        Effect.succeed({
          error: `${refusal(failure)} A long text goes in more than one post, so a part of it can be posted already. Do not post it again only because of this error.`,
          failure: "unknown" as const,
        }),
      ),
    );
    if (!("posted" in posted)) return posted;
    const skippedFiles = files.length
      ? yield* live.adapter.upload(target, files).pipe(
          Effect.map((uploaded) => uploaded.skipped),
          Effect.catch((failure) =>
            Effect.sync(() => {
              this.#warn(failure.cause);
              return files.map((file) => file.name);
            }),
          ),
        )
      : [];
    const sentFiles = files.map((file) => file.name).filter((name) => !skippedFiles.includes(name));
    live.adapter.rememberPost?.(
      target,
      posted.messageId,
      sentFiles.length ? `${text}\nFiles: ${sentFiles.join(", ")}` : text,
    );
    return skippedFiles.length ? { ...posted, skippedFiles } : posted;
  });

  readonly #outboundDiscord = Effect.fn("MessagingService.outboundDiscord")(function* (
    this: MessagingService,
    connectionId: string,
    send: MessagingDiscordSend,
  ) {
    const live = this.#live.get(connectionId);
    if (!live?.identity || live.record.platform !== "discord" || !live.adapter.addEmoji)
      return { failure: "not-running" as const };
    if (send.action === "react")
      return yield* live.adapter
        .addEmoji({ platformChannelId: send.channelId, replyThreadId: null }, send.messageId, send.emoji)
        .pipe(
          Effect.as({ posted: true as const }),
          Effect.catch((failure) =>
            Effect.sync(() => {
              this.#warn(failure.cause);
              return { failure: "refused" as const };
            }),
          ),
        );
    const target = {
      platformChannelId: send.channelId,
      replyThreadId: send.action === "reply" ? send.messageId : null,
    };
    const result = yield* this.#outboundPost(connectionId, target, send.text);
    return "posted" in result ? { posted: true as const } : { failure: result.failure };
  });

  readonly #outboundTelegram = Effect.fn("MessagingService.outboundTelegram")(function* (
    this: MessagingService,
    connectionId: string,
    send: MessagingTelegramSend,
  ) {
    const live = this.#live.get(connectionId);
    if (!live?.identity || live.record.platform !== "telegram" || !live.adapter.addEmoji)
      return { failure: "not-running" as const };
    const chatId = live.identity.workspaceId;
    if (send.action === "react")
      return yield* live.adapter
        .addEmoji({ platformChannelId: chatId, replyThreadId: null }, send.messageId, send.emoji)
        .pipe(
          Effect.as({ posted: true as const }),
          Effect.catch((failure) =>
            Effect.sync(() => {
              this.#warn(failure.cause);
              return { failure: "refused" as const };
            }),
          ),
        );
    const target = {
      platformChannelId: chatId,
      replyThreadId: send.action === "reply" ? `${send.threadKey}:${send.messageId}` : null,
    };
    const result = yield* this.#outboundPost(connectionId, target, send.text);
    return "posted" in result ? { posted: true as const } : { failure: result.failure };
  });

  readonly #outboundSlack = Effect.fn("MessagingService.outboundSlack")(function* (
    this: MessagingService,
    connectionId: string,
    send: MessagingSlackSend,
  ) {
    const live = this.#live.get(connectionId);
    if (!live?.identity || live.record.platform !== "slack" || !live.adapter.addEmoji)
      return { failure: "not-running" as const };
    if (send.action === "react")
      return yield* live.adapter
        .addEmoji({ platformChannelId: send.channelId, replyThreadId: null }, send.messageId, send.emoji)
        .pipe(
          Effect.as({ posted: true as const }),
          Effect.catch((failure) =>
            Effect.sync(() => {
              this.#warn(failure.cause);
              return { failure: "refused" as const };
            }),
          ),
        );
    const target = {
      platformChannelId: send.channelId,
      replyThreadId: send.action === "reply" ? send.threadId : null,
    };
    const result = yield* this.#outboundPost(connectionId, target, send.text);
    return "posted" in result ? { posted: true as const } : { failure: result.failure };
  });

  readonly #activity = Effect.fn("MessagingService.activity")(function* (
    this: MessagingService,
    activity: MessagingActivity,
  ) {
    if (!activity.origin) return;
    const live = this.#live.get(activity.link.connectionId);
    const origin = activity.origin;
    const key = `${activity.link.linkId}:${origin.platformMessageId}`;
    const target = this.#targets.get(key) ?? linkTarget(activity.link);
    const post = this.#posts.get(key);
    if (activity.type === "progress") {
      if (!live || !post?.messageId || !post.stopToken || post.final) return;
      const text = redactPostText(activity.text).replace(MENTION_MARKERS, "");
      yield* live.adapter
        .edit(target, post.messageId, {
          text: text.length > PROGRESS_TEXT_LIMIT ? `${text.slice(0, PROGRESS_TEXT_LIMIT - 1)}…` : text,
          buttons: [{ action: "stop" as const, label: sourceText("status.messaging.stop"), token: post.stopToken }],
        })
        .pipe(Effect.catch((failure) => Effect.sync(() => this.#warn(failure.cause))));
      return;
    }
    if (activity.type === "started") {
      if (!live) return;
      if (!post?.messageId && (activity.teammateRequest || this.#withoutStatusPost(live.record.connectionId))) {
        this.#posts.set(key, { connectionId: live.record.connectionId, target, messageId: null, stopToken: null });
        this.#status.restored.delete(key);
        yield* this.#status.save();
        return;
      }
      const stopToken = token();
      this.#stops.set(stopToken, {
        linkId: activity.link.linkId,
        authorId: origin.authorId,
        connectionId: live.record.connectionId,
      });
      if (post?.stopToken) this.#stops.delete(post.stopToken);
      const body = {
        text: sourceText("status.messaging.working"),
        buttons: [{ action: "stop" as const, label: sourceText("status.messaging.stop"), token: stopToken }],
      };
      const existingMessageId = post?.messageId ?? null;
      this.#posts.set(key, { connectionId: live.record.connectionId, target, messageId: existingMessageId, stopToken });
      this.#status.restored.delete(key);
      const messageId = existingMessageId
        ? yield* live.adapter
            .edit(target, existingMessageId, body)
            .pipe(toMessagingOperationFailed)
            .pipe(Effect.as(existingMessageId))
        : yield* live.adapter.post(target, body).pipe(toMessagingOperationFailed);
      this.#posts.set(key, { connectionId: live.record.connectionId, target, messageId, stopToken });
      yield* this.#status.save();
      return;
    }
    this.#targets.delete(key);
    const final = finalPost(
      activity,
      this.#threads.awaitsTeammate(activity.link.linkId),
      this.#quietEnd(activity.link.connectionId, target),
      this.#withoutStatusPost(activity.link.connectionId),
      live !== undefined,
    );
    if (final.answer && live?.record.platform === "slack") {
      const botUserId = live.identity?.botUserId;
      const userIds = slackPingedUsers(final.text).filter((userId) => userId !== botUserId);
      if (userIds.length)
        yield* this.#threads.recordPings({
          connectionId: activity.link.connectionId,
          platformChannelId: activity.link.platformChannelId,
          threadKey: activity.link.threadKey,
          userIds,
          agentId: activity.link.agentId,
          text: final.text,
        });
    }
    const ended: StatusPost = {
      connectionId: activity.link.connectionId,
      target,
      messageId: post?.messageId ?? null,
      stopToken: post?.stopToken ?? null,
      final,
    };
    this.#posts.set(key, ended);
    this.#status.restored.delete(key);
    yield* this.#status.save();
    if (!live) return;
    yield* this.#deliverFinal(live, key, ended);
    if (activity.type === "finished" && activity.status === "completed" && activity.files.length) {
      const { adapter } = live;
      const { skipped } = yield* adapter.upload(target, activity.files).pipe(toMessagingOperationFailed);
      if (skipped.length)
        yield* adapter
          .post(target, {
            text: sourceText("status.messaging.filesSkipped", { names: skipped.join(", ") }),
          })
          .pipe(toMessagingOperationFailed);
    }
  });

  readonly #deliverFinal = Effect.fn("MessagingService.deliverFinal")(function* (
    this: MessagingService,
    live: LiveConnection,
    key: string,
    post: StatusPost,
  ) {
    const final = post.final;
    if (!final || this.#posts.get(key) !== post) return;
    const { adapter } = live;
    const placeholder = (this.#finalFailures.get(key) ?? 0) + 1 >= FINAL_POST_ATTEMPTS ? null : post.messageId;
    yield* Effect.gen({ self: this }, function* () {
      if (final.reaction) {
        const platformMessageId = key.slice(key.indexOf(":") + 1);
        yield* this.#react(live, post.target, platformMessageId, "received", false);
        yield* this.#react(live, post.target, platformMessageId, final.reaction, true);
      }
      if (final.answer)
        yield* adapter.postAnswer(post.target, final.text, placeholder).pipe(toMessagingOperationFailed);
      else if (final.text) yield* this.#say(adapter, post.target, placeholder, final.text);
      else if (placeholder && adapter.remove)
        yield* adapter.remove(post.target, placeholder).pipe(toMessagingOperationFailed);
      else if (placeholder)
        yield* this.#say(adapter, post.target, placeholder, sourceText("status.messaging.noAnswer"));
    }).pipe(
      Effect.tapError((failure) =>
        Effect.gen({ self: this }, function* () {
          const cause = failure instanceof MessagingOperationFailed ? failure.cause : null;
          const partlySent = cause instanceof WhatsAppAnswerPartlySent;
          if ((partlySent ? cause.cause : cause) instanceof WhatsAppRefusedError)
            return yield* this.#forgetPost(key, post);
          const quiet = final.answer && this.#quietEnd(live.record.connectionId, post.target);
          if (quiet && partlySent) return yield* this.#forgetPost(key, post);
          const failures = (this.#finalFailures.get(key) ?? 0) + 1;
          this.#finalFailures.set(key, failures);
          let current = post;
          if (final.answer) {
            current = {
              ...post,
              final: { answer: false, text: quiet ? "" : sourceText("status.messaging.failed"), reaction: null },
            };
            this.#posts.set(key, current);
            yield* this.#status.save();
          }
          if (failures < FINAL_POST_ATTEMPTS) return this.#settleLater(live.record.connectionId);
          yield* this.#forgetPost(key, current);
        }),
      ),
    );
    yield* this.#forgetPost(key, post);
  });

  readonly #forgetPost = Effect.fn("MessagingService.forgetPost")(function* (
    this: MessagingService,
    key: string,
    post: StatusPost,
  ) {
    this.#finalFailures.delete(key);
    if (this.#posts.get(key) === post) this.#posts.delete(key);
    if (post.stopToken) this.#stops.delete(post.stopToken);
    yield* this.#status.save();
  });

  readonly #settleStatusPosts = Effect.fn("MessagingService.settleStatusPosts")(function* (
    this: MessagingService,
    live: LiveConnection,
  ) {
    const connectionId = live.record.connectionId;
    for (const [key, stored] of [...this.#posts]) {
      if (stored.connectionId !== connectionId) continue;
      const linkId = key.slice(0, key.indexOf(":"));
      let post = stored;
      if (!post.final) {
        if (!this.#status.restored.has(key)) continue;
        if (this.#threads.isPending(linkId, key.slice(linkId.length + 1))) continue;
        this.#status.restored.delete(key);
        const quiet = this.#withoutStatusPost(connectionId) || this.#quietEnd(connectionId, post.target);
        const text = quiet ? "" : sourceText("status.messaging.stopped");
        post = { ...post, final: { answer: false, text, reaction: "stopped" } };
        this.#posts.set(key, post);
      }
      this.#dispatch(this.#serial(linkId, this.#deliverFinal(live, key, post)));
    }
    const unposted = new Set([...this.#approvals.values()].filter((pending) => pending.connectionId === connectionId));
    for (const pending of unposted) {
      if (pending.messageId === null && !pending.answered && !pending.posting)
        this.#dispatch(this.#postApproval(live, pending));
    }
  });

  #settleLater(connectionId: string): void {
    if (!this.#started || this.#settleTimers.has(connectionId)) return;
    const timer = setTimeout(() => {
      this.#settleTimers.delete(connectionId);
      const live = this.#live.get(connectionId);
      if (live?.state === "connected") this.#dispatch(this.#settleStatusPosts(live));
      else if (live) this.#settleLater(connectionId);
    }, SETTLE_RETRY_MS);
    timer.unref?.();
    this.#settleTimers.set(connectionId, timer);
  }

  readonly #say = Effect.fn("MessagingService.say")(function* (
    this: MessagingService,
    adapter: MessagingAdapter,
    target: MessageTarget,
    placeholder: string | null,
    text: string,
  ) {
    if (placeholder) yield* adapter.edit(target, placeholder, { text }).pipe(toMessagingOperationFailed);
    else yield* adapter.post(target, { text }).pipe(toMessagingOperationFailed);
  });

  #dispatch<A>(operation: Effect.Effect<A, MessagingOperationFailed>): void {
    if (!this.#started) return;
    Effect.runFork(
      operation.pipe(
        Effect.catch((error) => Effect.sync(() => this.#warn(error.cause))),
        Effect.uninterruptible,
        Effect.forkIn(this.#scope, { startImmediately: true }),
      ),
    );
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
    const send = Effect.gen({ self: this }, function* () {
      const adapter = this.#live.get(post.connectionId)?.adapter;
      if (!adapter) return;
      if (post.messageId) yield* adapter.edit(post.target, post.messageId, { text });
      else post.messageId = yield* adapter.post(post.target, { text });
    }).pipe(
      toMessagingOperationFailed,
      Effect.ensuring(
        Effect.sync(() => {
          post.sentText = text;
          post.lastSentAt = Date.now();
          post.sending = false;
          this.#flushHandoffPost(linkId);
        }),
      ),
    );
    this.#dispatch(this.#serial(linkId, send));
  }

  #agentEvent(event: AgentEvent): void {
    // Only main-thread turns come here: the turns of a reply context come from `onReplyContextTurn`.
    if (event.type === "turn-started" || event.type === "turn-completed")
      this.#autoReplyTurn({
        type: event.type === "turn-started" ? "started" : "completed",
        agentId: event.agentId,
        threadId: event.threadId,
        turnId: event.turnId,
        status: event.type === "turn-completed" ? event.status : null,
      });
    // A local-only approval (a mail to send, a meeting to book) holds private text, and only the
    // person at this computer answers it: it never goes to Slack.
    if (event.type === "approval" && isLocalOnlyApprovalRequestId(event.approval.requestId)) return;
    if (event.type === "approval")
      this.#dispatch(
        this.#approval(
          event.approval,
          this.#agents.approvalExecutionThreadId(event.approval.requestId) ?? event.approval.threadId,
        ),
      );
    else if (event.type === "agent-input-resolved" && event.kind === "approval")
      this.#dispatch(this.#approvalResolved(event.requestId));
  }

  readonly #approval = Effect.fn("MessagingService.approval")(function* (
    this: MessagingService,
    approval: AgentApproval,
    executionThreadId: string,
  ) {
    const own = this.#threads.store.linkForThread(executionThreadId);
    const request = own ? null : this.#threads.teammateRequest(approval.agentId, approval.turnId);
    const link = own ?? request?.link;
    if (!link) return;
    const origin = request?.origin ?? this.#threads.runningOrigin(link.linkId)?.origin;
    const key = origin ? `${link.linkId}:${origin.platformMessageId}` : null;
    const target = (key && this.#targets.get(key)) || (key && this.#posts.get(key)?.target) || linkTarget(link);
    const teammate = request
      ? this.#agents
          .listAgents()
          .find((agent) => agent.id === approval.agentId)
          ?.name.replace(MENTION_MARKERS, "")
      : undefined;
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
      teammate
        ? sourceText("status.messaging.approvalTitleTeammate", { agent: teammate })
        : sourceText("status.messaging.approvalTitle"),
      `**${kind}**`,
      detail ? `\`\`\`\n${detail}\n\`\`\`` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const accept = token();
    const decline = token();
    const pending: PendingApproval = {
      requestId: approval.requestId,
      connectionId: link.connectionId,
      target,
      messageId: null,
      allowedUserId: origin?.authorId ?? null,
      text,
      answered: false,
      accept,
      decline,
      posting: false,
    };
    this.#approvals.set(accept, pending);
    this.#approvals.set(decline, pending);
    const live = this.#live.get(link.connectionId);
    if (live) yield* this.#postApproval(live, pending);
  });

  readonly #postApproval = Effect.fn("MessagingService.postApproval")(function* (
    this: MessagingService,
    live: LiveConnection,
    pending: PendingApproval,
  ) {
    pending.posting = true;
    yield* live.adapter
      .post(pending.target, {
        text: pending.text,
        buttons: [
          { action: "accept", label: sourceText("status.messaging.approve"), token: pending.accept, style: "primary" },
          { action: "decline", label: sourceText("status.messaging.deny"), token: pending.decline, style: "danger" },
        ],
      })
      .pipe(
        toMessagingOperationFailed,
        Effect.tap((messageId) =>
          Effect.sync(() => {
            pending.messageId = messageId;
          }),
        ),
        Effect.tapError(() => Effect.sync(() => this.#settleLater(pending.connectionId))),
        Effect.ensuring(
          Effect.sync(() => {
            pending.posting = false;
          }),
        ),
      );
  });

  /**
   * GoAhead: posts a drafted message with Approve and Deny, and keeps it under both button tokens.
   * A draft is stored before its post, so a press that arrives before Slack's answer finds it too.
   */
  async #postWithButtons(live: LiveConnection, pending: PendingSend): Promise<void> {
    const accept = token();
    const decline = token();
    this.#sendApprovals.set(accept, pending);
    this.#sendApprovals.set(decline, pending);
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
      pending.messageId = await runCauseEffect(
        live.adapter.post(pending.target, {
          text: pending.text,
          buttons: [
            { action: "accept", label: sourceText("status.messaging.approve"), token: accept, style: "primary" },
            { action: "decline", label: sourceText("status.messaging.deny"), token: decline, style: "danger" },
          ],
        }),
      );
      if (pending.messageId && !pending.answered)
        this.#threads.drafts.setMessageId(pending.draft.draftId, pending.messageId);
    } catch (error) {
      this.#sendApprovals.delete(accept);
      this.#sendApprovals.delete(decline);
      this.#threads.drafts.claim(pending.draft.draftId);
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
    // Only the person's own request goes out as them. Anyone else's, and a teammate's answer that
    // carries the person's origin, goes out as the GoAhead app.
    const ownRequest = running?.fromPerson === true && running.origin.authorId === approverId;
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
          ? await runCauseEffect(adapter.placeName(to.id)).catch(() => to.id)
          : (await Promise.all(slackTargetPeople(to).map((id) => runCauseEffect(adapter.authorName(id))))).join(", "),
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
        ? await runCauseEffect(adapter.placeName(to.id)).catch(() => to.id)
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
    const running = channelId
      ? this.#runningAutoReply(request.agentId, connectionId, channelId, request.threadId)
      : null;
    if (!channelId || !running || !this.#threads.autoReply.isOn(connectionId, channelId))
      throw new Error(sourceText("error.messaging.sendNeedsSlack"));
    // A pause or quiet hours refuse at once: with no Slack conversation, no draft can wait.
    const blocked = this.#sendBlock(live.record);
    if (blocked) throw new Error(blocked);
    const recipient =
      to.kind === "channel"
        ? await runCauseEffect(live.adapter.placeName(to.id)).catch(() => to.id)
        : (await Promise.all(slackTargetPeople(to).map((id) => runCauseEffect(live.adapter.authorName(id))))).join(
            ", ",
          );
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
    // The reply went out, so the messages it answered stay read even if the turn fails later.
    this.#commitReadMark(running);
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
            ids.map((id) =>
              to.kind === "channel"
                ? runCauseEffect(live.adapter.placeName(id))
                : runCauseEffect(live.adapter.authorName(id)),
            ),
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
      ? await runCauseEffect(live.adapter.placeName(to.id)).catch(() => to.id)
      : (await Promise.all(slackTargetPeople(to).map((id) => runCauseEffect(live.adapter.authorName(id))))).join(", ");
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

  readonly #approvalResolved = Effect.fn("MessagingService.approvalResolved")(function* (
    this: MessagingService,
    requestId: string | number,
  ) {
    const entries = [...this.#approvals.entries()].filter(([, pending]) => pending.requestId === requestId);
    const pending = entries[0]?.[1];
    for (const [key] of entries) this.#approvals.delete(key);
    if (!pending || pending.answered) return;
    const live = this.#live.get(pending.connectionId);
    const messageId = pending.messageId;
    if (!messageId || !live) return;
    yield* live.adapter
      .edit(pending.target, messageId, {
        text: `${pending.text}\n${sourceText("status.messaging.answeredOnHost")}`,
      })
      .pipe(toMessagingOperationFailed);
  });

  readonly #action = Effect.fn("MessagingService.action")(function* (
    this: MessagingService,
    live: LiveConnection,
    action: InboundAction,
  ) {
    const { adapter } = live;
    if (action.type === "stop") {
      const stop = this.#stops.get(action.token);
      if (!stop || stop.connectionId !== live.record.connectionId) return;
      if (action.actorId !== stop.authorId) {
        yield* adapter
          .postPrivate(
            action.target,
            action.actorId,
            sourceText("status.messaging.onlyRequester", { user: adapter.mention(stop.authorId) }),
            action.replyHandle,
          )
          .pipe(toMessagingOperationFailed);
        return;
      }
      yield* this.#threads.stop(stop.linkId, stop.authorId).pipe(toMessagingOperationFailed);
      return;
    }
    const draft = this.#sendApprovals.get(action.token);
    if (draft) {
      // GoAhead: a drafted message that the connected person approves or denies.
      yield* Effect.promise(() => this.#answerDraftPress(live, draft, action).catch((error) => this.#warn(error)));
      return;
    }
    const pending = this.#approvals.get(action.token);
    if (!pending || pending.connectionId !== live.record.connectionId || pending.answered) {
      yield* adapter
        .edit(action.target, action.platformMessageId, { text: sourceText("status.messaging.requestInactive") })
        .pipe(Effect.catch(() => Effect.void));
      return;
    }
    if (!pending.allowedUserId || action.actorId !== pending.allowedUserId) {
      yield* adapter
        .postPrivate(
          action.target,
          action.actorId,
          pending.allowedUserId
            ? sourceText("status.messaging.onlyRequester", { user: adapter.mention(pending.allowedUserId) })
            : sourceText("status.messaging.hostOnly"),
          action.replyHandle,
        )
        .pipe(toMessagingOperationFailed);
      return;
    }
    pending.answered = true;
    const answered = yield* Effect.result(
      this.#agents
        .respondToApproval({ requestId: pending.requestId, decision: action.decision })
        .pipe(toMessagingOperationFailed),
    );
    const outcome = Result.isFailure(answered)
      ? sourceText("status.messaging.requestInactive")
      : sourceText(action.decision === "accept" ? "status.messaging.approvedBy" : "status.messaging.deniedBy", {
          user: adapter.mention(action.actorId),
        });
    for (const [key, candidate] of this.#approvals) if (candidate === pending) this.#approvals.delete(key);
    yield* adapter
      .edit(pending.target, pending.messageId ?? action.platformMessageId, {
        text: `${pending.text}\n${outcome}`,
      })
      .pipe(toMessagingOperationFailed);
  }, Effect.uninterruptible);

  /** GoAhead: a press on a draft's Approve or Deny. Only the person who connected the workspace may press. */
  async #answerDraftPress(
    live: LiveConnection,
    pending: PendingSend,
    action: Exclude<InboundAction, { type: "stop" }>,
  ): Promise<void> {
    const { adapter } = live;
    // A second press while the first one still runs must not send or answer twice.
    if (pending.connectionId !== live.record.connectionId || pending.answered) {
      await runCauseEffect(
        adapter.edit(action.target, action.platformMessageId, { text: sourceText("status.messaging.requestInactive") }),
      ).catch(() => undefined);
      return;
    }
    if (action.actorId !== pending.allowedUserId) {
      await runCauseEffect(
        adapter.postPrivate(
          action.target,
          action.actorId,
          sourceText("status.messaging.onlyRequester", { user: adapter.mention(pending.allowedUserId) }),
          action.replyHandle,
        ),
      );
      return;
    }
    // An approval that cannot send now leaves the draft waiting; a denial always counts.
    const blocked = action.decision === "accept" ? this.#sendBlock(live.record) : null;
    if (blocked) {
      await runCauseEffect(adapter.postPrivate(action.target, action.actorId, blocked, action.replyHandle));
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
  /**
   * Answers one drafted message once, from a Slack button or the desktop, and shows the result in
   * place of the buttons. `answered` is set before any await, so a second answer finds it taken.
   */
  async #finishApproval(
    live: LiveConnection,
    pending: PendingSend,
    decision: "accept" | "decline",
    actorId: string,
    pressedMessageId: string | null,
  ): Promise<void> {
    const { adapter } = live;
    // A stored draft is taken from the database first: if its row is gone, another answer, before or
    // after a restart, already took it, and it must not be sent again.
    const claimed = this.#threads.drafts.claim(pending.draft.draftId);
    pending.answered = true;
    const outcome = !claimed
      ? sourceText("status.messaging.requestInactive")
      : decision === "accept"
        ? await this.#sendDraft(live, pending, actorId)
        : sourceText("status.messaging.deniedBy", { user: adapter.mention(actorId) });
    for (const [key, candidate] of this.#sendApprovals) if (candidate === pending) this.#sendApprovals.delete(key);
    const link = this.#threads.store.link(pending.draft.linkId);
    if (link) this.#threads.notifyChanged(link.threadId);
    const messageId = pending.messageId ?? pressedMessageId;
    if (messageId)
      await runCauseEffect(adapter.edit(pending.target, messageId, { text: `${pending.text}\n${outcome}` }));
  }

  readonly #serial = Effect.fn("MessagingService.serial")(function* (
    this: MessagingService,
    linkId: string,
    task: Effect.Effect<void, MessagingOperationFailed>,
  ) {
    const previous = this.#chains.get(linkId);
    const next = Deferred.makeUnsafe<void>();
    this.#chains.set(linkId, next);
    yield* Effect.forkIn(
      Effect.gen({ self: this }, function* () {
        if (previous) yield* Deferred.await(previous);
        yield* task.pipe(Effect.catch((error) => Effect.sync(() => this.#warn(error.cause))));
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            Deferred.doneUnsafe(next, Effect.void);
            if (this.#chains.get(linkId) === next) this.#chains.delete(linkId);
          }),
        ),
      ),
      this.#scope,
      { startImmediately: true, uninterruptible: true },
    );
  });

  #requireConnection(platform: MessagingPlatform, workspaceId: string): MessagingConnectionRecord {
    const record = this.#threads.store.connectionForWorkspace(platform, workspaceId);
    if (!record)
      throw new Error(
        sourceText(
          platform === "discord"
            ? "error.messaging.discordNotConnected"
            : platform === "telegram"
              ? "error.messaging.telegramNotConnected"
              : platform === "whatsapp"
                ? "error.messaging.whatsappNotConnected"
                : "error.messaging.notConnected",
        ),
      );
    return record;
  }

  #requireLinked(platform: MessagingPlatform, workspaceId: string): MessagingConnectionRecord {
    const record = this.#requireConnection(platform, workspaceId);
    if (record.lastErrorCode === "removed") throw new Error(sourceText("error.messaging.telegramNotConnected"));
    return record;
  }

  #requireTelegram(): { app: TelegramAppPort; ingress: MessagingIngress } {
    if (!this.#telegramApp || !this.#ingress) throw new Error(sourceText("error.messaging.telegramUnsupported"));
    return { app: this.#telegramApp, ingress: this.#ingress };
  }

  #requireRouting(): SlackRoutingPort {
    if (!this.#routing) throw new Error(sourceText("error.messaging.unsupported"));
    return this.#routing;
  }

  #requireConnect(): SlackConnect {
    if (!this.#connect) throw new Error(sourceText("error.messaging.unsupported"));
    return this.#connect;
  }

  #requireDiscordConnect(): DiscordConnect {
    if (!this.#discordConnect) throw new Error(sourceText("error.messaging.discordUnsupported"));
    return this.#discordConnect;
  }

  #pruneHistory(): void {
    try {
      const cutoff = Date.now() - WHATSAPP_HISTORY_KEEP_MS;
      const paths = this.#threads.history.prune(new Date(cutoff).toISOString());
      this.#whatsappRuntime?.deleteSavedFiles(paths);
      this.#whatsappRuntime?.pruneFiles(cutoff);
    } catch (cause) {
      this.#warn(cause);
    }
  }

  #warn(error: unknown, message = "A messaging action failed."): void {
    const code = isDynamicRecord(error) && isString(error.code) ? error.code : undefined;
    logger.warn(message, {
      error: error instanceof Error ? error.name : "unknown",
      ...(code ? { code } : {}),
    });
  }
}

function tooLarge(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  return (
    (isDynamicRecord(cause) && cause.code === "too_large") ||
    cause.message === "file_too_large" ||
    cause.message.endsWith("file is too big")
  );
}

function integrationsSection(layout: SidebarLayoutSnapshot): SidebarSection | undefined {
  const name = sourceText("status.messaging.integrationsSection");
  return layout.sections.find((section) => section.name === name);
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

function redactEmbed(embed: DiscordEmbed): DiscordEmbed {
  const mask = (value: string | undefined) => (value === undefined ? undefined : redactPostText(value));
  return {
    title: mask(embed.title),
    description: mask(embed.description),
    url: mask(embed.url),
    color: embed.color,
    timestamp: embed.timestamp,
    author: embed.author && {
      name: redactPostText(embed.author.name),
      url: mask(embed.author.url),
      icon_url: mask(embed.author.icon_url),
    },
    footer: embed.footer && { text: redactPostText(embed.footer.text), icon_url: mask(embed.footer.icon_url) },
    thumbnail: embed.thumbnail && { url: redactPostText(embed.thumbnail.url) },
    image: embed.image && { url: redactPostText(embed.image.url) },
    fields: embed.fields?.map((field) => ({
      name: redactPostText(field.name),
      value: redactPostText(field.value),
      inline: field.inline,
    })),
  };
}

const WHATSAPP_ALLOWED_PLACES =
  "This list has only the WhatsApp chats that the user allowed, not all chats of this number. For a chat that is not in it, tell the user to open Marketplace, then Apps, then WhatsApp, and to use Add contact or Add group for this number. A place with readOnly is read only: read its history, but GoAhead cannot post in it.";

const WHATSAPP_NOT_CONNECTED =
  "WhatsApp is not connected on this number now. Tell the user to open Marketplace, then Apps, then WhatsApp, and to use Reconnect or Link again for this number.";

const WHATSAPP_LOCAL_REFUSALS = new Map([
  [
    "place_not_allowed",
    "GoAhead sent nothing: the user did not allow this WhatsApp chat. Tell the user to open Marketplace, then Apps, then WhatsApp, and to use Add contact or Add group for this chat. Then the post can go to it.",
  ],
  [
    "place_read_only",
    "GoAhead sent nothing: the user made this WhatsApp chat read only. GoAhead reads it but never posts in it. Do not post it again: give the result in the conversation that you answer.",
  ],
  ["not_connected", WHATSAPP_NOT_CONNECTED],
  ["not_linked", WHATSAPP_NOT_CONNECTED],
  [
    "not_confirmed",
    "The WhatsApp connection dropped before WhatsApp confirmed the message, also after GoAhead sent it again. It can be in the chat already. Do not post it again only because of this error: tell the user to check the chat.",
  ],
]);

const DISCORD_NOT_LINKED =
  "This Discord server is not linked to this GoAhead server now. Another GoAhead server of the user may answer there. Tell the user to open Marketplace, then Apps, then Discord, and to select Reconnect for this Discord server if this server must answer there.";

const TELEGRAM_RELAY_REFUSALS = new Map([
  [
    "telegram_503 relay_unavailable",
    "GoAhead on this computer is not connected to the GoAhead service now. Telegram calls go through that service, so Telegram did not refuse this call, and the connection and place ids are not the cause. GoAhead connects again by itself. When a Telegram call fails again in a few minutes, tell the user that GoAhead on this computer cannot connect to its service, and that the computer must be online and signed in to GoAhead.",
  ],
  [
    "telegram_504 timeout",
    "The GoAhead service did not answer this Telegram call in time. Telegram did not refuse it, and the connection and place ids are not the cause.",
  ],
]);

function telegramNotReady(state: IngressState): MessagingOperationFailed {
  const text =
    state === "online"
      ? sourceText("error.messaging.telegramServiceUnavailable")
      : state === "signed_out" || state === "no_host"
        ? sourceText("error.messaging.telegramRelayUnavailable")
        : sourceText("error.messaging.telegramRelayUnreachable");
  return new MessagingOperationFailed({ cause: new Error(text) });
}

function refusal(failure: MessagingAdapterError): string {
  const cause = failure.cause;
  if (cause instanceof WhatsAppRefusedError)
    return `WhatsApp refused the message: ${cause.code}. It was not delivered. Do not post it again: tell the user that WhatsApp did not deliver it.`;
  const local = cause instanceof Error ? WHATSAPP_LOCAL_REFUSALS.get(cause.message) : undefined;
  if (local) return local;
  if (cause instanceof DiscordApiError && cause.code === "unknown_guild") return DISCORD_NOT_LINKED;
  const relay =
    cause instanceof TelegramCallError ? TELEGRAM_RELAY_REFUSALS.get(`${cause.code} ${cause.message}`) : undefined;
  if (relay) return relay;
  const code =
    cause instanceof SlackApiError || cause instanceof DiscordApiError || cause instanceof TelegramCallError
      ? cause.code
      : "no_answer";
  return `The platform refused the call: ${code}. Check the connection and place ids with openbot.messaging_list_places.`;
}

function roleName(name: string): string {
  if (name.length <= MESSAGING_LIMITS.roleName) return name;
  const cut = name.slice(0, MESSAGING_LIMITS.roleName);
  return /[\uD800-\uDBFF]$/u.test(cut) ? cut.slice(0, -1) : cut;
}

function isQuietAnswer(answer: string): boolean {
  return answer.trim().replace(/^[`*_"']+|[`*_"'.]+$/g, "") === QUIET_ANSWER;
}

function token(): string {
  return randomBytes(16).toString("hex");
}

function finalPost(
  activity: Exclude<MessagingActivity, { type: "started" | "progress" }>,
  awaitsTeammate: boolean,
  quiet: boolean,
  answerOnly: boolean,
  sendsFiles: boolean,
): PendingFinal {
  const reacts = activity.type === "cancelled" || !activity.followUp;
  if (activity.type === "cancelled" || activity.status === "interrupted")
    return {
      answer: false,
      text: quiet || answerOnly ? "" : sourceText("status.messaging.stopped"),
      reaction: reacts ? "stopped" : null,
    };
  if (activity.status === "failed")
    return {
      answer: false,
      text: quiet ? "" : (activity.reason ?? sourceText("status.messaging.failed")),
      reaction: reacts ? "failed" : null,
    };
  const reaction = reacts ? "done" : null;
  if (
    activity.answer &&
    (isQuietAnswer(activity.answer) || (activity.teammateRequest && RESULT_REPORT.test(activity.answer)))
  )
    return { answer: false, text: "", reaction };
  if (activity.answer) return { answer: true, text: redactPostText(activity.answer), reaction };
  if (answerOnly || activity.teammateRequest) return { answer: false, text: "", reaction };
  if (!activity.followUp && awaitsTeammate)
    return { answer: false, text: sourceText("status.messaging.delegated"), reaction };
  if (sendsFiles && activity.files.length) return { answer: false, text: "", reaction };
  return { answer: false, text: sourceText("status.messaging.noAnswer"), reaction };
}

function filteredRecent(
  adapter: MessagingAdapter,
  platformChannelId: string,
  threadKey: string | null,
  limit: number,
  filter: HistoryFilter,
): Effect.Effect<RecentMessages, MessagingAdapterError> {
  if (adapter.searchesHistory || (!filter.query && !filter.before))
    return adapter.recent(platformChannelId, threadKey, limit, filter);
  return adapter.recent(platformChannelId, threadKey, limit).pipe(
    Effect.map((recent) => ({
      messages: recent.messages.filter((entry) => matchesHistoryFilter(entry, filter)),
      note: [recent.note, `query and before searched only the newest ${limit} messages.`].filter(Boolean).join(" "),
    })),
  );
}

export class MessagingOperationFailed extends Schema.TaggedError<MessagingOperationFailed>()(
  "MessagingOperationFailed",
  {
    cause: Schema.Defect(),
  },
) {}

const {
  io: messagingIo,
  sync: messagingStep,
  rewrap: toMessagingOperationFailed,
} = causeHelpers(MessagingOperationFailed);
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
