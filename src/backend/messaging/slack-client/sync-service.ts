import {
  SLACK_CLIENT_LIMITS,
  type SlackClientChanged,
  type SlackClientConversation,
  type SlackClientFile,
  type SlackClientMessage,
  type SlackClientPage,
  type SlackClientThread,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { isInboxImage } from "../messaging-inbox-files";
import type { HistoryMessage, InboxFile, MessagingAdapter } from "../messaging-types";
import type { SlackCacheStore } from "./cache-store";
import type { SlackRequestPriority, SlackRequestQueue } from "./request-queue";

/** The adapter methods the sync reads with. Each read is one Slack call, run in the workspace's queue. */
export type SlackClientAdapter = Pick<
  MessagingAdapter,
  | "authorName"
  | "placeName"
  | "customEmoji"
  | "listConversations"
  | "historyPage"
  | "threadReplies"
  | "conversationInfo"
  | "conversationMembers"
  | "markReadAsUser"
>;

/** What the sync needs to know about a connection that the cache does not hold. */
export interface SlackClientNames {
  /** The Slack workspace id of a connection, or null when it is not connected. */
  workspaceId(connectionId: string): string | null;
  /** The connected person's Slack user id, for `mine`. Null when not connected as a person. */
  ownerUserId(connectionId: string): string | null;
}

/** A read that `stop` ended: its result is not written to the cache. */
class SlackClientStopped extends Error {
  constructor() {
    super("The Slack client of this connection stopped.");
  }
}

/**
 * The cached images of a workspace, owned by the caller. They count toward the cache limit, and the
 * images of an evicted conversation go with its messages.
 */
export interface SlackClientImages {
  sizeBytes(connectionId: string): Promise<number>;
  forget(connectionId: string, channelIds: readonly string[]): Promise<void>;
}

export interface SlackClientSyncOptions {
  store: SlackCacheStore;
  /** The request queue of a connection's workspace: the same one other history-type calls use. */
  queueFor(connectionId: string): SlackRequestQueue;
  /** The live adapter of a connection, or null when it is not connected. */
  adapterFor(connectionId: string): SlackClientAdapter | null;
  names: SlackClientNames;
  onChanged(change: SlackClientChanged): void;
  images?: SlackClientImages;
  now?: () => Date;
  /** Only tests change these. */
  cacheBytes?: number;
  refreshIntervalMs?: number;
  /** Errors that the sync does not pass on, such as a failed background read. Never logs Slack text. */
  warn?: (error: unknown) => void;
}

const PAGE_SIZE = SLACK_CLIENT_LIMITS.pageSize;
/** The conversation list is read again this often while connected. */
const REFRESH_INTERVAL_MS = 10 * 60_000;
/** A conversation or thread read from Slack this recently opens from the cache only; events keep it current. */
const FRESH_MS = 60_000;
/** Bounds on one list or thread read: 200 items a page. */
const LIST_PAGES = 50;
const THREAD_PAGES = 50;
/** The most people, channels and emoji one page looks up. */
const LOOKUPS = 200;
/** Bounds the IPC guards also hold. */
const MAX_NAME = 1_024;
const MAX_TEXT = 100_000;
const MAX_FILES = 100;
const MAX_REACTIONS = 200;
const MAX_REPLIES = 10_000;
const MAX_MEMBERS = 1_000;
/** Codes of a request that did not reach Slack. */
const NETWORK_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/**
 * Loads the Slack client's cache from Slack: the conversation list (at connect and every 10
 * minutes), the newest page of an opened conversation, older pages on scroll, threads and unread
 * state. Every read runs in the workspace's request queue. Each read answers from the cache at once
 * or after one page; a change it merges later is announced with `onChanged`. It owns the timers and
 * the offline state of each connection, never a token, and never logs Slack text or file addresses.
 */
export class SlackClientSync {
  readonly #store: SlackCacheStore;
  readonly #queueFor: (connectionId: string) => SlackRequestQueue;
  readonly #adapterFor: (connectionId: string) => SlackClientAdapter | null;
  readonly #names: SlackClientNames;
  readonly #onChanged: (change: SlackClientChanged) => void;
  readonly #images: SlackClientImages | null;
  readonly #now: () => Date;
  readonly #cacheBytes: number;
  readonly #refreshIntervalMs: number;
  readonly #warn: (error: unknown) => void;
  /** Connections whose last Slack read did not reach Slack. */
  readonly #offline = new Set<string>();
  /** When each conversation's newest page or thread was last read, by `connectionId\0key`. */
  readonly #fetchedAt = new Map<string, number>();
  readonly #inFlight = new Map<string, Promise<void>>();
  readonly #refreshes = new Map<string, Promise<void>>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  /**
   * Conversations whose last newest-page read failed, by `connectionId\0channelId`: Slack could not
   * be reached, or Slack refused the read.
   */
  readonly #loadFailed = new Map<string, "network" | "refused">();
  /** Conversations whose unread state was read in this session, by connection. */
  readonly #unreadChecked = new Map<string, Set<string>>();
  /** Each connection's session. `stop` starts a new one, so a read of the old one writes nothing. */
  readonly #sessions = new Map<string, number>();

  constructor(options: SlackClientSyncOptions) {
    this.#store = options.store;
    this.#queueFor = options.queueFor;
    this.#adapterFor = options.adapterFor;
    this.#names = options.names;
    this.#onChanged = options.onChanged;
    this.#images = options.images ?? null;
    this.#now = options.now ?? (() => new Date());
    this.#cacheBytes = options.cacheBytes ?? SLACK_CLIENT_LIMITS.cacheBytesPerWorkspace;
    this.#refreshIntervalMs = options.refreshIntervalMs ?? REFRESH_INTERVAL_MS;
    const warn = options.warn ?? (() => undefined);
    // A read that `stop` ended is expected: it is not a failure.
    this.#warn = (error) => {
      if (!(error instanceof SlackClientStopped)) warn(error);
    };
  }

  /**
   * The cached conversation list. The first call of a connection with an empty cache waits for one
   * read of the list from Slack.
   */
  async listConversations(connectionId: string): Promise<SlackClientConversation[]> {
    const workspaceId = this.#workspace(connectionId);
    if (this.#store.conversations(connectionId).length === 0)
      await this.refreshConversations(connectionId, "visible").catch((error) => this.#warn(error));
    const owner = this.#names.ownerUserId(connectionId);
    const adapter = this.#adapterFor(connectionId);
    const conversations = await Promise.all(
      this.#store.conversations(connectionId).map(async (conversation): Promise<SlackClientConversation> => {
        const memberIds = conversation.memberIds.filter((id) => id !== owner).slice(0, MAX_MEMBERS);
        // A direct message has no name in Slack, and a group DM's name is Slack's `mpdm-a--b-1`
        // handle list: both are named after their other people.
        const direct = conversation.kind === "im" || conversation.kind === "mpim";
        const fallback = conversation.kind === "mpim" ? groupDmHandles(conversation.name) : conversation.name;
        const name =
          direct && adapter && memberIds.length > 0
            ? (await Promise.all(memberIds.slice(0, 8).map((id) => adapter.authorName(id).catch(() => id)))).join(", ")
            : fallback;
        return {
          workspaceId,
          channelId: conversation.channelId,
          kind: conversation.kind,
          name: name.slice(0, MAX_NAME),
          memberIds,
          unreadCount: Math.max(0, Math.floor(conversation.unreadCount)),
          lastActivityTs: lastActivity(conversation.lastActivityTs, conversation.lastReadTs),
          isMember: conversation.isMember,
        };
      }),
    );
    return conversations.sort(
      (a, b) =>
        (b.lastActivityTs ?? "").localeCompare(a.lastActivityTs ?? "") ||
        a.name.localeCompare(b.name) ||
        a.channelId.localeCompare(b.channelId),
    );
  }

  /**
   * Reads the person's conversation list from Slack into the cache, then the unread state of the
   * conversations not checked in this session (background work), and reads the list again in 10
   * minutes while connected. Concurrent calls share one read.
   */
  refreshConversations(connectionId: string, priority: SlackRequestPriority = "background"): Promise<void> {
    const running = this.#refreshes.get(connectionId);
    if (running) return running;
    const session = this.#session(connectionId);
    const refresh = this.#refresh(connectionId, priority).finally(() => {
      if (this.#refreshes.get(connectionId) === refresh) this.#refreshes.delete(connectionId);
      // A refresh that `stop` ended sets no timer: the connection is stopped.
      if (this.#session(connectionId) === session) this.#schedule(connectionId);
    });
    this.#refreshes.set(connectionId, refresh);
    return refresh;
  }

  /**
   * The cached newest page of a conversation, at once. Unless it was read in the last minute, the
   * newest page is read from Slack (visible work), merged, marked read, and announced.
   */
  async open(connectionId: string, channelId: string): Promise<SlackClientPage> {
    const workspaceId = this.#workspace(connectionId);
    this.#store.markOpened(connectionId, channelId, this.#now().toISOString());
    const adapter = this.#adapterFor(connectionId);
    if (adapter?.historyPage) this.#fetchNewest(connectionId, channelId, adapter);
    const cached = this.#store.page(connectionId, channelId, { limit: PAGE_SIZE });
    return this.#page(workspaceId, connectionId, channelId, cached.messages, cached.hasOlder);
  }

  /**
   * The page before `beforeTs`. Slack is read only when the cache cannot answer alone; when Slack
   * cannot be reached, the cached part comes back with the offline flag.
   */
  async older(connectionId: string, channelId: string, beforeTs: string): Promise<SlackClientPage> {
    const workspaceId = this.#workspace(connectionId);
    let cached = this.#store.page(connectionId, channelId, { beforeTs, limit: PAGE_SIZE });
    const adapter = this.#adapterFor(connectionId);
    const read = adapter?.historyPage?.bind(adapter);
    if (!cached.complete && read) {
      // Read from the bottom of the loaded range, so the page joins it with no gap.
      const oldest = this.#store
        .conversations(connectionId)
        .find((conversation) => conversation.channelId === channelId)?.oldestLoadedTs;
      const latest = oldest && oldest < beforeTs ? oldest : beforeTs;
      try {
        const page = await this.#call(connectionId, "visible", () => read(channelId, { latest, limit: PAGE_SIZE }));
        this.#store.mergePage(connectionId, channelId, page.messages, { hasMore: page.hasMore, latestTs: latest });
        await this.#evict(connectionId);
      } catch (error) {
        if (!isNetworkError(error) && !(error instanceof SlackClientStopped)) throw error;
      }
      cached = this.#store.page(connectionId, channelId, { beforeTs, limit: PAGE_SIZE });
    }
    return this.#page(workspaceId, connectionId, channelId, cached.messages, cached.hasOlder);
  }

  /**
   * A thread's parent and replies. A cached thread answers at once and is read again in the
   * background unless it was read in the last minute; an uncached one waits for Slack.
   */
  async thread(connectionId: string, channelId: string, threadTs: string): Promise<SlackClientThread> {
    const workspaceId = this.#workspace(connectionId);
    const adapter = this.#adapterFor(connectionId);
    const read = adapter?.threadReplies?.bind(adapter);
    let cached = this.#store.thread(connectionId, channelId, threadTs);
    if (read) {
      const key = `${connectionId}\0${channelId}\0${threadTs}`;
      if (!cached.parent) {
        await this.#once(key, () => this.#readThread(connectionId, channelId, threadTs, read)).catch((error) => {
          if (!isNetworkError(error) && !(error instanceof SlackClientStopped)) throw error;
        });
        cached = this.#store.thread(connectionId, channelId, threadTs);
      } else if (this.#stale(key)) {
        void this.#once(key, async () => {
          await this.#readThread(connectionId, channelId, threadTs, read);
          this.#onChanged({ workspaceId, channelId });
        }).catch((error) => this.#warn(error));
      }
    }
    const parent = cached.parent;
    if (!parent) throw new Error(sourceText("error.messaging.threadUnavailable"));
    const owner = this.#names.ownerUserId(connectionId);
    const replies = cached.replies.slice(-MAX_REPLIES).map((message) => clientMessage(workspaceId, message, owner));
    const all = [parent, ...cached.replies.slice(-MAX_REPLIES)];
    return {
      workspaceId,
      channelId,
      parent: clientMessage(workspaceId, parent, owner),
      replies,
      ...(await this.#lookups(connectionId, all)),
    };
  }

  /** Reads one conversation's read mark and unread count into the cache. */
  async refreshUnread(
    connectionId: string,
    channelId: string,
    priority: SlackRequestPriority = "background",
  ): Promise<void> {
    const adapter = this.#adapterFor(connectionId);
    const read = adapter?.conversationInfo?.bind(adapter);
    if (!read) return;
    const state = await this.#call(connectionId, priority, () => read(channelId));
    const known = this.#store.conversations(connectionId).find((entry) => entry.channelId === channelId);
    this.#store.setUnread(connectionId, channelId, state.unreadCount ?? known?.unreadCount ?? 0, state.lastReadTs);
  }

  /**
   * Stops a connection's timers and forgets its session state, as at disconnect. The cache stays.
   * A read that is queued or in flight ends without a write, so a cache cleared after this stays empty.
   */
  stop(connectionId: string): void {
    this.#sessions.set(connectionId, this.#session(connectionId) + 1);
    const timer = this.#timers.get(connectionId);
    if (timer) clearTimeout(timer);
    this.#timers.delete(connectionId);
    this.#offline.delete(connectionId);
    this.#unreadChecked.delete(connectionId);
    for (const key of this.#loadFailed.keys()) if (key.startsWith(`${connectionId}\0`)) this.#loadFailed.delete(key);
    // A refresh of the old session still runs; a refresh after this starts a new one.
    this.#refreshes.delete(connectionId);
    this.#forgetFetched(`${connectionId}\0`);
  }

  /** Forgets when the conversations and threads under a key prefix were read, so the next open reads Slack. */
  #forgetFetched(prefix: string): void {
    for (const key of this.#fetchedAt.keys()) if (key.startsWith(prefix)) this.#fetchedAt.delete(key);
  }

  async #refresh(connectionId: string, priority: SlackRequestPriority): Promise<void> {
    const adapter = this.#adapterFor(connectionId);
    const list = adapter?.listConversations?.bind(adapter);
    const workspaceId = this.#names.workspaceId(connectionId);
    if (!list || workspaceId === null) return;
    let cursor: string | undefined;
    for (let page = 0; page < LIST_PAGES; page += 1) {
      const result = await this.#call(connectionId, priority, () => list(cursor));
      this.#store.upsertConversations(connectionId, result.conversations);
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    this.#onChanged({ workspaceId, channelId: null });
    void this.#checkUnread(connectionId, workspaceId).catch((error) => this.#warn(error));
  }

  /**
   * Reads the people of each group DM whose people are not cached, then the unread state of each
   * conversation once per session, behind any visible work.
   */
  async #checkUnread(connectionId: string, workspaceId: string): Promise<void> {
    let checked = this.#unreadChecked.get(connectionId);
    if (!checked) {
      checked = new Set();
      this.#unreadChecked.set(connectionId, checked);
    }
    await this.#readGroupMembers(connectionId, workspaceId, checked).catch((error) => {
      // A failed read keeps the `mpdm-` names; the unread state is still read.
      if (error instanceof SlackClientStopped) throw error;
      this.#warn(error);
    });
    for (const conversation of this.#store.conversations(connectionId)) {
      if (checked.has(conversation.channelId) || this.#unreadChecked.get(connectionId) !== checked) continue;
      checked.add(conversation.channelId);
      await this.refreshUnread(connectionId, conversation.channelId);
      this.#onChanged({ workspaceId, channelId: null });
    }
  }

  /** Reads the people of each group DM that has none cached, so it is named after them. */
  async #readGroupMembers(connectionId: string, workspaceId: string, session: Set<string>): Promise<void> {
    for (const conversation of this.#store.conversations(connectionId)) {
      if (conversation.kind !== "mpim" || conversation.memberIds.length > 0) continue;
      const adapter = this.#adapterFor(connectionId);
      const read = adapter?.conversationMembers?.bind(adapter);
      if (!read || this.#unreadChecked.get(connectionId) !== session) return;
      const people = await this.#call(connectionId, "background", () => read(conversation.channelId));
      this.#store.setMembers(connectionId, conversation.channelId, people.slice(0, MAX_MEMBERS));
      this.#onChanged({ workspaceId, channelId: null });
    }
  }

  #schedule(connectionId: string): void {
    const previous = this.#timers.get(connectionId);
    if (previous) clearTimeout(previous);
    if (!this.#adapterFor(connectionId)) {
      this.#timers.delete(connectionId);
      return;
    }
    const timer = setTimeout(() => {
      this.#timers.delete(connectionId);
      void this.refreshConversations(connectionId).catch((error) => this.#warn(error));
    }, this.#refreshIntervalMs);
    timer.unref?.();
    this.#timers.set(connectionId, timer);
  }

  #fetchNewest(connectionId: string, channelId: string, adapter: SlackClientAdapter): void {
    const read = adapter.historyPage?.bind(adapter);
    const key = `${connectionId}\0${channelId}`;
    if (!read || !this.#stale(key)) return;
    const workspaceId = this.#names.workspaceId(connectionId);
    void this.#once(key, async () => {
      try {
        const page = await this.#call(connectionId, "visible", () => read(channelId, { limit: PAGE_SIZE }));
        this.#store.mergePage(connectionId, channelId, page.messages, { hasMore: page.hasMore });
        this.#loadFailed.delete(key);
        await this.#markRead(connectionId, channelId, adapter, page.messages);
        await this.#evict(connectionId);
      } catch (error) {
        if (error instanceof SlackClientStopped) return;
        // The conversation is not fresh: the next open reads Slack again. Offline is shown on the
        // page; any other failure shows as a load error, and the cache stays as it is. Only a new
        // error is announced, so a view that reads again on each change does not retry in a loop.
        this.#fetchedAt.delete(key);
        const failure = isNetworkError(error) ? "network" : "refused";
        if (failure === "refused") this.#warn(error);
        if (this.#loadFailed.get(key) === failure) return;
        this.#loadFailed.set(key, failure);
      }
      if (workspaceId !== null) this.#onChanged({ workspaceId, channelId });
    });
  }

  /** Moves the person's read mark in Slack to the newest message, as opening it in Slack does. */
  async #markRead(
    connectionId: string,
    channelId: string,
    adapter: SlackClientAdapter,
    messages: readonly HistoryMessage[],
  ): Promise<void> {
    const newest = messages
      .filter((message) => message.threadTs === null || message.threadTs === message.ts)
      .reduce<string | null>((latest, message) => (latest === null || message.ts > latest ? message.ts : latest), null);
    if (newest === null) return;
    const known = this.#store.conversations(connectionId).find((entry) => entry.channelId === channelId);
    if (known?.lastReadTs && known.lastReadTs >= newest && known.unreadCount === 0) return;
    this.#store.setUnread(connectionId, channelId, 0, newest);
    await adapter.markReadAsUser?.(channelId, newest).catch((error) => this.#warn(error));
  }

  async #readThread(
    connectionId: string,
    channelId: string,
    threadTs: string,
    read: NonNullable<SlackClientAdapter["threadReplies"]>,
  ): Promise<void> {
    const messages: HistoryMessage[] = [];
    let cursor: string | undefined;
    // One queued call a page, so a 429 repeats only that page.
    for (let page = 0; page < THREAD_PAGES; page += 1) {
      const result = await this.#call(connectionId, "visible", () => read(channelId, threadTs, cursor));
      messages.push(...result.messages);
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    this.#store.mergeThread(connectionId, channelId, threadTs, messages);
    await this.#evict(connectionId);
  }

  /**
   * Runs one Slack read in the workspace's queue and keeps the connection's offline state. Every
   * cache write follows a call with no other wait between, so a read that `stop` ended rejects here
   * and its result is never written.
   */
  async #call<T>(connectionId: string, priority: SlackRequestPriority, call: () => Promise<T>): Promise<T> {
    const session = this.#session(connectionId);
    try {
      const result = await this.#queueFor(connectionId).run(priority, () =>
        this.#session(connectionId) === session ? call() : Promise.reject(new SlackClientStopped()),
      );
      if (this.#session(connectionId) !== session) throw new SlackClientStopped();
      this.#setOffline(connectionId, false);
      return result;
    } catch (error) {
      if (isNetworkError(error)) this.#setOffline(connectionId, true);
      throw error;
    }
  }

  #session(connectionId: string): number {
    return this.#sessions.get(connectionId) ?? 0;
  }

  #setOffline(connectionId: string, offline: boolean): void {
    if (offline === this.#offline.has(connectionId)) return;
    if (offline) this.#offline.add(connectionId);
    else this.#offline.delete(connectionId);
    const workspaceId = this.#names.workspaceId(connectionId);
    if (workspaceId !== null) this.#onChanged({ workspaceId, channelId: null });
  }

  /** Keeps the workspace's messages and images under the limit. */
  async #evict(connectionId: string): Promise<void> {
    const imageBytes = (await this.#images?.sizeBytes(connectionId).catch(() => 0)) ?? 0;
    const evicted = this.#store.evictTo(connectionId, Math.max(0, this.#cacheBytes - imageBytes));
    // An evicted conversation has no cached page, so it is not fresh: the next open reads Slack.
    for (const channelId of evicted) {
      this.#fetchedAt.delete(`${connectionId}\0${channelId}`);
      this.#forgetFetched(`${connectionId}\0${channelId}\0`);
    }
    if (evicted.length > 0) await this.#images?.forget(connectionId, evicted).catch((error) => this.#warn(error));
  }

  #stale(key: string): boolean {
    if (this.#inFlight.has(key)) return false;
    const at = this.#fetchedAt.get(key);
    return at === undefined || this.#now().getTime() - at >= FRESH_MS;
  }

  /** Runs `work` once per key at a time and records when it started. */
  #once(key: string, work: () => Promise<void>): Promise<void> {
    const running = this.#inFlight.get(key);
    if (running) return running;
    this.#fetchedAt.set(key, this.#now().getTime());
    const promise = work().finally(() => this.#inFlight.delete(key));
    this.#inFlight.set(key, promise);
    return promise;
  }

  /** The workspace id of a connection that reads the person's conversations. */
  #workspace(connectionId: string): string {
    const workspaceId = this.#names.workspaceId(connectionId);
    if (workspaceId === null) throw new Error(sourceText("error.messaging.clientNeedsUserRead"));
    return workspaceId;
  }

  async #page(
    workspaceId: string,
    connectionId: string,
    channelId: string,
    messages: readonly HistoryMessage[],
    hasOlder: boolean,
  ): Promise<SlackClientPage> {
    const owner = this.#names.ownerUserId(connectionId);
    return {
      workspaceId,
      channelId,
      messages: messages.map((message) => clientMessage(workspaceId, message, owner)),
      hasOlder,
      ...(await this.#lookups(connectionId, messages)),
      offline: this.#offline.has(connectionId) || this.#adapterFor(connectionId) === null,
      ...(this.#loadFailed.get(`${connectionId}\0${channelId}`) === "refused" ? { loadError: true } : {}),
    };
  }

  /**
   * The names of the authors and of the people and channels the texts mention, and the workspace
   * emoji the texts and reactions use. A name that cannot be read is left out: the renderer shows the id.
   */
  async #lookups(
    connectionId: string,
    messages: readonly HistoryMessage[],
  ): Promise<Pick<SlackClientPage, "people" | "channels" | "customEmoji">> {
    const people: Record<string, string> = {};
    const channels: Record<string, string> = {};
    const customEmoji: Record<string, string> = {};
    const adapter = this.#adapterFor(connectionId);
    if (!adapter) return { people, channels, customEmoji };
    const references = slackReferences(messages);
    await Promise.all([
      ...[...references.users].slice(0, LOOKUPS).map(async (id) => {
        const name = await adapter.authorName(id).catch(() => id);
        if (name && name !== id) people[id] = name.slice(0, MAX_NAME);
      }),
      ...[...references.channels].slice(0, LOOKUPS).map(async (id) => {
        const name = (await adapter.placeName(id).catch(() => id)).replace(/^#/u, "");
        if (name && name !== id) channels[id] = name.slice(0, MAX_NAME);
      }),
    ]);
    if (references.emoji.size > 0 && adapter.customEmoji) {
      const all: Record<string, string> = await adapter.customEmoji().catch(() => ({}));
      // Only the emoji on the page, and the emoji an alias of theirs names.
      const wanted = [...references.emoji];
      for (let index = 0; index < wanted.length && index < LOOKUPS; index += 1) {
        const name = wanted[index] ?? "";
        const value = Object.hasOwn(all, name) ? all[name] : undefined;
        if (value === undefined || Object.hasOwn(customEmoji, name)) continue;
        if (!value.startsWith("alias:") && !value.startsWith("https://")) continue;
        customEmoji[name] = value;
        if (value.startsWith("alias:")) wanted.push(value.slice("alias:".length));
      }
    }
    return { people, channels, customEmoji };
  }
}

/** A cached message for the renderer. Files keep no Slack address: an image is main's own cache address. */
function clientMessage(workspaceId: string, message: HistoryMessage, ownerUserId: string | null): SlackClientMessage {
  return {
    ts: message.ts,
    threadTs: message.threadTs,
    replyCount: message.replyCount,
    latestReplyTs: message.latestReplyTs,
    authorId: message.authorId.slice(0, MAX_NAME),
    text: message.text.slice(0, MAX_TEXT),
    files: message.files.slice(0, MAX_FILES).map((file) => clientFile(workspaceId, file)),
    reactions: message.reactions
      .filter((reaction) => reaction.name.length > 0 && reaction.name.length <= 255)
      .slice(0, MAX_REACTIONS)
      .map((reaction) => ({ name: reaction.name, count: reaction.count, mine: reaction.mine })),
    editedAt: message.editedAt,
    deleted: message.deleted,
    mine: ownerUserId !== null && message.authorId === ownerUserId,
  };
}

function clientFile(workspaceId: string, file: InboxFile): SlackClientFile {
  return {
    id: file.id,
    name: file.name.slice(0, MAX_NAME),
    mimetype: file.mimeType.slice(0, 255),
    size: file.size,
    previewUrl: isInboxImage(file.mimeType)
      ? `openbot-attachment://slack/${encodeURIComponent(workspaceId)}/${encodeURIComponent(file.id)}`
      : null,
    permalink: file.permalink?.startsWith("https://") && file.permalink.length <= 2_048 ? file.permalink : null,
  };
}

/**
 * The user and channel ids and the emoji names that messages name: authors, Slack markup in the
 * text, and reactions. Code is not read: Slack does not render markup inside it.
 */
function slackReferences(messages: readonly HistoryMessage[]): {
  users: Set<string>;
  channels: Set<string>;
  emoji: Set<string>;
} {
  const references = { users: new Set<string>(), channels: new Set<string>(), emoji: new Set<string>() };
  for (const message of messages) {
    if (message.authorId) references.users.add(message.authorId);
    for (const reaction of message.reactions) references.emoji.add(reaction.name.split("::")[0] ?? reaction.name);
    const outsideCode = message.text.replace(/```[\s\S]*?```|`[^`\n]*`/gu, " ");
    for (const match of outsideCode.matchAll(/<@([UWB][A-Z0-9]+)(?:\|[^>]*)?>/gu))
      if (match[1]) references.users.add(match[1]);
    for (const match of outsideCode.matchAll(/<#([CGD][A-Z0-9]+)(?:\|[^>]*)?>/gu))
      if (match[1]) references.channels.add(match[1]);
    for (const match of outsideCode.matchAll(/:([a-z0-9_+'-]+):/gu)) if (match[1]) references.emoji.add(match[1]);
  }
  return references;
}

/**
 * The other people of a group DM from Slack's `mpdm-a--b--c-1` name, until its members are read.
 * Any other name stays as it is.
 */
function groupDmHandles(name: string): string {
  const match = /^mpdm-(.+)-\d+$/u.exec(name);
  return match?.[1] ? match[1].split("--").filter(Boolean).join(", ") : name;
}

/**
 * The newest known activity of a conversation: its newest cached message, or the person's read mark
 * when that is later or no message is cached. Slack's `0000000000.000000` mark means never read.
 */
function lastActivity(activityTs: string | null, lastReadTs: string | null): string | null {
  const read = lastReadTs && /^0+\.0+$/u.test(lastReadTs) ? null : lastReadTs;
  if (activityTs === null) return read;
  if (read === null) return activityTs;
  return compareSlackTs(read, activityTs) > 0 ? read : activityTs;
}

function compareSlackTs(a: string, b: string): number {
  const [aSeconds = "", aFraction = ""] = a.split(".");
  const [bSeconds = "", bFraction = ""] = b.split(".");
  const left = `${aSeconds.padStart(12, "0")}.${aFraction.padEnd(9, "0")}`;
  const right = `${bSeconds.padStart(12, "0")}.${bFraction.padEnd(9, "0")}`;
  return left === right ? 0 : left < right ? -1 : 1;
}

/** The request did not reach Slack: no connection, a name lookup or a socket failure. */
function isNetworkError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && isDynamicRecord(current); depth += 1) {
    if (isString(current.code) && NETWORK_CODES.has(current.code)) return true;
    if (current instanceof TypeError && current.message === "fetch failed") return true;
    current = current.cause;
  }
  return false;
}
