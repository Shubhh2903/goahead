// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import type { AgentSummary, ConversationMessage } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it } from "vitest";
import { OpenBotDatabase } from "./openbot-database";
import { migrateOpenBotDatabase } from "./openbot-database-schema";
import { importProviderHistory } from "./provider-history-import";

// Migration 33 (upstream OpenBot migration 29): the provider history tables. Failure modes, one test each:
// - an upgrade from a shipped schema (32 on top of 31, 31, 28, 27, and 8 to 26) loses or changes a row;
// - the upgrade leaves foreign keys off, an orphan row, or a database that fails `quick_check`;
// - a failure leaves a part of the migration or its marker, or changes a row;
// - a taken index name stops the upgrade in a state that a retry cannot finish;
// - a newer or incomplete history is changed or accepted;
// - a deleted thread leaves import, turn or staging rows behind;
// - the first import after the upgrade deletes a saved row or drops its attachments.

const LATEST = 35;
const STAMP = "2026-10-01T07:00:00.000Z";
const HISTORY_OBJECTS = [
  "provider_history_imports",
  "provider_history_imports_thread",
  "provider_history_staging",
  "provider_history_staging_pending",
  "provider_history_staging_turn",
  "provider_history_turns",
  "provider_history_turns_pending",
];

const roots: string[] = [];
const databases: DatabaseSync[] = [];

afterEach(async () => {
  for (const db of databases.splice(0)) if (db.isOpen) db.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/**
 * The real shipped shape of an install at `version`: the migrations run until a stop trigger aborts the next
 * marker. Migrations up to 32 are frozen, so this is what an upgraded user database holds.
 */
function databaseAt(version: number): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TEMP TRIGGER stop_at_version BEFORE INSERT ON schema_migrations WHEN new.version > ${version}
    BEGIN SELECT RAISE(ABORT, 'fixture stop'); END;`);
  expect(() => migrateOpenBotDatabase(db)).toThrow(`migration to version ${version + 1} failed`);
  db.exec("DROP TRIGGER stop_at_version");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

/** A thread with a message, one provider session and one turn linked to it: rows every shipped schema has. */
function seedConversation(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO projection_threads (thread_id, agent_id, title, active_turn_id, created_at, updated_at,
       last_event_sequence) VALUES ('thread-writer', 'writer', 'Writer', NULL, ?, ?, 1)`,
  ).run(STAMP, STAMP);
  db.prepare(
    `INSERT INTO projection_thread_messages (thread_id, message_id, turn_id, author, status, item_type, created_at,
       ordinal, message_json, last_event_sequence)
     VALUES ('thread-writer', 'message-1', 'turn-1', 'user', 'complete', NULL, ?, 0, ?, 2)`,
  ).run(STAMP, JSON.stringify({ text: "Zażółć gęślą jaźń 漢字" }));
  db.prepare(
    `INSERT INTO projection_provider_sessions (id, thread_id, provider, external_session_id, model, effort, state,
       created_at, updated_at, resume_cursor, last_event_sequence)
     VALUES ('session-1', 'thread-writer', 'codex', 'codex-external', 'codex-model', 'medium', 'inactive', ?, ?,
       'codex-cursor', 3)`,
  ).run(STAMP, STAMP);
  db.prepare(
    `INSERT INTO projection_turns (turn_id, thread_id, provider_session_id, status, started_at, completed_at,
       last_event_sequence) VALUES ('turn-1', 'thread-writer', 'session-1', 'completed', ?, ?, 4)`,
  ).run(STAMP, STAMP);
}

