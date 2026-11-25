// @vitest-environment node
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: an upgrade loses a routine or its trigger; an old routine gets a run condition and so
// stops starting its agent; a retry adds a column twice; the CHECK accepts text that is not JSON.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

/** The agent routine tables are the v8 baseline's. Migration 19 added the channel ones. */
const CHANNEL_ROUTINES_SINCE = 19;

function databaseAt(version: number): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TEMP TRIGGER stop_at_version BEFORE INSERT ON schema_migrations WHEN new.version > ${version}
    BEGIN SELECT RAISE(ABORT, 'fixture stop'); END;`);
  expect(() => migrateOpenBotDatabase(db)).toThrow(`migration to version ${version + 1} failed`);
  db.exec("DROP TRIGGER stop_at_version");
  return db;
}

/** One active routine with its trigger per owner kind, in the columns every release has. */
function seedRoutines(db: DatabaseSync, version: number): string[] {
  const stamp = "2026-11-01T07:00:00.000Z";
  const owners = [
    { routines: "projection_agent_routines", triggers: "projection_routine_triggers", owner: "agent_id" },
    ...(version >= CHANNEL_ROUTINES_SINCE
      ? [
          {
            routines: "projection_channel_routines",
            triggers: "projection_channel_routine_triggers",
            owner: "channel_id",
          },
        ]
      : []),
  ];
  if (version >= CHANNEL_ROUTINES_SINCE) {
    db.prepare("INSERT INTO projection_channels(channel_id, channel_json) VALUES ('owner', '{}')").run();
  }
  for (const [index, table] of owners.entries()) {
    db.prepare(
      `INSERT INTO ${table.routines} (routine_id, ${table.owner}, name, instruction, active, timezone, created_at,
         updated_at, last_event_sequence) VALUES (?, 'owner', 'Release watch', 'Summarise new commits.', 1,
         'Asia/Kolkata', ?, ?, 1)`,
    ).run(`routine-${index}`, stamp, stamp);
    db.prepare(
      `INSERT INTO ${table.triggers} (trigger_id, routine_id, schedule_json, next_run_at, created_at, updated_at,
         last_event_sequence) VALUES (?, ?, '{"kind":"daily","time":"09:00"}', '2026-11-02T03:30:00.000Z', ?, ?, 2)`,
    ).run(`trigger-${index}`, `routine-${index}`, stamp, stamp);
  }
  return owners.flatMap((table) => [table.routines, table.triggers]);
}

function rows(db: DatabaseSync, tables: readonly string[]): Record<string, Record<string, SQLOutputValue>[]> {
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}

/** What any upgrade adds to an old routine row. Earlier migrations add their own policies. */
function upgraded(before: Record<string, Record<string, SQLOutputValue>[]>) {
  return Object.fromEntries(
    Object.entries(before).map(([table, tableRows]) => [
      table,
      tableRows.map((row) =>
        table.endsWith("_routines")
          ? {
              limit_policy: "wait",
              missed_policy: "skip",
              ...row,
              run_condition: null,
              run_condition_fingerprint: null,
              ...(table === "projection_agent_routines" ? { run_in: "chat" } : {}),
            }
          : row,
      ),
    ]),
  );
}

describe("routine run condition migration", () => {
  it.each(Array.from({ length: 29 }, (_, index) => index + 8))(
    "keeps every routine and trigger from released schema %i, with no run condition",
    (version) => {
      const db = databaseAt(version);
      const tables = seedRoutines(db, version);
      const before = rows(db, tables);
      migrateOpenBotDatabase(db);
      expect(rows(db, tables)).toEqual(upgraded(before));
      expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 74 });
      expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    },
  );

  it("adds the columns once when a profile already has them", () => {
    const db = databaseAt(36);
    db.exec(`ALTER TABLE projection_agent_routines ADD COLUMN run_condition TEXT;
      ALTER TABLE projection_channel_routines ADD COLUMN run_condition_fingerprint TEXT;`);
    migrateOpenBotDatabase(db);
    for (const table of ["projection_agent_routines", "projection_channel_routines"]) {
      const names = db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((column) => column.name);
      expect(names.filter((name) => name === "run_condition")).toHaveLength(1);
      expect(names.filter((name) => name === "run_condition_fingerprint")).toHaveLength(1);
    }
  });

  it("leaves no column and no changed row behind when the migration fails, and succeeds on retry", () => {
    const db = databaseAt(36);
    const tables = seedRoutines(db, 36);
    const before = rows(db, tables);
    db.exec(`CREATE TEMP TRIGGER fail_v37 BEFORE INSERT ON schema_migrations WHEN new.version = 37
      BEGIN SELECT RAISE(ABORT, 'injected failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 37 failed");
    // Rolled back: the columns and the version marker are gone, and every row is as it was.
    for (const table of ["projection_agent_routines", "projection_channel_routines"]) {
      const names = db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((column) => column.name);
      expect(names).not.toContain("run_condition");
      expect(names).not.toContain("run_condition_fingerprint");
    }
    expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 36 });
    expect(rows(db, tables)).toEqual(before);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });

    db.exec("DROP TRIGGER fail_v37");
    migrateOpenBotDatabase(db);
    expect(rows(db, tables)).toEqual(upgraded(before));
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("stores only a run condition that is JSON", () => {
    const db = databaseAt(36);
    const tables = seedRoutines(db, 36);
    migrateOpenBotDatabase(db);
    const condition = JSON.stringify({ command: "git log -1 --format=%H", when: "output-changes" });
    for (const table of tables.filter((name) => name.endsWith("_routines"))) {
      db.prepare(`UPDATE ${table} SET run_condition = ?`).run(condition);
      expect(() => db.prepare(`UPDATE ${table} SET run_condition = 'not json'`).run()).toThrow(
        /CHECK constraint failed/u,
      );
      expect(db.prepare(`SELECT run_condition FROM ${table}`).get()).toEqual({ run_condition: condition });
    }
  });
});
