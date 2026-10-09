# Slack client in GoAhead

Date: 2026-10-09. Status: design approved in chat, spec waiting for review. Ships in v0.35.0 (v0.33.0 and v0.34.0 are
released first with the features already built).

## Goal

The "Slack inbox" becomes a Slack client inside GoAhead: every channel, DM and group DM of the connected
person, the full history as they scroll, threads, reactions, sending text and files, and editing or
deleting their own messages. Agents keep reading Slack through the same owner-only rules.

Success: the person opens any of their Slack conversations in GoAhead, scrolls back to its first message,
reads and answers threads, reacts, attaches a file, and edits or deletes their own message; everything
also shows in Slack, and changes made in Slack show in GoAhead within seconds.

## Today

- `projection_messaging_inbox` (migration v28) keeps messages that arrive as events, plus the newest 15
  messages of each picked channel, read at one `conversations.history` call per minute. Rows are deleted
  after 30 days.
- Step 1b added mrkdwn rendering, names, standard and custom emoji, and images (`files.json` sidecar per
  connection, `openbot-attachment://slack/…`).
- Sends from the inbox go out as the person (`postAsUser`); `@chief` goes to the Slack Orchestrator.

## Slack limits (verified)

Slack's 2025-05-29 change (1 request per minute and 15 objects for `conversations.history` and
`conversations.replies`) applies only to commercially distributed apps that are not in the Slack
Marketplace. "Internal customer-built applications are not impacted." Both GoAhead Slack apps
(`A0C860EFP6C`, `A0C7VBUH6KW`) are installed only in the company workspace, so they keep Tier 3
(about 50 requests per minute) and `limit` up to 200 is safe.

## Decisions

- Scope: all conversations with full history, threads, reactions, file upload, edit and delete own
  messages.
- Storage: local SQLite cache, loaded on demand; kept until disconnect, with a size limit.
- Layout: a Slack-like 3-pane view behind the "Slack inbox" row; it replaces today's inbox view.
- The person's own actions in the view need no approval. Send guards stay for agent sends only.

## 1. Data and cache

Migration v29, additive only:

- `slack_conversations`: `connection_id`, `channel_id`, `kind` (`channel` | `private` | `im` | `mpim`),
  `name`, `member_ids_json` (DMs and group DMs), `is_member`, `last_read_ts`, `unread_count`,
  `last_activity_ts`, `last_opened_at`, `oldest_loaded_ts`, `has_more_history`, `updated_at`. Primary key
  `(connection_id, channel_id)`. Foreign key to `projection_messaging_connections` with cascade delete.
- `slack_messages`: `connection_id`, `channel_id`, `ts`, `thread_ts`, `reply_count`, `latest_reply_ts`,
  `author_id`, `text` (raw Slack mrkdwn), `files_json`, `reactions_json`, `edited_at`, `deleted`
  (0/1), `subtype`, `cached_at`. Primary key `(connection_id, channel_id, ts)`. Indexes on
  `(connection_id, channel_id, ts)` and `(connection_id, channel_id, thread_ts)`.
- The migration copies every `projection_messaging_inbox` row into `slack_messages`, and one
  `slack_conversations` row per distinct conversation. The old table stays and is no longer written.
- `LATEST_SCHEMA_SQL` mirrors the new tables (schema parity test).
- Size limit: 1 GB per workspace for cached messages plus cached images. Past it, evict the
  conversations with the oldest `last_opened_at` (their messages and images). Scrolling reloads them.
- Disconnect deletes the workspace's cache rows and images, as today.

## 2. Loading, live updates, limits

- Conversation list: `users.conversations` (types `public_channel,private_channel,im,mpim`, `limit`
  200, paged) at connect and every 10 minutes. DM names from the name cache.
- Open a conversation: show the cache at once, then `conversations.history` (`limit` 100) for the newest
  messages and merge.
- Scroll to the top: `conversations.history` with `latest = oldest_loaded_ts` (`limit` 100) until
  `has_more` is false. Skip the call when the cache already holds those messages.