/** Everything a GoAhead 0.31.0 to 0.35.0 user can have: the conversation, memories, routines and Slack data. */
function seedInstall(db: DatabaseSync, version: number): void {
  seedConversation(db);
  db.prepare(
    `INSERT INTO projection_agents (agent_id, thread_id, model, updated_at, sort_order, agent_json,
       last_event_sequence) VALUES ('writer', 'thread-writer', 'codex-model', ?, 0, '{"name":"Writer"}', 5)`,
  ).run(STAMP);
  db.prepare(
    `INSERT INTO projection_agent_memories (memory_id, agent_id, text, normalized_text, origin, source_turn_id,
       created_at, updated_at, last_event_sequence)
     VALUES ('memory-1', 'writer', 'Prefers short answers.', 'prefers short answers.', 'manual', NULL, ?, ?, 6)`,
  ).run(STAMP, STAMP);
  db.prepare("INSERT INTO projection_channels(channel_id, channel_json) VALUES ('owner', '{}')").run();
  for (const [index, table] of [
    { owner: "agent_id", handle: "delivery_id", prefix: "projection_", routines: "projection_agent_routines" },
    { owner: "channel_id", handle: "request_message_id", prefix: "projection_channel_", routines: "" },
  ].entries()) {
    const routines = table.routines || "projection_channel_routines";
    const owner = index === 0 ? "writer" : "owner";
    db.prepare(
      `INSERT INTO ${routines} (routine_id, ${table.owner}, name, instruction, active, timezone, created_at,
         updated_at, last_event_sequence, limit_policy)
       VALUES (?, ?, 'Morning brief', 'Collect the news.', 1, 'Europe/Warsaw', ?, ?, 7, 'skip')`,
    ).run(`routine-${index}`, owner, STAMP, STAMP);
    db.prepare(
      `INSERT INTO ${table.prefix}routine_triggers (trigger_id, routine_id, schedule_json, next_run_at, created_at,
         updated_at, last_event_sequence)
       VALUES (?, ?, '{"kind":"daily","time":"09:00"}', '2026-10-02T07:00:00.000Z', ?, ?, 8)`,
    ).run(`trigger-${index}`, `routine-${index}`, STAMP, STAMP);
    db.prepare(
      `INSERT INTO ${table.prefix}routine_runs (run_id, routine_id, ${table.owner}, trigger_id, run_kind,
         scheduled_for, routine_name, instruction, ${table.handle}, status, error, created_at, updated_at,
         last_event_sequence)
       VALUES (?, ?, ?, ?, 'scheduled', ?, 'Morning brief', 'Collect the news.', ?, 'succeeded', NULL, ?, ?, 9)`,
    ).run(`run-${index}`, `routine-${index}`, owner, `trigger-${index}`, STAMP, `handle-${index}`, STAMP, STAMP);
  }
  db.prepare(
    `INSERT INTO projection_messaging_connections (connection_id, platform, workspace_id, workspace_name, enabled,
       bot_user_id, app_id, orchestrator_agent_id, last_error_code, created_at, updated_at)
     VALUES ('connection-1', 'slack', 'T1', 'Acme', 1, 'U-BOT', 'A1', 'writer', NULL, ?, ?)`,
  ).run(STAMP, STAMP);
  db.prepare(
    `INSERT INTO projection_messaging_threads (link_id, connection_id, agent_id, platform_channel_id, thread_key,
       is_direct, thread_id, title, history_cursor, created_at, updated_at)
     VALUES ('link-1', 'connection-1', 'writer', 'C1', '1700000000.000100', 0, 'thread-writer', '#general', NULL, ?, ?)`,
  ).run(STAMP, STAMP);
  if (version >= 28) {
    db.prepare(
      `INSERT INTO projection_messaging_inbox (connection_id, platform_channel_id, platform_message_id, thread_key,
         kind, author_id, author_name, text, sent_at)
       VALUES ('connection-1', 'D1', '1700000000.000200', NULL, 'direct', 'U2', 'Ada', 'Cześć!', ?)`,
    ).run(STAMP);
  }
  if (version >= 29) {
    db.prepare(
      `INSERT INTO slack_messages (connection_id, channel_id, ts, thread_ts, reply_count, latest_reply_ts, author_id,
         text, files_json, reactions_json, edited_at, deleted, subtype, cached_at)
       VALUES ('connection-1', 'C1', '1700000000.000300', NULL, 0, NULL, 'U2', 'Hello', '[]', '[]', NULL, 0, NULL, ?)`,
    ).run(STAMP);
  }
  if (version >= 30) {
    db.prepare(
      `INSERT INTO projection_messaging_drafts (draft_id, connection_id, link_id, accept_token, decline_token,
         target_json, message_id, allowed_user_id, post_text, draft_json, created_at)
       VALUES ('draft-1', 'connection-1', 'link-1', 'accept-1', 'decline-1', '{}', NULL, 'U2', 'Draft', '{}', ?)`,
    ).run(STAMP);
  }
  if (version >= 31) {
    db.prepare(
      `INSERT INTO projection_messaging_auto_reply (connection_id, platform_channel_id, created_at)
       VALUES ('connection-1', 'D1', ?)`,
    ).run(STAMP);
  }
}

