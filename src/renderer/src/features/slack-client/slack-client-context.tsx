import type {
  SlackClientConversation,
  SlackClientMentionCandidate,
  SlackClientMessage,
  SlackClientPage,
  SlackClientReaction,
  SlackClientThread,
} from "@openbot/contracts/ipc";
import type { SlackClientUpload, SlackComposerFile } from "@openbot/ui/features/slack-client/slack-client-types";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createStore, onCleanup, reconcile } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { useMessagingThreads } from "../messaging-threads/messaging-threads-context";
import { useUsage } from "../usage/usage-context";
import { slackClientPort } from "./slack-client-port";

interface Selection {
  workspaceId: string;
  channelId: string;
}

interface ThreadSelection extends Selection {
  threadTs: string;
}

/** A change the person made to a message that shows before Slack confirms it. */
type MessageChange = { kind: "edit"; text: string } | { kind: "delete" } | { kind: "react"; name: string; on: boolean };

interface PendingChange extends Selection {
  id: number;
  ts: string;
  change: MessageChange;
  /**
   * Null while Slack has not answered. After Slack accepted it, the number of the last read started
   * then: a later read of the conversation holds the change, so it drops this one.
   */
  settledAfter: number | null;
}

/** A message the person sent that no read has brought yet. */
interface Outgoing extends Selection {
  id: string;
  threadTs: string | null;
  broadcast: boolean;
  text: string;
  /** A Slack-style time of the send, so the pane can show its date and time before Slack answers. */
  sentTs: string;
  /**
   * Null while Slack has not answered. After Slack accepted it, the number of the last read started
   * then: a later read of the place it went to holds the message, so it drops this copy.
   */
  settledAfter: number | null;
}

interface Upload extends SlackClientUpload {
  workspaceId: string;
  channelId: string;
  threadTs: string | null;
}

interface SlackClientState {
  /** Every conversation of every workspace connected as the person. */
  conversations: SlackClientConversation[];
  selection: Selection | null;
  /** The last page read. It stays while the next conversation loads, so the view does not go blank. */
  page: SlackClientPage | null;
  pageFailed: boolean;
  loadingOlder: boolean;
  thread: ThreadSelection | null;
  /** The open thread as read; null while its first read is on its way. */
  threadPage: SlackClientThread | null;
  threadFailed: boolean;
  changes: PendingChange[];
  outgoing: Outgoing[];
  uploads: Upload[];
  /** The text of the last action that Slack refused. */
  actionError: string | null;
}

const conversationKey = (item: { workspaceId: string; channelId: string }) => `${item.workspaceId}:${item.channelId}`;

const samePlace = (a: Selection | null, b: Selection | null) =>
  a !== null && b !== null && a.workspaceId === b.workspaceId && a.channelId === b.channelId;

const sameThread = (a: ThreadSelection | null, b: ThreadSelection | null) =>
  samePlace(a, b) && a?.threadTs === b?.threadTs;

/** A Slack ts as a string that sorts in time order: `seconds.fraction`, both padded. */
function tsOrder(ts: string): string {
  const [seconds = "", fraction = ""] = ts.split(".");
  return `${seconds.padStart(12, "0")}.${fraction.padEnd(9, "0")}`;
}

function mergeLookups<T extends { people: Record<string, string>; channels: Record<string, string> }>(
  older: T & { customEmoji: Record<string, string> },
  newer: T & { customEmoji: Record<string, string> },
) {
  return {
    people: { ...older.people, ...newer.people },
    channels: { ...older.channels, ...newer.channels },
    customEmoji: { ...older.customEmoji, ...newer.customEmoji },
  };
}

/**
 * The newest page that a read brings, over the page on screen. The messages older than the read stay,
 * so a reload does not drop what the person scrolled back to; inside the read's range the read wins.
 */
/** Seconds and six digits, as Slack writes `ts`; the last digits keep two sends in one millisecond apart. */
function sentTs(sequence: number): string {
  const now = Date.now();
  const fraction = `${String(now % 1000).padStart(3, "0")}${String(sequence % 1000).padStart(3, "0")}`;
  return `${Math.floor(now / 1000)}.${fraction}`;
}

function mergeNewest(current: SlackClientPage, fresh: SlackClientPage): SlackClientPage {
  const first = fresh.messages[0];
  if (!first) return fresh;
  const kept = current.messages.filter((message) => tsOrder(message.ts) < tsOrder(first.ts));
  return {
    ...fresh,
    ...mergeLookups(current, fresh),
    messages: [...kept, ...fresh.messages],
    hasOlder: kept.length > 0 ? current.hasOlder : fresh.hasOlder,
  };
}

