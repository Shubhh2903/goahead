import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { ATTACHMENT_LIMITS, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AddSlackOrchestratorInput,
  AddSlackOrchestratorResult,
  AgentApproval,
  AgentEvent,
  AgentSummary,
  MessagingConnection,
  MessagingConnectionState,
  MessagingCredentialState,
  MessagingDraft,
  MessagingInboxPage,
  MessagingInboxWorkspace,
  MessagingPlatform,
  MessagingThreadSummary,
  RespondToApprovalInput,
  SlackChannelChoice,
  SlackChannelList,
  SlackOverview,
} from "@openbot/contracts/ipc";
import { MESSAGING_CONNECTION_STATES, MESSAGING_LIMITS } from "@openbot/contracts/ipc";
import { isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { SLACK_ORCHESTRATOR_AVATAR } from "@openbot/contracts/slack-app";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import type { MessagingOrigin } from "../mailbox-store";
import type { SidebarLayoutStore } from "../sidebar-layout-store";
import type { InboxKind } from "./messaging-inbox-store";
import { SLACK_INBOX_UNTRUSTED_NOTE } from "./messaging-read-tools";
import {
  inQuietHours,
  MessagingSendGuardStore,
  type QuietHours,
  SEND_HOURLY_LIMIT,
  SEND_LIMIT_WINDOW_MS,
} from "./messaging-send-guards";
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
  type InboundAction,
  type InboundMessage,
  type InboxCandidate,
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
import { slackOrchestratorMemories, slackOrchestratorProfile } from "./slack/slack-orchestrator";
import { SlackWebApi } from "./slack/slack-web-api";

const logger = createOpenBotLogger("messaging");

/** The tokens of each connection, kept by the main process in encrypted storage, by connection id. */
export interface MessagingCredentials {
  keys(): string[];
  status(connectionId: string): MessagingCredentialState;
  get(connectionId: string): Record<string, string> | null;
  set(connectionId: string, values: Record<string, string>): Promise<void>;
  clear(connectionId: string): Promise<void>;
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
}

export interface MessagingServiceOptions {
  threads: MessagingThreads;
  agents: MessagingAgents;
  credentials: MessagingCredentials;
  drivers: readonly MessagingDriver[];
  /** A private folder for files that arrive, until the mailbox has copied them. */
  downloadsRoot: string;
  /** The Signal relay of the OpenBot Slack app. Without it and `slackApp`, no workspace can connect. */
  ingress?: MessagingIngress;
  slackApp?: SlackAppPort;
  /** Only tests change this. */
  slackOrigin?: string;
  /** Where the Slack Orchestrator goes in the sidebar: an Integrations section. */
  sidebar?: Pick<SidebarLayoutStore, "getSnapshot" | "mutate">;
  /** The person's send guards: pause and quiet hours. Without it, they live in memory only. */
  sendGuards?: MessagingSendGuardStore;
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
  draft: SendDraft;
}

interface SendDraft {
  draftId: string;
  linkId: string;
  agentId: string;
  to: SlackSendTarget;
  text: string;
  threadKey: string | null;
  sender: MessageSender;
  /** For the desktop card: who gets it, by name, and who asked. */
  recipient: string;
  requestedBy: string | null;
  /**
   * Someone other than the connected person asked for it: it goes out as the GoAhead app, and its
   * first line names them, so nobody reads it as the person's own words.
   */
  onBehalfOf: string | null;
  createdAt: string;
}

type PendingApproval = PendingAgentApproval | PendingSend;

const FATAL_STATES = new Set<MessagingConnectionState>(["invalid_token"]);
const LIVE_STATES = new Set<MessagingConnectionState>(["connecting", "connected", "reconnecting", "rate_limited"]);
const APPROVAL_TEXT_LIMIT = 2_500;
/** How long a reply to a message OpenBot sent as the user still comes back to the conversation. */
const REPLY_WATCH_MS = 14 * 24 * 60 * 60_000;
const SENT_PREVIEW = 300;
/** How much of the newest message the desktop inbox list shows. */
const PREVIEW_CHARACTERS = 200;
/** How long every direct message after a send by the app counts as an answer to it. */
const APP_SEND_REPLY_MS = 24 * 60 * 60_000;
const CANCEL_TEXT = /^(cancel|stop)$/i;
const RECENT_MESSAGES = 2_000;
/** How long a connection waits before it tries Slack again after Slack was unreachable. */
const IDENTIFY_RETRY_MS = 30_000;
/** How long the local inbox keeps a message, and how often it deletes older ones. */
const INBOX_RETENTION_MS = 30 * 24 * 60 * 60_000;
const INBOX_PURGE_INTERVAL_MS = 6 * 60 * 60_000;
/**
 * A newly picked channel starts with its newest messages. Slack allows apps outside its Marketplace
 * one history call a minute, of at most 15 messages, so the fills of one workspace wait in line.
 */
const HISTORY_FILL_MESSAGES = 15;
const HISTORY_FILL_SPACING_MS = 61_000;
/** The marker `mention` uses. Text that did not come from the host has it taken out. */
const MENTION_MARKERS = /[\uE000-\uE001]/g;

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
  readonly #approvals = new Map<string, PendingApproval>();
  readonly #stops = new Map<string, { linkId: string; authorId: string; connectionId: string }>();
  readonly #chains = new Map<string, Promise<void>>();
  readonly #recent = new Set<string>();
  /** Who hears that a workspace's inbox got a new message. */
  readonly #inboxListeners = new Set<(workspaceId: string) => void>();
  /** The history fills of each connection, one after the other. */
  readonly #fills = new Map<string, Promise<void>>();
  readonly #unsubscribe: Array<() => void> = [];
  readonly #ingress: MessagingIngress | null;
  readonly #connect: SlackConnect | null;
  readonly #slackOrigin: string | undefined;
  readonly #sidebar: Pick<SidebarLayoutStore, "getSnapshot" | "mutate"> | null;
  readonly #guards: MessagingSendGuardStore;
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
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    await this.#guards.load();
    this.#unsubscribe.push(
      this.#threads.onActivity((activity) => this.#serial(activity.link.linkId, () => this.#activity(activity))),
      this.#agents.onEvent((event) => this.#agentEvent(event)),
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
    await this.#credentials.retain(new Set(records.map((record) => record.connectionId)));
    await Promise.all(records.filter((record) => record.enabled).map((record) => this.#startConnection(record)));
  }

  async stop(): Promise<void> {
    this.#started = false;
    for (const unsubscribe of this.#unsubscribe.splice(0)) unsubscribe();
    this.#threads.setContextSource(null);
    this.#threads.setMessageSender(null);
    this.#threads.setInboxReader(null);
    this.#ingress?.handle(null);
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

  /** The external conversations, newest first. The caller adds each one's read state. */
  threadSummaries(): Array<Omit<MessagingThreadSummary, "unreadCount">> {
    return this.#threads.store.recentLinks().map((link) => ({
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

  #pendingSends(): PendingSend[] {
    const unique = new Set<PendingSend>();
    for (const pending of this.#approvals.values())
      if (pending.kind === "send" && !pending.answered) unique.add(pending);
    return [...unique].sort((left, right) => left.draft.createdAt.localeCompare(right.draft.createdAt));
  }

  /** The agent that answers one external conversation. Any other thread id is refused. */
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
      ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
    });
    for (const text of slackOrchestratorMemories(record.workspaceName))
      this.#agents.createMemory({ agentId: agent.id, text });
    this.#threads.store.updateConnection(record.connectionId, { orchestratorAgentId: agent.id });
    // A sidebar it cannot reach leaves the agent where new agents go; the orchestrator still answers.
    const sectionId = await this.#placeInIntegrations(agent.id).catch((error) => {
      this.#warn(error);
      return null;
    });
    return { agentId: agent.id, sectionId };
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
   * Stops the workspace's connection, asks Slack to revoke the user token and the bot token, removes
   * them, and unlinks the workspace from this host. The conversations stay, for a later connect.
   */
  async disconnectSlackWorkspace(workspaceId: string): Promise<void> {
    const record = this.#requireConnection(workspaceId);
    await this.#stopConnection(record.connectionId);
    const values = this.#credentials.get(record.connectionId);
    for (const token of [values?.userToken, values?.botToken])
      if (token)
        await new SlackWebApi({ token, origin: this.#slackOrigin })
          .call("auth.revoke")
          .catch((error) => this.#warn(error));
    await this.#credentials.clear(record.connectionId);
    // The inbox is a copy of the person's Slack messages, read with the access this revokes.
    this.#threads.inbox.deleteForConnection(record.connectionId);
    this.#inboxChanged(record.workspaceId);
    this.#threads.store.updateConnection(record.connectionId, { enabled: false, lastErrorCode: null });
    await this.#connect?.unlink(workspaceId).catch((error) => this.#warn(error));
    this.#ingress?.reconnect();
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
      inbox: (candidate) => void this.#keep(live, candidate).catch((error) => this.#warn(error)),
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
    if (added) this.#inboxChanged(live.record.workspaceId);
  }

  /**
   * An agent's read of the person's inbox. Only the connected person may ask, and only in their direct
   * message with OpenBot: anyone else who mentions OpenBot must never read their private messages, and
   * an answer in a channel is posted where everyone there reads it.
   */
  async #readInbox(request: MessagingInboxRequest): Promise<MessagingInboxResult> {
    const link = this.#threads.store.linkForThread(request.threadId);
    if (!link?.isDirect) throw new Error(sourceText("error.messaging.inboxNeedsSlack"));
    const live = this.#live.get(link.connectionId);
    const user = live?.identity?.user;
    if (!live || !user) throw new Error(sourceText("error.messaging.inboxNeedsUser"));
    if (this.#threads.runningOrigin(link.linkId)?.origin.authorId !== user.id)
      throw new Error(sourceText("error.messaging.inboxOwnerOnly"));
    const inbox = this.#threads.inbox;
    const connectionId = link.connectionId;
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
    const messages = inbox.read(connectionId, conversation, request.threadKey, request.limit);
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
        text: message.text,
      })),
      note: SLACK_INBOX_UNTRUSTED_NOTE,
    };
  }

  /** The live connection of a workspace that is connected as the person. */
  #personConnection(workspaceId: string): LiveConnection {
    const record = this.#requireConnection(workspaceId);
    const live = this.#live.get(record.connectionId);
    if (!live?.identity?.user) throw new Error(sourceText("error.messaging.inboxNeedsUser"));
    return live;
  }

  /** Reads a newly picked channel's newest messages into the inbox, after the fills before it. */
  #fillHistory(live: LiveConnection, platformChannelId: string): void {
    const connectionId = live.record.connectionId;
    const previous = this.#fills.get(connectionId) ?? Promise.resolve();
    const next = previous.then(async () => {
      if (this.#live.get(connectionId) !== live || !live.adapter.recentMessages) return;
      if (!this.#threads.inbox.isWatched(connectionId, platformChannelId)) return;
      const messages = await live.adapter.recentMessages(platformChannelId, HISTORY_FILL_MESSAGES).catch((error) => {
        this.#warn(error);
        return [];
      });
      for (const candidate of messages) await this.#keep(live, candidate).catch((error) => this.#warn(error));
      await new Promise((resolve) => setTimeout(resolve, HISTORY_FILL_SPACING_MS).unref?.());
    });
    const settled = next.catch((error) => this.#warn(error));
    this.#fills.set(connectionId, settled);
    void settled.then(() => {
      if (this.#fills.get(connectionId) === settled) this.#fills.delete(connectionId);
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
          preview: item.preview.slice(0, PREVIEW_CHARACTERS),
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
    if (newest) inbox.markRead(connectionId, conversation, newest.platformMessageId);
    const other = messages.find((message) => message.authorId !== user.id)?.authorName ?? "";
    return {
      workspaceId,
      conversation,
      place: await this.#inboxPlace(live, inbox.watched(connectionId))(
        conversation,
        messages[0]?.kind ?? "channel",
        other,
      ),
      messages: messages.map((message) => ({
        id: message.platformMessageId,
        from: message.authorName,
        isOwn: message.authorId === user.id,
        text: message.text,
        sentAt: message.sentAt,
        thread: message.threadKey,
      })),
    };
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
      this.#threads.inbox.purgeBefore(new Date(Date.now() - INBOX_RETENTION_MS).toISOString());
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
        hourlyLimit: SEND_HOURLY_LIMIT,
        sentLastHour: this.#threads.store.sendsSince(
          record.connectionId,
          new Date(Date.now() - SEND_LIMIT_WINDOW_MS).toISOString(),
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

  #agentEvent(event: AgentEvent): void {
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
    try {
      pending.messageId = await live.adapter.post(pending.target, {
        text: pending.text,
        buttons: [
          { action: "accept", label: sourceText("status.messaging.approve"), token: accept, style: "primary" },
          { action: "decline", label: sourceText("status.messaging.deny"), token: decline, style: "danger" },
        ],
      });
    } catch (error) {
      this.#approvals.delete(accept);
      this.#approvals.delete(decline);
      throw error;
    }
  }

  /**
   * An agent asks to send a new message. It needs a Slack conversation, so the draft has a place to
   * ask for approval, and a workspace connected as a person, who is the only one allowed to approve.
   */
  async #requestSend(request: MessagingSendRequest): Promise<MessagingSendReceipt> {
    const link = this.#threads.store.linkForThread(request.threadId);
    if (!link) throw new Error(sourceText("error.messaging.sendNeedsSlack"));
    const live = this.#live.get(link.connectionId);
    if (!live?.identity) throw new Error(sourceText("error.messaging.notConnected"));
    const credentials = this.#credentials.get(link.connectionId);
    const approverId = credentials?.userId;
    if (!approverId) throw new Error(sourceText("error.messaging.sendNeedsUser"));
    const parsed = parseSlackSendTarget(request.to);
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
    // A pause or a spent hour refuses at once, with no draft: the agent learns that nothing went out.
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
    const sender: MessageSender = ownRequest && credentials.userToken ? "user" : "bot";
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
          ? await adapter.placeName(to.id)
          : (await Promise.all(slackTargetPeople(to).map((id) => adapter.authorName(id)))).join(", "),
      requestedBy: running?.origin.authorName ?? null,
      onBehalfOf: ownRequest ? null : (running?.origin.authorName ?? null),
      createdAt: new Date().toISOString(),
    };
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
        ? await adapter.placeName(to.id)
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

  /** Sends a draft once and records it. Returns the link to the sent message, when Slack gives one. */
  async #deliver(live: LiveConnection, draft: SendDraft, approvedBy: string): Promise<string | null> {
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

  /** Why no send can go out now: the pause or the hourly limit. Quiet hours turn sends into drafts. */
  #sendRefusal(record: MessagingConnectionRecord): string | null {
    if (this.#guards.get(record.workspaceId).paused) return sourceText("error.messaging.sendPaused");
    const since = new Date(Date.now() - SEND_LIMIT_WINDOW_MS).toISOString();
    if (this.#threads.store.sendsSince(record.connectionId, since) >= SEND_HOURLY_LIMIT)
      return sourceText("error.messaging.sendRateLimited", { limit: SEND_HOURLY_LIMIT });
    return null;
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
    pending.answered = true;
    let outcome: string;
    if (pending.kind === "send") {
      outcome =
        decision === "accept"
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
function linkTarget(link: MessagingLink): MessageTarget {
  return {
    platformChannelId: link.platformChannelId,
    // A person's direct message conversation is not one Slack thread: answer in the direct message.
    replyThreadId: link.threadKey === DIRECT_CONVERSATION_KEY ? null : link.threadKey,
  };
}

function token(): string {
  return randomBytes(16).toString("hex");
}