type TableRows = Record<string, readonly Record<string, SQLOutputValue>[]>;

/** Every row of every table, in a stable order. */
function allRows(db: DatabaseSync): TableRows {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => String(row.name));
  return Object.fromEntries(
    tables.map((table) => [
      table,
      db
        .prepare(`SELECT * FROM "${table}"`)
        .all()
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ]),
  );
}

function schema(db: DatabaseSync): readonly Record<string, SQLOutputValue>[] {
  return db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all();
}

function withoutMarkers(rows: TableRows): TableRows {
  const { schema_migrations: _markers, ...rest } = rows;
  return rest;
}

/** The named tables only. A table that the upgrade dropped reads as undefined, so the comparison fails. */
function pick(rows: TableRows, tables: readonly string[]): Partial<TableRows> {
  return Object.fromEntries(tables.map((table) => [table, rows[table]]));
}

function historyObjects(db: DatabaseSync): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'provider_history_%' ORDER BY name")
    .all()
    .map((row) => String(row.name));
}

function maxVersion(db: DatabaseSync): SQLOutputValue {
  return db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()?.version ?? null;
}

function expectHealthyLatest(db: DatabaseSync): void {
  expect(maxVersion(db)).toBe(LATEST);
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
  expect(historyObjects(db)).toEqual(HISTORY_OBJECTS);
}