function toggleReaction(reactions: SlackClientReaction[], name: string, on: boolean): SlackClientReaction[] {
  const current = reactions.find((reaction) => reaction.name === name);
  if (on) {
    if (current?.mine) return reactions;
    if (current)
      return reactions.map((reaction) =>
        reaction.name === name ? { ...reaction, count: reaction.count + 1, mine: true } : reaction,
      );
    return [...reactions, { name, count: 1, mine: true }];
  }
  if (!current?.mine) return reactions;
  return current.count <= 1
    ? reactions.filter((reaction) => reaction.name !== name)
    : reactions.map((reaction) =>
        reaction.name === name ? { ...reaction, count: reaction.count - 1, mine: false } : reaction,
      );
}

function applyChange(message: SlackClientMessage, item: PendingChange): SlackClientMessage {
  const pending = item.settledAfter === null;
  switch (item.change.kind) {
    case "edit":
      return { ...message, text: item.change.text, ...(pending ? { pending: "editing" as const } : {}) };
    case "delete":
      // Slack accepted the delete: the message shows as deleted until a read drops or replaces it.
      return pending
        ? { ...message, pending: "deleting" }
        : { ...message, deleted: true, text: "", files: [], reactions: [] };
    case "react":
      return { ...message, reactions: toggleReaction(message.reactions, item.change.name, item.change.on) };
  }
}

/**
 * The Slack client: the conversations of the workspaces connected as the person, the open one and its
 * open thread. Reads come from main's cache; a `changed` event reads again, one read per place at a
 * time. The person's actions show at once and roll back when Slack refuses them. Only the local host
 * has Slack, and the view that mounts this provider shows only there.
 */
