import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord } from "./runtime-values";

// GoAhead migration 37: the optional run condition of a routine (a shell command the host runs before a scheduled
// run) and the fingerprint of its last output. Frozen with the migration.
export const V37_ROUTINE_RUN_CONDITION_COLUMNS_SQL = [
  "run_condition TEXT CHECK(run_condition IS NULL OR (json_valid(run_condition) AND length(run_condition) <= 4096))",
  "run_condition_fingerprint TEXT",
];

function addRoutineRunConditions(db: DatabaseSync): void {
  for (const table of ["projection_agent_routines", "projection_channel_routines"]) {
    for (const column of V37_ROUTINE_RUN_CONDITION_COLUMNS_SQL) {
      const name = column.slice(0, column.indexOf(" "));
      // A development profile that ran this version before it shipped has the column already.
      const columns = db.prepare(`PRAGMA table_info(${table})`).all();
      if (columns.some((existing) => isDynamicRecord(existing) && existing.name === name)) continue;
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`);
    }
  }
}

export const migration: OpenBotMigration = {
  version: 37,
  name: "routine-run-conditions",
  // Adds two nullable columns with no default to the two routine tables: no rebuild, so no foreign-key pause and
  // no vacuum. Every existing routine has no run condition, so each scheduled run starts the agent.
  up: addRoutineRunConditions,
};