describe("migration 33: provider history tables", () => {
  // GoAhead 0.35.0 writes 31, GoAhead 0.31.0 to 0.34.0 write 28, 27 is the last schema shared with upstream, and 32
  // is the migration before this one.
  it.each([32, 31, 28, 27])("keeps every row of a v%i install and adds empty history tables", (version) => {
    const db = databaseAt(version);
    seedInstall(db, version);
    const before = withoutMarkers(allRows(db));
    expect(historyObjects(db)).toEqual([]);

    migrateOpenBotDatabase(db);

    expectHealthyLatest(db);
    const after = allRows(db);
    expect(pick(after, Object.keys(before))).toEqual(before);
    expect(pick(after, ["provider_history_imports", "provider_history_turns", "provider_history_staging"])).toEqual({
      provider_history_imports: [],
      provider_history_turns: [],
      provider_history_staging: [],
    });
  });

  // Smoke: every older shipped schema reaches the latest version with its conversation intact.
  it.each(Array.from({ length: 19 }, (_, index) => index + 8))("upgrades shipped schema %i", (version) => {
    const db = databaseAt(version);
    seedConversation(db);
    const tables = ["projection_threads", "projection_thread_messages", "projection_provider_sessions"];
    const before = pick(allRows(db), [...tables, "projection_turns"]);

    migrateOpenBotDatabase(db);

    expectHealthyLatest(db);
    expect(pick(allRows(db), [...tables, "projection_turns"])).toEqual(before);
  });

  it("rolls back the tables and the marker after a late failure, then retries", () => {
    const db = databaseAt(32);
    seedInstall(db, 32);
    const before = allRows(db);
    const beforeSchema = schema(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version = 33
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);

    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 33 failed");
    expect(allRows(db)).toEqual(before);
    expect(schema(db).filter((entry) => entry.name !== "fail_marker")).toEqual(beforeSchema);
    expect(historyObjects(db)).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });

    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expectHealthyLatest(db);
    expect(pick(allRows(db), Object.keys(withoutMarkers(before)))).toEqual(withoutMarkers(before));
  });

  it("stops at a taken index name with 29 to 32 committed, then retries", () => {
    // A 0.31.0 to 0.34.0 install runs 29 to 33 in one start. The tables use IF NOT EXISTS, so only an index name
    // can collide.
    const db = databaseAt(28);
    seedInstall(db, 28);
    db.exec("CREATE TABLE provider_history_imports_thread (squatter TEXT)");

    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 33 failed");
    expect(maxVersion(db)).toBe(32);
    expect(historyObjects(db)).toEqual(["provider_history_imports_thread"]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    const before = withoutMarkers(allRows(db));

    db.exec("DROP TABLE provider_history_imports_thread");
    migrateOpenBotDatabase(db);
    expectHealthyLatest(db);
    const { provider_history_imports_thread: _squatter, ...kept } = before;
    expect(pick(allRows(db), Object.keys(kept))).toEqual(kept);
  });

  it("refuses a database from a newer GoAhead and changes nothing", () => {
    const db = databaseAt(32);
    seedInstall(db, 32);
    migrateOpenBotDatabase(db);
    db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(LATEST + 1, STAMP);
    const before = allRows(db);
    const beforeSchema = schema(db);

    expect(() => migrateOpenBotDatabase(db)).toThrow(`newer than this application supports (${LATEST})`);
    expect(allRows(db)).toEqual(before);
    expect(schema(db)).toEqual(beforeSchema);
  });

  it("refuses a v33 database whose history lost version 32 and changes nothing", () => {
    const db = databaseAt(32);
    seedInstall(db, 32);
    migrateOpenBotDatabase(db);
    db.prepare("DELETE FROM schema_migrations WHERE version = 32").run();
    const before = allRows(db);

    expect(() => migrateOpenBotDatabase(db)).toThrow("migration history is missing version 32");
    expect(allRows(db)).toEqual(before);
  });

  it("removes the import, turn and staging rows of a deleted thread", () => {
    const db = databaseAt(32);
    seedConversation(db);
    migrateOpenBotDatabase(db);
    db.prepare(
      `INSERT INTO provider_history_imports (session_id, thread_id, provider, external_session_id, cursor_json, state,
         created_at, updated_at) VALUES ('session-1', 'thread-writer', 'codex', 'codex-external', NULL, 'active', ?, ?)`,
    ).run(STAMP, STAMP);
    db.prepare(
      `INSERT INTO provider_history_turns (session_id, turn_id, turn_status, turn_started_at, complete, imported,
         updated_at) VALUES ('session-1', 'turn-1', 'completed', 1, 1, 0, ?)`,
    ).run(STAMP);
    db.prepare(
      `INSERT INTO provider_history_staging (session_id, turn_id, item_key, item_index, item_json, imported, updated_at)
       VALUES ('session-1', 'turn-1', 'item-1', 0, '{"type":"agentMessage"}', 0, ?)`,
    ).run(STAMP);
    expect(() =>
      db
        .prepare(
          `INSERT INTO provider_history_imports (session_id, thread_id, provider, external_session_id, cursor_json,
           state, created_at, updated_at) VALUES ('orphan', 'thread-missing', 'codex', 'other', NULL, 'active', ?, ?)`,
        )
        .run(STAMP, STAMP),
    ).toThrow(/FOREIGN KEY constraint failed/u);

    db.prepare("DELETE FROM projection_threads WHERE thread_id = 'thread-writer'").run();

    expect(
      pick(allRows(db), ["provider_history_imports", "provider_history_turns", "provider_history_staging"]),
    ).toEqual({ provider_history_imports: [], provider_history_turns: [], provider_history_staging: [] });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("keeps every saved row and its attachments when the first import after the upgrade runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "goahead-provider-history-"));
    roots.push(root);
    const agent: AgentSummary = {
      id: "chief",
      provider: "codex",
      name: "Chief",
      title: "Coordinator",
      description: "",
      notifications: true,
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
      threadId: "openbot-thread-chief",
      workspacePath: "/tmp/openbot-chief",
      preview: "42",
      updatedAt: "2026-08-18T10:00:01.000Z",
      avatarSeed: "chief",
      avatarHue: null,
      avatarUrl: null,
    };
    const threadId = "openbot-thread-chief";
    const attachment = {
      id: "kept-attachment",
      name: "notes.txt",
      size: 5,
      kind: "file" as const,
      mimeType: "text/plain",
      previewKind: "text" as const,
      previewUrl: null,
    };
    const messages: ConversationMessage[] = [
      { id: "old-user", author: "user", text: "Earlier", createdAt: STAMP, status: "completed" },
      {
        id: "provider-answer",
        turnId: "provider-turn",
        author: "assistant",
        text: "Before",
        createdAt: "2026-10-01T07:00:01.000Z",
        status: "completed",
        attachments: [attachment],
      },
    ];
    const created = new OpenBotDatabase(root);
    await created.initialize();
    created.replaceAgents("provider-history-agent", [agent], "agents.imported");
    created.persistConversation(
      { agentId: agent.id, threadId, activeTurnId: null, revision: 0, messages },
      "conversation.seeded",
    );
    const session = created.bindProviderSession({
      threadId,
      provider: "codex",
      externalSessionId: "provider-history-thread",
      model: agent.model,
      effort: agent.reasoningEffort,
    });
    created.close();
    // Migrations 33 to 35 only add objects, so taking them and the markers away gives the v32 shape of this install.
    const legacy = new DatabaseSync(join(root, "openbot.db"));
    databases.push(legacy);
    legacy.exec(`DROP TABLE provider_history_staging; DROP TABLE provider_history_turns;
      DROP TABLE provider_history_imports; DROP TABLE routine_flow_steps; DROP TABLE routine_flow_links;
      DROP TABLE routine_flow_positions; DROP TRIGGER agent_memory_insert; DROP TRIGGER agent_memory_update;
      DROP TRIGGER agent_memory_delete; DROP TABLE agent_memory_search; DROP TABLE agent_memory_selections;
      DELETE FROM schema_migrations WHERE version IN (33, 34, 35);`);
    legacy.close();

    const database = new OpenBotDatabase(root);
    await database.initialize();
    try {
      expect(maxVersion(database.connection)).toBe(LATEST);
      const result = await importProviderHistory({
        database,
        readHistory: async (_request, consume) => {
          // One page of the provider turn, then the rest of it. The page carries none of the saved rows.
          await consume({
            turnId: "provider-turn",
            status: "completed",
            items: [{ id: "provider-answer", type: "agentMessage", text: "After" }],
            complete: false,
          });
          await consume({ turnId: "provider-turn", status: "completed", items: [], complete: true });
        },
        sessionId: session.id,
        provider: "codex",
        externalSessionId: session.externalSessionId,
        agentId: agent.id,
        publicThreadId: threadId,
        findDelivery: () => null,
      });

      expect(result).toEqual({ turns: 1, messages: 1 });
      expect(database.providerHistoryImport(session.id)?.state).toBe("complete");
      expect(database.readConversation(agent.id, threadId).messages).toEqual([
        expect.objectContaining({ id: "old-user", text: "Earlier" }),
        expect.objectContaining({ id: "provider-answer", text: "After", attachments: [attachment] }),
      ]);
      expect(database.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      database.close();
    }
  });
});
