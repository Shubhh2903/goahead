import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";

// GoAhead migration 29: the Slack client cache, filled from the inbox rows. Frozen with the migration: the SQL is
// the text GoAhead shipped.
const V29_SLACK_CLIENT_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS slack_conversations (
    connection_id TEXT NOT NULL REFERENCES projection_messaging_connections(connection_id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    member_ids_json TEXT NOT NULL,
    is_member INTEGER NOT NULL CHECK(is_member IN (0, 1)),
    last_read_ts TEXT,
    unread_count INTEGER NOT NULL,
    last_activity_ts TEXT,
    last_opened_at TEXT,
    oldest_loaded_ts TEXT,
    newest_loaded_ts TEXT,
    has_more_history INTEGER NOT NULL CHECK(has_more_history IN (0, 1)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(connection_id, channel_id)
  );
  CREATE TABLE IF NOT EXISTS slack_messages (
    connection_id TEXT NOT NULL REFERENCES projection_messaging_connections(connection_id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL,
    ts TEXT NOT NULL,
    thread_ts TEXT,
    reply_count INTEGER NOT NULL,
    latest_reply_ts TEXT,
    author_id TEXT NOT NULL,
    text TEXT NOT NULL,
    files_json TEXT NOT NULL,
    reactions_json TEXT NOT NULL,
    edited_at TEXT,
    deleted INTEGER NOT NULL CHECK(deleted IN (0, 1)),
    subtype TEXT,
    cached_at TEXT NOT NULL,
    PRIMARY KEY(connection_id, channel_id, ts)
  );
  CREATE INDEX IF NOT EXISTS slack_messages_thread ON slack_messages(connection_id, channel_id, thread_ts);
`;

function addSlackClientCache(db: DatabaseSync, appliedAt: string): void {
  db.exec(V29_SLACK_CLIENT_SCHEMA_SQL);
  db.exec(`
    INSERT OR IGNORE INTO slack_messages
      (connection_id, channel_id, ts, thread_ts, author_id, text, files_json, reactions_json, deleted, subtype,
       reply_count, cached_at)
    SELECT connection_id, platform_channel_id, platform_message_id, thread_key, author_id, text, '[]', '[]', 0, NULL,
      0, sent_at
    FROM projection_messaging_inbox
  `);
  db.prepare(
    `INSERT OR IGNORE INTO slack_conversations
       (connection_id, channel_id, kind, name, member_ids_json, is_member, last_read_ts, unread_count,
        last_activity_ts, last_opened_at, oldest_loaded_ts, newest_loaded_ts, has_more_history, updated_at)
     SELECT m.connection_id, m.platform_channel_id,
       CASE
         WHEN SUM(m.kind = 'direct') > 0 THEN 'im'
         WHEN SUM(m.kind = 'group') > 0 THEN 'mpim'
         ELSE 'channel'
       END,
       '', '[]', 1, NULL, 0, MAX(m.platform_message_id), NULL, NULL, NULL, 1, ?
     FROM projection_messaging_inbox m
     GROUP BY m.connection_id, m.platform_channel_id`,
  ).run(appliedAt);
}

export const migration: OpenBotMigration = {
  version: 29,
  name: "slack-client-cache",
  // Creates tables and an index and copies rows into them: no rebuild, so no foreign-key pause and no vacuum.
  up: addSlackClientCache,
};
