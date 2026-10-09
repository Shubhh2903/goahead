# Slack Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the GoAhead "Slack inbox" into a Slack client: every conversation, full history on scroll, threads, reactions, file upload, edit/delete own messages, backed by a local SQLite cache.

**Architecture:** Main/backend owns a cache (migration v29: `slack_conversations`, `slack_messages`), a per-workspace Slack request queue (40/min, Retry-After), a sync service (list refresh, page/thread loading, eviction), event handlers (edits, deletes, reactions, membership), and person actions (send, edit, delete, react, upload). The renderer gets a 3-pane view (list, messages, thread) through new `slackClient` IPC endpoints. Agents read the cache through the existing owner-only rules.

**Tech Stack:** Bun monorepo; Electron main + backend (TypeScript, node:sqlite); SolidJS 2.0 RC renderer + `@openbot/ui`; Vitest.

**Spec:** `docs/superpowers/specs/2026-10-09-slack-client-design.md`

## Global Constraints

- WORKTREE: all work happens in `/Users/ensureprotect/projects/openbot/.claude/worktrees/slack-client` (branch `slack-client`). Use absolute paths under it. NEVER edit files under `/Users/ensureprotect/projects/openbot/` outside this worktree. Run every command from the worktree root.
- Read `AGENTS.md` and the `AGENTS.md` of every directory you change before you edit.
- Do not run `git commit`, `push`, `tag`, `stash`, `reset`, `checkout`, `restore`. The user commits.
- Change only the files your task lists. If you need another file, stop and report it.
- Checks: only your task's test files, one per command (`bun run test:desktop -- <path>`); lint changed files with `bunx biome check --write --max-diagnostics=none <paths>`; `bun run typecheck:node` / `bun run typecheck:renderer` only where the task says. No full suites, builds, `bun run typecheck`, `bun run format`.
- Migration v29 is additive. It needs data-preservation fixtures for every affected released schema, failure/rollback tests and a second-run test (src/backend/AGENTS.md). Mirror the DDL in `LATEST_SCHEMA_SQL` and the schema history JSON.
- Text a user reads: `@openbot/i18n` English keys; errors from main/backend via `sourceText(key)`.
- No `biome-ignore`, `@ts-expect-error`, `@ts-ignore`, `as any`; no widening to `unknown` at a boundary.
- Tokens and file URLs never reach the renderer or logs; redact on every log path.
- The person's own actions need no approval; agent sends keep the send guards.
- No `data-testid`; renderer tests query roles and names; wait on promises/state, not timers (except the queue's own rate logic, tested with an injected clock).

## Review Focus

- Edit/delete of another person's message is refused before any Slack call (T8 test "edit of another person's message is refused").
- Scroll paging never repeats or skips messages across page boundaries (T3 test "pages merge by ts without gaps or duplicates").
- A 429 storm never floods Slack and never stops loading forever (T4 test "waits Retry-After then resumes").
- Migration keeps every v28 inbox row (T2 test "copies inbox rows into the cache").
- An optimistic action that Slack refuses is rolled back with the error text (T13 test "a refused reaction rolls back").

---

## Interfaces (shared; Task 1 creates them)

`packages/contracts/src/ipc-slack-client.ts`:

```ts
export type SlackConversationKind = "channel" | "private" | "im" | "mpim";
export interface SlackClientConversation {
  workspaceId: string; channelId: string; kind: SlackConversationKind; name: string;
  memberIds: string[]; unreadCount: number; lastActivityTs: string | null; isMember: boolean; hidden: boolean;
}
export interface SlackClientReaction { name: string; count: number; mine: boolean }
export interface SlackClientFile { id: string; name: string; mimetype: string; size: number; previewUrl: string | null; permalink: string | null }
export interface SlackClientMessage {
  ts: string; threadTs: string | null; replyCount: number; latestReplyTs: string | null;
  authorId: string; text: string; files: SlackClientFile[]; reactions: SlackClientReaction[];
  editedAt: string | null; deleted: boolean; mine: boolean; pending?: "sending" | "editing" | "deleting";
}
export interface SlackClientPage {
  workspaceId: string; channelId: string; messages: SlackClientMessage[]; hasOlder: boolean;
  people: Record<string, string>; channels: Record<string, string>; customEmoji: Record<string, string>;
  offline: boolean;
}
export interface SlackClientThread { workspaceId: string; channelId: string; parent: SlackClientMessage; replies: SlackClientMessage[] ; people: Record<string, string>; channels: Record<string, string>; customEmoji: Record<string, string> }
export interface SlackClientChanged { workspaceId: string; channelId: string | null }
// Inputs
export interface SlackClientOpenInput { workspaceId: string; channelId: string }
export interface SlackClientOlderInput { workspaceId: string; channelId: string; beforeTs: string }
export interface SlackClientThreadInput { workspaceId: string; channelId: string; threadTs: string }
export interface SlackClientSendInput { workspaceId: string; channelId: string; text: string; threadTs?: string; broadcast?: boolean; fileIds?: string[] }
export interface SlackClientEditInput { workspaceId: string; channelId: string; ts: string; text: string }
export interface SlackClientDeleteInput { workspaceId: string; channelId: string; ts: string }
export interface SlackClientReactInput { workspaceId: string; channelId: string; ts: string; name: string; on: boolean }
export interface SlackClientUploadInput { workspaceId: string; channelId: string } // main opens the file picker; drag-drop sends a renderer File via the existing attachment path (see T8)
export interface SlackClientUploadResult { fileId: string; name: string; size: number }
export const SLACK_CLIENT_LIMITS = { pageSize: 100, uploadBytes: 50 * 1024 * 1024, textLength: 4000, cacheBytesPerWorkspace: 1024 * 1024 * 1024 } as const;
```

IPC group `slackClient` (Task 9): `listConversations` (`slack-client:list-conversations`, input `{ workspaceId }` → `SlackClientConversation[]`), `open` (→ `SlackClientPage`), `older` (→ `SlackClientPage`), `thread` (→ `SlackClientThread`), `send` (→ `void`), `edit`, `delete`, `react` (→ `void`), `upload` (→ `SlackClientUploadResult | null`), `mentionCandidates` (`{ workspaceId, query }` → `{ id, name }[]`), event `changed` (`slack-client:changed` → `SlackClientChanged`).

Backend modules (names fixed):
- `src/backend/messaging/slack-client/cache-store.ts` → `class SlackCacheStore`
- `src/backend/messaging/slack-client/request-queue.ts` → `class SlackRequestQueue`
- `src/backend/messaging/slack-client/sync-service.ts` → `class SlackClientSync`
- `src/backend/messaging/slack-client/events.ts` → `applySlackClientEvent(store, connectionId, event)`
- `src/backend/messaging/slack-client/actions.ts` → `class SlackClientActions`
- Slack adapter additions in `src/backend/messaging/slack/slack-driver.ts` (Task 5).

---

### Task 1: Contracts, scopes, manifests
**Files:** create `packages/contracts/src/ipc-slack-client.ts` (+ guards `isSlackClientPage`, `isSlackClientConversations`, `isSlackClientThread`, `isSlackClientUploadResult`, `isSlackClientChanged`), export from `packages/contracts/src/ipc.ts` barrel as other ipc-* modules are; `packages/contracts/src/slack-app.ts` add user scopes `files:write`, `reactions:read`; `apps/slack-app/{development,internal,production}/manifest.json` add those scopes and user events `reaction_added`, `reaction_removed`, `member_joined_channel`, `channel_left`; English i18n keys for the client (area `messaging.client.*`: list sections "Unreads", "Channels", "Direct messages", search placeholder "Find a conversation", "Load older messages", "Offline: showing saved messages", "Edit", "Delete", "Delete this message?", "Delete", "Cancel", "edited", "{count} replies", "Reply in thread", "Also send to channel", "Attach a file", "Add reaction", "Uploading {name}…", "Thread", "Close").
**Tests:** guards in a contracts test file (valid/invalid page); `packages/contracts/src/slack-app.test.ts` passes (manifests match scopes).
- [ ] Write failing guard tests → implement → pass. Run slack-app.test.ts. Lint. Do not commit.

### Task 2: Migration v29
**Files:** `src/backend/messaging/messaging-schema.ts` (new `SLACK_CLIENT_SCHEMA_SQL`), `src/backend/openbot-database-schema.ts` (v29 entry; `LATEST_SCHEMA_SQL` mirror), `src/backend/openbot-database-schema-history.json` ("29"), tests in `src/backend/openbot-database.test.ts` (follow the v28 test pattern).
DDL per spec section 1. v29 `up`: create tables + indexes; `INSERT OR IGNORE INTO slack_messages (connection_id, channel_id, ts, thread_ts, author_id, text, files_json, reactions_json, deleted, subtype, reply_count, cached_at) SELECT connection_id, platform_channel_id, platform_message_id, thread_key, author_id, text, '[]', '[]', 0, NULL, 0, sent_at FROM projection_messaging_inbox`; one `slack_conversations` row per distinct (connection_id, platform_channel_id) with `kind` mapped from inbox kind (`direct`→`im`, `group`→`mpim`, else `channel`), `name` = '' (filled by sync), `oldest_loaded_ts` = min ts, `has_more_history` = 1.
**Tests:** "adds the Slack client cache to a version 28 database and copies inbox rows (failed attempt=%s)" (v28 fixture with inbox rows; forced failure rolls back; retry; second start no-op; FK and integrity checks); update older-fixture expectations to MAX(version)=29; parity test passes.
- [ ] Failing tests → migration → pass (`openbot-database.test.ts`, `openbot-database-schema-parity.test.ts`). Lint. Do not commit.

### Task 3: Cache store
**Files:** `src/backend/messaging/slack-client/cache-store.ts` + `cache-store.test.ts`.
API: `upsertConversations(connectionId, list)`, `conversations(connectionId)`, `markOpened(connectionId, channelId, at)`, `mergePage(connectionId, channelId, messages, { hasMore, oldestTs })`, `page(connectionId, channelId, { beforeTs?, limit })` (newest-first query, returned oldest-first), `thread(connectionId, channelId, threadTs)`, `upsertMessage`, `markEdited(…, ts, text, editedAt)`, `markDeleted(…, ts)`, `setReactions(…, ts, reactions)`, `adjustReaction(…, ts, name, userId, on)`, `setUnread(…, count, lastReadTs)`, `sizeBytes(connectionId)`, `evictTo(connectionId, maxBytes)` (by oldest `last_opened_at`, returns evicted channel ids), `clearConnection(connectionId)`.
**Tests:** "pages merge by ts without gaps or duplicates"; "edit, delete and reactions update a cached message"; "eviction drops least recently opened conversations"; "clear removes a workspace".
- [ ] TDD; run the test file. Lint. Do not commit.

### Task 4: Request queue
**Files:** `src/backend/messaging/slack-client/request-queue.ts` + test.
`new SlackRequestQueue({ perMinute: 40, now?, sleep? })`; `run<T>(priority: "visible" | "background", call: () => Promise<T>): Promise<T>`; rate window per minute; visible before background; on an error with `status 429` and `retryAfterSeconds`, pause the whole queue that long then retry the same call (max 3 retries), other errors reject.
**Tests (injected clock):** "caps at 40 calls per minute"; "visible work runs before background"; "waits Retry-After then resumes".
- [ ] TDD; run the test. Lint. Do not commit.

### Task 5: Slack adapter methods
**Files:** `src/backend/messaging/slack/slack-driver.ts`, `slack-web-api.ts` (429 → typed error with `retryAfterSeconds` from the header), `src/backend/messaging/messaging-types.ts` (optional adapter methods), tests in `src/backend/messaging/slack/slack-driver.test.ts` (fake Slack HTTP server pattern already there).
Methods (user token unless noted): `listConversations(cursor?)` (`users.conversations`, types public_channel,private_channel,im,mpim, limit 200, exclude_archived), `historyPage(channel, { latest?, limit })` → raw messages + `has_more`, `threadReplies(channel, ts)`, `conversationInfo(channel)` → `last_read`, `unread_count_display` when present, `updateAsUser(channel, ts, text)`, `deleteAsUser(channel, ts)`, `reactAsUser(channel, ts, name, on)`, `uploadFileAsUser({ channel, threadTs?, name, bytes })` via `files.getUploadURLExternal` → PUT bytes → `files.completeUploadExternal`, `searchPeople(query)` (cached `users.list`). Map raw Slack messages to the cache shape (files, reactions with `mine`, edited, subtype).
**Tests:** one per method with the fake server; 429 maps to the typed error; tokens never in thrown messages.
- [ ] TDD; run the test file. Lint. Do not commit.

### Task 6: Sync service
**Files:** `src/backend/messaging/slack-client/sync-service.ts` + test. Depends T3, T4, T5.
`new SlackClientSync({ store, queue, adapterFor(connectionId), names, onChanged, now })`: `refreshConversations(connectionId)` (paged, then schedule every 10 min while connected), `open(connectionId, channelId)` → cache page immediately + background fetch newest page (visible priority) merging into cache then `onChanged`, `older(connectionId, channelId, beforeTs)` (skip fetch if cache has `limit` older rows), `thread(...)`, `unread` from `conversationInfo`, eviction after merges (1 GB), offline flag when the adapter throws a network error. Remove the old 1-per-minute history fill in `messaging-service.ts` (`#fillHistory`) by making the watched-channel fill use the queue (this one change in messaging-service.ts is allowed).
**Tests:** "open returns the cache then merges the newest page"; "older skips Slack when the cache has the rows"; "offline returns cached messages with the offline flag".
- [ ] TDD; run the test file + `src/backend/messaging/messaging-service.test.ts`. Lint. Do not commit.

### Task 7: Live events
**Files:** `src/backend/messaging/slack-client/events.ts` + test; `src/backend/messaging/slack/slack-events-transport.ts` / `slack-events.ts` to surface `message_changed`, `message_deleted`, `reaction_added`, `reaction_removed`, `member_joined_channel`, `channel_left` as typed inbound events (no agent turns for them). Depends T3.
**Tests:** one per event type updating the store; reactions keep `mine` for the owner.
- [ ] TDD; run test files. Lint. Do not commit.

### Task 8: Person actions
**Files:** `src/backend/messaging/slack-client/actions.ts` + test. Depends T3, T5.
`send` (postAsUser; threadTs; broadcast; attaches previously uploaded file ids), `edit`/`delete` (refuse unless cached `author_id` is the owner, before any Slack call; source-text error `error.messaging.clientNotYours`), `react`, `upload` (bytes from main-picked path or the renderer attachment path; refuse > 50 MB; returns file id). Each updates the cache optimistically and reverts on error. No send guards for these.
**Tests:** "edit of another person's message is refused"; "send updates the cache then confirms"; "a refused reaction reverts the cache"; "upload over 50 MB is refused".
- [ ] TDD. Lint. Do not commit.

### Task 9: Wiring and IPC
**Files:** `src/backend/messaging/messaging-service.ts` (own an instance of sync/actions per connection; feed events from T7; clear cache on disconnect), `src/main/application-services.ts`, `packages/contracts/src/ipc-endpoints.ts` (group `slackClient`), `src/main/ipc/` (new `slack-client-handlers.ts` + input decoders), `src/preload/index.ts` + `src/preload/slack-client-decoding.ts`, `src/renderer/src/preview/mock-slack-client.ts` (+ register in mock-openbot), main-side file picker for upload. Depends T1, T6, T7, T8.
**Tests:** `src/main/ipc-channel-coverage.test.ts`; one service test "disconnect clears the Slack client cache".
- [ ] Implement; run coverage + messaging tests; `bun run typecheck:node`. Lint. Do not commit.

### Task 10: Agents read the cache
**Files:** `src/backend/messaging/messaging-read-tools.ts` (and only the read path it calls) so agent inbox tools and `@chief` context read `SlackCacheStore` (fallback to the old inbox table when the cache has no rows). Owner-only rules unchanged. Depends T3.
**Tests:** "an agent inbox read returns cached thread replies" (owner turn); "a non-owner turn is refused" (existing rule still holds).
- [ ] TDD. Lint. Do not commit.

### Task 11: Renderer store and 3-pane shell
**Files:** `src/renderer/src/features/slack-client/slack-client-port.ts`, `slack-client-context.tsx` (reconcile-based store: conversations, open page, thread, pending actions; coalesced reloads; listens to `changed`), `SlackClientView.tsx` (layout with three slots), and switch the "Slack inbox" row to open it (in `messaging-threads-context.tsx` / `WorkspaceSidebar.tsx`, only the open call). Depends T9 contracts (use the mock).
**Tests:** `SlackClientView.test.tsx` "opens the Slack client with three panes" (roles: navigation, main, complementary).
- [ ] TDD; `bun run typecheck:renderer`. Lint. Do not commit.

### Task 12: Conversation list pane
**Files:** `packages/ui/src/features/slack-client/SlackConversationList.tsx` (+ export subpath), CSS, renderer glue in `SlackClientView.tsx` slot only. Depends T11.
Search filter, sections Unreads / Channels / Direct messages, unread counts, Hide on right-click (reuse existing hide action).
**Tests:** "search filters conversations"; "unread conversations are listed under Unreads".
- [ ] TDD. Lint. Do not commit.

### Task 13: Message pane
**Files:** `packages/ui/src/features/slack-client/SlackMessagePane.tsx`, `SlackReactionChips.tsx`, CSS; slot glue. Depends T11.
Virtualized list (reuse the repo's virtual list if present), grouping by author/day, step-1b `SlackMessageContent`, reactions chips (toggle own; "+" emoji picker reusing an existing picker if present), "N replies", Edit/Delete for `mine` only (Delete confirm via existing ConfirmDialog), load older on reaching top, sticky bottom, offline note.
**Tests:** "Edit and Delete show only on my messages"; "a refused reaction rolls back"; "reaching the top loads older messages".
- [ ] TDD. Lint. Do not commit.

### Task 14: Composer and thread panel
**Files:** `packages/ui/src/features/slack-client/SlackComposer.tsx`, `SlackThreadPanel.tsx`, CSS; slot glue. Depends T11.
@mention picker (`mentionCandidates`), emoji shortcodes, attach button + drag-and-drop (upload then send with file ids, progress), Enter/Shift+Enter, `@chief` keeps asking the orchestrator (reuse existing ask path); thread panel with parent, replies, composer, "Also send to channel".
**Tests:** "@mention picker inserts a mention"; "a thread reply can also go to the channel"; "@chief asks the orchestrator".
- [ ] TDD. Lint. Do not commit.

### Task 15: Docs
**Files:** `PRIVACY.md`, `docs/goahead-internal-release.md` (new scopes/events, reconnect), `docs/ARCHITECTURE.md` (Slack client cache), `changelog.d/slack-client.md`.
- [ ] Write; `bun scripts/check-release-notes.ts`. Do not commit.

### Task 16: E2E
**Files:** `src/main/slack-workspace.test.ts` (one new `it`). Depends T9, T11.
History paging (two pages), a thread, edit and delete own, a reaction event, report `.openbot-build/slack-workspace-e2e/slack-client.json`.
- [ ] Write; run alone. Do not commit.

## Final check (coordinator)
`bun run typecheck:node`, `bun run typecheck:renderer`, `bun run i18n:check`, each task's tests once, one at a time; whole-branch review; report unverified items (mobile typecheck, full suites → CI).
