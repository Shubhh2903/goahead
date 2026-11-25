import {
  type ConversationMessage,
  type ConversationPage,
  MESSAGING_LIMITS,
  type MessagingConnection,
  type MessagingDesktopApi,
  type MessagingInboxMessage,
  type MessagingPlatform,
  type MessagingRole,
  type MessagingThreadSummary,
  type MessagingThreadsChanged,
  parseWhatsAppPhoneNumber,
  type SlackRoutingStatus,
  type StartWhatsAppLinkInput,
  type WhatsAppAccount,
  type WhatsAppGroup,
  type WhatsAppLinkState,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { clone } from "./mock-support";

type WorkspacePlatform = Exclude<MessagingPlatform, "telegram" | "whatsapp">;

const PREVIEW_WORKSPACE = {
  slack: (count: number) => ({
    workspaceId: count === 1 ? "T0PREVIEW" : `T0PREVIEW${count}`,
    workspaceName: count === 1 ? "Preview workspace" : `Preview workspace ${count}`,
    botUserId: "U0PREVIEW",
  }),
  discord: (count: number) => ({
    workspaceId: String(100000000000000001n + BigInt(count - 1)),
    workspaceName: count === 1 ? "Preview Discord server" : `Preview Discord server ${count}`,
    botUserId: "100000000000000002",
  }),
} as const satisfies Record<
  WorkspacePlatform,
  (count: number) => { workspaceId: string; workspaceName: string; botUserId: string }
>;

const PREVIEW_ROLES: readonly MessagingRole[] = [
  { id: "200000000000000001", name: "Admin" },
  { id: "200000000000000002", name: "Moderator" },
  { id: "200000000000000003", name: "Member" },
];

const TELEGRAM_LINK_MS = 1_500;

const WHATSAPP_LINK_READS = 4;
const WHATSAPP_QR_READS = 2;

const PREVIEW_WHATSAPP_GROUPS: readonly WhatsAppGroup[] = [
  { id: "120363000000000001@g.us", name: "Family" },
  { id: "120363000000000002@g.us", name: "Book club" },
  { id: "120363000000000003@g.us", name: "Acme team" },
];

const PREVIEW_WHATSAPP_STRANGER = { senderId: "447700900555", name: "Grace Hopper" };

const SLACK_PREVIEW_WORKSPACE_ID = "T0PREVIEW";

const SLACK_SEND_GUARDS = { paused: false, quietHours: null, hourlyLimit: null, sentLastHour: 0 };

const NO_SLACK_USER = { userId: null, userName: null, watchedChannels: [], sendGuards: SLACK_SEND_GUARDS };

function previewThreads(agentId: string): Array<{ summary: MessagingThreadSummary; messages: ConversationMessage[] }> {
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const thread = (
    id: string,
    title: string,
    isDirect: boolean,
    age: number,
    unreadCount: number,
    texts: Array<[ConversationMessage["author"], string]>,
  ) => ({
    summary: {
      threadId: `preview-slack-${id}`,
      agentId,
      workspaceId: SLACK_PREVIEW_WORKSPACE_ID,
      platform: "slack" as const,
      title,
      preview: texts.at(-1)?.[1] ?? null,
      isDirect,
      updatedAt: minutesAgo(age),
      unreadCount,
      pendingDrafts: id === "preet" ? 1 : 0,
    },
    messages: texts.map(([author, text], index) => ({
      id: `preview-slack-${id}-${index}`,
      author,
      text,
      createdAt: minutesAgo(age + texts.length - index),
      status: "completed" as const,
    })),
  });
  return [
    thread("deploy", "#general · Why did the deploy fail?", false, 2, 1, [
      ["user", "Why did the deploy fail?"],
      ["assistant", "The build step ran out of disk space. I asked the infrastructure agent to clean the cache."],
    ]),
    thread("preet", "Preet", true, 60, 0, [
      ["user", "Can you send me the release notes?"],
      ["assistant", "Here they are. The draft is in the shared folder."],
    ]),
    thread("ana", "Ana", true, 1_440, 0, [
      ["user", "Is the demo still on for Friday?"],
      ["assistant", "Yes. It starts at 10:00."],
    ]),
  ];
}

function previewInbox() {
  const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const message = (id: string, from: string, text: string, minutes: number, isOwn = false): MessagingInboxMessage => ({
    id,
    from,
    isOwn,
    text,
    sentAt: at(minutes),
    thread: null,
  });
  return [
    {
      workspaceId: SLACK_PREVIEW_WORKSPACE_ID,
      conversation: "D0PREVIEWPREET",
      kind: "direct" as const,
      place: "Preet",
      unreadCount: 1,
      latestAt: at(3),
      latestFrom: "Preet",
      preview: "Are you free at 3?",
      messages: [
        message("1.000001", "you", "Lunch at 1?", 40, true),
        message("1.000002", "Preet", "Are you free at 3?", 3),
      ],
    },
    {
      workspaceId: SLACK_PREVIEW_WORKSPACE_ID,
      conversation: "C0PREVIEWLAU",
      kind: "channel" as const,
      place: "#launch",
      unreadCount: 2,
      latestAt: at(12),
      latestFrom: "Ana",
      preview: "The demo moves to Friday.",
      messages: [
        message("2.000001", "Ana", "Kickoff notes are in <https://example.com/notes|the doc> :tada:", 30),
        message(
          "2.000002",
          "Ana",
          "<@U0PREVIEWPREET> *The demo* moves to _Friday_ in <#C0PREVIEWLAU|launch>. :+1::skin-tone-3:",
          12,
        ),
      ],
    },
  ];
}

export function createMockMessaging(orchestrator: () => string): MessagingDesktopApi {
  const platform = (name: WorkspacePlatform, notConnected: string, user: Partial<MessagingConnection> = {}) => {
    const connections = new Map<string, MessagingConnection>();
    let connects = 0;
    const change = (workspaceId: string, update: Partial<MessagingConnection>) => {
      const current = connections.get(workspaceId);
      if (!current) throw new Error(notConnected);
      connections.set(workspaceId, { ...current, ...update });
    };
    return {
      overview: async () => clone({ connections: [...connections.values()] }),
      connect: async () => {
        connects += 1;
        const workspace = PREVIEW_WORKSPACE[name](connects);
        connections.set(workspace.workspaceId, {
          ...workspace,
          platform: name,
          enabled: true,
          state: "connected",
          missingScopes: [],
          retryAt: null,
          credentials: "saved",
          orchestratorAgentId: null,
          ...NO_SLACK_USER,
          ...user,
        });
      },
      disconnect: async ({ workspaceId }: { workspaceId: string }) => {
        connections.delete(workspaceId);
      },
      reconnect: async ({ workspaceId }: { workspaceId: string }) =>
        change(workspaceId, { enabled: true, state: "connected" }),
      setEnabled: async ({ workspaceId, enabled }: { workspaceId: string; enabled: boolean }) =>
        change(workspaceId, { enabled, state: enabled ? "connected" : "paused" }),
      addOrchestrator: async ({ workspaceId }: { workspaceId: string }) => {
        const agentId = orchestrator();
        change(workspaceId, { orchestratorAgentId: agentId });
        return { agentId, sectionId: null };
      },
      connections,
      change,
      connected: (workspaceId: string) => {
        if (!connections.has(workspaceId)) throw new Error(notConnected);
      },
    };
  };
  const slack = platform("slack", sourceText("error.messaging.notConnected"), {
    userId: "U0PREVIEWME",
    userName: "you",
  });
  const connections = slack.connections;
  const change = slack.change;
  let threads: ReturnType<typeof previewThreads> = [];
  const changeListeners = new Set<(change: MessagingThreadsChanged) => void>();
  const answered = new Set<string>();
  const inbox = previewInbox();
  const inboxRead = new Set<string>();
  const inboxListeners = new Set<(change: { workspaceId: string }) => void>();
  const routing = new Map<string, SlackRoutingStatus>();
  const routingOf = (workspaceId: string): SlackRoutingStatus => {
    if (!connections.has(workspaceId)) throw new Error(sourceText("error.messaging.notConnected"));
    return (
      routing.get(workspaceId) ?? { isDefault: true, people: [{ slackUserId: "U0PREVIEWPREET", displayName: "Preet" }] }
    );
  };
  let replies = 0;
  const findThread = (threadId: string) => {
    const found = threads.find((candidate) => candidate.summary.threadId === threadId);
    if (!found) throw new Error(sourceText("error.messaging.threadUnavailable"));
    return found;
  };
  const discord = platform("discord", sourceText("error.messaging.discordNotConnected"));
  const allowedRoles = new Map<string, MessagingRole[]>();
  const chats = new Map<string, MessagingConnection>();
  let telegramOrchestrator: string | null = null;
  let linkedChats = 0;
  const changeChat = (workspaceId: string, update: Partial<MessagingConnection>) => {
    const current = chats.get(workspaceId);
    if (!current) throw new Error(sourceText("error.messaging.notConnected"));
    chats.set(workspaceId, { ...current, ...update });
  };
  const numbers = new Map<string, MessagingConnection>();
  const accounts = new Map<string, WhatsAppAccount>();
  let whatsappOrchestrator: string | null = null;
  let linkedNumbers = 0;
  let link: { state: WhatsAppLinkState; input: StartWhatsAppLinkInput; reads: number } | null = null;
  const previewQr = (rotation: number) =>
    `2@openbot-preview-${linkedNumbers + 1}-${rotation},openbot-preview-noise-key,openbot-preview-identity-key,preview`;
  const changeNumber = (workspaceId: string, update: Partial<MessagingConnection>) => {
    const current = numbers.get(workspaceId);
    if (!current) throw new Error(sourceText("error.messaging.whatsappNotConnected"));
    numbers.set(workspaceId, { ...current, ...update });
  };
  const account = (workspaceId: string) => {
    const current = accounts.get(workspaceId);
    if (!current) throw new Error(sourceText("error.messaging.whatsappNotConnected"));
    return current;
  };
  const linkNumber = (input: StartWhatsAppLinkInput): string => {
    linkedNumbers += 1;
    const count = linkedNumbers;
    const workspaceId = input.phoneNumber ?? `4477009001${String(count).padStart(2, "0")}`;
    numbers.set(workspaceId, {
      workspaceId,
      platform: "whatsapp",
      enabled: true,
      state: "connected",
      workspaceName: count === 1 ? "Preview phone" : `Preview phone ${count}`,
      botUserId: workspaceId,
      missingScopes: [],
      retryAt: null,
      credentials: "saved",
      orchestratorAgentId: whatsappOrchestrator,
      ...NO_SLACK_USER,
    });
    const before = accounts.get(workspaceId);
    accounts.set(workspaceId, {
      workspaceId,
      ownNumber: input.ownNumber,
      workingMessage: before?.workingMessage ?? true,
      statusReactions: before?.statusReactions ?? true,
      allowedSenders: before?.allowedSenders ?? [],
      pendingRequests: [],
    });
    if (!input.ownNumber)
      setTimeout(() => {
        const current = accounts.get(workspaceId);
        if (!current || current.ownNumber) return;
        accounts.set(workspaceId, {
          ...current,
          pendingRequests: [
            {
              ...PREVIEW_WHATSAPP_STRANGER,
              code: `K7Q${String(count).padStart(3, "0")}`,
              expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
            },
          ],
        });
      }, TELEGRAM_LINK_MS);
    return workspaceId;
  };
  const api: Omit<MessagingDesktopApi, `host${string}`> = {
    getSlackOverview: slack.overview,
    connectSlackWorkspace: slack.connect,
    disconnectSlackWorkspace: slack.disconnect,
    reconnectSlackWorkspace: slack.reconnect,
    setSlackEnabled: slack.setEnabled,
    addSlackOrchestrator: async (input) => {
      const added = await slack.addOrchestrator(input);
      threads = previewThreads(added.agentId);
      for (const { summary } of threads)
        for (const listener of changeListeners) listener({ threadId: summary.threadId });
      return added;
    },
    getDiscordOverview: discord.overview,
    connectDiscordGuild: discord.connect,
    disconnectDiscordGuild: discord.disconnect,
    reconnectDiscordGuild: discord.reconnect,
    setDiscordEnabled: discord.setEnabled,
    addDiscordOrchestrator: discord.addOrchestrator,
    getDiscordAccess: async ({ workspaceId }) => {
      discord.connected(workspaceId);
      return clone({ allowedRoles: allowedRoles.get(workspaceId) ?? [] });
    },
    listDiscordRoles: async ({ workspaceId }) => {
      discord.connected(workspaceId);
      return clone({ roles: [...PREVIEW_ROLES] });
    },
    setDiscordAccess: async ({ workspaceId, allowedRoles: roles }) => {
      discord.connected(workspaceId);
      allowedRoles.set(workspaceId, clone(roles));
      return clone({ allowedRoles: roles });
    },
    getTelegramOverview: async () => clone({ connections: [...chats.values()] }),
    connectTelegramChat: async ({ place }) => {
      linkedChats += 1;
      const count = linkedChats;
      const chat =
        place === "group"
          ? { workspaceId: `-100${count}`, workspaceName: `Preview group ${count}` }
          : { workspaceId: `${700_000 + count}`, workspaceName: `Preview chat ${count}` };
      setTimeout(() => {
        chats.set(chat.workspaceId, {
          ...chat,
          platform: "telegram",
          enabled: true,
          state: "connected",
          botUserId: "7000000000",
          missingScopes: [],
          retryAt: null,
          credentials: "saved",
          orchestratorAgentId: telegramOrchestrator,
          ...NO_SLACK_USER,
        });
      }, TELEGRAM_LINK_MS);
    },
    disconnectTelegramChat: async ({ workspaceId }) => {
      chats.delete(workspaceId);
    },
    reconnectTelegramChat: async ({ workspaceId }) => changeChat(workspaceId, { enabled: true, state: "connected" }),
    setTelegramEnabled: async ({ workspaceId, enabled }) =>
      changeChat(workspaceId, { enabled, state: enabled ? "connected" : "paused" }),
    addTelegramOrchestrator: async () => {
      const agentId = orchestrator();
      telegramOrchestrator = agentId;
      for (const workspaceId of chats.keys()) changeChat(workspaceId, { orchestratorAgentId: agentId });
      return { agentId, sectionId: null };
    },
    getWhatsAppOverview: async () => clone({ connections: [...numbers.values()], accounts: [...accounts.values()] }),
    startWhatsAppLink: async (input) => {
      link = {
        input: clone(input),
        reads: 0,
        state: {
          status: "waiting",
          qr: input.method === "qr" ? previewQr(0) : null,
          code: input.method === "code" ? `PRVW${String(linkedNumbers + 1).padStart(4, "0")}` : null,
          workspaceId: null,
          error: null,
        },
      };
      return clone(link.state);
    },
    getWhatsAppLinkState: async () => {
      if (!link) return { status: "idle", qr: null, code: null, workspaceId: null, error: null };
      if (link.state.status === "waiting") {
        link.reads += 1;
        if (link.reads >= WHATSAPP_LINK_READS)
          link.state = { status: "linked", qr: null, code: null, workspaceId: linkNumber(link.input), error: null };
        else if (link.state.qr !== null)
          link.state = { ...link.state, qr: previewQr(Math.floor(link.reads / WHATSAPP_QR_READS)) };
      }
      return clone(link.state);
    },
    cancelWhatsAppLink: async () => {
      link = null;
    },
    disconnectWhatsAppNumber: async ({ workspaceId }) => {
      numbers.delete(workspaceId);
      accounts.delete(workspaceId);
    },
    reconnectWhatsAppNumber: async ({ workspaceId }) =>
      changeNumber(workspaceId, { enabled: true, state: "connected" }),
    setWhatsAppEnabled: async ({ workspaceId, enabled }) =>
      changeNumber(workspaceId, { enabled, state: enabled ? "connected" : "paused" }),
    addWhatsAppOrchestrator: async () => {
      const agentId = orchestrator();
      whatsappOrchestrator = agentId;
      for (const workspaceId of numbers.keys()) changeNumber(workspaceId, { orchestratorAgentId: agentId });
      return { agentId, sectionId: null };
    },
    listWhatsAppGroups: async ({ workspaceId }) => {
      account(workspaceId);
      return clone({ groups: [...PREVIEW_WHATSAPP_GROUPS] });
    },
    addWhatsAppSender: async ({ workspaceId, sender }) => {
      const current = account(workspaceId);
      const id = sender.kind === "contact" ? parseWhatsAppPhoneNumber(sender.id) : sender.id;
      if (!id) throw new Error("A messaging request is invalid.");
      const others = current.allowedSenders.filter((allowed) => allowed.id !== id);
      if (others.length >= MESSAGING_LIMITS.allowedSenders)
        throw new Error(sourceText("error.messaging.whatsappTooManySenders"));
      accounts.set(workspaceId, {
        ...current,
        allowedSenders: [...others, { id, kind: sender.kind, name: sender.name.trim() || id, readOnly: false }],
      });
    },
    removeWhatsAppSender: async ({ workspaceId, senderId }) => {
      const current = account(workspaceId);
      accounts.set(workspaceId, {
        ...current,
        allowedSenders: current.allowedSenders.filter((sender) => sender.id !== senderId),
      });
    },
    answerWhatsAppRequest: async ({ workspaceId, code, approve }) => {
      const current = account(workspaceId);
      const request = current.pendingRequests.find((pending) => pending.code === code);
      if (!request) throw new Error(sourceText("error.messaging.whatsappRequestEnded"));
      accounts.set(workspaceId, {
        ...current,
        pendingRequests: current.pendingRequests.filter((pending) => pending.code !== code),
        allowedSenders: approve
          ? [
              ...current.allowedSenders.filter((sender) => sender.id !== request.senderId),
              { id: request.senderId, kind: "contact", name: request.name || request.senderId, readOnly: false },
            ]
          : current.allowedSenders,
      });
    },
    setWhatsAppOwnNumber: async ({ workspaceId, ownNumber }) => {
      accounts.set(workspaceId, { ...account(workspaceId), ownNumber });
    },
    setWhatsAppWorkingMessage: async ({ workspaceId, workingMessage }) => {
      accounts.set(workspaceId, { ...account(workspaceId), workingMessage });
    },
    setWhatsAppStatusReactions: async ({ workspaceId, statusReactions }) => {
      accounts.set(workspaceId, { ...account(workspaceId), statusReactions });
    },
    setWhatsAppSenderReadOnly: async ({ workspaceId, senderId, readOnly }) => {
      const current = account(workspaceId);
      if (!current.allowedSenders.some((sender) => sender.id === senderId))
        throw new Error(sourceText("error.messaging.whatsappSenderNotFound"));
      accounts.set(workspaceId, {
        ...current,
        allowedSenders: current.allowedSenders.map((sender) =>
          sender.id === senderId ? { ...sender, readOnly } : sender,
        ),
      });
    },
    listSlackChannels: async ({ workspaceId }) => {
      if (!connections.has(workspaceId)) throw new Error(sourceText("error.messaging.notConnected"));
      return {
        channels: [
          { channelId: "C0PREVIEWGEN", name: "general", isPrivate: false },
          { channelId: "C0PREVIEWLAU", name: "launch", isPrivate: false },
          { channelId: "C0PREVIEWLEA", name: "leadership", isPrivate: true },
          { channelId: "C0PREVIEWRAN", name: "random", isPrivate: false },
        ],
      };
    },
    setSlackWatchedChannels: async ({ workspaceId, channels }) => change(workspaceId, { watchedChannels: channels }),
    setSlackSendGuards: async ({ workspaceId, ...guards }) => {
      const current = connections.get(workspaceId);
      if (!current) throw new Error(sourceText("error.messaging.notConnected"));
      change(workspaceId, { sendGuards: { ...current.sendGuards, ...guards } });
    },
    listInbox: async () =>
      clone(
        [...connections.values()]
          .filter((connection) => connection.userId)
          .map((connection) => ({
            workspaceId: connection.workspaceId,
            workspaceName: connection.workspaceName,
            agentId: connection.orchestratorAgentId,
            conversations: inbox
              .filter((item) => item.workspaceId === connection.workspaceId)
              .map(({ messages, workspaceId: _workspace, ...conversation }) => ({
                ...conversation,
                unreadCount: inboxRead.has(conversation.conversation) ? 0 : conversation.unreadCount,
              })),
          })),
      ),
    readInboxConversation: async ({ workspaceId, conversation }) => {
      const found = inbox.find((item) => item.workspaceId === workspaceId && item.conversation === conversation);
      if (!found) throw new Error(sourceText("error.messaging.inboxUnknownConversation"));
      inboxRead.add(conversation);
      for (const listener of inboxListeners) listener({ workspaceId });
      return clone({
        workspaceId,
        conversation,
        place: found.place,
        messages: found.messages,
        people: { U0PREVIEWPREET: "Preet" },
        channels: { C0PREVIEWLAU: "launch" },
        customEmoji: {},
      });
    },
    sendInboxReply: async ({ workspaceId, conversation, threadKey, text }) => {
      if (!connections.get(workspaceId)?.userId) throw new Error(sourceText("error.messaging.inboxNeedsUser"));
      const found = inbox.find((item) => item.workspaceId === workspaceId && item.conversation === conversation);
      if (!found) throw new Error(sourceText("error.messaging.inboxUnknownConversation"));
      const trimmed = text.trim();
      if (!trimmed) throw new Error(sourceText("error.messaging.sendTextEmpty"));
      replies += 1;
      const sentAt = new Date().toISOString();
      found.messages.push({
        id: `9.${String(replies).padStart(6, "0")}`,
        from: "you",
        isOwn: true,
        text: trimmed,
        sentAt,
        thread: threadKey ?? null,
      });
      found.latestAt = sentAt;
      found.latestFrom = "you";
      found.preview = trimmed;
      for (const listener of inboxListeners) listener({ workspaceId });
    },
    askOrchestratorAboutInbox: async ({ workspaceId, conversation, text }) => {
      const connection = connections.get(workspaceId);
      if (!connection?.userId) throw new Error(sourceText("error.messaging.inboxNeedsUser"));
      if (!inbox.some((item) => item.workspaceId === workspaceId && item.conversation === conversation))
        throw new Error(sourceText("error.messaging.inboxUnknownConversation"));
      if (
        !text
          .trim()
          .replace(/^@chief/i, "")
          .trim()
      )
        throw new Error(sourceText("error.messaging.sendTextEmpty"));
      if (!connection.orchestratorAgentId) throw new Error(sourceText("error.messaging.inboxNeedsOrchestrator"));
      return { agentId: connection.orchestratorAgentId };
    },
    getSlackRouting: async ({ workspaceId }) => clone(routingOf(workspaceId)),
    handOverSlackDefault: async ({ workspaceId, slackUserId }) => {
      const current = routingOf(workspaceId);
      if (!current.isDefault || !current.people.some((person) => person.slackUserId === slackUserId))
        throw new Error(sourceText("error.messaging.notConnected"));
      routing.set(workspaceId, { isDefault: false, people: [] });
      return clone(routingOf(workspaceId));
    },
    onInboxChanged: (listener) => {
      inboxListeners.add(listener);
      return () => inboxListeners.delete(listener);
    },
    listDrafts: async () =>
      clone(
        threads
          .filter((candidate) => candidate.summary.pendingDrafts > 0 && !answered.has(candidate.summary.threadId))
          .map((candidate) => ({
            draftId: `draft-${candidate.summary.threadId}`,
            workspaceId: SLACK_PREVIEW_WORKSPACE_ID,
            threadId: candidate.summary.threadId,
            agentId: candidate.summary.agentId,
            recipient: "Ana",
            sender: "user" as const,
            requestedBy: candidate.summary.title,
            text: "The release notes are in the shared folder.",
            createdAt: candidate.summary.updatedAt,
          })),
      ),
    answerDraft: async ({ draftId }) => {
      const found = threads.find((candidate) => `draft-${candidate.summary.threadId}` === draftId);
      if (!found || answered.has(found.summary.threadId))
        throw new Error(sourceText("status.messaging.requestInactive"));
      answered.add(found.summary.threadId);
      found.summary = { ...found.summary, pendingDrafts: 0 };
      for (const listener of changeListeners) listener({ threadId: found.summary.threadId });
    },
    listThreads: async () => clone(threads.map((candidate) => candidate.summary)),
    readThreadPage: async ({ threadId }): Promise<ConversationPage> => {
      const { summary, messages } = findThread(threadId);
      return clone({
        agentId: summary.agentId,
        threadId,
        activeTurnId: null,
        revision: messages.length,
        messages,
        references: {},
        pageInfo: { hasOlder: false, olderCursor: null },
        readState: {
          unreadCount: summary.unreadCount,
          firstUnreadMessageId: summary.unreadCount > 0 ? (messages.at(-summary.unreadCount)?.id ?? null) : null,
          throughMessageId: null,
        },
      });
    },
    markThreadRead: async ({ threadId, throughMessageId }) => {
      const found = findThread(threadId);
      found.summary = { ...found.summary, unreadCount: 0 };
      for (const listener of changeListeners) listener({ threadId });
      return { unreadCount: 0, firstUnreadMessageId: null, throughMessageId };
    },
    hideThreads: async ({ threadIds }) => {
      const hidden = new Set(threadIds);
      threads = threads.filter((candidate) => !hidden.has(candidate.summary.threadId));
      for (const threadId of hidden) for (const listener of changeListeners) listener({ threadId });
    },
    onThreadsChanged: (listener) => {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
  };
  const overview = { slack: api.getSlackOverview, discord: api.getDiscordOverview, telegram: api.getTelegramOverview };
  return {
    ...api,
    hostOverview: ({ platform }) => overview[platform](),
    hostConnect: ({ platform, place }) =>
      platform === "slack"
        ? api.connectSlackWorkspace()
        : platform === "discord"
          ? api.connectDiscordGuild()
          : api.connectTelegramChat({ place: place ?? "group" }),
    hostDisconnect: ({ platform, workspaceId }) =>
      platform === "slack"
        ? api.disconnectSlackWorkspace({ workspaceId })
        : platform === "discord"
          ? api.disconnectDiscordGuild({ workspaceId })
          : api.disconnectTelegramChat({ workspaceId }),
    hostReconnect: ({ platform, workspaceId }) =>
      platform === "slack"
        ? api.reconnectSlackWorkspace({ workspaceId })
        : platform === "discord"
          ? api.reconnectDiscordGuild({ workspaceId })
          : api.reconnectTelegramChat({ workspaceId }),
    hostSetEnabled: ({ platform, ...input }) =>
      platform === "slack"
        ? api.setSlackEnabled(input)
        : platform === "discord"
          ? api.setDiscordEnabled(input)
          : api.setTelegramEnabled(input),
    hostAddOrchestrator: ({ platform, workspaceId }) =>
      platform === "telegram" || workspaceId === null
        ? api.addTelegramOrchestrator({})
        : platform === "slack"
          ? api.addSlackOrchestrator({ workspaceId })
          : api.addDiscordOrchestrator({ workspaceId }),
    hostGetDiscordAccess: (input) => api.getDiscordAccess(input),
    hostListDiscordRoles: (input) => api.listDiscordRoles(input),
    hostSetDiscordAccess: (input) => api.setDiscordAccess(input),
    hostGetWhatsAppOverview: () => api.getWhatsAppOverview(),
    hostStartWhatsAppLink: (input) => api.startWhatsAppLink(input),
    hostGetWhatsAppLinkState: () => api.getWhatsAppLinkState(),
    hostCancelWhatsAppLink: () => api.cancelWhatsAppLink(),
    hostDisconnectWhatsAppNumber: (input) => api.disconnectWhatsAppNumber(input),
    hostReconnectWhatsAppNumber: (input) => api.reconnectWhatsAppNumber(input),
    hostSetWhatsAppEnabled: (input) => api.setWhatsAppEnabled(input),
    hostAddWhatsAppOrchestrator: () => api.addWhatsAppOrchestrator({}),
    hostListWhatsAppGroups: (input) => api.listWhatsAppGroups(input),
    hostAddWhatsAppSender: (input) => api.addWhatsAppSender(input),
    hostRemoveWhatsAppSender: (input) => api.removeWhatsAppSender(input),
    hostAnswerWhatsAppRequest: (input) => api.answerWhatsAppRequest(input),
    hostSetWhatsAppOwnNumber: (input) => api.setWhatsAppOwnNumber(input),
    hostSetWhatsAppWorkingMessage: (input) => api.setWhatsAppWorkingMessage(input),
    hostSetWhatsAppStatusReactions: (input) => api.setWhatsAppStatusReactions(input),
    hostSetWhatsAppSenderReadOnly: (input) => api.setWhatsAppSenderReadOnly(input),
  };
}
