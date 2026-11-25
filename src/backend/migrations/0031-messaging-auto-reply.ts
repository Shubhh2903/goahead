import type { OpenBotMigration } from "./migration";

// GoAhead migration 31: the Slack auto-reply list. Frozen with the migration: the SQL is the text GoAhead shipped.
const V31_MESSAGING_AUTO_REPLY_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_messaging_auto_reply (
    connection_id TEXT NOT NULL REFERENCES projection_messaging_connections(connection_id) ON DELETE CASCADE,
    platform_channel_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(connection_id, platform_channel_id)
  );
`;

export const migration: OpenBotMigration = {
  version: 31,
  name: "messaging-auto-reply",
  // Only creates a table. The list starts empty, so every conversation still needs approval after the upgrade.
  up: (db) => db.exec(V31_MESSAGING_AUTO_REPLY_SCHEMA_SQL),
};
