import {
  type ConversationPage,
  LOCAL_SERVER_ID,
  type MessagingDraft,
  type MessagingThreadSummary,
} from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { createStore, onCleanup, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { createSimpleContext } from "../../simple-context";
import { useAgents } from "../agents/agents-context";
import { useChannels } from "../channels/channels-context";
import { useDirectMessages } from "../conversation/direct-messages-context";
import { useServers } from "../servers/servers-context";
import { useUsage } from "../usage/usage-context";
import { messagingThreadsPort } from "./messaging-threads-port";

const PAGE_LIMIT = 50;

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

/**
 * The Slack conversations that this computer's agents answer, and the one the user opened. The view
 * is read-only: the agent answers in Slack, and approvals stay on the Slack buttons. Only the local
 * host has these, so on a remote server the list stays empty.
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
    let disposed = false;
    // Each read replaces the one before it, so a slow answer never overwrites a newer one.
    let listReads = 0;
    let pageReads = 0;

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
      reloadList();
    }
    onCleanup(() => {
      disposed = true;
    });

    /** Opens one conversation over the workspace, as a channel does, and closes what it covers. */
    function open(threadId: string): void {
      setAgentSetupOpen(false);
      setDirectTyping(false);
      clearDirectSelection();
      usage.dismissUsage();
      channels.close();
      setState((draft) => {
        draft.selectedId = threadId;
        draft.page = null;
      });
      loadPage(threadId);
    }

    function close(): void {
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
    };
  },
});

export const MessagingThreadsProvider = MessagingThreads.provider;
export const useMessagingThreads = MessagingThreads.use;
