import type { OpenBotMigration } from "./migration";

// GoAhead migration 30: the Slack reply drafts table. Frozen with the migration: the SQL is the text GoAhead shipped.
const V30_MESSAGING_DRAFTS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_messaging_drafts (
    draft_id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES projection_messaging_connections(connection_id) ON DELETE CASCADE,
    link_id TEXT NOT NULL REFERENCES projection_messaging_threads(link_id) ON DELETE CASCADE,
    accept_token TEXT NOT NULL UNIQUE,
    decline_token TEXT NOT NULL UNIQUE,
    target_json TEXT NOT NULL CHECK(json_valid(target_json)),
    message_id TEXT,
    allowed_user_id TEXT NOT NULL,
    post_text TEXT NOT NULL,
    draft_json TEXT NOT NULL CHECK(json_valid(draft_json)),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messaging_drafts_link ON projection_messaging_drafts(link_id);
`;

export const migration: OpenBotMigration = {
  version: 30,
  name: "messaging-drafts",
  // Only creates a table and an index. Drafts were kept in memory before, so there are no rows to copy.
  up: (db) => db.exec(V30_MESSAGING_DRAFTS_SCHEMA_SQL),
};
