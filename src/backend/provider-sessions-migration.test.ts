// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import type { AgentProviderId } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { afterEach, describe, expect, it } from "vitest";
import { OpenBotDatabase } from "./openbot-database";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Migration 32 (upstream OpenBot migration 28) and the lineage guard. Failure modes, one test each:
// - an upgrade from a shipped schema (31, 28, 27, and 8 to 26) loses or changes a row;
// - the rebuild with foreign keys on sets `projection_turns.provider_session_id` to NULL;
// - one of the shipped provider CHECK variants (v8, v17, v22, v23, v24, v26) does not upgrade;
// - the new table still rejects a provider that a later release adds (`pi`, `muse`);
// - the new table loses the state CHECK, the UNIQUE or the thread index;
// - with no CHECK, an unknown provider writes an event or a row;
// - a failure leaves a part of the migration, the staging table, or foreign keys off;
// - a retry after a failure does not finish the upgrade;
// - a newer or incomplete history is changed or accepted;
// - a database that upstream OpenBot wrote is migrated as a GoAhead database;
// - the lineage guard stops a real GoAhead database.

const LATEST = 36;
const STAMP = "2026-10-01T07:00:00.000Z";

const roots: string[] = [];
const databases: DatabaseSync[] = [];

afterEach(async () => {
  for (const db of databases.splice(0)) if (db.isOpen) db.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "goahead-provider-sessions-"));
  roots.push(root);
  return root;
}

/**
 * The real shipped shape of an install at `version`: the migrations run until a stop trigger aborts the next
 * marker. Migrations up to 31 are frozen, so this is what an upgraded user database holds.
 */
