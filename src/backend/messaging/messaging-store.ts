import { randomUUID } from "node:crypto";
import { MESSAGING_PLATFORMS, type MessagingPlatform } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { deleteAggregateHistory, deleteThreadAttachments } from "../database/database-core";
import {
  databaseRow,
  databaseRows,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "../database/database-rows";
import { withTransaction } from "../database/sqlite-transaction";
import { cachedStatement } from "../database/statement-cache";
import type { OpenBotDatabase } from "../openbot-database";

export interface MessagingConnectionRecord {
  connectionId: string;
  platform: MessagingPlatform;
  workspaceId: string;
  workspaceName: string;
  enabled: boolean;
  botUserId: string | null;
  appId: string | null;
  orchestratorAgentId: string | null;
  lastErrorCode: string | null;
}

export interface MessagingLink {
  linkId: string;
  connectionId: string;
  agentId: string;
  platformChannelId: string;
  threadKey: string;
  isDirect: boolean;
  threadId: string;
  title: string;
  historyCursor: string | null;
  updatedAt: string;
}

export interface MessagingAllowedRole {
  id: string;
  name: string;
}

export interface MessagingAllowedSender {
  id: string;
  kind: "contact" | "group";
  name: string;
  readOnly: boolean;
}

export interface MessagingPingInput {
  connectionId: string;
  platformChannelId: string;
  threadKey: string;
  userIds: readonly string[];
  agentId: string;
  text: string;
}

export interface MessagingPing {
  userId: string;
  agentId: string;
  text: string;
  createdAt: string;
}

export interface MessagingLinkInput {
  connectionId: string;
  agentId: string;
  platformChannelId: string;
  threadKey: string;
  isDirect: boolean;
  title: string;
}

/** One message that OpenBot sent on an agent's request, after a person approved it. */
export interface MessagingSendRecord {
  draftId: string;
  connectionId: string;
  /** The conversation where the user asked for the send. A reply goes back there. Null in old records. */
  linkId: string | null;
  agentId: string;
  /** The platform user who approved, and when. */
  approvedBy: string;
  approvedAt: string;
  sender: "user" | "bot";
  to: string;
  platformChannelId: string;
  platformMessageId: string;
  text: string;
  link: string | null;
  /** Sent with no approval, because the conversation was on the auto-reply list. Absent in old records. */
  autoSent?: true;
  /** Sent as the person because they asked in GoAhead, with no Slack conversation. Absent in old records. */
  fromGoAhead?: true;
}

/**
 * The thread key of a reply context: the execution thread where auto-reply turns of one Slack
 * conversation run, away from the agent's main thread. A Slack thread key is a `ts` or `direct`, so
 * no external conversation can have this key. The link reads below never return such a row: for
 * every send and inbox gate, a reply context is a thread with no external conversation.
 */
export const REPLY_CONTEXT_KEY = "goahead:auto-reply";

const LINK_LIST_LIMIT = 200;
/** As long as a title: the row shows one line of it. */
const PREVIEW_LIMIT = 256;
const SEND_AGGREGATE = "messaging_send";
const SEND_EVENT = "messaging_send_sent";

export class MessagingStore {
  readonly #database: OpenBotDatabase;

  constructor(database: OpenBotDatabase) {
    this.#database = database;
  }

  connections(): MessagingConnectionRecord[] {
    return databaseRows(
      this.#database.connection.prepare("SELECT * FROM projection_messaging_connections ORDER BY created_at").all(),
    ).flatMap(decodeConnection);
  }

  connectionForWorkspace(platform: MessagingPlatform, workspaceId: string): MessagingConnectionRecord | null {
    const row = databaseRow(
      this.#database.connection
        .prepare("SELECT * FROM projection_messaging_connections WHERE platform = ? AND workspace_id = ?")
        .get(platform, workspaceId),
    );
    return row ? (decodeConnection(row)[0] ?? null) : null;
  }

  connection(connectionId: string): MessagingConnectionRecord | null {
    const row = databaseRow(
      this.#database.connection
        .prepare("SELECT * FROM projection_messaging_connections WHERE connection_id = ?")
        .get(connectionId),
    );
    return row ? (decodeConnection(row)[0] ?? null) : null;
  }

  ensureConnection(platform: MessagingPlatform, workspaceId: string, workspaceName: string): MessagingConnectionRecord {
    const existing = this.connectionForWorkspace(platform, workspaceId);
    if (existing) return existing;
    const now = new Date().toISOString();
    this.#database.connection
      .prepare(
        `INSERT INTO projection_messaging_connections
           (connection_id, platform, workspace_id, workspace_name, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(`messaging-${randomUUID()}`, platform, workspaceId, workspaceName, now, now);
    const created = this.connectionForWorkspace(platform, workspaceId);
    if (!created) throw new Error("The messaging connection was not stored.");
    return created;
  }

  updateConnection(
    connectionId: string,
    changes: Partial<Omit<MessagingConnectionRecord, "connectionId" | "platform" | "workspaceId">>,
  ): void {
    const current = this.connection(connectionId);
    if (!current) return;
    const next = { ...current, ...changes };
    this.#database.connection
      .prepare(
        `UPDATE projection_messaging_connections
         SET enabled = ?, workspace_name = ?, bot_user_id = ?, app_id = ?, orchestrator_agent_id = ?,
             last_error_code = ?, updated_at = ?
         WHERE connection_id = ?`,
      )
      .run(
        next.enabled ? 1 : 0,
        next.workspaceName,
        next.botUserId,
        next.appId,
        next.orchestratorAgentId,
        next.lastErrorCode,
        new Date().toISOString(),
        connectionId,
      );
  }

  allowedRoles(connectionId: string): MessagingAllowedRole[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT role_id, role_name FROM projection_messaging_allowed_roles
           WHERE connection_id = ? ORDER BY created_at, role_name, role_id`,
        )
        .all(connectionId),
    ).map((row) => ({ id: requiredStringColumn(row, "role_id"), name: requiredStringColumn(row, "role_name") }));
  }

  replaceAllowedRoles(connectionId: string, roles: readonly MessagingAllowedRole[]): void {
    const db = this.#database.connection;
    withTransaction(db, () => {
      const kept = new Set(roles.map((role) => role.id));
      for (const current of this.allowedRoles(connectionId))
        if (!kept.has(current.id))
          db.prepare("DELETE FROM projection_messaging_allowed_roles WHERE connection_id = ? AND role_id = ?").run(
            connectionId,
            current.id,
          );
      const now = new Date().toISOString();
      const upsert = db.prepare(
        `INSERT INTO projection_messaging_allowed_roles (connection_id, role_id, role_name, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(connection_id, role_id) DO UPDATE SET role_name = excluded.role_name`,
      );
      for (const role of roles) upsert.run(connectionId, role.id, role.name, now);
    });
  }

  allowedSenders(connectionId: string): MessagingAllowedSender[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT sender_id, kind, name, mode FROM projection_messaging_allowed_senders
           WHERE connection_id = ? ORDER BY created_at, name, sender_id`,
        )
        .all(connectionId),
    ).flatMap((row) => {
      const kind = requiredStringColumn(row, "kind");
      if (kind !== "contact" && kind !== "group") return [];
      return [
        {
          id: requiredStringColumn(row, "sender_id"),
          kind,
          name: requiredStringColumn(row, "name"),
          readOnly: requiredStringColumn(row, "mode") === "read",
        },
      ];
    });
  }

  setAllowedSenderReadOnly(connectionId: string, senderId: string, readOnly: boolean): boolean {
    const result = this.#database.connection
      .prepare("UPDATE projection_messaging_allowed_senders SET mode = ? WHERE connection_id = ? AND sender_id = ?")
      .run(readOnly ? "read" : "reply", connectionId, senderId);
    return Number(result.changes) > 0;
  }

  addAllowedSender(connectionId: string, sender: Omit<MessagingAllowedSender, "readOnly">): void {
    this.#database.connection
      .prepare(
        `INSERT INTO projection_messaging_allowed_senders (connection_id, sender_id, kind, name, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(connection_id, sender_id) DO UPDATE SET name = excluded.name`,
      )
      .run(connectionId, sender.id, sender.kind, sender.name, new Date().toISOString());
  }

  removeAllowedSender(connectionId: string, senderId: string): void {
    this.#database.connection
      .prepare("DELETE FROM projection_messaging_allowed_senders WHERE connection_id = ? AND sender_id = ?")
      .run(connectionId, senderId);
  }

  savePings(input: MessagingPingInput): void {
    const db = this.#database.connection;
    withTransaction(db, () => {
      const upsert = db.prepare(
        `INSERT INTO projection_messaging_pings
           (connection_id, platform_channel_id, thread_key, user_id, agent_id, text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(connection_id, platform_channel_id, thread_key, user_id)
         DO UPDATE SET agent_id = excluded.agent_id, text = excluded.text, created_at = excluded.created_at`,
      );
      const now = new Date().toISOString();
      for (const userId of input.userIds)
        upsert.run(
          input.connectionId,
          input.platformChannelId,
          input.threadKey,
          userId,
          input.agentId,
          input.text,
          now,
        );
    });
  }

  pings(connectionId: string, platformChannelId: string, threadKey: string): MessagingPing[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT user_id, agent_id, text, created_at FROM projection_messaging_pings
           WHERE connection_id = ? AND platform_channel_id = ? AND thread_key = ?`,
        )
        .all(connectionId, platformChannelId, threadKey),
    ).map((row) => ({
      userId: requiredStringColumn(row, "user_id"),
      agentId: requiredStringColumn(row, "agent_id"),
      text: requiredStringColumn(row, "text"),
      createdAt: requiredStringColumn(row, "created_at"),
    }));
  }

  link(linkId: string): MessagingLink | null {
    const row = databaseRow(
      this.#database.connection.prepare("SELECT * FROM projection_messaging_threads WHERE link_id = ?").get(linkId),
    );
    return row ? decodeLink(row) : null;
  }

  linkByKey(connectionId: string, platformChannelId: string, threadKey: string): MessagingLink | null {
    const row = databaseRow(
      this.#database.connection
        .prepare(
          `SELECT * FROM projection_messaging_threads
           WHERE connection_id = ? AND platform_channel_id = ? AND thread_key = ?`,
        )
        .get(connectionId, platformChannelId, threadKey),
    );
    return row ? decodeLink(row) : null;
  }

  linkForThread(threadId: string): MessagingLink | null {
    const row = databaseRow(
      cachedStatement(
        this.#database.connection,
        "SELECT * FROM projection_messaging_threads WHERE thread_id = ? AND thread_key != ?",
      ).get(threadId, REPLY_CONTEXT_KEY),
    );
    return row ? decodeLink(row) : null;
  }

  links(agentId: string): MessagingLink[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT * FROM projection_messaging_threads WHERE agent_id = ? AND thread_key != ?
           ORDER BY updated_at DESC, link_id LIMIT ?`,
        )
        .all(agentId, REPLY_CONTEXT_KEY, LINK_LIST_LIMIT),
    ).map(decodeLink);
  }

  /** The link or reply context that owns this execution thread, or null: one lookup for both. */
  executionLink(threadId: string): MessagingLink | null {
    const row = databaseRow(
      this.#database.connection.prepare("SELECT * FROM projection_messaging_threads WHERE thread_id = ?").get(threadId),
    );
    return row ? decodeLink(row) : null;
  }

  /** The reply context of one conversation, or null. */
  replyContext(connectionId: string, platformChannelId: string): MessagingLink | null {
    return this.linkByKey(connectionId, platformChannelId, REPLY_CONTEXT_KEY);
  }

  /** The reply context that owns this execution thread, or null. */
  replyContextForThread(threadId: string): MessagingLink | null {
    const row = databaseRow(
      this.#database.connection
        .prepare("SELECT * FROM projection_messaging_threads WHERE thread_id = ? AND thread_key = ?")
        .get(threadId, REPLY_CONTEXT_KEY),
    );
    return row ? decodeLink(row) : null;
  }

  /** How many messages GoAhead wrote to the thread, which is how many turns it had. */
  userMessageCount(threadId: string): number {
    const row = databaseRow(
      this.#database.connection
        .prepare("SELECT COUNT(*) AS count FROM projection_thread_messages WHERE thread_id = ? AND author = 'user'")
        .get(threadId),
    );
    return row ? requiredNumberColumn(row, "count") : 0;
  }

  /**
   * The newest links of every connection, with the workspace each one belongs to and the start of
   * the newest message that either side wrote (not the agent's work notes).
   */
  recentLinks(): Array<MessagingLink & { workspaceId: string; platform: MessagingPlatform; preview: string | null }> {
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT t.*, c.workspace_id, c.platform,
             (SELECT substr(json_extract(m.message_json, '$.text'), 1, ?) FROM projection_thread_messages m
              WHERE m.thread_id = t.thread_id AND m.author IN ('user', 'assistant')
                AND COALESCE(m.item_type, '') NOT IN ('commentary', 'plan')
              ORDER BY m.created_at DESC, m.ordinal DESC LIMIT 1) AS preview
           FROM projection_messaging_threads t
           JOIN projection_messaging_connections c ON c.connection_id = t.connection_id
           WHERE t.thread_key != ?
           ORDER BY t.updated_at DESC, t.link_id LIMIT ?`,
        )
        .all(PREVIEW_LIMIT, REPLY_CONTEXT_KEY, LINK_LIST_LIMIT),
    ).flatMap((row) => {
      const platform = requiredStringColumn(row, "platform");
      if (!isOneOf(MESSAGING_PLATFORMS, platform)) return [];
      const preview = optionalStringColumn(row, "preview");
      return [
        {
          ...decodeLink(row),
          workspaceId: requiredStringColumn(row, "workspace_id"),
          platform,
          preview: preview ? preview.replace(/\s+/g, " ").trim() || null : null,
        },
      ];
    });
  }

  executionThreads(): Array<{ id: string; threadId: string }> {
    return databaseRows(
      this.#database.connection.prepare("SELECT agent_id, thread_id FROM projection_messaging_threads").all(),
    ).map((row) => ({ id: requiredStringColumn(row, "agent_id"), threadId: requiredStringColumn(row, "thread_id") }));
  }

  ensureLink(input: MessagingLinkInput): MessagingLink {
    const existing = this.linkByKey(input.connectionId, input.platformChannelId, input.threadKey);
    if (existing) return existing;
    const linkId = `messaging-link-${randomUUID()}`;
    const threadId = `openbot-thread-${randomUUID()}`;
    this.#database.dispatch(
      `messaging-thread:${linkId}`,
      [
        {
          aggregateType: "messaging-thread",
          aggregateId: linkId,
          eventType: "messaging.thread-created",
          payload: { agentId: input.agentId, threadId },
        },
      ],
      (db, sequences) => {
        const now = new Date().toISOString();
        db.prepare("INSERT INTO projection_threads VALUES (?, ?, ?, NULL, ?, ?, ?)").run(
          threadId,
          input.agentId,
          input.title,
          now,
          now,
          sequences[0] ?? 0,
        );
        db.prepare(
          `INSERT INTO projection_messaging_threads
             (link_id, connection_id, agent_id, platform_channel_id, thread_key, is_direct, thread_id, title,
              history_cursor, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        ).run(
          linkId,
          input.connectionId,
          input.agentId,
          input.platformChannelId,
          input.threadKey,
          input.isDirect ? 1 : 0,
          threadId,
          input.title,
          now,
          now,
        );
        return null;
      },
    );
    const created = this.link(linkId);
    if (!created) throw new Error("The messaging thread was not stored.");
    return created;
  }

  touch(linkId: string, historyCursor?: string): void {
    const now = new Date().toISOString();
    if (historyCursor === undefined)
      this.#database.connection
        .prepare("UPDATE projection_messaging_threads SET updated_at = ? WHERE link_id = ?")
        .run(now, linkId);
    else
      this.#database.connection
        .prepare("UPDATE projection_messaging_threads SET updated_at = ?, history_cursor = ? WHERE link_id = ?")
        .run(now, historyCursor, linkId);
  }

  deleteForAgent(agentId: string): string[] {
    const orchestratorOf = databaseRows(
      this.#database.connection
        .prepare("SELECT connection_id FROM projection_messaging_connections WHERE orchestrator_agent_id = ?")
        .all(agentId),
    ).map((row) => requiredStringColumn(row, "connection_id"));
    const links = databaseRows(
      this.#database.connection
        .prepare("SELECT link_id, thread_id FROM projection_messaging_threads WHERE agent_id = ?")
        .all(agentId),
    ).map((row) => ({
      linkId: requiredStringColumn(row, "link_id"),
      threadId: requiredStringColumn(row, "thread_id"),
    }));
    this.#database.dispatch(
      `messaging-agent-deleted:${agentId}:${randomUUID()}`,
      [
        {
          aggregateType: "messaging-agent",
          aggregateId: agentId,
          eventType: "messaging.agent-deleted",
          payload: { threadIds: links.map((link) => link.threadId) },
        },
      ],
      (db) => {
        deleteAggregateHistory(
          db,
          "messaging-thread",
          links.map((link) => link.linkId),
        );
        for (const { threadId } of links) {
          deleteAggregateHistory(db, "thread", [threadId]);
          deleteThreadAttachments(db, threadId);
        }
        db.prepare(
          `DELETE FROM projection_messaging_pings WHERE EXISTS (
             SELECT 1 FROM projection_messaging_threads AS link WHERE link.agent_id = ?
               AND link.connection_id = projection_messaging_pings.connection_id
               AND link.platform_channel_id = projection_messaging_pings.platform_channel_id
               AND link.thread_key = projection_messaging_pings.thread_key)`,
        ).run(agentId);
        db.prepare(
          `DELETE FROM projection_messaging_pings WHERE agent_id = ? AND NOT EXISTS (
             SELECT 1 FROM projection_messaging_threads AS link
             WHERE link.connection_id = projection_messaging_pings.connection_id
               AND link.platform_channel_id = projection_messaging_pings.platform_channel_id
               AND link.thread_key = projection_messaging_pings.thread_key)`,
        ).run(agentId);
        db.prepare("DELETE FROM projection_messaging_threads WHERE agent_id = ?").run(agentId);
        for (const { threadId } of links)
          db.prepare("DELETE FROM projection_threads WHERE thread_id = ?").run(threadId);
        db.prepare(
          "UPDATE projection_messaging_connections SET orchestrator_agent_id = NULL WHERE orchestrator_agent_id = ?",
        ).run(agentId);
        return null;
      },
    );
    return orchestratorOf;
  }

  restoreOrchestrator(agentId: string, connectionIds: readonly string[]): void {
    for (const connectionId of connectionIds)
      if (this.connection(connectionId)?.orchestratorAgentId === null)
        this.updateConnection(connectionId, { orchestratorAgentId: agentId });
  }

  /**
   * Removes one link with its execution thread. Only for a reply context, which holds no drafts and
   * no external message. The caller removes the live provider state of the thread first.
   */
  deleteLink(linkId: string): void {
    const link = this.link(linkId);
    if (!link) return;
    this.#database.dispatch(
      `messaging-link-deleted:${linkId}:${randomUUID()}`,
      [
        {
          // On the agent, as `deleteForAgent` does: the history of the link is deleted below.
          aggregateType: "messaging-agent",
          aggregateId: link.agentId,
          eventType: "messaging.reply-context-deleted",
          payload: { threadIds: [link.threadId] },
        },
      ],
      (db) => {
        deleteAggregateHistory(db, "messaging-thread", [linkId]);
        deleteAggregateHistory(db, "thread", [link.threadId]);
        db.prepare("DELETE FROM projection_attachments WHERE owner_kind = 'thread-message' AND owner_id LIKE ?").run(
          `${link.threadId}:%`,
        );
        db.prepare("DELETE FROM projection_messaging_threads WHERE link_id = ?").run(linkId);
        db.prepare("DELETE FROM projection_threads WHERE thread_id = ?").run(link.threadId);
        return null;
      },
    );
  }

  /** The audit log entry of one send, in the event log, so it survives like every other decision. */
  recordSend(record: MessagingSendRecord): void {
    this.#database.dispatch(
      `messaging-send:${record.draftId}`,
      [{ aggregateType: SEND_AGGREGATE, aggregateId: record.draftId, eventType: SEND_EVENT, payload: record }],
      () => null,
    );
  }

  /** The newest send to one platform conversation of a connection, or null. */
  latestSendTo(connectionId: string, platformChannelId: string): MessagingSendRecord | null {
    const row = databaseRows(
      this.#database.connection
        .prepare(
          `SELECT payload_json FROM orchestration_events
           WHERE aggregate_type = ? AND json_extract(payload_json, '$.connectionId') = ?
             AND json_extract(payload_json, '$.platformChannelId') = ?
           ORDER BY sequence DESC LIMIT 1`,
        )
        .all(SEND_AGGREGATE, connectionId, platformChannelId),
    )[0];
    return row ? decodeSendRecord(JSON.parse(String(row.payload_json))) : null;
  }

  /** The ids of the messages that went out in one platform conversation with no approval (auto-reply). */
  autoSentMessageIds(connectionId: string, platformChannelId: string): Set<string> {
    return new Set(
      databaseRows(
        this.#database.connection
          .prepare(
            `SELECT json_extract(payload_json, '$.platformMessageId') AS message_id FROM orchestration_events
             WHERE aggregate_type = ? AND json_extract(payload_json, '$.connectionId') = ?
               AND json_extract(payload_json, '$.platformChannelId') = ?
               AND json_extract(payload_json, '$.autoSent') = 1`,
          )
          .all(SEND_AGGREGATE, connectionId, platformChannelId),
      ).map((row) => requiredStringColumn(row, "message_id")),
    );
  }

  /** Whether GoAhead ever sent to this recipient (`user:U1`, `group:U1,U2`, `channel:C1`) in the workspace. */
  hasSentTo(connectionId: string, to: string): boolean {
    return (
      databaseRows(
        this.#database.connection
          .prepare(
            `SELECT 1 FROM orchestration_events
             WHERE aggregate_type = ? AND json_extract(payload_json, '$.connectionId') = ?
               AND json_extract(payload_json, '$.to') = ? LIMIT 1`,
          )
          .all(SEND_AGGREGATE, connectionId, to),
      ).length > 0
    );
  }

  /**
   * How many messages agents sent in the workspace since the time. A reply that the person typed in
   * GoAhead has no agent and does not count. Settings show this count; it limits nothing.
   */
  sendsSince(connectionId: string, since: string): number {
    const row = databaseRow(
      this.#database.connection
        .prepare(
          `SELECT COUNT(*) AS count FROM orchestration_events
           WHERE aggregate_type = ? AND json_extract(payload_json, '$.connectionId') = ?
             AND json_extract(payload_json, '$.approvedAt') >= ?
             AND json_extract(payload_json, '$.agentId') != ''`,
        )
        .get(SEND_AGGREGATE, connectionId, since),
    );
    return row ? requiredNumberColumn(row, "count") : 0;
  }

  /** Every send on record, oldest first. */
  sends(): MessagingSendRecord[] {
    return databaseRows(
      this.#database.connection
        .prepare("SELECT payload_json FROM orchestration_events WHERE aggregate_type = ? ORDER BY sequence")
        .all(SEND_AGGREGATE),
    )
      .map((row) => decodeSendRecord(JSON.parse(String(row.payload_json))))
      .filter((record) => record !== null);
  }

  threadIdsForAgent(agentId: string): string[] {
    return databaseRows(
      this.#database.connection
        .prepare("SELECT thread_id FROM projection_messaging_threads WHERE agent_id = ?")
        .all(agentId),
    ).map((row) => requiredStringColumn(row, "thread_id"));
  }
}

function decodeConnection(row: DynamicRecord): MessagingConnectionRecord[] {
  const platform = requiredStringColumn(row, "platform");
  if (!isOneOf(MESSAGING_PLATFORMS, platform)) return [];
  return [
    {
      connectionId: requiredStringColumn(row, "connection_id"),
      platform,
      workspaceId: requiredStringColumn(row, "workspace_id"),
      workspaceName: requiredStringColumn(row, "workspace_name"),
      enabled: requiredNumberColumn(row, "enabled") === 1,
      botUserId: optionalStringColumn(row, "bot_user_id"),
      appId: optionalStringColumn(row, "app_id"),
      orchestratorAgentId: optionalStringColumn(row, "orchestrator_agent_id"),
      lastErrorCode: optionalStringColumn(row, "last_error_code"),
    },
  ];
}

function decodeLink(row: DynamicRecord): MessagingLink {
  return {
    linkId: requiredStringColumn(row, "link_id"),
    connectionId: requiredStringColumn(row, "connection_id"),
    agentId: requiredStringColumn(row, "agent_id"),
    platformChannelId: requiredStringColumn(row, "platform_channel_id"),
    threadKey: requiredStringColumn(row, "thread_key"),
    isDirect: requiredNumberColumn(row, "is_direct") === 1,
    threadId: requiredStringColumn(row, "thread_id"),
    title: requiredStringColumn(row, "title"),
    historyCursor: optionalStringColumn(row, "history_cursor"),
    updatedAt: requiredStringColumn(row, "updated_at"),
  };
}

function decodeSendRecord(value: unknown): MessagingSendRecord | null {
  if (
    !isDynamicRecord(value) ||
    !isString(value.draftId) ||
    !isString(value.connectionId) ||
    (value.linkId !== undefined && value.linkId !== null && !isString(value.linkId)) ||
    !isString(value.agentId) ||
    !isString(value.approvedBy) ||
    !isString(value.approvedAt) ||
    !isOneOf(["user", "bot"] as const, value.sender) ||
    !isString(value.to) ||
    !isString(value.platformChannelId) ||
    !isString(value.platformMessageId) ||
    !isString(value.text) ||
    (value.link !== null && !isString(value.link))
  ) {
    return null;
  }
  return {
    draftId: value.draftId,
    connectionId: value.connectionId,
    linkId: isString(value.linkId) ? value.linkId : null,
    agentId: value.agentId,
    approvedBy: value.approvedBy,
    approvedAt: value.approvedAt,
    sender: value.sender,
    to: value.to,
    platformChannelId: value.platformChannelId,
    platformMessageId: value.platformMessageId,
    text: value.text,
    link: value.link,
    ...(value.autoSent === true ? { autoSent: true as const } : {}),
    ...(value.fromGoAhead === true ? { fromGoAhead: true as const } : {}),
  };
}
