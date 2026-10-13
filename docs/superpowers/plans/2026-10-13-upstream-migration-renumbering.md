# Upstream sync: migration renumbering plan (GA-46)

Status: plan only. This file does not contain migration code.

Scope: upstream OpenBot migrations 28–33 (`refs/upstream/openbot-main`) move to GoAhead migrations
32–37. Read `src/backend/AGENTS.md` before you start any task in this plan. Migrations are
irreversible. No backup of `openbot.db` exists.

Claims marked **(unconfirmed)** are not verified. Each one says where I looked.

## 0. Facts this plan uses

### 0.1 GoAhead schema state

- Migration list: `src/backend/openbot-database-schema.ts`, `MIGRATIONS`. Latest version is **31**.
  `LATEST_SCHEMA_VERSION` is the last entry.
- Separate schema for new databases: `LATEST_SCHEMA_SQL` in the same file. `createLatestDatabase`
  runs it and marks every migration as applied without running it.
- Schema history: `src/backend/openbot-database-schema-history.json` has entries 8–31.
- Parity test: `src/backend/openbot-database-schema-parity.test.ts`.

GoAhead migrations after the fork:

| GoAhead version | What it does | Tables / indexes |
| --- | --- | --- |
| 28 | `MESSAGING_INBOX_SCHEMA_SQL` (Slack inbox) | `projection_messaging_inbox`, `projection_messaging_watched_channels`, `projection_messaging_inbox_reads`, index `messaging_inbox_sent` |
| 29 | `addSlackClientCache` (create + copy rows from the inbox) | `slack_conversations`, `slack_messages`, index `slack_messages_thread` |
| 30 | `MESSAGING_DRAFTS_SCHEMA_SQL` | `projection_messaging_drafts`, index `messaging_drafts_link` |
| 31 | `MESSAGING_AUTO_REPLY_SCHEMA_SQL` | `projection_messaging_auto_reply` |

All four live in `src/backend/messaging/messaging-schema.ts`.

### 0.2 Shared history

The upstream and GoAhead history files are equal for versions 8–27 (I compared the JSON entries).
They differ from version 28. GoAhead has no upstream migration 28–33.

### 0.3 Schema version of each GoAhead release

The tags `v0.31.0`–`v0.35.0` are on GoAhead `master`. The tags `v0.1.0`–`v0.30.0` are on the
upstream ref (upstream releases). Evidence: `git tag --merged master`,
`git tag --merged refs/upstream/openbot-main`, and `git grep "version: N," <tag>`.

| GoAhead release | Tag commit | Date | Latest schema version |
| --- | --- | --- | --- |
| 0.31.0 | 5fe44b4d | 2026-10-08 | 28 |
| 0.32.0 | 44fe465b | 2026-10-08 | 28 |
| 0.33.0 | f7e48764 | 2026-10-09 | 28 |
| 0.34.0 | 2a7fe426 | 2026-10-09 | 28 |
| 0.35.0 | 0d5e2b1f | 2026-10-11 | 31 |
| master (now) | – | – | 31 (no schema change after 0.35.0) |

Thus the shipped GoAhead source schemas are **28** and **31**. Schemas 8–27 were shipped by upstream
OpenBot and are the shared base. They must also continue to upgrade.

All GoAhead releases use the product name `GoAhead` (`packages/contracts/src/product-identity.ts`
at `v0.31.0`). Thus the user data folder, and `openbot.db` in it, is separate from the upstream
OpenBot folder in a normal install. See open question Q3.

### 0.4 Upstream migrations 28–33

