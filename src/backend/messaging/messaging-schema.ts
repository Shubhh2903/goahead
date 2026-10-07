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
