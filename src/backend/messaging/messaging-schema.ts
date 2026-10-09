// Shared by migration v25 and the separate new-database schema. IF NOT EXISTS throughout, because
// this text is both the migration and the tail of the latest schema.
//
// `platform` has no CHECK on purpose: the next platform must not need a table rebuild, which is
// what a CHECK change costs (migrations 17, 22 and 23). The code only accepts the platforms it has
// a driver for.
//
// A connection is one workspace of a platform, such as a Slack workspace that installed the OpenBot
// app. Its orchestrator agent receives each new conversation and asks its teammates. No token is
// stored here. The tokens of a connection live in the main process's
// encrypted credential file, keyed by `connection_id`.
//
// A messaging thread is an execution thread of the agent that answers it, like a channel context:
// its own row in `projection_threads`, which the agent's public chat never shows.
export const MESSAGING_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_messaging_connections (
    connection_id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    workspace_name TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
    bot_user_id TEXT,
    app_id TEXT,
    orchestrator_agent_id TEXT,
    last_error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(platform, workspace_id)
  );
  CREATE TABLE IF NOT EXISTS projection_messaging_threads (
    link_id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES projection_messaging_connections(connection_id),
    agent_id TEXT NOT NULL,
    platform_channel_id TEXT NOT NULL,
    thread_key TEXT NOT NULL,
    is_direct INTEGER NOT NULL CHECK(is_direct IN (0, 1)),
    thread_id TEXT NOT NULL UNIQUE REFERENCES projection_threads(thread_id),
    title TEXT NOT NULL,
    history_cursor TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(connection_id, platform_channel_id, thread_key)
  );
  CREATE INDEX IF NOT EXISTS messaging_threads_agent ON projection_messaging_threads(agent_id, updated_at DESC);
`;

// Migration 28, and the tail of the latest schema after `MESSAGING_SCHEMA_SQL`. IF NOT EXISTS
// throughout, for the same reason.
//
// The inbox keeps the Slack messages that the connected person receives and GoAhead may read: their
// direct and group direct messages, messages that mention them, and the channels they pick. It is a
// copy of Slack text on this computer only, so rows are written directly and never go to the event
// log, which is append-only. Rows older than 30 days are deleted, and a disconnect deletes its
// workspace's rows. `kind` and `platform` have no CHECK, so a new kind needs no table rebuild.
//
// A watched channel is one the person picked in Settings. A read mark is the newest message GoAhead
// has read in one conversation; "unread" means newer than that.
export const MESSAGING_INBOX_SCHEMA_SQL = `
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

// Migration 29, and the tail of the latest schema after `MESSAGING_INBOX_SCHEMA_SQL`. IF NOT EXISTS
// throughout, for the same reason.
//
// The Slack client cache: every conversation the connected person can see, and the messages loaded
// for it. Like the inbox, it is a copy of Slack data on this computer only, written directly and never
// to the event log. Rows go with their connection, and a cache past its size limit drops the
// conversations opened least recently. `kind` has no CHECK, so a new kind needs no table rebuild.
// `ts` values compare as text: a Slack `ts` has a fixed width. The primary key of `slack_messages`
// is also its `(connection_id, channel_id, ts)` index.
export const SLACK_CLIENT_SCHEMA_SQL = `
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
