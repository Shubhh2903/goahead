import {
  type ConversationPage,
  LOCAL_SERVER_ID,
  type MessagingDraft,
  type MessagingInboxPage,
  type MessagingInboxWorkspace,
  type MessagingThreadSummary,
} from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { createStore, onCleanup, reconcile, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { createSimpleContext } from "../../simple-context";
import { useAgents } from "../agents/agents-context";
import { useChannels } from "../channels/channels-context";
import { useDirectMessages } from "../conversation/direct-messages-context";
import { useServers } from "../servers/servers-context";
import { useUsage } from "../usage/usage-context";
import { messagingThreadsPort } from "./messaging-threads-port";

const PAGE_LIMIT = 50;

/**
 * A reply that the person sent from the inbox. It shows at once and stays until a read of its
 * conversation brings the stored message.
 */
export interface MessagingInboxOutgoing {
  id: string;
  workspaceId: string;
  conversation: string;
  text: string;
  /** Before Slack got the reply, so the stored message is not older. */
  startedAt: string;
  /** Slack has not answered yet. */
  sending: boolean;
}

/** The workspaces and the conversations of the inbox list keep their rows across reads. */
const inboxListKey = (item: { workspaceId?: string; conversation?: string }) => item.workspaceId ?? item.conversation;

const samePlace = (
  a: { workspaceId: string; conversation: string } | null,
  b: { workspaceId: string; conversation: string } | null,
) => a !== null && b !== null && a.workspaceId === b.workspaceId && a.conversation === b.conversation;

/** The outgoing replies that `page` does not hold yet. Each stored reply settles one outgoing reply. */
function unsettledOutgoing(outgoing: readonly MessagingInboxOutgoing[], page: MessagingInboxPage) {
  const settled = new Set<string>();
  return outgoing.filter((item) => {
    if (!samePlace(item, page)) return true;
    const stored = page.messages.find(
      (message) =>
        message.isOwn && message.text === item.text && message.sentAt >= item.startedAt && !settled.has(message.id),
    );
    if (!stored) return true;
    settled.add(stored.id);
    return false;
  });
}

interface MessagingThreadsState {
  /** Newest first, across every agent. The sidebar puts each one under its agent. */
  threads: MessagingThreadSummary[];
  selectedId: string | null;
  /** The open conversation, null while it loads. */
  page: ConversationPage | null;
  loading: boolean;
  failed: boolean;
  /** Messages agents drafted, which wait for the person, oldest first. */
  drafts: MessagingDraft[];
  /** The drafts whose answer is on its way. */
  answering: string[];
}

interface MessagingInboxState {
  /** One entry per workspace connected as the person. */
  workspaces: MessagingInboxWorkspace[];
  /** The inbox covers the workspace pane. */
  open: boolean;
  selection: { workspaceId: string; conversation: string } | null;
  /**
   * The last conversation read. It stays while the next one loads, so the view does not go blank; it
   * is null only before the first read.
   */
  page: MessagingInboxPage | null;
  failed: boolean;
  /** Replies the person sent that no read has brought yet, oldest first. */
  outgoing: MessagingInboxOutgoing[];
}

/**
 * The Slack conversations that this computer's agents answer, and the one the user opened. The thread
 * view is read-only: the agent answers in Slack, and approvals stay on the Slack buttons. In the inbox
 * the person can reply as themselves. Only the local host has these, so on a remote server the list
 * stays empty.
 */
const MessagingThreads = createSimpleContext({
  name: "MessagingThreads",
  init: () => {
    const { activeServerId } = useServers();
    const { setAgentSetupOpen } = useAgents();
    const { clearDirectSelection, setDirectTyping } = useDirectMessages();
    const channels = useChannels();
    const usage = useUsage();
    const port = () => messagingThreadsPort().messaging;
    // This provider lives for one server id. Read the id, not the server: the server list can still be
    // loading when the scope mounts, and the local scope is keyed "local" from the start.
    const supported = untrack(activeServerId) === LOCAL_SERVER_ID;
    const [state, setState] = createStore<MessagingThreadsState>({
      threads: [],
      selectedId: null,
      page: null,
      loading: false,
      failed: false,
      drafts: [],
      answering: [],
    });
    const [inbox, setInbox] = createStore<MessagingInboxState>({
      workspaces: [],
      open: false,
      selection: null,
      page: null,
      failed: false,
      outgoing: [],
    });
    let disposed = false;
    // Each read replaces the one before it, so a slow answer never overwrites a newer one.
    let listReads = 0;
    let pageReads = 0;
    let inboxPageReads = 0;
    let outgoingIds = 0;
    // One list read at a time. A change during a read asks for one more read after it.
    let inboxListReading = false;
    let inboxListAgain = false;
    // One read of a conversation at a time, for the same reason.
    let inboxPageRead: { workspaceId: string; conversation: string; again: boolean } | null = null;

    // A failed read keeps the last inbox. The next change reads again.
    const reloadInbox = () => {
      if (!supported || disposed) return;
      if (inboxListReading) {
        inboxListAgain = true;
        return;
      }
      inboxListReading = true;
      inboxListAgain = false;
      void port()
        .listInbox()
        .then((workspaces) => {
          if (disposed) return;
          setInbox((draft) => {
            reconcile(workspaces, inboxListKey)(draft.workspaces);
          });
        })
        .catch(() => undefined)
        .finally(() => {
          inboxListReading = false;
          if (inboxListAgain) reloadInbox();
        });
    };

    const unreadIn = (workspaceId: string, conversation: string) =>
      inbox.workspaces
        .find((workspace) => workspace.workspaceId === workspaceId)
        ?.conversations.find((item) => item.conversation === conversation)?.unreadCount ?? 0;

    /**
     * Reads one inbox conversation into the open page. Rows that did not change stay. Main marks it
     * read, so the list reads again when its count can be out of date.
     */
    const loadInboxPage = (workspaceId: string, conversation: string) => {
      if (samePlace(inboxPageRead, { workspaceId, conversation })) {
        if (inboxPageRead) inboxPageRead.again = true;
        return;
      }
      const read = ++inboxPageReads;
      const current = { workspaceId, conversation, again: false };
      inboxPageRead = current;
      setInbox((draft) => {
        draft.failed = false;
      });
      void port()
        .readInboxConversation({ workspaceId, conversation, limit: PAGE_LIMIT })
        .then((page) => {
          if (disposed || read !== inboxPageReads) return;
          setInbox((draft) => {
            if (draft.page && samePlace(draft.page, page)) reconcile(page, "id")(draft.page);
            else draft.page = page;
            draft.outgoing = unsettledOutgoing(draft.outgoing, page);
          });
          if (inboxListReading || unreadIn(workspaceId, conversation) > 0) reloadInbox();
        })
        .catch(() => {
          if (disposed || read !== inboxPageReads) return;
          setInbox((draft) => {
            draft.failed = true;
            // Messages of another conversation would read as this one's.
            if (draft.page && !samePlace(draft.page, current)) draft.page = null;
          });
        })
        .finally(() => {
          if (inboxPageRead !== current) return;
          inboxPageRead = null;
          if (current.again && !disposed && read === inboxPageReads) loadInboxPage(workspaceId, conversation);
        });
    };

    // A failed read keeps the last list. The next change reads again. A draft changes its thread, so
    // the drafts are read with the list.
    const reloadList = () => {
      if (!supported) return;
      const read = ++listReads;
      void Promise.all([port().listThreads(), port().listDrafts()])
        .then(([threads, drafts]) => {
          if (disposed || read !== listReads) return;
          setState((draft) => {
            draft.threads = threads;
            draft.drafts = drafts;
          });
        })
        .catch(() => undefined);
    };

    /** Answers a draft as the person. The list reads again when main reports the change. */
    function answerDraft(draftId: string, decision: "approve" | "deny", text?: string): void {
      if (state.answering.includes(draftId)) return;
      setState((draft) => {
        draft.answering = [...draft.answering, draftId];
      });
      void port()
        .answerDraft({ draftId, decision, ...(text === undefined ? {} : { text }) })
        .catch((error: unknown) => {
          const { t, errorMessage } = currentText();
          actionToast.error(t("messaging.draft.failed"), {
            description: errorMessage(error, t("messaging.draft.failed")),
          });
          reloadList();
        })
        .finally(() => {
          if (disposed) return;
          setState((draft) => {
            draft.answering = draft.answering.filter((id) => id !== draftId);
          });
        });
    }

    // As in a channel: a message that arrives behind the Usage report, or while the window is in the
    // background, was not seen.
    const markRead = (threadId: string, page: ConversationPage) => {
      const last = page.messages.at(-1)?.id ?? null;
      if (!last || (page.readState?.unreadCount ?? 0) === 0) return;
      if (!document.hasFocus() || usage.state.serverId) return;
      void port()
        .markThreadRead({ threadId, throughMessageId: last })
        .then(reloadList)
        .catch(() => undefined);
    };

    const loadPage = (threadId: string) => {
      const read = ++pageReads;
      setState((draft) => {
        draft.loading = true;
        draft.failed = false;
      });
      void port()
        .readThreadPage({ threadId, limit: PAGE_LIMIT })
        .then((page) => {
          if (disposed || read !== pageReads) return;
          setState((draft) => {
            draft.page = page;
            draft.loading = false;
          });
          markRead(threadId, page);
        })
        .catch(() => {
          if (disposed || read !== pageReads) return;
          setState((draft) => {
            draft.loading = false;
            draft.failed = true;
          });
        });
    };

    const loadOlder = () => {
      const threadId = state.selectedId;
      const cursor = state.page?.pageInfo.olderCursor;
      if (!threadId || !cursor || state.loading) return;
      const read = ++pageReads;
      setState((draft) => {
        draft.loading = true;
      });
      void port()
        .readThreadPage({ threadId, anchor: { type: "before", cursor }, limit: PAGE_LIMIT })
        .then((older) => {
          if (disposed || read !== pageReads) return;
          setState((draft) => {
            if (draft.page) {
              draft.page.messages = [...older.messages, ...draft.page.messages];
              draft.page.references = { ...older.references, ...draft.page.references };
              draft.page.pageInfo = older.pageInfo;
            }
            draft.loading = false;
          });
        })
        .catch(() => {
          if (disposed || read !== pageReads) return;
          setState((draft) => {
            draft.loading = false;
          });
        });
    };

    if (supported) {
      const unsubscribe = port().onThreadsChanged(({ threadId }) => {
        reloadList();
        if (state.selectedId === threadId) loadPage(threadId);
      });
      onCleanup(unsubscribe);
      // A new message shows at once. The open conversation reads again only while the person can see
      // it, because reading marks it read.
      const stopInbox = port().onInboxChanged(({ workspaceId }) => {
        reloadInbox();
        const selection = inbox.selection;
        if (inbox.open && selection?.workspaceId === workspaceId && document.hasFocus() && !usage.state.serverId)
          loadInboxPage(selection.workspaceId, selection.conversation);
      });
      onCleanup(stopInbox);
      reloadList();
      reloadInbox();
    }
    onCleanup(() => {
      disposed = true;
    });

    /** Closes what a Slack view covers, as opening a channel does. */
    function coverWorkspace(): void {
      setAgentSetupOpen(false);
      setDirectTyping(false);
      clearDirectSelection();
      usage.dismissUsage();
      channels.close();
    }

    function closeInbox(): void {
      if (!inbox.open) return;
      inboxPageReads += 1;
      inboxPageRead = null;
      setInbox((draft) => {
        draft.open = false;
        draft.selection = null;
        draft.page = null;
        draft.failed = false;
        // Slack holds the sent replies, so the next read shows them.
        draft.outgoing = draft.outgoing.filter((item) => item.sending);
      });
    }

    /** Opens the inbox over the workspace. No conversation is read until the person picks one. */
    function openInbox(): void {
      coverWorkspace();
      closeThread();
      setInbox((draft) => {
        draft.open = true;
      });
      reloadInbox();
    }

    function selectInboxConversation(workspaceId: string, conversation: string): void {
      // The page on screen stays until the new one arrives, so the view does not go blank.
      setInbox((draft) => {
        draft.selection = { workspaceId, conversation };
      });
      loadInboxPage(workspaceId, conversation);
    }

    /**
     * Sends a reply as the person to the top of the open inbox conversation. The reply shows at once.
     * Main stores it, marks the conversation read and reports the change, so the read that follows
     * brings the stored reply in its place. A failure removes it and rejects, so the reply box gets
     * the text back.
     */
    async function sendInboxReply(text: string): Promise<void> {
      const selection = inbox.selection;
      if (!selection) throw new Error("No inbox conversation is open.");
      const id = `outgoing-${++outgoingIds}`;
      setInbox((draft) => {
        draft.outgoing.push({ id, ...selection, text, startedAt: new Date().toISOString(), sending: true });
      });
      try {
        await port().sendInboxReply({ workspaceId: selection.workspaceId, conversation: selection.conversation, text });
      } catch (error) {
        if (!disposed)
          setInbox((draft) => {
            draft.outgoing = draft.outgoing.filter((item) => item.id !== id);
          });
        throw error;
      }
      if (disposed) return;
      setInbox((draft) => {
        const sent = draft.outgoing.find((item) => item.id === id);
        if (sent) sent.sending = false;
      });
    }

    /**
     * Gives an `@chief` instruction about the open inbox conversation to the workspace's Slack
     * Orchestrator. Nothing goes to Slack. Answers the orchestrator, so the caller can open it.
     */
    async function askOrchestratorAboutInbox(text: string): Promise<string> {
      const selection = inbox.selection;
      if (!selection) throw new Error("No inbox conversation is open.");
      const { agentId } = await port().askOrchestratorAboutInbox({
        workspaceId: selection.workspaceId,
        conversation: selection.conversation,
        text,
      });
      return agentId;
    }

    /**
     * Hides conversations from the sidebar until a newer message arrives. Nothing is deleted. A
     * failure shows a toast and rejects, so a confirmation can stay open.
     */
    async function hideThreads(threadIds: string[]): Promise<void> {
      try {
        await port().hideThreads({ threadIds });
      } catch (error) {
        const { t, errorMessage } = currentText();
        actionToast.error(t("sidebar.clearHistory.failed"), {
          description: errorMessage(error, t("sidebar.clearHistory.failed")),
        });
        throw error;
      }
      if (state.selectedId && threadIds.includes(state.selectedId)) closeThread();
      reloadList();
    }

    /** Opens one conversation over the workspace, as a channel does, and closes what it covers. */
    function open(threadId: string): void {
      coverWorkspace();
      closeInbox();
      setState((draft) => {
        draft.selectedId = threadId;
        draft.page = null;
      });
      loadPage(threadId);
    }

    /** Closes the open thread and the inbox. */
    function close(): void {
      closeThread();
      closeInbox();
    }

    function closeThread(): void {
      if (state.selectedId === null) return;
      pageReads += 1;
      setState((draft) => {
        draft.selectedId = null;
        draft.page = null;
        draft.loading = false;
        draft.failed = false;
      });
    }

    return {
      state,
      open,
      close,
      loadOlder,
      retry: () => {
        if (state.selectedId) loadPage(state.selectedId);
      },
      selectedThread: () => state.threads.find((thread) => thread.threadId === state.selectedId),
      answerDraft,
      hideThreads,
      inbox,
      openInbox,
      selectInboxConversation,
      sendInboxReply,
      askOrchestratorAboutInbox,
      retryInbox: () => {
        const selection = inbox.selection;
        if (selection) loadInboxPage(selection.workspaceId, selection.conversation);
        else reloadInbox();
      },
    };
  },
});

export const MessagingThreadsProvider = MessagingThreads.provider;
export const useMessagingThreads = MessagingThreads.use;
