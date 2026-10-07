import type {
  ConversationMessage,
  ConversationPage,
  MessagingConnection,
  MessagingDesktopApi,
  MessagingThreadSummary,
  MessagingThreadsChanged,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { clone } from "./mock-support";

const PREVIEW_WORKSPACE = { workspaceId: "T0PREVIEW", workspaceName: "Preview workspace" };

/** The Slack conversations the preview orchestrator answered, with their messages. */
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
      workspaceId: PREVIEW_WORKSPACE.workspaceId,
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

/** The preview person's local Slack inbox: a direct message, a mention and a picked channel. */
function previewInbox() {
  const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const message = (id: string, from: string, text: string, minutes: number, isOwn = false) => ({
    id,
    from,
    isOwn,
    text,
    sentAt: at(minutes),
    thread: null,
  });
  return [
    {
      workspaceId: PREVIEW_WORKSPACE.workspaceId,
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
      workspaceId: PREVIEW_WORKSPACE.workspaceId,
      conversation: "C0PREVIEWLAU",
      kind: "channel" as const,
      place: "#launch",
      unreadCount: 2,
      latestAt: at(12),
      latestFrom: "Ana",
      preview: "The demo moves to Friday.",
      messages: [
        message("2.000001", "Ana", "Kickoff notes are in the doc.", 30),
        message("2.000002", "Ana", "The demo moves to Friday.", 12),
      ],
    },
  ];
}

/** The Slack workspaces of the preview host. Connecting Slack connects a preview workspace at once. */
/** `orchestrator` names the preview agent that stands in for the Slack Orchestrator. */
export function createMockMessaging(orchestrator: () => string): MessagingDesktopApi {
  const connections = new Map<string, MessagingConnection>();
  let threads: ReturnType<typeof previewThreads> = [];
  const changeListeners = new Set<(change: MessagingThreadsChanged) => void>();
  const answered = new Set<string>();
  const inbox = previewInbox();
  const inboxRead = new Set<string>();
  const inboxListeners = new Set<(change: { workspaceId: string }) => void>();
  const findThread = (threadId: string) => {
    const found = threads.find((candidate) => candidate.summary.threadId === threadId);
    if (!found) throw new Error(sourceText("error.messaging.threadUnavailable"));
    return found;
  };
  const change = (workspaceId: string, update: Partial<MessagingConnection>) => {
    const current = connections.get(workspaceId);
    if (!current) throw new Error(sourceText("error.messaging.notConnected"));
    connections.set(workspaceId, { ...current, ...update });
  };
  return {
    getSlackOverview: async () => clone({ connections: [...connections.values()] }),
    connectSlackWorkspace: async () => {
      connections.set(PREVIEW_WORKSPACE.workspaceId, {
        ...PREVIEW_WORKSPACE,
        platform: "slack",
        enabled: true,
        state: "connected",
        botUserId: "U0PREVIEW",
        userId: "U0PREVIEWME",
        userName: "you",
        missingScopes: [],
        retryAt: null,
        credentials: "saved",
        orchestratorAgentId: null,
        watchedChannels: [],
        sendGuards: { paused: false, quietHours: null, hourlyLimit: 10, sentLastHour: 0 },
      });
    },
    disconnectSlackWorkspace: async ({ workspaceId }) => {
      connections.delete(workspaceId);
    },
    reconnectSlackWorkspace: async ({ workspaceId }) => change(workspaceId, { enabled: true, state: "connected" }),
    setSlackEnabled: async ({ workspaceId, enabled }) =>
      change(workspaceId, { enabled, state: enabled ? "connected" : "paused" }),
    addSlackOrchestrator: async ({ workspaceId }) => {
      const agentId = orchestrator();
      change(workspaceId, { orchestratorAgentId: agentId });
      threads = previewThreads(agentId);
      for (const { summary } of threads)
        for (const listener of changeListeners) listener({ threadId: summary.threadId });
      return { agentId, sectionId: null };
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
      return clone({ workspaceId, conversation, place: found.place, messages: found.messages });
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
            workspaceId: PREVIEW_WORKSPACE.workspaceId,
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
    onThreadsChanged: (listener) => {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
  };
}
