import type { OpenBotMigration } from "./migration";

// GoAhead migration 28: the Slack inbox tables and index. Frozen with the migration: the SQL is the text GoAhead shipped.
const V28_MESSAGING_INBOX_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_messaging_inbox (
    connection_id TEXT NOT NULL REFERENCES projection_messaging_connections(connection_id) ON DELETE CASCADE,
    platform_channel_id TEXT NOT NULL,
    platform_message_id TEXT NOT NULL,
    thread_key TEXT,
    kind TEXT NOT NULL,
    author_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    text TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    PRIMARY KEY(connection_id, platform_channel_id, platform_message_id)
  );
  CREATE INDEX IF NOT EXISTS messaging_inbox_sent ON projection_messaging_inbox(sent_at);
  CREATE TABLE IF NOT EXISTS projection_messaging_watched_channels (
    connection_id TEXT NOT NULL REFERENCES projection_messaging_connections(connection_id) ON DELETE CASCADE,
    platform_channel_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(connection_id, platform_channel_id)
  );
  CREATE TABLE IF NOT EXISTS projection_messaging_inbox_reads (
    connection_id TEXT NOT NULL REFERENCES projection_messaging_connections(connection_id) ON DELETE CASCADE,
    platform_channel_id TEXT NOT NULL,
    through_message_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(connection_id, platform_channel_id)
  );
`;

export const migration: OpenBotMigration = {
  version: 28,
  name: "messaging-inbox",
  // Only creates tables and an index, as migration 25 does: no foreign-key pause and no vacuum.
  up: (db) => db.exec(V28_MESSAGING_INBOX_SCHEMA_SQL),
};
