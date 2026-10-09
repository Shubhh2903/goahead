import { isOneOf } from "@openbot/contracts/runtime-values";
import {
  databaseRows,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "../database/database-rows";
import type { OpenBotDatabase } from "../openbot-database";
import { SlackCacheStore } from "./slack-client/cache-store";

/** Why the inbox keeps a message. */
export const INBOX_KINDS = ["direct", "group", "mention", "channel"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

/** One message the connected person received, as the inbox keeps it. */
export interface InboxEntry {
  connectionId: string;
  platformChannelId: string;
  /** The platform's message id. For Slack it is the `ts`, which sorts as text. */
  platformMessageId: string;
  /** The thread the message is in, or null for a message at the top of the conversation. */
  threadKey: string | null;
  kind: InboxKind;
  authorId: string;
  authorName: string;
  text: string;
  sentAt: string;
}

/** One conversation with messages GoAhead has not read yet. */
export interface InboxUnread {
  platformChannelId: string;
  kind: InboxKind;
  count: number;
  latestAt: string;
  /** Who wrote the newest unread message. */
  latestAuthorName: string;
}

/** One conversation of the inbox, for the desktop list. */
export interface InboxConversation {
  platformChannelId: string;
  kind: InboxKind;
  unreadCount: number;
  latestAt: string;
  latestFrom: string;
  /** The newest message, from either side. */
  preview: string;
}

/** The desktop list shows at most this many conversations of one workspace. */
const CONVERSATION_LIST_LIMIT = 200;

export interface WatchedChannel {
  platformChannelId: string;
  name: string;
}

/**
 * Owns the local Slack inbox (`projection_messaging_inbox`), the channels the person picked, and
 * GoAhead's read mark per conversation. Rows hold Slack text, so they are written directly and never
 * go to the event log. Message ids compare as text: a Slack `ts` has a fixed width.
 */
export class MessagingInboxStore {
  /** The Slack client's cache. Agent reads use it first: it keeps more of each conversation. */
  readonly cache: SlackCacheStore;
  readonly #database: OpenBotDatabase;

  constructor(database: OpenBotDatabase) {
    this.#database = database;
    this.cache = new SlackCacheStore(database);
  }

  /** Keeps one message, and says whether it is new. The same message from a second event changes nothing. */
  add(entry: InboxEntry): boolean {
    const result = this.#database.connection
      .prepare(
        `INSERT OR IGNORE INTO projection_messaging_inbox
           (connection_id, platform_channel_id, platform_message_id, thread_key, kind, author_id, author_name,
            text, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.connectionId,
        entry.platformChannelId,
        entry.platformMessageId,
        entry.threadKey,
        entry.kind,
        entry.authorId,
        entry.authorName,
        entry.text,
        entry.sentAt,
      );
    return Number(result.changes) > 0;
  }

  /** Deletes every message sent before the time, and returns how many went. */
  purgeBefore(time: string): number {
    const result = this.#database.connection
      .prepare("DELETE FROM projection_messaging_inbox WHERE sent_at < ?")
      .run(time);
    return Number(result.changes);
  }

  /** Forgets one workspace's messages and read marks. The picked channels stay, for a later connect. */
  deleteForConnection(connectionId: string): void {
    const db = this.#database.connection;
    db.prepare("DELETE FROM projection_messaging_inbox WHERE connection_id = ?").run(connectionId);
    db.prepare("DELETE FROM projection_messaging_inbox_reads WHERE connection_id = ?").run(connectionId);
  }

  watched(connectionId: string): WatchedChannel[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT platform_channel_id, name FROM projection_messaging_watched_channels
           WHERE connection_id = ? ORDER BY name, platform_channel_id`,
        )
        .all(connectionId),
    ).map((row) => ({
      platformChannelId: requiredStringColumn(row, "platform_channel_id"),
      name: requiredStringColumn(row, "name"),
    }));
  }

  isWatched(connectionId: string, platformChannelId: string): boolean {
    return (
      this.#database.connection
        .prepare(
          "SELECT 1 FROM projection_messaging_watched_channels WHERE connection_id = ? AND platform_channel_id = ?",
        )
        .get(connectionId, platformChannelId) !== undefined
    );
  }

  /**
   * Replaces the picked channels. A channel that is no longer picked loses its kept messages, unless
   * a message mentions the person, which the inbox keeps anyway. Returns the newly picked channels.
   */
  setWatched(connectionId: string, channels: WatchedChannel[]): WatchedChannel[] {
    const db = this.#database.connection;
    const before = new Set(this.watched(connectionId).map((channel) => channel.platformChannelId));
    const next = new Map(channels.map((channel) => [channel.platformChannelId, channel]));
    const now = new Date().toISOString();
    // Only when no caller holds a transaction already, as `dispatch` does: a nested BEGIN fails.
    const own = !db.isTransaction;
    if (own) db.exec("BEGIN IMMEDIATE");
    try {
      for (const id of before) {
        if (next.has(id)) continue;
        db.prepare(
          "DELETE FROM projection_messaging_watched_channels WHERE connection_id = ? AND platform_channel_id = ?",
        ).run(connectionId, id);
        db.prepare(
          "DELETE FROM projection_messaging_inbox WHERE connection_id = ? AND platform_channel_id = ? AND kind = 'channel'",
        ).run(connectionId, id);
      }
      for (const channel of next.values())
        db.prepare(
          `INSERT INTO projection_messaging_watched_channels (connection_id, platform_channel_id, name, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(connection_id, platform_channel_id) DO UPDATE SET name = excluded.name`,
        ).run(connectionId, channel.platformChannelId, channel.name, now);
      if (own) db.exec("COMMIT");
    } catch (error) {
      if (own && db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
    return [...next.values()].filter((channel) => !before.has(channel.platformChannelId));
  }

  /** The conversations with messages newer than GoAhead's read mark, newest first. The person's own do not count. */
  unread(connectionId: string, ownUserId: string): InboxUnread[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT m.platform_channel_id, MAX(m.kind) AS kind, COUNT(*) AS count, MAX(m.sent_at) AS latest_at,
             (SELECT n.author_name FROM projection_messaging_inbox n
              WHERE n.connection_id = m.connection_id AND n.platform_channel_id = m.platform_channel_id
                AND n.author_id != ?
              ORDER BY n.platform_message_id DESC LIMIT 1) AS latest_author_name
           FROM projection_messaging_inbox m
           LEFT JOIN projection_messaging_inbox_reads r
             ON r.connection_id = m.connection_id AND r.platform_channel_id = m.platform_channel_id
           WHERE m.connection_id = ? AND m.author_id != ?
             AND (r.through_message_id IS NULL OR m.platform_message_id > r.through_message_id)
           GROUP BY m.platform_channel_id
           ORDER BY latest_at DESC`,
        )
        .all(ownUserId, connectionId, ownUserId),
    ).flatMap((row) => {
      const kind = requiredStringColumn(row, "kind");
      if (!isOneOf(INBOX_KINDS, kind)) return [];
      return [
        {
          platformChannelId: requiredStringColumn(row, "platform_channel_id"),
          kind,
          count: requiredNumberColumn(row, "count"),
          latestAt: requiredStringColumn(row, "latest_at"),
          latestAuthorName: optionalStringColumn(row, "latest_author_name") ?? "",
        },
      ];
    });
  }

  /**
   * Every conversation of the inbox, for the desktop: the ones with unread messages first, then the
   * newest. The person's own messages never count as unread. `latestFrom` is the newest author other
   * than the person, so a direct message names the other side.
   */
  conversations(connectionId: string, ownUserId: string): InboxConversation[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT m.platform_channel_id, MAX(m.kind) AS kind, MAX(m.sent_at) AS latest_at,
             SUM(CASE WHEN m.author_id != ? AND (r.through_message_id IS NULL OR m.platform_message_id > r.through_message_id)
                 THEN 1 ELSE 0 END) AS unread_count,
             (SELECT n.text FROM projection_messaging_inbox n
              WHERE n.connection_id = m.connection_id AND n.platform_channel_id = m.platform_channel_id
              ORDER BY n.platform_message_id DESC LIMIT 1) AS preview,
             (SELECT n.author_name FROM projection_messaging_inbox n
              WHERE n.connection_id = m.connection_id AND n.platform_channel_id = m.platform_channel_id
                AND n.author_id != ?
              ORDER BY n.platform_message_id DESC LIMIT 1) AS latest_from
           FROM projection_messaging_inbox m
           LEFT JOIN projection_messaging_inbox_reads r
             ON r.connection_id = m.connection_id AND r.platform_channel_id = m.platform_channel_id
           WHERE m.connection_id = ?
           GROUP BY m.platform_channel_id
           ORDER BY (unread_count > 0) DESC, latest_at DESC
           LIMIT ?`,
        )
        .all(ownUserId, ownUserId, connectionId, CONVERSATION_LIST_LIMIT),
    ).flatMap((row) => {
      const kind = requiredStringColumn(row, "kind");
      if (!isOneOf(INBOX_KINDS, kind)) return [];
      return [
        {
          platformChannelId: requiredStringColumn(row, "platform_channel_id"),
          kind,
          unreadCount: requiredNumberColumn(row, "unread_count"),
          latestAt: requiredStringColumn(row, "latest_at"),
          latestFrom: optionalStringColumn(row, "latest_from") ?? "",
          preview: optionalStringColumn(row, "preview") ?? "",
        },
      ];
    });
  }

  /**
   * The newest messages of one conversation, oldest first. With a thread, only that thread: its
   * first message and the replies. Only the inbox: the desktop inbox view and its replies use it.
   */
  read(connectionId: string, platformChannelId: string, threadKey: string | null, limit: number): InboxEntry[] {
    return this.#readInbox(connectionId, platformChannelId, threadKey, limit);
  }

  /**
   * The newest messages of one conversation for an agent or `@chief`, oldest first: the inbox rows
   * and the Slack client cache rows together, one entry per message `ts`. The cache gives the text
   * and removes a message it marks deleted; the inbox gives the names. So a message that only one
   * of the two holds still shows. A name the inbox does not know comes from the author's newest
   * inbox message, and else is the author id.
   */
  readForAgent(connectionId: string, platformChannelId: string, threadKey: string | null, limit: number): InboxEntry[] {
    const inboxEntries = this.#readInbox(connectionId, platformChannelId, threadKey, limit);
    const kind = this.#cachedKind(connectionId, platformChannelId);
    if (!kind) return inboxEntries;
    const db = this.#database.connection;
    const cached = this.#cachedMessages(connectionId, platformChannelId, threadKey, limit);
    const isDeleted = db.prepare(
      "SELECT 1 FROM slack_messages WHERE connection_id = ? AND channel_id = ? AND ts = ? AND deleted = 1",
    );
    const byTs = new Map<string, InboxEntry>();
    for (const entry of inboxEntries) {
      if (isDeleted.get(connectionId, platformChannelId, entry.platformMessageId) !== undefined) continue;
      byTs.set(entry.platformMessageId, { ...entry, kind });
    }
    const nameOf = db.prepare(
      `SELECT author_name FROM projection_messaging_inbox
       WHERE connection_id = ? AND author_id = ? ORDER BY sent_at DESC LIMIT 1`,
    );
    for (const message of cached) {
      const known = byTs.get(message.ts);
      if (known) {
        byTs.set(message.ts, { ...known, text: message.text });
        continue;
      }
      const named = message.authorId ? databaseRows(nameOf.all(connectionId, message.authorId))[0] : undefined;
      byTs.set(message.ts, {
        connectionId,
        platformChannelId,
        platformMessageId: message.ts,
        threadKey: message.threadTs === message.ts ? null : message.threadTs,
        kind,
        authorId: message.authorId,
        authorName: (named ? optionalStringColumn(named, "author_name") : null) || message.authorId,
        text: message.text,
        sentAt: tsTime(message.ts),
      });
    }
    // A Slack `ts` has a fixed width, so it sorts as text.
    return [...byTs.values()]
      .sort((a, b) =>
        a.platformMessageId < b.platformMessageId ? -1 : a.platformMessageId > b.platformMessageId ? 1 : 0,
      )
      .slice(-limit);
  }

  /** The newest `limit` cached messages that are not deleted: of the conversation, or of one thread. */
  #cachedMessages(
    connectionId: string,
    channelId: string,
    threadKey: string | null,
    limit: number,
  ): Array<{ ts: string; threadTs: string | null; authorId: string; text: string }> {
    const db = this.#database.connection;
    const rows = threadKey
      ? db
          .prepare(
            `SELECT ts, thread_ts, author_id, text FROM slack_messages
             WHERE connection_id = ? AND channel_id = ? AND (ts = ? OR thread_ts = ?) AND deleted = 0
             ORDER BY ts DESC LIMIT ?`,
          )
          .all(connectionId, channelId, threadKey, threadKey, limit)
      : db
          .prepare(
            `SELECT ts, thread_ts, author_id, text FROM slack_messages
             WHERE connection_id = ? AND channel_id = ? AND deleted = 0
             ORDER BY ts DESC LIMIT ?`,
          )
          .all(connectionId, channelId, limit);
    return databaseRows(rows).map((row) => ({
      ts: requiredStringColumn(row, "ts"),
      threadTs: optionalStringColumn(row, "thread_ts"),
      authorId: requiredStringColumn(row, "author_id"),
      text: requiredStringColumn(row, "text"),
    }));
  }

  /**
   * The kind of a conversation the cache knows, or null. A direct or group direct message has that
   * kind. A channel is a `mention` only when the inbox keeps it for mentions alone, not as a picked channel.
   */
  #cachedKind(connectionId: string, channelId: string): InboxKind | null {
    const row = databaseRows(
      this.#database.connection
        .prepare(
          `SELECT c.kind AS cache_kind,
             EXISTS(SELECT 1 FROM projection_messaging_inbox i
              WHERE i.connection_id = c.connection_id AND i.platform_channel_id = c.channel_id
                AND i.kind = 'mention') AS has_mention,
             EXISTS(SELECT 1 FROM projection_messaging_inbox i
              WHERE i.connection_id = c.connection_id AND i.platform_channel_id = c.channel_id
                AND i.kind = 'channel') AS has_channel
           FROM slack_conversations c WHERE c.connection_id = ? AND c.channel_id = ?`,
        )
        .all(connectionId, channelId),
    )[0];
    if (!row) return null;
    const cacheKind = requiredStringColumn(row, "cache_kind");
    if (cacheKind === "im") return "direct";
    if (cacheKind === "mpim") return "group";
    return requiredNumberColumn(row, "has_mention") === 1 && requiredNumberColumn(row, "has_channel") === 0
      ? "mention"
      : "channel";
  }

  #readInbox(connectionId: string, platformChannelId: string, threadKey: string | null, limit: number): InboxEntry[] {
    const rows = threadKey
      ? this.#database.connection
          .prepare(
            `SELECT * FROM projection_messaging_inbox
             WHERE connection_id = ? AND platform_channel_id = ? AND (thread_key = ? OR platform_message_id = ?)
             ORDER BY platform_message_id DESC LIMIT ?`,
          )
          .all(connectionId, platformChannelId, threadKey, threadKey, limit)
      : this.#database.connection
          .prepare(
            `SELECT * FROM projection_messaging_inbox
             WHERE connection_id = ? AND platform_channel_id = ?
             ORDER BY platform_message_id DESC LIMIT ?`,
          )
          .all(connectionId, platformChannelId, limit);
    return databaseRows(rows)
      .flatMap((row) => {
        const kind = requiredStringColumn(row, "kind");
        if (!isOneOf(INBOX_KINDS, kind)) return [];
        return [
          {
            connectionId: requiredStringColumn(row, "connection_id"),
            platformChannelId: requiredStringColumn(row, "platform_channel_id"),
            platformMessageId: requiredStringColumn(row, "platform_message_id"),
            threadKey: optionalStringColumn(row, "thread_key"),
            kind,
            authorId: requiredStringColumn(row, "author_id"),
            authorName: requiredStringColumn(row, "author_name"),
            text: requiredStringColumn(row, "text"),
            sentAt: requiredStringColumn(row, "sent_at"),
          },
        ];
      })
      .reverse();
  }

  /** Moves GoAhead's read mark forward. It never moves back. */
  markRead(connectionId: string, platformChannelId: string, throughMessageId: string): void {
    this.#database.connection
      .prepare(
        `INSERT INTO projection_messaging_inbox_reads (connection_id, platform_channel_id, through_message_id, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(connection_id, platform_channel_id) DO UPDATE SET
           through_message_id = MAX(through_message_id, excluded.through_message_id),
           updated_at = excluded.updated_at`,
      )
      .run(connectionId, platformChannelId, throughMessageId, new Date().toISOString());
  }
}

/** A Slack `ts` (seconds since 1970, then a sequence) as an ISO time. */
function tsTime(ts: string): string {
  const seconds = Number(ts.split(".")[0]);
  return new Date(Number.isFinite(seconds) ? seconds * 1000 : 0).toISOString();
}
