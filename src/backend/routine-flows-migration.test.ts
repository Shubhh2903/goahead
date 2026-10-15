// @vitest-environment node
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Migration 34 (upstream OpenBot migration 31): the routine flow tables. GoAhead leaves out upstream 30 (webhooks);
// no flow column refers to a webhook table. Failure modes, one test each:
// - an upgrade from a shipped or chained schema (33, 32, 31, 28, 27, and 8 to 26) loses or changes a row;
// - the upgrade leaves foreign keys off, an orphan row, or a database that fails `quick_check`;
// - a late failure leaves a flow table, an index or the marker, or changes a row;
// - a taken index name stops a multi-step upgrade in a state that a retry cannot finish;
// - a newer or incomplete history is changed or accepted;
// - a deleted routine or run leaves links or steps behind, or a step can point at a missing run.

const LATEST = 35;
const STAMP = "2026-10-01T07:00:00.000Z";
const FLOW_OBJECTS = [
  "routine_flow_links",
  "routine_flow_links_to",
  "routine_flow_positions",
  "routine_flow_steps",
  "routine_flow_steps_agent",
  "routine_flow_steps_delivery",
];

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) if (db.isOpen) db.close();
});

/**
 * The real shape of an install at `version`: the migrations run until a stop trigger aborts the next marker.
 * Migrations up to 33 are frozen, so this is what an upgraded user database holds.
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

/** An agent routine with a trigger and runs in every status: the rows the flow tables point at. */
function seedRoutines(db: DatabaseSync, withLimitPolicy: boolean): void {
  db.prepare(
    `INSERT INTO projection_agent_routines (routine_id, agent_id, name, instruction, active, timezone, created_at,
       updated_at, last_event_sequence${withLimitPolicy ? ", limit_policy" : ""})
     VALUES ('routine-1', 'writer', 'Morning brief', 'Collect the news.', 1, 'Europe/Warsaw', ?, ?, 7
       ${withLimitPolicy ? ", 'skip'" : ""})`,
  ).run(STAMP, STAMP);
  db.prepare(
    `INSERT INTO projection_routine_triggers (trigger_id, routine_id, schedule_json, next_run_at, created_at,
       updated_at, last_event_sequence)
     VALUES ('trigger-1', 'routine-1', '{"kind":"daily","time":"09:00"}', '2026-10-02T07:00:00.000Z', ?, ?, 8)`,
  ).run(STAMP, STAMP);
  const statuses = ["queued", "running", "needs-attention", "succeeded", "failed", "interrupted", "cancelled"];
  for (const [index, status] of statuses.entries()) {
    db.prepare(
      `INSERT INTO projection_routine_runs (run_id, routine_id, agent_id, trigger_id, run_kind, scheduled_for,
         routine_name, instruction, delivery_id, status, error, created_at, updated_at, last_event_sequence)
       VALUES (?, 'routine-1', 'writer', 'trigger-1', 'scheduled', ?, 'Morning brief', 'Collect the news.', ?, ?, ?,
         ?, ?, ?)`,
    ).run(
      `run-${status}`,
      `2026-10-0${index + 1}T07:00:00.000Z`,
      `delivery-${status}`,
      status,
      status === "failed" ? "Provider error" : null,
      STAMP,
      STAMP,
      9 + index,
    );
  }
}