function databaseAt(version: number, path = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(path);
  databases.push(db);
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TEMP TRIGGER stop_at_version BEFORE INSERT ON schema_migrations WHEN new.version > ${version}
    BEGIN SELECT RAISE(ABORT, 'fixture stop'); END;`);
  expect(() => migrateOpenBotDatabase(db)).toThrow(`migration to version ${version + 1} failed`);
  db.exec("DROP TRIGGER stop_at_version");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

/** The providers that the provider CHECK of each shipped schema allows. */
function providersAt(version: number): readonly string[] {
  const providers = ["codex", "claude", "grok"];
  if (version >= 17) providers.push("opencode");
  if (version >= 22) providers.push("antigravity");
  if (version >= 23) providers.push("acp");
  if (version >= 24) providers.push("cursor");
  if (version >= 26) providers.push("cline");
  return providers;
}

/** The provider CHECK line of each shipped schema, as the migration that wrote it spelled it. */
function providerCheckAt(version: number): string {
  return `CHECK(provider IN (${providersAt(version)
    .map((provider) => `'${provider}'`)
    .join(", ")}))`;
}

/**
 * One thread with a message, one inactive provider session for each provider that the schema allows, and one
 * turn linked to each session. Inactive, so the migrations 9 to 14 that mark active sessions inactive do not
 * change a row of an older source.
 */
function seedSessions(db: DatabaseSync, version: number): void {
  db.prepare(
    `INSERT INTO projection_threads (thread_id, agent_id, title, active_turn_id, created_at, updated_at,
       last_event_sequence) VALUES ('thread-writer', 'writer', 'Writer', NULL, ?, ?, 1)`,
  ).run(STAMP, STAMP);
  db.prepare(
    `INSERT INTO projection_thread_messages (thread_id, message_id, turn_id, author, status, item_type, created_at,
       ordinal, message_json, last_event_sequence)
     VALUES ('thread-writer', 'message-1', 'turn-codex', 'user', 'complete', NULL, ?, 0, ?, 2)`,
  ).run(STAMP, JSON.stringify({ text: "Zażółć gęślą jaźń 漢字" }));
  const session = db.prepare(
    `INSERT INTO projection_provider_sessions (id, thread_id, provider, external_session_id, model, effort, state,
       created_at, updated_at, resume_cursor, last_event_sequence)
     VALUES (?, 'thread-writer', ?, ?, ?, 'medium', 'inactive', ?, ?, ?, 3)`,
  );
  const turn = db.prepare(
    `INSERT INTO projection_turns (turn_id, thread_id, provider_session_id, status, started_at, completed_at,
       last_event_sequence) VALUES (?, 'thread-writer', ?, 'completed', ?, ?, 4)`,
  );
  for (const provider of providersAt(version)) {
    session.run(
      `session-${provider}`,
      provider,
      `${provider}-external`,
      `${provider}-model`,
      STAMP,
      STAMP,
      `${provider}-cursor`,
    );
    turn.run(`turn-${provider}`, `session-${provider}`, STAMP, STAMP);
  }
}

/** Everything a GoAhead 0.31.0 to 0.35.0 user can have: sessions, memories, routines and Slack data. */
function seedInstall(db: DatabaseSync, version: number): void {
  seedSessions(db, version);
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
    `INSERT INTO projection_threads (thread_id, agent_id, title, active_turn_id, created_at, updated_at,
       last_event_sequence) VALUES ('thread-slack', 'writer', 'Slack', NULL, ?, ?, 10)`,
  ).run(STAMP, STAMP);
  db.prepare(
    `INSERT INTO projection_messaging_connections (connection_id, platform, workspace_id, workspace_name, enabled,
       bot_user_id, app_id, orchestrator_agent_id, last_error_code, created_at, updated_at)
     VALUES ('connection-1', 'slack', 'T1', 'Acme', 1, 'U-BOT', 'A1', 'writer', NULL, ?, ?)`,
  ).run(STAMP, STAMP);
  db.prepare(
    `INSERT INTO projection_messaging_threads (link_id, connection_id, agent_id, platform_channel_id, thread_key,
       is_direct, thread_id, title, history_cursor, created_at, updated_at)
     VALUES ('link-1', 'connection-1', 'writer', 'C1', '1700000000.000100', 0, 'thread-slack', '#general', NULL, ?, ?)`,
  ).run(STAMP, STAMP);
  if (version >= 28) {
    db.prepare(
      `INSERT INTO projection_messaging_inbox (connection_id, platform_channel_id, platform_message_id, thread_key,
         kind, author_id, author_name, text, sent_at)
       VALUES ('connection-1', 'D1', '1700000000.000200', NULL, 'direct', 'U2', 'Ada', 'Cześć!', ?)`,
    ).run(STAMP);
    db.prepare(
      `INSERT INTO projection_messaging_watched_channels (connection_id, platform_channel_id, name, created_at)
       VALUES ('connection-1', 'C1', 'general', ?)`,
    ).run(STAMP);
    db.prepare(
      `INSERT INTO projection_messaging_inbox_reads (connection_id, platform_channel_id, through_message_id,
         updated_at) VALUES ('connection-1', 'D1', '1700000000.000200', ?)`,
    ).run(STAMP);
  }
  if (version >= 29) {
    db.prepare(
      `INSERT INTO slack_conversations (connection_id, channel_id, kind, name, member_ids_json, is_member,
         last_read_ts, unread_count, last_activity_ts, last_opened_at, oldest_loaded_ts, newest_loaded_ts,
         has_more_history, updated_at)
       VALUES ('connection-1', 'C1', 'channel', 'general', '["U2"]', 1, NULL, 2, '1700000000.000300', NULL, NULL,
         NULL, 1, ?)`,
    ).run(STAMP);
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

/** Every row of every table, in a stable order. A rebuild can change the rowid order, not the rows. */
/**
 * Migration 36 adds these columns to the routine and run rows, and `routine-missed-runs-migration.test.ts` checks
 * them, so the row comparisons here leave them out.
 */
const MISSED_RUN_COLUMNS = new Set(["missed_policy", "missed_count", "missed_until"]);

function withoutMissedRunColumns(row: Record<string, SQLOutputValue>): Record<string, SQLOutputValue> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !MISSED_RUN_COLUMNS.has(key)));
}

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
        .map(withoutMissedRunColumns)
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

function providerSessionsSql(db: DatabaseSync): string {
  return String(
    db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'projection_provider_sessions'").get()
      ?.sql,
  );
}

function expectHealthyLatest(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: LATEST });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
}

/** The new table keeps every other constraint and the index, and takes a provider that a later release adds. */
function expectOpenProviderTable(db: DatabaseSync): void {
  expect(providerSessionsSql(db)).not.toContain("CHECK(provider");
  expect(
    db
      .prepare("PRAGMA index_info(provider_sessions_thread)")
      .all()
      .map((column) => column.name),
  ).toEqual(["thread_id", "provider", "state"]);
  const insert = db.prepare(
    `INSERT INTO projection_provider_sessions (id, thread_id, provider, external_session_id, model, effort, state,
       created_at, updated_at, resume_cursor, last_event_sequence)
     VALUES (?, 'thread-writer', ?, ?, 'model', 'medium', ?, ?, ?, NULL, 0)`,
  );
  expect(() => insert.run("session-pi", "pi", "pi-external", "inactive", STAMP, STAMP)).not.toThrow();
  expect(() => insert.run("session-muse", "muse", "muse-external", "active", STAMP, STAMP)).not.toThrow();
  expect(() => insert.run("session-bad-state", "codex", "other-external", "paused", STAMP, STAMP)).toThrow(
    /CHECK constraint failed/u,
  );
  expect(() => insert.run("session-duplicate", "codex", "codex-external", "inactive", STAMP, STAMP)).toThrow(
    /UNIQUE constraint failed/u,
  );
}

describe("migration 32: provider sessions without a provider CHECK", () => {
  // GoAhead 0.35.0 writes 31, GoAhead 0.31.0 to 0.34.0 write 28, and 27 is the last schema shared with upstream.
  it.each([31, 28, 27])("keeps every row of a shipped v%i install", (version) => {
    const db = databaseAt(version);
    seedInstall(db, version);
    expect(providerSessionsSql(db)).toContain(providerCheckAt(version));
    const before = withoutMarkers(allRows(db));

    migrateOpenBotDatabase(db);

    expectHealthyLatest(db);
    expect(pick(allRows(db), Object.keys(before))).toEqual(before);
    // With foreign keys on, the DROP in the rebuild would set each link to NULL.
    expect(db.prepare("SELECT turn_id, provider_session_id FROM projection_turns ORDER BY turn_id").all()).toEqual(
      [...providersAt(version)]
        .sort()
        .map((provider) => ({ turn_id: `turn-${provider}`, provider_session_id: `session-${provider}` })),
    );
    expectOpenProviderTable(db);
  });

  // Smoke: every older shipped schema reaches the latest version. Together with the loop above this covers
  // every shipped provider CHECK: v8 (8 to 16), v17 (17 to 21), v22, v23, v24 (24 to 25) and v26 (26 to 31).
  it.each(Array.from({ length: 19 }, (_, index) => index + 8))(
    "keeps every provider session and turn link of shipped schema %i",
    (version) => {
      const db = databaseAt(version);
      seedSessions(db, version);
      expect(providerSessionsSql(db)).toContain(providerCheckAt(version));
      const tables = ["projection_provider_sessions", "projection_turns", "projection_thread_messages"];
      const before = pick(allRows(db), tables);

      migrateOpenBotDatabase(db);

      expectHealthyLatest(db);
      expect(pick(allRows(db), tables)).toEqual(before);
      expectOpenProviderTable(db);
    },
  );

  it("rolls back the rebuild and the marker after a late failure, then retries", () => {
    const db = databaseAt(31);
    seedInstall(db, 31);
    const before = allRows(db);
    const beforeSchema = schema(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version = 32
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);

    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 32 failed");
    expect(allRows(db)).toEqual(before);
    expect(schema(db).filter((entry) => entry.name !== "fail_marker")).toEqual(beforeSchema);
    expect(providerSessionsSql(db)).toContain(providerCheckAt(31));
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expectHealthyLatest(db);
    expect(pick(allRows(db), Object.keys(withoutMarkers(before)))).toEqual(withoutMarkers(before));
    expectOpenProviderTable(db);
  });

  it("rolls back when the staging table name is taken, then retries", () => {
    const db = databaseAt(28);
    seedInstall(db, 28);
    // Migrations 29 to 31 run first and commit; only 32 fails.
    db.exec("CREATE TABLE projection_provider_sessions_v32 (squatter TEXT)");

    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 32 failed");
    expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 31 });
    expect(providerSessionsSql(db)).toContain(providerCheckAt(28));
    expect(db.prepare("SELECT COUNT(*) AS count FROM projection_provider_sessions").get()).toEqual({
      count: providersAt(28).length,
    });
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM projection_turns WHERE provider_session_id IS NOT NULL").get(),
    ).toEqual({ count: providersAt(28).length });
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    const before = withoutMarkers(allRows(db));

    db.exec("DROP TABLE projection_provider_sessions_v32");
    migrateOpenBotDatabase(db);
    expectHealthyLatest(db);
    const { projection_provider_sessions_v32: _squatter, ...kept } = before;
    expect(pick(allRows(db), Object.keys(kept))).toEqual(kept);
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'projection_provider_sessions_v32'").get()).toBe(
      undefined,
    );
  });

  it("refuses a database from a newer GoAhead and changes nothing", () => {
    const db = databaseAt(31);
    seedInstall(db, 31);
    migrateOpenBotDatabase(db);
    db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(LATEST + 1, STAMP);
    const before = allRows(db);
    const beforeSchema = schema(db);

    expect(() => migrateOpenBotDatabase(db)).toThrow(`newer than this application supports (${LATEST})`);
    expect(allRows(db)).toEqual(before);
    expect(schema(db)).toEqual(beforeSchema);
  });

  it.each([27, 31])("refuses an upgraded database whose history lost version %i and changes nothing", (lost) => {
    const db = databaseAt(31);
    seedInstall(db, 31);
    migrateOpenBotDatabase(db);
    db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(lost);
    const before = allRows(db);

    expect(() => migrateOpenBotDatabase(db)).toThrow(`migration history is missing version ${lost}`);
    expect(allRows(db)).toEqual(before);
  });

  it("rejects an unknown provider before it writes an event or a row", async () => {
    const root = await tempRoot();
    const source = databaseAt(31, join(root, "openbot.db"));
    seedInstall(source, 31);
    source.close();

    const database = new OpenBotDatabase(root);
    await database.initialize();
    try {
      expect(providerSessionsSql(database.connection)).not.toContain("CHECK(provider");
      const events = database.connection.prepare("SELECT COUNT(*) AS count FROM orchestration_events").get();
      const sessions = database.listProviderSessions("thread-writer");
      // A provider string from outside the type system, such as an old settings file.
      const provider: AgentProviderId = JSON.parse('"gemini"');
      expect(() =>
        database.bindProviderSession({
          threadId: "thread-writer",
          provider,
          externalSessionId: "gemini-external",
          model: "model",
          effort: "medium",
        }),
      ).toThrow("Unknown provider for a provider session.");
      expect(database.connection.prepare("SELECT COUNT(*) AS count FROM orchestration_events").get()).toEqual(events);
      expect(database.listProviderSessions("thread-writer")).toEqual(sessions);

      const cline = database.bindProviderSession({
        threadId: "thread-writer",
        provider: "cline",
        externalSessionId: "cline-after-v32",
        model: "cline-model",
        effort: "medium",
      });
      expect(database.activeProviderSession("thread-writer", "cline")).toEqual(cline);
    } finally {
      database.close();
    }
  });
});

/**
 * An upstream OpenBot database: the shared schema up to 27, then upstream's own migrations. Upstream 28 removes the
 * provider CHECK, 29 to 31 add provider history, webhook and routine flow tables, 32 adds memory selection and 33
 * adds missed-run columns. Only the objects that matter here are made; GoAhead must not look further.
 */
function upstreamDatabaseAt(version: number, path = ":memory:"): DatabaseSync {
  const db = databaseAt(27, path);
  seedInstall(db, 27);
  const steps: Record<number, string> = {
    28: `PRAGMA foreign_keys = OFF;
      CREATE TABLE projection_provider_sessions_v28 (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES projection_threads(thread_id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        external_session_id TEXT NOT NULL,
        model TEXT NOT NULL,
        effort TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('active', 'inactive', 'failed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resume_cursor TEXT,
        last_event_sequence INTEGER NOT NULL,
        UNIQUE(provider, external_session_id)
      );
      INSERT INTO projection_provider_sessions_v28 SELECT * FROM projection_provider_sessions;
      DROP TABLE projection_provider_sessions;
      ALTER TABLE projection_provider_sessions_v28 RENAME TO projection_provider_sessions;
      CREATE INDEX provider_sessions_thread ON projection_provider_sessions(thread_id, provider, state);
      PRAGMA foreign_keys = ON;`,
    29: `CREATE TABLE provider_history_imports (
        thread_id TEXT NOT NULL REFERENCES projection_threads(thread_id) ON DELETE CASCADE, provider TEXT NOT NULL);`,
    30: "CREATE TABLE projection_webhook_receipts (receipt_id TEXT PRIMARY KEY, owner_kind TEXT NOT NULL);",
    31: "CREATE TABLE routine_flow_links (routine_id TEXT NOT NULL, from_agent_id TEXT NOT NULL);",
    32: "CREATE TABLE agent_memory_selections (memory_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL);",
    33: "ALTER TABLE projection_agent_routines ADD COLUMN missed_policy TEXT NOT NULL DEFAULT 'skip';",
  };
  for (let step = 28; step <= version; step += 1) {
    db.exec(steps[step] ?? "");
    db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(step, STAMP);
  }
  return db;
}

describe("lineage guard", () => {
  // 35 is above the latest GoAhead version: the person must see the lineage error, not the downgrade error.
  it.each([28, 29, 31, 33, 35])("stops on an upstream OpenBot database at v%i and changes nothing", (version) => {
    const db = upstreamDatabaseAt(version);
    const before = allRows(db);
    const beforeSchema = schema(db);

    expect(() => migrateOpenBotDatabase(db)).toThrow(sourceText("error.storage.upstreamDatabase"));
    expect(allRows(db)).toEqual(before);
    expect(schema(db)).toEqual(beforeSchema);
  });

  it("stops at startup on an upstream OpenBot file and leaves it unchanged", async () => {
    const root = await tempRoot();
    const source = upstreamDatabaseAt(31, join(root, "openbot.db"));
    const before = allRows(source);
    const beforeSchema = schema(source);
    source.close();

    const database = new OpenBotDatabase(root);
    await expect(database.initialize()).rejects.toThrow(
      "OpenBot made this database, not GoAhead. GoAhead cannot open it and did not change it.",
    );
    const reopened = new DatabaseSync(join(root, "openbot.db"));
    databases.push(reopened);
    expect(allRows(reopened)).toEqual(before);
    expect(schema(reopened)).toEqual(beforeSchema);
  });

  it.each([27, 28, 29, 30, 31, 32])("lets a GoAhead database at v%i through", (version) => {
    const db = databaseAt(version);
    seedInstall(db, version);
    expect(() => migrateOpenBotDatabase(db)).not.toThrow();
    expectHealthyLatest(db);
    // A second start meets an upgraded GoAhead database and runs nothing.
    const after = allRows(db);
    expect(() => migrateOpenBotDatabase(db)).not.toThrow();
    expect(allRows(db)).toEqual(after);
  });

  it("lets a new GoAhead database through on its next start", () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    db.exec("PRAGMA foreign_keys = ON");
    migrateOpenBotDatabase(db);
    expect(() => migrateOpenBotDatabase(db)).not.toThrow();
    expectHealthyLatest(db);
  });
});
