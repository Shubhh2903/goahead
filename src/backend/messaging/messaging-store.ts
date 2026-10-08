import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { MESSAGING_PLATFORMS, type MessagingPlatform } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import {
  databaseRow,
  databaseRows,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "../database/database-rows";
import type { OpenBotDatabase } from "../openbot-database";

/** One workspace of a platform, where every agent of this computer can answer. */
export interface MessagingConnectionRecord {
  connectionId: string;
  platform: MessagingPlatform;
  workspaceId: string;
  workspaceName: string;
  enabled: boolean;
  botUserId: string | null;
  appId: string | null;
  /** The agent that receives every new conversation. Null until the user adds it. */
  orchestratorAgentId: string | null;
  /** The last failure that stops the connection until the user acts, such as a revoked token. */
  lastErrorCode: string | null;
}

/** One external conversation, answered in its own execution thread of the agent. */
export interface MessagingLink {
  linkId: string;
  connectionId: string;
  agentId: string;
  platformChannelId: string;
  threadKey: string;
  isDirect: boolean;
  threadId: string;
  title: string;
  /** The newest platform message that the agent already read as context. */
  historyCursor: string | null;
  updatedAt: string;
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
}

const LINK_LIST_LIMIT = 200;
/** As long as a title: the row shows one line of it. */
const PREVIEW_LIMIT = 256;
const SEND_AGGREGATE = "messaging_send";
const SEND_EVENT = "messaging_send_sent";

/**
 * Owns `projection_messaging_connections` and `projection_messaging_threads`. It never stores a
 * token, and it never imports the database facade's callers.
 *
 * A connection row is configuration, so it is written directly, as MCP servers are. A link creates
 * a row in `projection_threads`, so it goes through `dispatch`, as a channel context does. Its event
 * payload holds ids only: the event log is append-only and must not keep external text.
 */
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

  /**
   * Creates the connection of this workspace, or returns the one it had. A workspace connected
   * again keeps its row, so its conversations keep their agents.
   */
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
      this.#database.connection.prepare("SELECT * FROM projection_messaging_threads WHERE thread_id = ?").get(threadId),
    );
    return row ? decodeLink(row) : null;
  }

  links(agentId: string): MessagingLink[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          "SELECT * FROM projection_messaging_threads WHERE agent_id = ? ORDER BY updated_at DESC, link_id LIMIT ?",
        )
        .all(agentId, LINK_LIST_LIMIT),
    ).map(decodeLink);
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
           ORDER BY t.updated_at DESC, t.link_id LIMIT ?`,
        )
        .all(PREVIEW_LIMIT, LINK_LIST_LIMIT),
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

  /** The agent id and thread id of every link, for boot recovery. */
  executionThreads(): Array<{ id: string; threadId: string }> {
    return databaseRows(
      this.#database.connection.prepare("SELECT agent_id, thread_id FROM projection_messaging_threads").all(),
    ).map((row) => ({ id: requiredStringColumn(row, "agent_id"), threadId: requiredStringColumn(row, "thread_id") }));
  }

  /** Finds the link of one external conversation, or creates it with a new execution thread. */
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

  /** Marks new activity, so the link lists first, and records what the agent has read. */
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

  /**
   * Removes every link of an agent, with the execution threads and their history. A workspace whose
   * orchestrator it was has none until the user adds one again. The caller releases the provider
   * sessions of `threadIdsForAgent` first.
   */
  deleteForAgent(agentId: string): void {
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
          db.prepare("DELETE FROM projection_attachments WHERE owner_kind = 'thread-message' AND owner_id LIKE ?").run(
            `${threadId}:%`,
          );
        }
        db.prepare("DELETE FROM projection_messaging_threads WHERE agent_id = ?").run(agentId);
        for (const { threadId } of links)
          db.prepare("DELETE FROM projection_threads WHERE thread_id = ?").run(threadId);
        db.prepare(
          "UPDATE projection_messaging_connections SET orchestrator_agent_id = NULL WHERE orchestrator_agent_id = ?",
        ).run(agentId);
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
   * GoAhead has no agent and does not count: the hourly limit is for agent sends only.
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

function deleteAggregateHistory(db: DatabaseSync, aggregateType: string, aggregateIds: readonly string[]): void {
  if (!aggregateIds.length) return;
  const placeholders = aggregateIds.map(() => "?").join(", ");
  db.prepare(
    `DELETE FROM orchestration_command_receipts WHERE command_id IN (
       SELECT DISTINCT command_id FROM orchestration_events
       WHERE aggregate_type = ? AND aggregate_id IN (${placeholders})
     )`,
  ).run(aggregateType, ...aggregateIds);
  db.prepare(`DELETE FROM orchestration_events WHERE aggregate_type = ? AND aggregate_id IN (${placeholders})`).run(
    aggregateType,
    ...aggregateIds,
  );
}

/** A row of a platform this build has no driver for is skipped, not an error: a newer build wrote it. */
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
  };
}