/** Everything a GoAhead user at `version` can have: the conversation, memories, routines and Slack data. */
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
  seedRoutines(db, version >= 27);
  db.prepare(
    `INSERT INTO projection_messaging_connections (connection_id, platform, workspace_id, workspace_name, enabled,
       bot_user_id, app_id, orchestrator_agent_id, last_error_code, created_at, updated_at)
     VALUES ('connection-1', 'slack', 'T1', 'Acme', 1, 'U-BOT', 'A1', 'writer', NULL, ?, ?)`,
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
  if (version >= 31) {
    db.prepare(
      `INSERT INTO projection_messaging_auto_reply (connection_id, platform_channel_id, created_at)
       VALUES ('connection-1', 'D1', ?)`,
    ).run(STAMP);
  }
  if (version >= 33) {
    db.prepare(
      `INSERT INTO provider_history_imports (session_id, thread_id, provider, external_session_id, cursor_json, state,
         created_at, updated_at) VALUES ('session-1', 'thread-writer', 'codex', 'codex-external', NULL, 'active', ?, ?)`,
    ).run(STAMP, STAMP);
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

function flowObjects(db: DatabaseSync): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'routine_flow_%' ORDER BY name")
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
  expect(flowObjects(db)).toEqual(FLOW_OBJECTS);
}

describe("migration 34: routine flow tables", () => {
  // GoAhead 0.35.0 writes 31, GoAhead 0.31.0 to 0.34.0 write 28, 27 is the last schema shared with upstream, and
  // 32 and 33 are the unreleased migrations before this one.
  it.each([33, 32, 31, 28, 27])("keeps every row of a v%i install and adds empty flow tables", (version) => {
    const db = databaseAt(version);
    seedInstall(db, version);
    const before = withoutMarkers(allRows(db));
    expect(flowObjects(db)).toEqual([]);

    migrateOpenBotDatabase(db);

    expectHealthyLatest(db);
    const after = allRows(db);
    expect(pick(after, Object.keys(before))).toEqual(before);
    expect(pick(after, ["routine_flow_links", "routine_flow_positions", "routine_flow_steps"])).toEqual({
      routine_flow_links: [],
      routine_flow_positions: [],
      routine_flow_steps: [],
    });
  });

  // Smoke: every older shipped schema reaches the latest version with its conversation and routines intact.
  it.each(Array.from({ length: 19 }, (_, index) => index + 8))("upgrades shipped schema %i", (version) => {
    const db = databaseAt(version);
    seedConversation(db);
    seedRoutines(db, false);
    const tables = [
      "projection_threads",
      "projection_thread_messages",
      "projection_provider_sessions",
      "projection_turns",
      "projection_routine_triggers",
      "projection_routine_runs",
    ];
    const before = allRows(db);

    migrateOpenBotDatabase(db);

    expectHealthyLatest(db);
    const after = allRows(db);
    expect(pick(after, tables)).toEqual(pick(before, tables));
    // Migration 27 adds `limit_policy` with its default; every other column stays as it was.
    expect(after.projection_agent_routines?.map(({ limit_policy: _policy, ...row }) => row)).toEqual(
      before.projection_agent_routines,
    );
  });

  it("rolls back the tables, the indexes and the marker after a late failure, then retries", () => {
    const db = databaseAt(33);
    seedInstall(db, 33);
    const before = allRows(db);
    const beforeSchema = schema(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version = 34
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);

    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 34 failed");
    expect(allRows(db)).toEqual(before);
    expect(schema(db).filter((entry) => entry.name !== "fail_marker")).toEqual(beforeSchema);
    expect(flowObjects(db)).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });

    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expectHealthyLatest(db);
    expect(pick(allRows(db), Object.keys(withoutMarkers(before)))).toEqual(withoutMarkers(before));
  });

  it("stops at a taken index name with 29 to 33 committed, then retries", () => {
    // A 0.31.0 to 0.34.0 install runs 29 to 34 in one start. The tables use IF NOT EXISTS, so only an index name
    // can collide.
    const db = databaseAt(28);
    seedInstall(db, 28);
    db.exec("CREATE TABLE routine_flow_links_to (squatter TEXT)");

    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 34 failed");
    expect(maxVersion(db)).toBe(33);
    expect(flowObjects(db)).toEqual(["routine_flow_links_to"]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(db.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
    const before = withoutMarkers(allRows(db));

    db.exec("DROP TABLE routine_flow_links_to");
    migrateOpenBotDatabase(db);
    expectHealthyLatest(db);
    const { routine_flow_links_to: _squatter, ...kept } = before;
    expect(pick(allRows(db), Object.keys(kept))).toEqual(kept);
  });

  it("refuses a database from a newer GoAhead and changes nothing", () => {
    const db = databaseAt(33);
    seedInstall(db, 33);
    migrateOpenBotDatabase(db);
    db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(LATEST + 1, STAMP);
    const before = allRows(db);
    const beforeSchema = schema(db);

    expect(() => migrateOpenBotDatabase(db)).toThrow(`newer than this application supports (${LATEST})`);
    expect(allRows(db)).toEqual(before);
    expect(schema(db)).toEqual(beforeSchema);
  });

  it("refuses a v34 database whose history lost version 33 and changes nothing", () => {
    const db = databaseAt(33);
    seedInstall(db, 33);
    migrateOpenBotDatabase(db);
    db.prepare("DELETE FROM schema_migrations WHERE version = 33").run();
    const before = allRows(db);
    const beforeSchema = schema(db);

    expect(() => migrateOpenBotDatabase(db)).toThrow("migration history is missing version 33");
    expect(allRows(db)).toEqual(before);
    expect(schema(db)).toEqual(beforeSchema);
  });

  it("removes the links of a deleted routine and the steps of a deleted run, and refuses an orphan", () => {
    const db = databaseAt(33);
    seedInstall(db, 33);
    migrateOpenBotDatabase(db);
    db.prepare(
      `INSERT INTO routine_flow_links (link_id, routine_id, from_agent_id, to_agent_id, instruction, created_at)
       VALUES ('link-1', 'routine-1', 'writer', 'editor', 'Edit it.', ?)`,
    ).run(STAMP);
    for (const [stepId, runId] of [
      ["step-1", "run-succeeded"],
      ["step-2", "run-failed"],
    ] as const) {
      db.prepare(
        `INSERT INTO routine_flow_steps (step_id, run_id, agent_id, delivery_id, input, status, created_at, updated_at)
         VALUES (?, ?, 'editor', ?, 'Writer answered.', 'running', ?, ?)`,
      ).run(stepId, runId, `handoff-${stepId}`, STAMP, STAMP);
    }
    expect(() =>
      db
        .prepare(
          `INSERT INTO routine_flow_steps (step_id, run_id, agent_id, input, status, created_at, updated_at)
           VALUES ('orphan', 'run-missing', 'editor', '', 'running', ?, ?)`,
        )
        .run(STAMP, STAMP),
    ).toThrow(/FOREIGN KEY constraint failed/u);
    expect(() =>
      db
        .prepare(
          `INSERT INTO routine_flow_links (link_id, routine_id, from_agent_id, to_agent_id, created_at)
           VALUES ('orphan', 'routine-missing', 'writer', 'editor', ?)`,
        )
        .run(STAMP),
    ).toThrow(/FOREIGN KEY constraint failed/u);

    db.prepare("DELETE FROM projection_routine_runs WHERE run_id = 'run-failed'").run();
    expect(db.prepare("SELECT step_id FROM routine_flow_steps").all()).toEqual([{ step_id: "step-1" }]);

    db.prepare("DELETE FROM projection_agent_routines WHERE routine_id = 'routine-1'").run();
    expect(db.prepare("SELECT link_id FROM routine_flow_links").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