const SlackClient = createSimpleContext({
  name: "SlackClient",
  init: () => {
    const messagingThreads = useMessagingThreads();
    const usage = useUsage();
    const port = () => slackClientPort().slackClient;
    const [state, setState] = createStore<SlackClientState>({
      conversations: [],
      selection: null,
      page: null,
      pageFailed: false,
      loadingOlder: false,
      thread: null,
      threadPage: null,
      threadFailed: false,
      changes: [],
      outgoing: [],
      uploads: [],
      actionError: null,
    });
    let disposed = false;
    // Every read gets a number, so a change that Slack accepted knows which reads came after it.
    let reads = 0;
    let changeIds = 0;
    let outgoingIds = 0;
    let uploadIds = 0;
    // One read per place at a time. A change during a read asks for one more read after it.
    let listReading = false;
    let listAgain = false;
    let pageRead: (Selection & { again: boolean }) | null = null;
    let threadRead: (ThreadSelection & { again: boolean }) | null = null;
    // The open conversation changed while the window was in the background: read it on focus.
    let pageStale = false;

    const workspaceIds = () => messagingThreads.inbox.workspaces.map((workspace) => workspace.workspaceId);

    /** A failed workspace keeps its last conversations. The next change reads again. */
    const reloadList = () => {
      if (disposed) return;
      if (listReading) {
        listAgain = true;
        return;
      }
      listReading = true;
      listAgain = false;
      const ids = workspaceIds();
      void Promise.allSettled(ids.map((workspaceId) => port().listConversations({ workspaceId })))
        .then((results) => {
          if (disposed) return;
          const conversations = results.flatMap((result, index) =>
            result.status === "fulfilled"
              ? result.value
              : state.conversations.filter((item) => item.workspaceId === ids[index]),
          );
          setState((draft) => {
            reconcile(conversations, conversationKey)(draft.conversations);
          });
        })
        .finally(() => {
          listReading = false;
          if (listAgain) reloadList();
        });
    };

    /**
     * Drops the changes and the sent messages that a read of `place`, started as `read`, holds. A read
     * of the conversation has `threadTs` null; it holds the messages sent to the channel, which include
     * a thread reply also sent to the channel. A read of a thread holds the replies sent to it.
     */
    const settle = (draft: SlackClientState, place: Selection, read: number, threadTs: string | null) => {
      const readAfter = (settledAfter: number | null) => settledAfter !== null && settledAfter < read;
      draft.changes = draft.changes.filter((item) => !samePlace(item, place) || !readAfter(item.settledAfter));
      draft.outgoing = draft.outgoing.filter((item) => {
        if (!samePlace(item, place) || !readAfter(item.settledAfter)) return true;
        const holds = threadTs === null ? item.threadTs === null || item.broadcast : item.threadTs === threadTs;
        return !holds;
      });
    };

    /** Reads the newest page of a conversation. Opening it marks it read, so the list reads again. */
    const loadPage = (place: Selection) => {
      if (samePlace(pageRead, place)) {
        if (pageRead) pageRead.again = true;
        return;
      }
      const read = ++reads;
      const current = { ...place, again: false };
      pageRead = current;
      pageStale = false;
      void port()
        .open({ workspaceId: place.workspaceId, channelId: place.channelId })
        .then((page) => {
          if (disposed || !samePlace(state.selection, place)) return;
          setState((draft) => {
            draft.pageFailed = false;
            if (draft.page && samePlace(draft.page, page)) reconcile(mergeNewest(draft.page, page), "ts")(draft.page);
            else draft.page = page;
            settle(draft, place, read, null);
          });
          reloadList();
        })
        .catch(() => {
          if (disposed || !samePlace(state.selection, place)) return;
          setState((draft) => {
            draft.pageFailed = true;
            // Messages of another conversation would read as this one's.
            if (draft.page && !samePlace(draft.page, place)) draft.page = null;
          });
        })
        .finally(() => {
          if (pageRead !== current) return;
          pageRead = null;
          if (current.again && !disposed && samePlace(state.selection, place)) loadPage(place);
        });
    };

    const loadThread = (place: ThreadSelection) => {
      if (sameThread(threadRead, place)) {
        if (threadRead) threadRead.again = true;
        return;
      }
      const read = ++reads;
      const current = { ...place, again: false };
      threadRead = current;
      void port()
        .thread({ workspaceId: place.workspaceId, channelId: place.channelId, threadTs: place.threadTs })
        .then((thread) => {
          if (disposed || !sameThread(state.thread, place)) return;
          setState((draft) => {
            draft.threadFailed = false;
            if (draft.threadPage && draft.threadPage.parent.ts === thread.parent.ts)
              reconcile(thread, "ts")(draft.threadPage);
            else draft.threadPage = thread;
            settle(draft, place, read, place.threadTs);
          });
        })
        .catch(() => {
          if (disposed || !sameThread(state.thread, place)) return;
          setState((draft) => {
            draft.threadFailed = true;
          });
        })
        .finally(() => {
          if (threadRead !== current) return;
          threadRead = null;
          if (current.again && !disposed && sameThread(state.thread, place)) loadThread(place);
        });
    };

    /** The open conversation reads again only while the person can see it, because reading marks it read. */
    const reloadOpen = (place: Selection) => {
      if (samePlace(state.selection, place)) {
        if (document.hasFocus() && !usage.state.serverId) loadPage(place);
        else pageStale = true;
      }
      const thread = state.thread;
      if (thread && samePlace(thread, place)) loadThread(thread);
    };

    const loadOlder = () => {
      const place = state.selection;
      const page = state.page;
      const oldest = page?.messages[0];
      if (!place || !page || !samePlace(page, place) || !page.hasOlder || !oldest || state.loadingOlder) return;
      setState((draft) => {
        draft.loadingOlder = true;
      });
      void port()
        .older({ workspaceId: place.workspaceId, channelId: place.channelId, beforeTs: oldest.ts })
        .then((older) => {
          if (disposed || !samePlace(state.selection, place)) return;
          setState((draft) => {
            const current = draft.page;
            if (!current || !samePlace(current, place)) return;
            const first = tsOrder(current.messages[0]?.ts ?? oldest.ts);
            const before = older.messages.filter((message) => tsOrder(message.ts) < first);
            Object.assign(current, mergeLookups(older, current));
            current.messages = [...before, ...current.messages];
            current.hasOlder = older.hasOlder;
            current.offline = older.offline;
          });
        })
        .catch(() => undefined)
        .finally(() => {
          if (disposed) return;
          setState((draft) => {
            draft.loadingOlder = false;
          });
        });
    };

    const stopChanged = port().onChanged(({ workspaceId, channelId }) => {
      reloadList();
      if (channelId !== null) reloadOpen({ workspaceId, channelId });
    });
    const onFocus = () => {
      const place = state.selection;
      if (pageStale && place) loadPage(place);
    };
    window.addEventListener("focus", onFocus);
    onCleanup(() => {
      disposed = true;
      stopChanged();
      window.removeEventListener("focus", onFocus);
    });
    // The workspaces come from the inbox list, which reads again when a workspace connects.
    createEffect(
      () => workspaceIds().join("\n"),
      () => reloadList(),
    );

    function select(workspaceId: string, channelId: string): void {
      const place = { workspaceId, channelId };
      setState((draft) => {
        draft.selection = place;
        draft.pageFailed = false;
        draft.loadingOlder = false;
        draft.thread = null;
        draft.threadPage = null;
        draft.threadFailed = false;
      });
      loadPage(place);
    }

    function openThread(threadTs: string): void {
      const place = state.selection;
      if (!place) return;
      const thread = { ...place, threadTs };
      setState((draft) => {
        draft.thread = thread;
        draft.threadFailed = false;
        if (draft.threadPage?.parent.ts !== threadTs) draft.threadPage = null;
      });
      loadThread(thread);
    }

    function closeThread(): void {
      setState((draft) => {
        draft.thread = null;
        draft.threadPage = null;
        draft.threadFailed = false;
      });
    }

    /**
     * Runs one action of the person. The error of a refused action shows, and the promise rejects so
     * the caller can roll back or keep the text.
     */
    async function act(run: () => Promise<unknown>): Promise<void> {
      setState((draft) => {
        draft.actionError = null;
      });
      try {
        await run();
      } catch (error) {
        if (!disposed) {
          const { t, errorMessage } = currentText();
          setState((draft) => {
            draft.actionError = errorMessage(error, t("messaging.inbox.reply.failed"));
          });
        }
        throw error;
      }
    }

    /** Shows `change` on the message at once; Slack's refusal takes it back. */
    async function changeMessage(ts: string, change: MessageChange, call: (place: Selection) => Promise<void>) {
      const place = state.selection;
      if (!place) throw new Error("No Slack conversation is open.");
      const id = ++changeIds;
      setState((draft) => {
        draft.changes.push({ id, ...place, ts, change, settledAfter: null });
      });
      try {
        await act(() => call(place));
      } catch (error) {
        if (!disposed)
          setState((draft) => {
            draft.changes = draft.changes.filter((item) => item.id !== id);
          });
        throw error;
      }
      if (disposed) return;
      setState((draft) => {
        const item = draft.changes.find((entry) => entry.id === id);
        if (item) item.settledAfter = reads;
      });
      reloadOpen(place);
    }

    const edit = (ts: string, text: string) =>
      changeMessage(ts, { kind: "edit", text }, (place) => port().edit({ ...place, ts, text }));
    const remove = (ts: string) => changeMessage(ts, { kind: "delete" }, (place) => port().delete({ ...place, ts }));
    const react = (ts: string, name: string, on: boolean) =>
      changeMessage(ts, { kind: "react", name, on }, (place) => port().react({ ...place, ts, name, on }));

    /** Sends as the person, in the open conversation or in `threadTs`. The message shows at once. */
    async function send(input: { text: string; threadTs?: string; broadcast?: boolean }): Promise<void> {
      const place = state.selection;
      if (!place) throw new Error("No Slack conversation is open.");
      const id = `local.${++outgoingIds}`;
      setState((draft) => {
        draft.outgoing.push({
          id,
          ...place,
          threadTs: input.threadTs ?? null,
          broadcast: input.broadcast === true,
          text: input.text,
          sentTs: sentTs(outgoingIds),
          settledAfter: null,
        });
      });
      try {
        await act(() =>
          port().send({
            ...place,
            text: input.text,
            ...(input.threadTs === undefined ? {} : { threadTs: input.threadTs }),
            ...(input.broadcast === undefined ? {} : { broadcast: input.broadcast }),
          }),
        );
      } catch (error) {
        if (!disposed)
          setState((draft) => {
            draft.outgoing = draft.outgoing.filter((item) => item.id !== id);
          });
        throw error;
      }
      if (disposed) return;
      setState((draft) => {
        const sent = draft.outgoing.find((item) => item.id === id);
        if (sent) sent.settledAfter = reads;
      });
      reloadOpen(place);
    }

    /** Main opens the file picker and shares the chosen file with `text`. Nothing happens on cancel. */
    async function attach(threadTs: string | null, text?: string): Promise<void> {
      const place = state.selection;
      if (!place) throw new Error("No Slack conversation is open.");
      await act(() =>
        port().upload({
          ...place,
          ...(threadTs === null ? {} : { threadTs }),
          ...(text === undefined ? {} : { text }),
        }),
      );
      reloadOpen(place);
    }

    /** Shares a dropped file. Its name shows as an upload until Slack answers. */
    async function uploadFile(file: SlackComposerFile, threadTs: string | null, text?: string): Promise<void> {
      const place = state.selection;
      if (!place) throw new Error("No Slack conversation is open.");
      const id = `upload-${++uploadIds}`;
      setState((draft) => {
        draft.uploads.push({ id, name: file.name, ...place, threadTs });
      });
      try {
        await act(() =>
          port().uploadBytes({
            ...place,
            name: file.name,
            bytes: file.bytes,
            ...(threadTs === null ? {} : { threadTs }),
            ...(text === undefined ? {} : { text }),
          }),
        );
      } finally {
        if (!disposed)
          setState((draft) => {
            draft.uploads = draft.uploads.filter((item) => item.id !== id);
          });
      }
      reloadOpen(place);
    }

    async function mentionCandidates(query: string): Promise<SlackClientMentionCandidate[]> {
      const place = state.selection;
      if (!place) return [];
      return port().mentionCandidates({ workspaceId: place.workspaceId, query });
    }

    /**
     * Gives an `@chief` instruction about the open conversation to the workspace's Slack Orchestrator.
     * Nothing goes to Slack. Answers the orchestrator, so the caller can open it.
     */
    async function askOrchestrator(text: string): Promise<string> {
      const place = state.selection;
      if (!place) throw new Error("No Slack conversation is open.");
      const { agentId } = await slackClientPort().askOrchestrator({
        workspaceId: place.workspaceId,
        conversation: place.channelId,
        text,
      });
      return agentId;
    }

    const withChanges = (message: SlackClientMessage, place: Selection) =>
      state.changes.filter((item) => item.ts === message.ts && samePlace(item, place)).reduce(applyChange, message);

    /** The person's own Slack id, read from a message of theirs. */
    const ownId = () =>
      state.page?.messages.find((message) => message.mine)?.authorId ??
      state.threadPage?.replies.find((message) => message.mine)?.authorId ??
      "";

    const outgoingMessage = (item: Outgoing): SlackClientMessage => ({
      ts: item.sentTs,
      threadTs: item.threadTs,
      replyCount: 0,
      latestReplyTs: null,
      authorId: ownId(),
      text: item.text,
      files: [],
      reactions: [],
      editedAt: null,
      deleted: false,
      mine: true,
      ...(item.settledAfter === null ? { pending: "sending" as const } : {}),
    });

    /** The page on screen is the chosen conversation. */
    const pageShown = createMemo(() => {
      const page = state.page;
      return page && samePlace(page, state.selection) ? page : null;
    });

    const messages = createMemo(() => {
      const page = pageShown();
      if (!page) return [];
      const sent = state.outgoing
        .filter((item) => samePlace(item, page) && (item.threadTs === null || item.broadcast))
        .map(outgoingMessage);
      return [...page.messages.map((message) => withChanges(message, page)), ...sent];
    });

    const threadShown = createMemo(() => {
      const thread = state.threadPage;
      const open = state.thread;
      return thread && open && samePlace(thread, open) && thread.parent.ts === open.threadTs ? thread : null;
    });

    const threadParent = createMemo(() => {
      const thread = threadShown();
      return thread ? withChanges(thread.parent, thread) : null;
    });

    const threadReplies = createMemo(() => {
      const thread = threadShown();
      if (!thread) return [];
      const sent = state.outgoing
        .filter((item) => samePlace(item, thread) && item.threadTs === thread.parent.ts)
        .map(outgoingMessage);
      return [...thread.replies.map((message) => withChanges(message, thread)), ...sent];
    });

    return {
      state,
      conversation: () => {
        const place = state.selection;
        return place ? (state.conversations.find((item) => samePlace(item, place)) ?? null) : null;
      },
      page: pageShown,
      messages,
      /** A conversation is chosen and its first read is on its way. */
      loading: () => state.selection !== null && pageShown() === null && !state.pageFailed,
      thread: threadShown,
      threadParent,
      threadReplies,
      uploadsIn: (threadTs: string | null) =>
        state.uploads.filter((item) => samePlace(item, state.selection) && item.threadTs === threadTs),
      select,
      retry: () => {
        const place = state.selection;
        if (place) loadPage(place);
        else reloadList();
      },
      retryThread: () => {
        const thread = state.thread;
        if (thread) loadThread(thread);
      },
      loadOlder,
      openThread,
      closeThread,
      send,
      edit,
      remove,
      react,
      attach,
      uploadFile,
      mentionCandidates,
      askOrchestrator,
      openUrl: (url: string) => void slackClientPort().openUrl(url),
      dismissError: () =>
        setState((draft) => {
          draft.actionError = null;
        }),
    };
  },
});

export const SlackClientProvider = SlackClient.provider;
export const useSlackClient = SlackClient.use;
