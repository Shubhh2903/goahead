import { SLACK_CONVERSATION_KINDS } from "@openbot/contracts/ipc";
import {
  type DynamicRecord,
  isBoolean,
  isDynamicRecord,
  isNumber,
  isOneOf,
  isString,
} from "@openbot/contracts/runtime-values";
import {
  databaseRow,
  databaseRows,
  optionalNumberColumn,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "../../database/database-rows";
import type { OpenBotDatabase } from "../../openbot-database";
import type { HistoryConversation, HistoryMessage, HistoryReaction, InboxFile } from "../messaging-types";

/** One conversation as the cache keeps it: the platform's facts plus the client's own state. */
export interface SlackCachedConversation extends HistoryConversation {
  lastReadTs: string | null;
  unreadCount: number;
  lastActivityTs: string | null;
  lastOpenedAt: string | null;
  /**
   * The cache holds every top-level message from this `ts` to the top of the loaded range, with no
   * gap. Null when no page has been merged since the cache was made or evicted.
   */
  oldestLoadedTs: string | null;
  /** Slack has messages older than `oldestLoadedTs`. */
  hasMoreHistory: boolean;
}

export interface SlackMergePageOptions {
  hasMore: boolean;
  /** The oldest `ts` of the page, or null for an empty page. Defaults to the oldest message given. */
  oldestTs?: string | null;
  /** The exclusive `latest` the page was read with. Absent for the newest page. */
  latestTs?: string;
}

export interface SlackCachePage {
  /** Top-level messages, oldest first. */
  messages: HistoryMessage[];
  /** Older messages exist in the cache or in Slack, or the cache cannot tell. */
  hasOlder: boolean;
  /** The cache alone answers the request: it holds `limit` rows with no gap, or the start of history. */
  complete: boolean;
}

export interface SlackCachedThread {
  parent: HistoryMessage | null;
  /** Oldest first. */
  replies: HistoryMessage[];
}

/** A row's size estimate past its text columns: keys, times and SQLite's own record overhead. */
const ROW_OVERHEAD_BYTES = 128;
const TOP_LEVEL = "(thread_ts IS NULL OR thread_ts = ts OR subtype = 'thread_broadcast')";
const MESSAGE_COLUMNS =
  "ts, thread_ts, reply_count, latest_reply_ts, author_id, text, files_json, reactions_json, edited_at, deleted, subtype";
const ROW_BYTES =
  "length(CAST(text AS BLOB)) + length(CAST(files_json AS BLOB)) + length(CAST(reactions_json AS BLOB))";

/**
 * The loaded range `[oldest, newest]` holds every top-level message in it, with no gap. Rows that a
 * live event wrote above `newest` are shown, but they do not extend the range: the event can come
 * after a gap.
 */
interface RangeState {
  oldest: string | null;
  newest: string | null;
  hasMore: boolean;
}

/**
 * Owns the Slack client's cache (`slack_conversations`, `slack_messages`) of each connected
 * workspace. Rows hold Slack text, so they are written directly and never go to the event log.
 * `ts` values compare as text: a Slack `ts` has a fixed width. File rows keep Slack's private
 * addresses: they stay in the backend and main. It never imports the database facade's controllers
 * and never calls Slack.
 */
export class SlackCacheStore {
  readonly #database: OpenBotDatabase;
  readonly #now: () => string;

  constructor(database: OpenBotDatabase, now: () => string = () => new Date().toISOString()) {
    this.#database = database;
    this.#now = now;
  }

  /**
   * Adds or updates conversations from Slack's list. The client's own state of each one stays, and so
   * do the members read with `setMembers`: Slack's list gives no members of a group DM.
   */
  upsertConversations(connectionId: string, list: readonly HistoryConversation[]): void {
    const at = this.#now();
    this.#write(() => {
      const statement = this.#database.connection.prepare(
        `INSERT INTO slack_conversations
           (connection_id, channel_id, kind, name, member_ids_json, is_member, last_read_ts, unread_count,
            last_activity_ts, last_opened_at, oldest_loaded_ts, newest_loaded_ts, has_more_history, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, 0, NULL, NULL, NULL, NULL, 1, ?)
         ON CONFLICT(connection_id, channel_id) DO UPDATE SET
           kind = excluded.kind, name = excluded.name,
           member_ids_json = CASE WHEN excluded.member_ids_json = '[]' THEN slack_conversations.member_ids_json
             ELSE excluded.member_ids_json END,
           is_member = excluded.is_member, updated_at = excluded.updated_at`,
      );
      for (const conversation of list)
        statement.run(
          connectionId,
          conversation.channelId,
          conversation.kind,
          conversation.name,
          JSON.stringify(conversation.memberIds),
          conversation.isMember ? 1 : 0,
          at,
        );
    });
  }

  /** Every cached conversation of one workspace, by channel id. */
  conversations(connectionId: string): SlackCachedConversation[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT channel_id, kind, name, member_ids_json, is_member, last_read_ts, unread_count, last_activity_ts,
             last_opened_at, oldest_loaded_ts, has_more_history
           FROM slack_conversations WHERE connection_id = ? ORDER BY channel_id`,
        )
        .all(connectionId),
    ).map((row) => {
      const kind = requiredStringColumn(row, "kind");
      return {
        channelId: requiredStringColumn(row, "channel_id"),
        kind: isOneOf(SLACK_CONVERSATION_KINDS, kind) ? kind : "channel",
        name: requiredStringColumn(row, "name"),
        memberIds: decodeStrings(requiredStringColumn(row, "member_ids_json")),
        isMember: requiredNumberColumn(row, "is_member") === 1,
        lastReadTs: optionalStringColumn(row, "last_read_ts"),
        unreadCount: requiredNumberColumn(row, "unread_count"),
        lastActivityTs: optionalStringColumn(row, "last_activity_ts"),
        lastOpenedAt: optionalStringColumn(row, "last_opened_at"),
        oldestLoadedTs: optionalStringColumn(row, "oldest_loaded_ts"),
        hasMoreHistory: requiredNumberColumn(row, "has_more_history") === 1,
      };
    });
  }

  /** Keeps the people of a conversation, as `conversations.members` gives them. */
  setMembers(connectionId: string, channelId: string, memberIds: readonly string[]): void {
    this.#database.connection
      .prepare("UPDATE slack_conversations SET member_ids_json = ? WHERE connection_id = ? AND channel_id = ?")
      .run(JSON.stringify(memberIds), connectionId, channelId);
  }

  markOpened(connectionId: string, channelId: string, at: string): void {
    this.#write(() => {
      this.#ensureConversation(connectionId, channelId);
      this.#database.connection
        .prepare("UPDATE slack_conversations SET last_opened_at = ? WHERE connection_id = ? AND channel_id = ?")
        .run(at, connectionId, channelId);
    });
  }

  /**
   * Merges one `conversations.history` page. Messages are keyed by `ts`, so a page that overlaps
   * the cache adds no duplicate. The loaded range grows only when the page touches it; a newest page
   * that does not touch it (after a long time offline) starts a new range, so the gap is never shown
   * as loaded history. Rows from live events do not count as the range: only merged pages move it.
   */
  mergePage(
    connectionId: string,
    channelId: string,
    messages: readonly HistoryMessage[],
    options: SlackMergePageOptions,
  ): void {
    this.#write(() => {
      const state = this.#ensureConversation(connectionId, channelId);
      const rangeKnown = state.oldest !== null || !state.hasMore;
      const pageOldest = options.oldestTs === undefined ? oldestTs(messages) : options.oldestTs;
      const pageNewest = newestTs(messages);
      const latest = options.latestTs;
      const newestPage = latest === undefined;
      // A newest page touches the range when it reaches down to the range top. An older page touches
      // it when its exclusive `latest` is at or above the range bottom.
      const connected =
        rangeKnown &&
        (latest === undefined
          ? state.newest !== null && pageOldest !== null && pageOldest <= state.newest
          : state.oldest === null || latest >= state.oldest);

      for (const message of messages) this.#upsertRow(connectionId, channelId, message);

      let next: RangeState = state;
      if (connected) {
        const newest = newestPage ? laterTs(state.newest, pageNewest) : (state.newest ?? pageNewest);
        next =
          state.hasMore && (pageOldest === null || state.oldest === null || pageOldest <= state.oldest)
            ? { oldest: pageOldest ?? state.oldest, newest, hasMore: options.hasMore }
            : { ...state, newest };
      } else if (newestPage) {
        next = { oldest: pageOldest, newest: pageNewest, hasMore: options.hasMore };
      }
      this.#database.connection
        .prepare(
          `UPDATE slack_conversations SET oldest_loaded_ts = ?, newest_loaded_ts = ?, has_more_history = ?
           WHERE connection_id = ? AND channel_id = ?`,
        )
        .run(next.oldest, next.newest, next.hasMore ? 1 : 0, connectionId, channelId);
      this.#touchActivity(connectionId, channelId, messages);
    });
  }

  /** Merges a thread parent and its replies from `conversations.replies`. */
  mergeThread(connectionId: string, channelId: string, threadTs: string, messages: readonly HistoryMessage[]): void {
    this.#write(() => {
      this.#ensureConversation(connectionId, channelId);
      for (const message of messages) {
        const reply = message.ts !== threadTs;
        this.#upsertRow(connectionId, channelId, reply ? { ...message, threadTs } : message);
      }
    });
  }

  /**
   * Top-level messages before `beforeTs` (the newest without it), oldest first. Rows below the
   * loaded range are not read, so a page never skips a message. Event rows above the range are shown,
   * but a page that holds one is not complete: a gap can come before it, and the newest page fills it.
   * Before any page is merged, every cached row is shown and the page is not complete.
   */
  page(connectionId: string, channelId: string, options: { beforeTs?: string; limit: number }): SlackCachePage {
    const state = this.#rangeState(connectionId, channelId);
    if (!state) return { messages: [], hasOlder: true, complete: false };
    const rangeKnown = state.oldest !== null || !state.hasMore;
    const where = [`connection_id = ?`, `channel_id = ?`, TOP_LEVEL];
    const values: string[] = [connectionId, channelId];
    if (state.oldest !== null) {
      where.push("ts >= ?");
      values.push(state.oldest);
    }
    const db = this.#database.connection;
    const newestFirst = databaseRows(
      db
        .prepare(
          `SELECT ${MESSAGE_COLUMNS} FROM slack_messages
           WHERE ${[...where, ...(options.beforeTs === undefined ? [] : ["ts < ?"])].join(" AND ")}
           ORDER BY ts DESC LIMIT ?`,
        )
        .all(...values, ...(options.beforeTs === undefined ? [] : [options.beforeTs]), options.limit),
    );
    const messages = newestFirst.reverse().map(decodeMessage);
    const below = messages[0]?.ts ?? options.beforeTs;
    const olderCached =
      below !== undefined &&
      db
        .prepare(`SELECT 1 FROM slack_messages WHERE ${where.join(" AND ")} AND ts < ? LIMIT 1`)
        .get(...values, below) !== undefined;
    const pastRange = messages.some((message) => state.newest === null || message.ts > state.newest);
    return {
      messages,
      hasOlder: !rangeKnown || state.hasMore || olderCached,
      complete: rangeKnown && !pastRange && (messages.length === options.limit || !state.hasMore),
    };
  }

  /** The cached parent and replies of one thread. */
  thread(connectionId: string, channelId: string, threadTs: string): SlackCachedThread {
    const db = this.#database.connection;
    const parent = databaseRow(
      db
        .prepare(`SELECT ${MESSAGE_COLUMNS} FROM slack_messages WHERE connection_id = ? AND channel_id = ? AND ts = ?`)
        .get(connectionId, channelId, threadTs),
    );
    const replies = databaseRows(
      db
        .prepare(
          `SELECT ${MESSAGE_COLUMNS} FROM slack_messages
           WHERE connection_id = ? AND channel_id = ? AND thread_ts = ? AND ts != ? ORDER BY ts`,
        )
        .all(connectionId, channelId, threadTs, threadTs),
    ).map(decodeMessage);
    return { parent: parent ? decodeMessage(parent) : null, replies };
  }

  /**
   * The cached message that shared a file: its place and all its files, or null. Main uses it to show
   * an image of a conversation the inbox does not keep. `fileId` must be a Slack file id: it is
   * matched inside the JSON column.
   */
  messageWithFile(connectionId: string, fileId: string): { channelId: string; ts: string; files: InboxFile[] } | null {
    if (!/^F[A-Z0-9]{4,40}$/u.test(fileId)) return null;
    const rows = databaseRows(
      this.#database.connection
        .prepare(
          `SELECT channel_id, ts, files_json FROM slack_messages
           WHERE connection_id = ? AND deleted = 0 AND files_json LIKE ? ORDER BY ts DESC LIMIT 20`,
        )
        .all(connectionId, `%"id":"${fileId}"%`),
    );
    for (const row of rows) {
      const files = decodeFiles(requiredStringColumn(row, "files_json"));
      if (files.some((candidate) => candidate.id === fileId))
        return { channelId: requiredStringColumn(row, "channel_id"), ts: requiredStringColumn(row, "ts"), files };
    }
    return null;
  }

  /** Keeps one message from a live event. A new reply counts on its cached parent. */
  upsertMessage(connectionId: string, channelId: string, message: HistoryMessage): void {
    this.#write(() => {
      this.#ensureConversation(connectionId, channelId);
      const db = this.#database.connection;
      const known =
        db
          .prepare("SELECT 1 FROM slack_messages WHERE connection_id = ? AND channel_id = ? AND ts = ?")
          .get(connectionId, channelId, message.ts) !== undefined;
      this.#upsertRow(connectionId, channelId, message);
      if (!known && message.threadTs !== null && message.threadTs !== message.ts)
        db.prepare(
          `UPDATE slack_messages SET reply_count = reply_count + 1,
             latest_reply_ts = CASE WHEN latest_reply_ts IS NULL OR latest_reply_ts < ? THEN ? ELSE latest_reply_ts END
           WHERE connection_id = ? AND channel_id = ? AND ts = ?`,
        ).run(message.ts, message.ts, connectionId, channelId, message.threadTs);
      this.#touchActivity(connectionId, channelId, [message]);
    });
  }

  markEdited(connectionId: string, channelId: string, ts: string, text: string, editedAt: string): void {
    this.#database.connection
      .prepare(
        `UPDATE slack_messages SET text = ?, edited_at = ?
         WHERE connection_id = ? AND channel_id = ? AND ts = ? AND deleted = 0`,
      )
      .run(text, editedAt, connectionId, channelId, ts);
  }

  /**
   * Removes a deleted message. A thread parent with replies stays as an empty placeholder, as in
   * Slack, so its replies keep a parent.
   */
  markDeleted(connectionId: string, channelId: string, ts: string): void {
    this.#write(() => {
      const db = this.#database.connection;
      const row = databaseRow(
        db
          .prepare(
            "SELECT reply_count, thread_ts FROM slack_messages WHERE connection_id = ? AND channel_id = ? AND ts = ?",
          )
          .get(connectionId, channelId, ts),
      );
      if (!row) return;
      if (requiredNumberColumn(row, "reply_count") > 0) {
        db.prepare(
          `UPDATE slack_messages SET deleted = 1, text = '', files_json = '[]', reactions_json = '[]'
           WHERE connection_id = ? AND channel_id = ? AND ts = ?`,
        ).run(connectionId, channelId, ts);
        return;
      }
      db.prepare("DELETE FROM slack_messages WHERE connection_id = ? AND channel_id = ? AND ts = ?").run(
        connectionId,
        channelId,
        ts,
      );
      const parent = optionalStringColumn(row, "thread_ts");
      // The newest cached reply becomes the latest one. When the cache holds no other reply, it is
      // NULL until the next conversations.replies merge gives Slack's value.
      if (parent !== null && parent !== ts)
        db.prepare(
          `UPDATE slack_messages SET reply_count = MAX(reply_count - 1, 0),
             latest_reply_ts = CASE WHEN latest_reply_ts = ? THEN (
               SELECT MAX(r.ts) FROM slack_messages r
               WHERE r.connection_id = ? AND r.channel_id = ? AND r.thread_ts = ? AND r.ts != ?
             ) ELSE latest_reply_ts END
           WHERE connection_id = ? AND channel_id = ? AND ts = ?`,
        ).run(ts, connectionId, channelId, parent, parent, connectionId, channelId, parent);
    });
  }

  setReactions(connectionId: string, channelId: string, ts: string, reactions: readonly HistoryReaction[]): void {
    this.#database.connection
      .prepare("UPDATE slack_messages SET reactions_json = ? WHERE connection_id = ? AND channel_id = ? AND ts = ?")
      .run(JSON.stringify(reactions), connectionId, channelId, ts);
  }

  /**
   * Applies one `reaction_added` or `reaction_removed`. The same event twice changes nothing.
   * `ownerUserId` is the connected person, whose own reaction sets `mine`.
   */
  adjustReaction(
    connectionId: string,
    channelId: string,
    ts: string,
    name: string,
    userId: string,
    on: boolean,
    ownerUserId: string | null = null,
  ): void {
    this.#write(() => {
      const row = databaseRow(
        this.#database.connection
          .prepare("SELECT reactions_json FROM slack_messages WHERE connection_id = ? AND channel_id = ? AND ts = ?")
          .get(connectionId, channelId, ts),
      );
      if (!row) return;
      const reactions = decodeReactions(requiredStringColumn(row, "reactions_json"));
      const index = reactions.findIndex((reaction) => reaction.name === name);
      const current = reactions[index];
      const mine = (fallback: boolean) => (ownerUserId !== null && userId === ownerUserId ? on : fallback);
      if (on) {
        // When Slack cut the user list, an unlisted user can already be counted, so the count can be
        // one too high until the next page merge gives Slack's count. A new reaction is more likely
        // than a repeated event, so it still counts.
        if (current?.userIds.includes(userId)) return;
        if (current)
          reactions[index] = {
            name,
            count: current.count + 1,
            userIds: [...current.userIds, userId],
            mine: mine(current.mine),
          };
        else reactions.push({ name, count: 1, userIds: [userId], mine: mine(false) });
      } else {
        if (!current) return;
        const listed = current.userIds.includes(userId);
        // Slack cuts the user list: a user not listed can still be counted.
        if (!listed && current.count <= current.userIds.length) return;
        const count = current.count - 1;
        if (count <= 0) reactions.splice(index, 1);
        else
          reactions[index] = {
            name,
            count,
            userIds: current.userIds.filter((id) => id !== userId),
            mine: mine(current.mine),
          };
      }
      this.setReactions(connectionId, channelId, ts, reactions);
    });
  }

  setUnread(connectionId: string, channelId: string, count: number, lastReadTs: string | null): void {
    this.#write(() => {
      this.#ensureConversation(connectionId, channelId);
      this.#database.connection
        .prepare(
          `UPDATE slack_conversations SET unread_count = ?, last_read_ts = ?
           WHERE connection_id = ? AND channel_id = ?`,
        )
        .run(count, lastReadTs, connectionId, channelId);
    });
  }

  /** An estimate of the cached message bytes of one workspace. Cached images are counted by their owner. */
  sizeBytes(connectionId: string): number {
    const row = databaseRow(
      this.#database.connection
        .prepare(`SELECT SUM(${ROW_OVERHEAD_BYTES} + ${ROW_BYTES}) AS size FROM slack_messages WHERE connection_id = ?`)
        .get(connectionId),
    );
    return (row && optionalNumberColumn(row, "size")) ?? 0;
  }

  /**
   * Drops the messages of the least recently opened conversations until the workspace is at most
   * `maxBytes`, and returns their channel ids in eviction order, so the caller drops their images.
   * The conversations stay in the list; scrolling loads their messages again.
   */
  evictTo(connectionId: string, maxBytes: number): string[] {
    let size = this.sizeBytes(connectionId);
    if (size <= maxBytes) return [];
    const candidates = databaseRows(
      this.#database.connection
        .prepare(
          `SELECT m.channel_id, SUM(${ROW_OVERHEAD_BYTES} + ${ROW_BYTES}) AS size
           FROM slack_messages m
           LEFT JOIN slack_conversations c ON c.connection_id = m.connection_id AND c.channel_id = m.channel_id
           WHERE m.connection_id = ?
           GROUP BY m.channel_id
           ORDER BY c.last_opened_at IS NOT NULL, c.last_opened_at, m.channel_id`,
        )
        .all(connectionId),
    );
    const evicted: string[] = [];
    this.#write(() => {
      const db = this.#database.connection;
      for (const row of candidates) {
        if (size <= maxBytes) break;
        const channelId = requiredStringColumn(row, "channel_id");
        db.prepare("DELETE FROM slack_messages WHERE connection_id = ? AND channel_id = ?").run(
          connectionId,
          channelId,
        );
        db.prepare(
          `UPDATE slack_conversations SET oldest_loaded_ts = NULL, newest_loaded_ts = NULL, has_more_history = 1
           WHERE connection_id = ? AND channel_id = ?`,
        ).run(connectionId, channelId);
        size -= requiredNumberColumn(row, "size");
        evicted.push(channelId);
      }
    });
    return evicted;
  }

  /** Forgets one workspace's conversations and messages, as a disconnect does. */
  clearConnection(connectionId: string): void {
    this.#write(() => {
      const db = this.#database.connection;
      db.prepare("DELETE FROM slack_messages WHERE connection_id = ?").run(connectionId);
      db.prepare("DELETE FROM slack_conversations WHERE connection_id = ?").run(connectionId);
    });
  }

  /** Runs `write` in a transaction, only when no caller holds one already: a nested BEGIN fails. */
  #write(write: () => void): void {
    const db = this.#database.connection;
    const own = !db.isTransaction;
    if (own) db.exec("BEGIN IMMEDIATE");
    try {
      write();
      if (own) db.exec("COMMIT");
    } catch (error) {
      if (own && db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }

  #rangeState(connectionId: string, channelId: string): RangeState | null {
    const row = databaseRow(
      this.#database.connection
        .prepare(
          `SELECT oldest_loaded_ts, newest_loaded_ts, has_more_history FROM slack_conversations
           WHERE connection_id = ? AND channel_id = ?`,
        )
        .get(connectionId, channelId),
    );
    if (!row) return null;
    return {
      oldest: optionalStringColumn(row, "oldest_loaded_ts"),
      newest: optionalStringColumn(row, "newest_loaded_ts"),
      hasMore: requiredNumberColumn(row, "has_more_history") === 1,
    };
  }

  /**
   * Adds a conversation the list has not shown yet, as a message or an open can name one first.
   * The next list refresh gives its real kind and name.
   */
  #ensureConversation(connectionId: string, channelId: string): RangeState {
    const existing = this.#rangeState(connectionId, channelId);
    if (existing) return existing;
    this.#database.connection
      .prepare(
        `INSERT INTO slack_conversations
           (connection_id, channel_id, kind, name, member_ids_json, is_member, last_read_ts, unread_count,
            last_activity_ts, last_opened_at, oldest_loaded_ts, newest_loaded_ts, has_more_history, updated_at)
         VALUES (?, ?, ?, '', '[]', 1, NULL, 0, NULL, NULL, NULL, NULL, 1, ?)`,
      )
      .run(connectionId, channelId, channelId.startsWith("D") ? "im" : "channel", this.#now());
    return { oldest: null, newest: null, hasMore: true };
  }

  #upsertRow(connectionId: string, channelId: string, message: HistoryMessage): void {
    this.#database.connection
      .prepare(
        `INSERT INTO slack_messages
           (connection_id, channel_id, ts, thread_ts, reply_count, latest_reply_ts, author_id, text, files_json,
            reactions_json, edited_at, deleted, subtype, cached_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(connection_id, channel_id, ts) DO UPDATE SET
           thread_ts = excluded.thread_ts, reply_count = excluded.reply_count,
           latest_reply_ts = excluded.latest_reply_ts, author_id = excluded.author_id, text = excluded.text,
           files_json = excluded.files_json, reactions_json = excluded.reactions_json,
           edited_at = excluded.edited_at, deleted = excluded.deleted, subtype = excluded.subtype,
           cached_at = excluded.cached_at`,
      )
      .run(
        connectionId,
        channelId,
        message.ts,
        message.threadTs,
        message.replyCount,
        message.latestReplyTs,
        message.authorId,
        message.text,
        JSON.stringify(message.files),
        JSON.stringify(message.reactions),
        message.editedAt,
        message.deleted ? 1 : 0,
        message.subtype,
        this.#now(),
      );
  }

  #touchActivity(connectionId: string, channelId: string, messages: readonly HistoryMessage[]): void {
    const newest = messages
      .filter((message) => message.threadTs === null || message.subtype === "thread_broadcast")
      .reduce<string | null>((latest, message) => (latest === null || message.ts > latest ? message.ts : latest), null);
    if (newest === null) return;
    this.#database.connection
      .prepare(
        `UPDATE slack_conversations
         SET last_activity_ts = CASE WHEN last_activity_ts IS NULL OR last_activity_ts < ? THEN ? ELSE last_activity_ts END
         WHERE connection_id = ? AND channel_id = ?`,
      )
      .run(newest, newest, connectionId, channelId);
  }
}

function oldestTs(messages: readonly HistoryMessage[]): string | null {
  return messages.reduce<string | null>(
    (oldest, message) => (oldest === null || message.ts < oldest ? message.ts : oldest),
    null,
  );
}

function newestTs(messages: readonly HistoryMessage[]): string | null {
  return messages.reduce<string | null>((newest, message) => laterTs(newest, message.ts), null);
}

function laterTs(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  return b === null || a >= b ? a : b;
}

function decodeMessage(row: DynamicRecord): HistoryMessage {
  return {
    ts: requiredStringColumn(row, "ts"),
    threadTs: optionalStringColumn(row, "thread_ts"),
    replyCount: requiredNumberColumn(row, "reply_count"),
    latestReplyTs: optionalStringColumn(row, "latest_reply_ts"),
    authorId: requiredStringColumn(row, "author_id"),
    text: requiredStringColumn(row, "text"),
    files: decodeFiles(requiredStringColumn(row, "files_json")),
    reactions: decodeReactions(requiredStringColumn(row, "reactions_json")),
    editedAt: optionalStringColumn(row, "edited_at"),
    deleted: requiredNumberColumn(row, "deleted") === 1,
    subtype: optionalStringColumn(row, "subtype"),
  };
}

/** Parses a JSON column. A broken value reads as empty rather than stopping the whole page. */
function parseJsonArray(text: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed : [];
}

function decodeStrings(text: string): string[] {
  return parseJsonArray(text).filter(isString);
}

function decodeFiles(text: string): InboxFile[] {
  return parseJsonArray(text).flatMap((value): InboxFile[] => {
    if (
      !isDynamicRecord(value) ||
      !isString(value.id) ||
      !isString(value.name) ||
      !isString(value.mimeType) ||
      !isNumber(value.size) ||
      !isString(value.url)
    )
      return [];
    return [
      {
        id: value.id,
        name: value.name,
        mimeType: value.mimeType,
        size: value.size,
        url: value.url,
        thumbnailUrl: isString(value.thumbnailUrl) ? value.thumbnailUrl : null,
        permalink: isString(value.permalink) ? value.permalink : null,
      },
    ];
  });
}

function decodeReactions(text: string): HistoryReaction[] {
  return parseJsonArray(text).flatMap((value): HistoryReaction[] => {
    if (!isDynamicRecord(value) || !isString(value.name) || !isNumber(value.count)) return [];
    const userIds = Array.isArray(value.userIds) ? value.userIds.filter(isString) : [];
    return [{ name: value.name, count: value.count, userIds, mine: isBoolean(value.mine) && value.mine }];
  });
}