| Upstream | Commit | Date | Title |
| --- | --- | --- | --- |
| 28 | 6abbfbc8 | 2026-10-06 | Remove the provider CHECK from provider sessions (#1444) |
| 29 | ee5376d4 | 2026-10-07 | Bound provider history and preserve recovery state (#1532) |
| 30 | 9e019602 | 2026-10-07 | Add webhook triggers to routines (#1520) |
| 31 | 08c994e5 | 2026-10-08 | Add a Routines canvas that hands a routine's answer from agent to agent (#1447) |
| 32 | fc0781c4 | 2026-10-10 | Add essential memories and local memory search (#1779) |
| 33 | 4ce20b63 | 2026-10-10 | Let a routine skip or run once a time that OpenBot missed while closed (#1833) |

Evidence: `git log -p refs/upstream/openbot-main -- src/backend/openbot-database-schema.ts`. Each
commit adds exactly one `version: N` entry.

## 1. Mapping table

| Upstream | Commit | What it changes | New GoAhead | Dependencies | Conflicts with GoAhead tables or GoAhead 28–31 |
| --- | --- | --- | --- | --- | --- |
| 28 | 6abbfbc8 | Rebuilds `projection_provider_sessions` with `provider TEXT NOT NULL` and no provider `CHECK`. Foreign keys off (child `projection_turns.provider_session_id ON DELETE SET NULL`). Recreates index `provider_sessions_thread`. Code: `ProviderSessions.bindProviderSession` rejects a provider that is not in `AGENT_PROVIDERS`. | **32** | Needs the v26 table shape (GoAhead has it). Upstream providers `pi` and `muse` (added later upstream) need it. No GA-53–56 feature needs it at schema level. | No table name conflict. GoAhead 28–31 tables do not reference `projection_provider_sessions`. Upstream moved the rebuild SQL into `rebuildProviderSessions`; the GoAhead copy of `widenProviderSessionsCheck` still has it inline. The refactor must keep the SQL of 17, 22, 23, 24, 26 byte-equal (the history test checks DDL only). |
| 29 | ee5376d4 | Creates `provider_history_imports` (FK `projection_threads` CASCADE), `provider_history_turns`, `provider_history_staging` (FK to imports CASCADE), and indexes `provider_history_imports_thread`, `provider_history_turns_pending`, `provider_history_staging_turn`, `provider_history_staging_pending`. Source: `src/backend/database/provider-history-schema.ts`. | **33** | Needs `projection_threads` only. The code is large (75 files, about 7,600 added lines: provider clients, boot recovery, `claude-history.ts`, `provider-history-*.ts`, `src/main/team-api-server.ts`). | No name conflict (no GoAhead table or code uses `provider_history_*` tables; I searched `src/backend`, `src/main`, `packages/contracts`). GoAhead already has the analytics key `provider_history_backfill_pending` (`src/backend/agent/boot-recovery.ts:253`, `src/main/analytics.ts:858`) from code before the fork. |
| 30 | 9e019602 | Creates `projection_routine_webhooks` (FK `projection_agent_routines` CASCADE), `projection_channel_routine_webhooks` (FK `projection_channel_routines` CASCADE), `projection_webhook_route_revocations`, `projection_webhook_receipts` (CHECKs on `owner_kind`, `status`, `reason`), indexes `webhook_receipts_recent`, `webhook_receipts_received`. Stores `secret_ciphertext`. | **34** | Needs `projection_agent_routines` (v8) and `projection_channel_routines` (v19). Outside SQLite: D1 migration `apps/auth-api/migrations/0027_webhook_routes.sql`, Signal (`remote/api`), Team API `events-v1`, `PRIVACY.md`. | No SQLite name conflict. D1 numbering conflict: GoAhead D1 `0026` is `slack_person_routes`, upstream `0026` is `discord_guild_routes`. See Q4. |
| 31 | 08c994e5 | Creates `routine_flow_links` (FK `projection_agent_routines` CASCADE, `CHECK(from_agent_id <> to_agent_id)`), `routine_flow_positions`, `routine_flow_steps` (FK `projection_routine_runs` CASCADE, status CHECK), indexes `routine_flow_links_to`, `routine_flow_steps_delivery` (partial unique), `routine_flow_steps_agent`. Source: `src/backend/routine-flows/routine-flow-schema.ts`. | **35** | Schema: needs `projection_agent_routines` and `projection_routine_runs` (v8). Code: needs GA-54 code (`isEventRoutineTrigger` in `packages/contracts/src/ipc-events.ts`, a file that 9e019602 adds). | No name conflict. |
| 32 | fc0781c4 | Creates `agent_memory_selections` (FK `projection_agent_memories` CASCADE), FTS5 virtual table `agent_memory_search` (external content `projection_agent_memories`, `content_rowid='rowid'`) and its shadow tables `_config`, `_data`, `_docsize`, `_idx`, triggers `agent_memory_insert`, `agent_memory_update`, `agent_memory_delete`. Data step: FTS `rebuild`, then one selection row per memory, per agent, inside the context budget. Source: `src/backend/agent-memory-selection.ts`. | **36** | Schema: needs `projection_agent_memories` (v8). Code: `packages/contracts/src/agent-memory-context.ts` (new in fc0781c4). Needs SQLite with FTS5. | No name conflict. Triggers fire on every write to `projection_agent_memories`, so every GoAhead writer of that table must be checked. |
| 33 | 4ce20b63 | `ALTER TABLE ... ADD COLUMN`: `missed_policy TEXT NOT NULL DEFAULT 'skip' CHECK(... IN ('skip','run-once'))` on `projection_agent_routines` and `projection_channel_routines`; `missed_count INTEGER CHECK(NULL or >= 1)` and `missed_until TEXT` on `projection_routine_runs` and `projection_channel_routine_runs`. Skips a column that exists. | **37** | Schema: needs the v27 `limit_policy` column (GoAhead has it); the latest schema puts `missed_policy` after it. Code: needs GA-55 code (`packages/contracts/src/ipc-routine-flows.ts`) and GA-54 code (routine store refactor). | No name conflict. Latest-schema helper `withRoutineLimitPolicy` becomes `withRoutinePolicies` and a new `withRunMissedColumns`. |

Acceptance check for the numbers: after each task, the new GoAhead history entry must be JSON-equal
to the upstream entry it ports (`32` = upstream `28`, ..., `37` = upstream `33`). The DDL is the same;
only the version key changes. Any difference means that the port changed the schema.

### 1.1 Fallback mapping if upstream 29 waits

Versions must be contiguous (`validateMigrationRegistry`). If the developer does not port ee5376d4
before GA-54, upstream 29 cannot keep number 33. Then:

| Upstream | 28 | 30 | 31 | 32 | 33 | 29 |
| --- | --- | --- | --- | --- | --- | --- |
| GoAhead | 32 | 33 | 34 | 35 | 36 | next free number when ported |

A number is fixed only when a GoAhead release ships it. Until then, it can move. See Q1.

## 2. Fixtures, failure and rollback cases per migration

### 2.1 How to build a source database

Do not build an old database by dropping objects from a new one. That pattern (used in
`openbot-database.test.ts`) can not undo a rebuild (`CHECK` removal) or an `ADD COLUMN`.

Use the stop-trigger builder from upstream `src/backend/routine-missed-runs-migration.test.ts`
(`databaseAt(version)`): create an empty `schema_migrations`, add a temporary trigger that aborts an
insert of a version above N, run `migrateOpenBotDatabase`, then drop the trigger. Migrations 8–31 are
frozen, so this gives the real shipped shape of an upgraded install at version N.

Required source versions for every migration in this plan:

| Source | Why |
| --- | --- |
| **31** | GoAhead 0.35.0 (and master). Most users. |
| **28** | GoAhead 0.31.0–0.34.0. The upgrade runs GoAhead 29–31 (including the Slack row copy) and then 32–37 in one start. |
| **27** | Last shared upstream schema (upstream 0.30.0). Proves that the GoAhead branch 28–31 and the new 32–37 run together from the shared base. |
| 8–26 loop | Smoke only: every older shipped schema reaches the latest version. Upstream tests already use this loop (`it.each(... index + 8)`). |

Seed data in each fixture before the upgrade, then assert it after: agents, a thread with messages,
provider sessions and turns linked to them, memories, agent and channel routines with triggers and
runs, and GoAhead 28–31 rows (messaging connection, thread link, inbox row, Slack conversation and
message, draft, auto-reply entry). The GoAhead rows must stay unchanged after every new migration.

New installs: GoAhead 0.31–0.35 created new databases from `LATEST_SCHEMA_SQL` of that release. The
parity test at each tag says this shape equals the upgraded shape. **(unconfirmed: I did not check CI
results at the release tags.)** If the developer wants proof, add one frozen `sqlite_master` dump per
shipped version (28, 31) as a fixture and upgrade it too.

### 2.2 Cases that `src/backend/AGENTS.md` requires for every migration

For each of 32–37, cover these at the stable database boundary (`OpenBotDatabase.initialize()` or
`migrateOpenBotDatabase`):

- **Data preservation** from 31, 28 and 27 (above).
- **Failure and rollback:** a temporary trigger that aborts the insert of the new marker. Assert: the
  error is `migration to version N failed`, the marker is absent, every new object is absent, all
  seeded rows are unchanged.
- **Retry:** remove the trigger and open again. Assert the latest version and the seeded data.
- **Downgrade:** a database at the new version opened by an app whose latest version is lower must
  fail with `newer than this application supports`. In practice: GoAhead 0.35.0 (latest 31) opens a
  database at 32+. Test it with a marker above the latest version, as the existing test
  `rejects a database created by a newer application` does.
- **Missing version:** a database at N+1 that lost marker N fails with
  `migration history is missing version N`, before any data changes.
- **Foreign keys:** `PRAGMA foreign_key_check` is empty after the upgrade, and
  `PRAGMA foreign_keys` is `1` after a failed run of a migration that turns them off.
- **Integrity:** `PRAGMA quick_check` is `ok` after the upgrade.

### 2.3 Specific cases per migration

**32 (upstream 28, provider CHECK removal)**

- Seed one provider session for each provider in the v26 CHECK: `codex`, `claude`, `grok`,
  `opencode`, `antigravity`, `acp`, `cursor`, `cline`. Link turns to them.
- Assert: every session row and column stays the same; `projection_turns.provider_session_id` is not
  set to NULL (this is why foreign keys are off); `UNIQUE(provider, external_session_id)` and index
  `provider_sessions_thread` exist.
- Failure: a squatted staging table name (`projection_provider_sessions_v32`) makes the rebuild fail.
  Assert rollback keeps the old table with its CHECK, and foreign keys are on again.
- Use staging name `projection_provider_sessions_v32` (the GoAhead number), as 17–26 use their own
  number.
- Code check (not a migration test): `bindProviderSession` rejects an unknown provider before it
  writes an event or a row. Upstream has this test; keep it, because the CHECK was the guard.

**33 (upstream 29, provider history)**

- Create only. Assert no existing row changes.
- Failure: squat an index name (for example `provider_history_imports_thread` as a table). The
  tables use `IF NOT EXISTS`, so only an index name can collide.
- Foreign keys: delete a thread and assert its import, turn and staging rows go (CASCADE).

**34 (upstream 30, webhooks)**

- Seed agent and channel routines with triggers and runs at 31, 28 and 27. Assert they are
  unchanged and the four new tables are empty.
- Failure: squat `webhook_receipts_recent`. Port upstream test
  `rolls back the webhook migration and retries without losing scheduled data`
  (`src/backend/openbot-database-events-migration.test.ts`) with GoAhead numbers.
- Foreign keys: delete a routine and assert its webhook row goes.
- Secrets: the migration writes no secret. The feature task must keep `secret_ciphertext` out of
  logs, diagnostics, exports and analytics (non-negotiable rule).

**35 (upstream 31, routine flows)**

- Seed routines and runs. Assert unchanged; new tables empty.
- Failure: squat `routine_flow_links_to`.
- Foreign keys: delete a routine (links go) and a run (steps go).

**36 (upstream 32, memory selection)** — the only data migration in this set.

- Seed memories for at least two agents: `manual` and `automatic`, with total size above
  `AGENT_MEMORY_CONTEXT_BUDGET_BYTES`, and non-ASCII text.
- Assert: every memory row is unchanged (text, origin, timestamps); each memory has exactly one
  `agent_memory_selections` row; per agent, the `essential` set fits the budget and `manual` comes
  first; an FTS `MATCH` finds each memory; after the upgrade an insert, update and delete of a memory
  keep the search index and selection rows correct.
- Failure: a late failure (marker trigger) rolls back the virtual table, its shadow tables, the
  triggers and the selection rows. Port upstream
  `rolls back schema, selection, index and marker after a late failure, then retries`
  (`src/backend/agent-memory-selection-migration.test.ts`).
- FTS5 missing: if the SQLite in GoAhead's Electron has no FTS5, the migration fails on every start.
  Confirm FTS5 before you merge (Q7).
- Rowid risk: the search index uses the `rowid` of `projection_agent_memories`, which has a TEXT
  primary key. `VACUUM` can change such rowids. Today only migrations 8 and 13 run `VACUUM`, before
  36. Rule for later work: no migration after 36 can set `vacuumAfterCommit` unless it also rebuilds
  `agent_memory_search`.
- Writers: check every GoAhead write to `projection_agent_memories` (agent import, agent removal,
  memory store, agent id changes) with the triggers active. **(unconfirmed: I did not list these
  writers.)**

**37 (upstream 33, missed runs)**

- Seed routines with `limit_policy` `wait` and `skip`, and runs in every status (including
  `interrupted` for agent runs). Assert `missed_policy = 'skip'` and `missed_count`, `missed_until`
  are NULL for every existing row; all other columns are unchanged.
- Failure: a late failure rolls back all four `ADD COLUMN` statements and the marker (port upstream
  `rolls back every column and the marker after a late failure, then retries`).
- Port upstream `keeps a column that a development build added before the marker`.
- CHECK: an invalid policy or a `missed_count` of 0 is rejected.

### 2.4 Multi-step upgrade

A GoAhead 0.31–0.34 database runs 29, 30, 31, 32, ... 37 in one start. Each migration has its own
transaction. If one fails, the database stays at the version before it, and the next start continues
from there. Add one test: fail at 36, assert version 35 and all data, retry, assert 37.

Note: `assertForeignKeys` checks the whole database. A user database with an old orphan row fails
every new migration and the app does not start. This is existing behavior, not new. **(unconfirmed:
I did not look for orphan rows in real user data.)**

## 3. Latest schema for new databases

Edit `LATEST_SCHEMA_SQL` in `src/backend/openbot-database-schema.ts` in the same change as each
migration:

| GoAhead version | Change to `LATEST_SCHEMA_SQL` |
| --- | --- |
| 32 | Replace the substitution target `V26_PROVIDER_SESSIONS_CHECK_SQL` with a frozen `V32_PROVIDER_SESSIONS_COLUMN_SQL` = `provider TEXT NOT NULL,`. Keep `V17`–`V26` constants: migrations still use them. |
| 33 | Append `PROVIDER_HISTORY_SCHEMA_SQL` (`src/backend/database/provider-history-schema.ts`). |
| 34 | Append `WEBHOOK_SCHEMA_SQL`. |
| 35 | Append `ROUTINE_FLOW_SCHEMA_SQL` (`src/backend/routine-flows/routine-flow-schema.ts`). |
| 36 | Append `AGENT_MEMORY_SELECTION_SCHEMA_SQL` (`src/backend/agent-memory-selection.ts`). |
| 37 | Rename `withRoutineLimitPolicy` to `withRoutinePolicies` (adds `missed_policy` after `limit_policy` on both routine tables). Add `withRunMissedColumns` for `projection_routine_runs` and `projection_channel_routine_runs` (columns before the `UNIQUE(trigger_id, scheduled_for)` constraint, where `ADD COLUMN` puts them). This needs two new frozen end markers, `BASELINE_ROUTINE_RUNS_END_SQL` and `V19_CHANNEL_ROUTINE_RUNS_END_SQL`. |

Append the new SQL after `MESSAGING_AUTO_REPLY_SCHEMA_SQL`. The order of the tail does not change the
parity result (the test sorts by type and name), but the GoAhead messaging tail stays first.

Update the comments that name migration numbers: upstream text says "migration 28", "v31",
"migration 33". Use the GoAhead numbers.

Tests that must pass (run one file at a time, as `AGENTS.md` says):

1. `bun run test:desktop -- src/backend/openbot-database-schema-parity.test.ts`:
   - `gives a new install the same tables, columns, indexes and foreign keys as an upgraded one`
   - `gives a new install the same declarations as an upgraded one, including partial index filters`
     (this one sees the removed CHECK, the FTS triggers and the partial index
     `routine_flow_steps_delivery`)
   - `records the same applied migration versions on both paths`
   - `keeps the schema change of every recorded migration`: entries 8–31 must not change; add
     entries 32–37. They must equal upstream 28–33 (section 1).
2. The migration test file of each task (section 2).
3. `bun run typecheck:node` once per task.

## 4. Order of work

Code dependencies (from the files each upstream commit changes):

- 08c994e5 (flows) uses `isEventRoutineTrigger` from `ipc-events.ts`, which 9e019602 (webhooks)
  adds. GoAhead has no `ipc-events.ts`, `ipc-routine-flows.ts`, `routine-records.ts` or
  `routine-tables.ts` now.
- 4ce20b63 (missed runs) changes `ipc-routine-flows.ts` (flows) and the upstream memory migration
  test (memories).
- fc0781c4 (memories) has no schema dependency on 30 or 31. Code overlap with flows is in
  `developer-instructions.ts` and `openbot-tool-router.ts`. **(unconfirmed: I did not prove that
  fc0781c4 builds without 08c994e5.)**

Recommended order. Each step is one PR with its migration, `LATEST_SCHEMA_SQL` change, history
entry and tests:

| Step | Notion task | Upstream | GoAhead version | Note |
| --- | --- | --- | --- | --- |
| 1 | new task (provider sync) | 28 | 32 | Small and standalone. Not part of GA-53–56. Needed before any upstream provider port (`pi`, `muse`). |
| 2 | new task (provider history) | 29 | 33 | Not part of GA-53–56. Belongs to the ee5376d4 port. If it waits, use the fallback mapping (1.1). |
| 3 | GA-54 webhooks | 30 | 34 | Also needs D1, Signal, Team API `events-v1` and `PRIVACY.md` work. |
| 4 | GA-55 flows | 31 | 35 | After GA-54 (code dependency). |
| 5 | GA-53 memories | 32 | 36 | Can move earlier only if the developer accepts a different number (Q2). |
| 6 | GA-56 missed runs | 33 | 37 | Last: depends on GA-54, GA-55 and the GA-53 test. |

Provider-session migrations and features:

- Upstream 28 (GoAhead 32) belongs to commit 6abbfbc8 only. No GA-53–56 feature needs it.
- Upstream 29 (GoAhead 33) belongs to commit ee5376d4 (provider history and recovery) only. No
  GA-53–56 feature reads `provider_history_*` tables (I searched upstream `src/backend`, `src/main`,
  `packages/contracts`; only provider clients, boot recovery, conversation writer and snapshots use
  them).

Release rule: do not ship a release with a number from this plan until the numbers before it are
merged. After a release ships a number, that number and its SQL are permanent.

Surfaces that each feature task must check (from `AGENTS.md`): desktop renderer, mobile
(`apps/mobile`), IPC contracts and `src/renderer/src/preview/mock-openbot.ts`, Team API
(`packages/contracts/src/team-protocol`), `apps/auth-api` (GA-54), `remote/api` (GA-54),
`PRIVACY.md` (GA-54 and GA-53 changed it upstream), `docs/ARCHITECTURE.md`, i18n keys, and a
`changelog.d/<branch>.md` note.

## 5. Open questions for the developer

1. **Upstream 29 now or later?** It is a large port (ee5376d4). If it waits, GA-54–56 and GA-53 take
   33–36 (fallback mapping). Which mapping do you want?
2. **Order of GA-53.** The Notion list starts with GA-53 (memories). This plan puts it fifth to keep
   the upstream order and code base. Do you want memories earlier, with a different number?
3. **Lineage guard.** Upstream OpenBot and GoAhead both use markers 28–31 with different meanings,
   and both name the file `openbot.db`. Normal installs use different user data folders (`GoAhead`
   vs `OpenBot`). But a user can point GoAhead at an OpenBot profile (`--user-data-dir`) or copy the
   file. Then GoAhead skips its Slack migrations and runs into missing tables. Do you want a guard
   (for example: refuse a database that has `provider_history_imports` but no `projection_messaging_inbox`)?
   Also note: upstream released v0.31.0–v0.33.0 too (commits 8af87353, c29b3a9c, c6ffd018), and those
   names are GoAhead tags here.
4. **D1 migrations for GA-54.** Upstream `0027_webhook_routes.sql` comes after upstream
   `0026_discord_guild_routes.sql`. GoAhead `0026` is `slack_person_routes`. The D1 renumbering needs
   its own plan under `apps/auth-api/AGENTS.md`. Do you want that as a new Notion task?
5. **Team API names.** Upstream adds `events-v1` (webhooks) and `agent-memories-v1` (memories)
   optional routes. Must GoAhead keep the upstream names and payloads for interop with upstream
   hosts? A released adapter is permanent, so decide before the first GoAhead release with them.
6. **Webhook transport and privacy.** Upstream webhooks go through Signal and the account service.
   Confirm that this fits "Cloudflare holds host configuration, not chats, files or commands", and
   approve the `PRIVACY.md` text. **(unconfirmed: I did not read the payload path in `remote/api`.)**
7. **FTS5.** GoAhead uses Electron 44.0.0; upstream uses 44.5.1 (`package.json`). The agent database
   host allows the `fts5` module (`src/backend/agent-data/agent-database-host.ts:35`), but I did not
   confirm that `node:sqlite` in GoAhead's packaged app has FTS5. Upgrade Electron first, or test it?
8. **Staging table name for 32.** This plan uses `projection_provider_sessions_v32`. Upstream uses
   `_v28`. The name leaves no trace after commit. Confirm.

## 7. Developer decisions (2026-10-13)

- Effect: port upstream feature code in GoAhead's Promise style. Do not add the `effect` dependency.
- Upstream 29 (provider history): keep GoAhead number 33 for it. Migrations run in order, so 34 and later do not ship before 33 exists.
- Order: plan order. 32 → 33 → GA-54 (34) → GA-55 (35) → GA-53 (36) → GA-56 (37).
- Lineage guard: add a guard that detects an upstream OpenBot `openbot.db` (markers 28–31 with upstream meaning) and stops with a clear error before any migration runs.
- Staging table name for 32: `projection_provider_sessions_v32` (default, not a developer decision).
- Open, for later decision: D1 numbering for GA-54 (question 4), Team API names `events-v1` / `agent-memories-v1` (question 5), webhooks through Signal and `PRIVACY.md` (question 6), FTS5 in Electron 44.0.0 (question 7, to check in code).
- 2026-10-13 (later): routine webhooks (upstream 30, GA-54) are dropped. New mapping: upstream 31 (flows, GA-55) → GoAhead 34, upstream 32 (memories, GA-53) → 35, upstream 33 (missed runs, GA-56) → 36. Upstream 30 is not ported, so the GoAhead history entries 34–36 must be checked against upstream 31–33 for any column or table that depends on the webhook tables (none expected; verify). GA-55 is ported without event/webhook triggers (`isEventRoutineTrigger` and `ipc-events.ts` stay out). D1 question 4 and Team API `events-v1` (question 5) and question 6 are closed: not needed.
- Order now: 32 → 33 (provider history) → GA-55 (34) → GA-53 (35) → GA-56 (36).