- Threads: `conversations.replies` when a thread opens; cache the replies.
- Unread: `last_read` from `conversations.info` and new events. Opening marks read in Slack
  (`conversations.mark`, already built).
- Live: existing events plus `message_changed`, `message_deleted` (subtypes of `message.*`),
  `reaction_added`, `reaction_removed`, `member_joined_channel`, `channel_left`. Each event updates the
  cache and emits a change; the open view updates without a reload.
- Request queue per workspace for history-type calls: at most 40 per minute, visible work first, then
  background; on 429 wait `Retry-After`. The 1-per-minute history fill is removed.
- Offline: cached conversations open with the note "Offline: showing saved messages"; sends wait.

## 3. Screen

- Left: search by name; sections Unreads, Channels, Direct messages; unread counts; Hide and Clear
  history stay.
- Center: header (name, member count); messages grouped by author and day, avatars, time, "edited";
  step-1b rendering; reaction chips (toggle own; "+" opens an emoji picker); "N replies" opens the
  thread; Edit and Delete on hover for own messages only (Delete confirms); sticky bottom; older
  messages load on scroll with a loading line; virtualized list.
- Composer: @mention picker, emoji shortcodes, attach button and drag-and-drop, Enter sends,
  Shift+Enter new line; `@chief …` still asks the Slack Orchestrator.
- Right: thread panel with parent, replies, reply composer and "Also send to channel".
- All text from i18n keys.

## 4. Actions, scopes, safety, agents

- As the person (user token): `chat.postMessage` (thread replies, `reply_broadcast`), `chat.update`
  and `chat.delete` only when the cached author is the connected person (checked before the call),
  `reactions.add` / `reactions.remove`, file upload via `files.getUploadURLExternal` +
  `files.completeUploadExternal` (max 50 MB, progress). Each action is optimistic and rolled back on
  a Slack error, with the error text.
- New user scopes: `files:write`, `reactions:read`. New user events: `reaction_added`,
  `reaction_removed`, `member_joined_channel`, `channel_left`. Update `SLACK_USER_SCOPES` and the three
  manifests; the person pastes the manifests and reconnects.
- Agent sends keep the send guards. Agent read tools and `@chief` read the cache, with the existing
  owner-only rules (own DM with GoAhead, or a local-owner app turn) and the untrusted-text note.
- `PRIVACY.md`: more Slack history is kept on this computer up to the size limit; attached files go to
  Slack.
- Tokens never reach the renderer or logs; files download in main (step 1b mechanism).

## Failure modes and tests

| Failure | Test |
| --- | --- |
| Migration loses inbox rows or fails half way | Migration test: v28 fixture with inbox rows → v29 copies them; forced failure rolls back; second run no-op; parity test |
| History paging repeats or skips messages | Cache store test: merge pages by `ts`, `has_more` stops paging |
| Slack 429 stops loading forever or floods Slack | Queue test: 40/min cap, waits `Retry-After`, visible work first |
| Edit or delete of another person's message | Service test: refused before any Slack call |
| Event edit/delete/reaction not reflected | Event tests for `message_changed`, `message_deleted`, `reaction_added/removed` |
| Cache grows without bound | Store test: eviction by `last_opened_at` past the limit |
| Optimistic action stays after Slack refuses | Renderer test: rollback with error text |
| Token or file URL leaks to renderer or logs | Existing redaction tests extended to the new calls |
| Agent reads cache outside owner rules | Service test: refused for a non-owner turn |

E2E: extend `src/main/slack-workspace.test.ts` with history paging, a thread, edit and delete, and a
reaction; report under `.openbot-build/slack-workspace-e2e/slack-client.json`.

## Rollout

1. v0.33.0 and v0.34.0 are released first (built features, local release command).
2. Build this on the plan from writing-plans; v0.35.0.
3. Person pastes both updated manifests and reconnects Slack after installing v0.35.0.

## Out of scope

Slack search across messages, calls/huddles, workflows, channel management (create, archive, invite),
Slack Connect specifics, the phone app.
