# Multi-user Slack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Several people in one Slack workspace connect their own GoAhead; each GoAhead serves only its owner, a default computer answers people without GoAhead, and people can reply to Slack from GoAhead.

**Architecture:** The account service keeps one route per person plus the workspace's default route. Route tickets carry both. Signal routes each Slack event by author, draft owner, or Slack's "who may see" list. Each desktop host stays single-person; it marks draft buttons with its owner and gets a reply box in the inbox.

**Tech Stack:** Bun monorepo; Cloudflare Worker + D1 (`apps/auth-api`, TanStack Solid Start routes, zod); Signal (`remote/api`, Bun/Elysia); Electron main/backend (TypeScript, node:sqlite); SolidJS renderer; Vitest.

**Spec:** `docs/superpowers/specs/2026-10-08-multi-user-slack-design.md`

## Global Constraints

- Read `AGENTS.md` and the `AGENTS.md` of every directory you change before you edit it.
- Do not run `git commit`, `git push`, `git tag`, `git stash`, `git reset` or `git checkout`. The user commits and pushes. Leave changes in the working tree.
- Change only the files your task lists. If you need another file, stop and report it.
- Checks: run only your task's own test files, one at a time (`bun run test:desktop -- <path>` for desktop and `remote/api`; `bun run --cwd apps/auth-api test:server <path>` for the Worker). Lint only changed files: `bunx biome check --write --max-diagnostics=none <paths>`. Do not run `bun run typecheck`, `bun run test`, `bun run format`, builds, or full suites. The coordinator runs the project typechecks one at a time at the end.
- D1 migrations are additive only. No column or table is dropped or renamed.
- Released contracts stay compatible: a route ticket without the new fields keeps today's meaning; the Team API wire does not change.
- Text that a user reads comes from `@openbot/i18n` English catalog keys (`packages/i18n/src/messages/en/<area>.ts`); errors sent from main/backend/Worker use `sourceText(key)`. Translations are optional.
- No `biome-ignore`, `@ts-expect-error`, `@ts-ignore`, `as any`, widening to `unknown` at a boundary.
- Never log or return a Slack token. Redact secrets on every log path.
- Slack app manifests do not change.

## Review Focus

- A private DM or group DM between two people reaches only computers of people in it, never a third person's (Task 7 test "private DM reaches only its members").
- An old host's route ticket (no `isDefault`, no `users`) still routes the whole workspace to that host after the deploy (Task 6 test "old ticket keeps workspace route"; Task 3 test "ticket without people validates").
- A Slack retry of an event that one computer already accepted does not run the agent twice on that computer (Task 8 test "repeat delivery is dropped").
- Preet clicking Approve on Shubham's draft never sends it (Task 7 rule 2 test + Task 9 test "non-owner click is refused").
- The default's owner disconnecting while others remain leaves a default (Task 3 test "default moves to earliest person").

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `packages/contracts/src/signal-protocol/slack-route.ts` | Route ticket types (+`isDefault`, `users`), owner block id helpers | 1 |
| `packages/contracts/src/signal-protocol/auth-events.ts` | `slack-person-route-revoked` event | 1 |
| `packages/contracts/src/ipc-endpoints.ts` (+ its messaging types file) | `messaging:send-inbox-reply`, `messaging:get-slack-routing`, `messaging:hand-over-slack-default` | 1 |
| `packages/i18n/src/messages/en/connector.ts`, `.../en/messaging.ts` (or the area that holds inbox keys) | New English keys | 1 |
| `apps/auth-api/migrations/0026_slack_person_routes.sql` + test | Person route table | 2 |
| `apps/auth-api/src/server/remote-control-plane.ts` + routes `v2/remote/slack-route/validate.ts`, `v2/remote/hosts/$hostId/slack-disconnect.ts`, new `v2/remote/hosts/$hostId/slack-default.ts` + tests | Tickets, validation, disconnect, handover, routing status | 3 |
| `apps/auth-api/src/server/slack-app.ts` + test | OAuth callback: second person, `slack_user_access_required` | 4 |
| `remote/api/src/slack-targets.ts` (new) + test | Pure routing rules 1–4 | 5 |
| `remote/api/src/slack-authorizations.ts` (new) + test | `apps.event.authorizations.list` client with per-event cache | 5 |
| `remote/api/src/signal-service.ts`, `app.ts`, `config.ts`, `index.ts`, `tokens.ts` + tests | Two route maps, multi-target delivery, new auth event, `SLACK_APP_TOKEN` | 6, 7 |
| `src/backend/messaging/slack/slack-driver.ts`, `slack-events.ts` | Owner `block_id`, owner check on clicks, post as user | 8 |
| `src/backend/messaging/messaging-service.ts`, `src/main/ipc/messaging-handlers.ts`, `src/main/central-auth-manager.ts`, `src/preload/index.ts`, `src/renderer/src/preview/mock-messaging.ts` | Reply, routing status, handover plumbing | 9 |
| Renderer inbox view + Slack connector settings (`src/renderer/src/features/messaging-threads/*`, Slack connector settings component) | Reply box; default line; Hand over | 10 |
| `src/main/slack-workspace.test.ts` | Two-host E2E | 11 |
| `docs/goahead-internal-release.md`, `docs/ARCHITECTURE.md`, `PRIVACY.md`, `changelog.d/multi-user-slack.md` | Rollout, outbound data, notes | 12 |

Execution order: Task 1 first (everyone consumes it). Then Tasks 2, 4, 5, 8, 10, 12 in parallel; Task 3 after 2; Tasks 6 and 7 after 5 (6 then 7, same files); Task 9 after 8; Task 11 last.

---

### Task 1: Shared contracts and text keys

**Files:**
- Modify: `packages/contracts/src/signal-protocol/slack-route.ts`
- Modify: `packages/contracts/src/signal-protocol/auth-events.ts:17`
- Modify: `packages/contracts/src/ipc-endpoints.ts` (messaging group near `listInbox`, line ~625) and the file that defines `ReadInboxConversationInput` / `MessagingInboxWorkspace`
- Modify: English i18n modules for `connector.*` and the inbox area
- Test: `packages/contracts/src/signal-protocol/slack-route.test.ts` (create if absent)

**Interfaces — Produces:**

```ts
// slack-route.ts (additions; existing fields unchanged)
export interface SlackRouteUser {
  /** The Slack user ID (`U…`). */
  id: string;
  /** When the account service linked this person to the host, in milliseconds. */
  linkedAt: number;
}
export interface SlackRouteTeam {
  id: string;
  appId: string;
  linkedAt: number;
  /** Absent in tickets made before multi-user Slack: the host is then the workspace's default. */
  isDefault?: boolean;
  /** The people of this workspace whose requests go to this host. */
  users?: SlackRouteUser[];
}
/** True when the ticket entry makes this host the workspace's default computer. */
export function isDefaultSlackRoute(team: SlackRouteTeam): boolean {
  return team.isDefault !== false;
}
/** Draft buttons' actions block carries the draft owner, so Signal can route a click to the owner. */
export const SLACK_OWNER_BLOCK_PREFIX = "goahead-owner:";
export function slackOwnerBlockId(slackUserId: string): string {
  return `${SLACK_OWNER_BLOCK_PREFIX}${slackUserId}`;
}
export function slackOwnerFromBlockId(blockId: unknown): string | null {
  if (typeof blockId !== "string" || !blockId.startsWith(SLACK_OWNER_BLOCK_PREFIX)) return null;
  const id = blockId.slice(SLACK_OWNER_BLOCK_PREFIX.length);
  return /^[UW][A-Z0-9]{2,}$/.test(id) ? id : null;
}

// auth-events.ts: add to the union
| { type: "slack-person-route-revoked"; appId: string; teamId: string; userId: string; through: number }

// IPC (messaging group)
sendInboxReply: request<SendInboxReplyInput, void>()("messaging:send-inbox-reply"),
getSlackRouting: request<{ workspaceId: string }, SlackRoutingStatus>()("messaging:get-slack-routing"),
handOverSlackDefault: request<{ workspaceId: string; slackUserId: string }, SlackRoutingStatus>()(
  "messaging:hand-over-slack-default",
),

export interface SendInboxReplyInput {
  workspaceId: string;
  conversation: string; // the inbox conversation id, as ReadInboxConversationInput
  threadKey?: string;
  text: string; // 1..4000 characters after trim
}
export interface SlackRoutingPerson { slackUserId: string; displayName: string }
export interface SlackRoutingStatus {
  /** This computer answers people without GoAhead. */
  isDefault: boolean;
  /** Other connected people the default can be handed to (only filled when isDefault). */
  people: SlackRoutingPerson[];
}
```

English keys (exact names; English text in the module):
- `connector.slack.defaultOn`: "This computer answers people who do not use GoAhead."
- `connector.slack.defaultOff`: "Another person's computer answers people who do not use GoAhead."
- `connector.slack.handOver`: "Hand over…"
- `connector.slack.handOverTitle`: "Answer people who do not use GoAhead from another computer"
- `connector.slack.userAccessRequired`: "Connect Slack again and allow GoAhead to act as you. Another person already connected this workspace."
- Inbox area: `…reply.placeholder` "Reply as you", `…reply.send` "Send", `…reply.failed` "Slack did not accept the reply." (use the inbox area's existing prefix).

- [ ] **Step 1: Write the failing test** `slack-route.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isDefaultSlackRoute, slackOwnerBlockId, slackOwnerFromBlockId } from "./slack-route";

describe("slack route", () => {
  it("reads a ticket entry without isDefault as the default", () => {
    expect(isDefaultSlackRoute({ id: "T1", appId: "A1", linkedAt: 1 })).toBe(true);
    expect(isDefaultSlackRoute({ id: "T1", appId: "A1", linkedAt: 1, isDefault: false })).toBe(false);
  });
  it("round-trips the owner block id and refuses anything else", () => {
    expect(slackOwnerFromBlockId(slackOwnerBlockId("U123ABC"))).toBe("U123ABC");
    expect(slackOwnerFromBlockId("goahead-owner:not a user")).toBeNull();
    expect(slackOwnerFromBlockId("other")).toBeNull();
    expect(slackOwnerFromBlockId(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (`isDefaultSlackRoute` not exported): `bun run test:desktop -- packages/contracts/src/signal-protocol/slack-route.test.ts`
- [ ] **Step 3: Add the code above** to the listed files; register the three endpoints in the messaging group of `ipc-endpoints.ts` next to `readInboxConversation`; add the English keys.
- [ ] **Step 4: Run the test, expect PASS.** Lint the changed files.
- [ ] **Step 5: Do not commit.** Report the exact type names and file paths you added.

---

### Task 2: D1 migration `0026_slack_person_routes`

**Files:**
- Create: `apps/auth-api/migrations/0026_slack_person_routes.sql`
- Test: the Worker's D1 migration test (find the test that applies `migrations/*.sql`, e.g. `apps/auth-api/test/*migration*.test.ts`); add a case there, or create `apps/auth-api/test/slack-person-routes-migration.test.ts` following its pattern.

**Interfaces — Produces:** table `slack_person_routes(team_id, slack_user_id, host_id, account_id, connected_at)`, PK `(team_id, slack_user_id)`, index `slack_person_routes_host(host_id)`.

- [ ] **Step 1: Write the failing test**: apply migrations up to 0025, insert a `users`, `remote_hosts` and `slack_workspace_routes` row, apply 0026, then assert (a) the 0025 row is unchanged, (b) inserting two person rows for one team with different `slack_user_id` succeeds, (c) a second insert with the same `(team_id, slack_user_id)` fails, (d) deleting the `remote_hosts` row deletes its person rows.
- [ ] **Step 2: Run it, expect FAIL** (no table).
- [ ] **Step 3: Write the migration:**

```sql
-- New table only. The Worker that runs before this deploy does not read it.
-- One row for each person who connected their own GoAhead to a Slack workspace. Signal sends that
-- person's requests and private messages to this host. `slack_workspace_routes` keeps the
-- workspace's default host, which answers people without GoAhead.
CREATE TABLE slack_person_routes (
  team_id TEXT NOT NULL,
  slack_user_id TEXT NOT NULL,
  host_id TEXT NOT NULL REFERENCES remote_hosts(host_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connected_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, slack_user_id)
);

CREATE INDEX slack_person_routes_host ON slack_person_routes(host_id);
```

- [ ] **Step 4: Run the test, expect PASS.**
- [ ] **Step 5: Do not commit.**

---

### Task 3: Worker control plane — tickets, validation, disconnect, handover, status

**Depends on:** Tasks 1, 2.

**Files:**
- Modify: `apps/auth-api/src/server/remote-control-plane.ts:1159-1214` (`issueSlackRoute`, `validateSlackRoute`, `disconnectSlackWorkspace`); add `slackRoutingStatus`, `handOverSlackDefault`
- Modify: `apps/auth-api/src/routes/v2/remote/slack-route/validate.ts` (schema accepts optional `isDefault`, `users`; response adds `routes`)
- Modify: `apps/auth-api/src/routes/v2/remote/hosts/$hostId/slack-disconnect.ts` (find exact file the host calls at `src/main/central-auth-manager.ts:366`): accept optional `slackUserId`
- Create: `apps/auth-api/src/routes/v2/remote/hosts/$hostId/slack-default.ts` (GET status, POST handover), same auth as `slack-disconnect`
- Test: the control plane test file for Slack routes (search `issueSlackRoute` in `apps/auth-api/test`)

**Interfaces:**
- Consumes: `SlackRouteTeam`, `SlackRouteUser`, `slack-person-route-revoked` (Task 1); table (Task 2).
- Produces:
  - `issueSlackRoute(hostId, machineToken): Promise<{ ticket: string; teams: string[] }>` — ticket `teams` = for each team where the host is default or has person rows: `{ id, appId, linkedAt, isDefault, users }`. `linkedAt` = the workspace row's `connected_at` when default, else the newest person row's. Limit `SLACK_ROUTE_TEAMS_LIMIT` teams.
  - `validateSlackRoute(input: { hostId: string; teams: SlackRouteTeam[] }): Promise<{ teams: string[]; routes: SlackRouteTeam[] }>` — `teams`: ids whose default link still holds (old meaning, for old Signal); `routes`: each entry reduced to what D1 still holds (default only if workspace row matches `appId` + `linkedAt`; users only those whose person row matches `id` + `linkedAt` and `host_id`). An entry without `isDefault` and without `users` validates exactly as today.
  - `disconnectSlackWorkspace(hostId, machineToken, teamId, slackUserId?: string): Promise<void>` — with `slackUserId`: delete that person row (emit `slack-person-route-revoked`); if the host also holds the workspace row: move it to the remaining person row with the smallest `connected_at` (update `host_id`, `account_id`, `connected_at = now`, emit `slack-route-revoked` through `now - 1`), or delete it if none remain. Without `slackUserId`: today's behaviour plus delete the team's person rows on this host.
  - `slackRoutingStatus(hostId, machineToken, teamId): Promise<{ isDefault: boolean; people: { slackUserId: string }[] }>` — `people` = other person rows of the team, only when `isDefault`.
  - `handOverSlackDefault(hostId, machineToken, teamId, slackUserId): Promise<void>` — only when this host holds the workspace row; target must be a person row of the same team on another host; move the workspace row there (`connected_at = now`), emit `slack-route-revoked` through `now - 1`. Otherwise `RemoteControlPlaneError(409, "slack_default_not_owned", …)` / `(404, "slack_person_not_found", …)`.

- [ ] **Step 1: Write failing tests** (one `it` each): "ticket lists default and person routes"; "ticket without people validates as today" (old-shape input → `teams` has the id, `routes[0]` has no `users`); "validate drops a moved person"; "person disconnect keeps the bot for others"; "default moves to earliest person" (two other people with `connected_at` 10 and 20 → workspace row now on the host of 10); "last person disconnect deletes the workspace row"; "handover moves the default"; "handover refused when not default".
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** in `remote-control-plane.ts`. Example core of `issueSlackRoute`:

```ts
const defaults = await this.#database
  .prepare("SELECT team_id, app_id, connected_at FROM slack_workspace_routes WHERE host_id = ?")
  .bind(hostId)
  .all<{ team_id: string; app_id: string; connected_at: number }>();
const people = await this.#database
  .prepare(
    `SELECT p.team_id, p.slack_user_id, p.connected_at, w.app_id
       FROM slack_person_routes p JOIN slack_workspace_routes w ON w.team_id = p.team_id
      WHERE p.host_id = ?`,
  )
  .bind(hostId)
  .all<{ team_id: string; slack_user_id: string; connected_at: number; app_id: string }>();
const byTeam = new Map<string, SlackRouteTeam>();
for (const row of defaults.results)
  byTeam.set(row.team_id, { id: row.team_id, appId: row.app_id, linkedAt: row.connected_at, isDefault: true, users: [] });
for (const row of people.results) {
  const team = byTeam.get(row.team_id) ?? { id: row.team_id, appId: row.app_id, linkedAt: 0, isDefault: false, users: [] };
  team.users = [...(team.users ?? []), { id: row.slack_user_id, linkedAt: row.connected_at }];
  if (!team.isDefault) team.linkedAt = Math.max(team.linkedAt, row.connected_at);
  byTeam.set(row.team_id, team);
}
const teams = [...byTeam.values()].sort((a, b) => b.linkedAt - a.linkedAt).slice(0, SLACK_ROUTE_TEAMS_LIMIT);
```

  Update the validate route to parse `isDefault: z.boolean().optional()` and `users: z.array(z.object({ id: z.string().min(1).max(64), linkedAt: z.number().int().nonnegative() })).max(64).optional()`, and return `json(await …validateSlackRoute(parsed.data))` (now `{ teams, routes }`). Add the `slack-default` route (GET → status, POST `{ teamId, slackUserId }` → handover) with the same host authentication as `slack-disconnect`.
- [ ] **Step 4: Run the tests, expect PASS.** Lint changed files.
- [ ] **Step 5: Do not commit.**

---

### Task 4: Worker OAuth callback — second person

**Depends on:** Tasks 1, 2.

**Files:**
- Modify: `apps/auth-api/src/server/slack-app.ts:138-234` (`complete()`), error code list near `:218`
- Modify: `apps/auth-api/src/components/landing/SlackConnectPage.tsx` (show the new error with its catalog text, as `slack_workspace_taken` is shown)
- Test: the existing `slack-app` server test in `apps/auth-api/test`

**Interfaces — Produces:** error code `slack_user_access_required` (409). Person row written for `authed_user.id` on every successful connect that has a user token.

- [ ] **Step 1: Write failing tests:** "second account connects the same team" (first connect by account A/host H1, second by account B/host H2 with `authed_user` user token → 200, workspace row still on H1, person rows for both users); "second account without user token is refused" (→ `slack_user_access_required`, no rows changed); "same person reconnects on another host" (person row moves; if they own the workspace row it moves too, emitting `slack-route-revoked`).
- [ ] **Step 2: Run, expect FAIL** (today returns `slack_workspace_taken`).
- [ ] **Step 3: Implement.** Replace the single upsert batch with:

```ts
const user = userGrant(body); // existing helper; null when no user token
const existing = await this.#database
  .prepare("SELECT host_id, account_id FROM slack_workspace_routes WHERE team_id = ?")
  .bind(team.id)
  .first<{ host_id: string; account_id: string }>();
if (existing && existing.account_id !== state.u && !user) {
  throw new SlackAppError(409, "slack_user_access_required", sourceText("connector.slack.userAccessRequired"));
}
const statements = [];
if (!existing || existing.account_id === state.u) {
  // today's upsert of slack_workspace_routes + slack-route-revoked event, unchanged
}
if (user) {
  statements.push(
    this.#database
      .prepare(
        `INSERT INTO slack_person_routes (team_id, slack_user_id, host_id, account_id, connected_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(team_id, slack_user_id) DO UPDATE SET host_id = excluded.host_id,
           account_id = excluded.account_id, connected_at = excluded.connected_at`,
      )
      .bind(team.id, user.id, state.h, state.u, now),
  );
  // emit slack-person-route-revoked through now - 1 for this (team, user) so Signal drops an old host
}
await this.#database.batch(statements);
```

  Use the module's real error class and event helper names; keep enterprise refusal and the dev spike log unchanged. Remove the `slack_workspace_taken` branch only where the new logic replaces it.
- [ ] **Step 4: Run the tests, expect PASS.** Lint changed files.
- [ ] **Step 5: Do not commit.**

---

### Task 5: Signal routing rules and authorizations client (pure modules)

**Depends on:** Task 1.

**Files:**
- Create: `remote/api/src/slack-targets.ts`, `remote/api/src/slack-targets.test.ts`
- Create: `remote/api/src/slack-authorizations.ts`, `remote/api/src/slack-authorizations.test.ts`

**Interfaces — Produces:**

```ts
// slack-targets.ts
export type SlackTarget =
  | { kind: "default" }                    // the workspace's default host
  | { kind: "person"; userId: string }     // that person's host
  // Ask Slack who may see it. `directAuthor` is set for a DM message from a person: when Slack's
  // list includes the bot, the DM is with @GoAhead and rule 1 applies to that author.
  | { kind: "people"; eventContext: string; directAuthor?: string }
  | { kind: "all" }                        // every host of the team
  | { kind: "persons"; userIds: string[] }; // listed people only
export interface SlackRequestFacts {
  kind: "event" | "interactivity";
  /** Parsed JSON body (events) or parsed `payload` (interactivity). */
  body: Record<string, unknown>;
  botUserId: string | null; // from authorizations[].user_id where is_bot, if present
}
/** Rules 1–4 of the spec. Returns the targets in priority order: the first one that has a host wins
 *  for rules 1–2; rule 3 and 4 targets are used whole. */
export function slackTargets(facts: SlackRequestFacts): SlackTarget[];

// slack-authorizations.ts
export interface SlackAuthorizationsOptions {
  appToken: (appId: string) => string | null; // SLACK_APP_TOKEN per app
  fetch?: typeof fetch;
  cacheSeconds?: number; // default 600
}
export class SlackAuthorizations {
  constructor(options: SlackAuthorizationsOptions);
  /** Who may see the event: person user IDs, and whether the bot is among them. Throws on a Slack
   *  error; the caller answers 503. */
  usersFor(appId: string, eventId: string, eventContext: string): Promise<{ users: string[]; includesBot: boolean }>;
}
```

Rules in `slackTargets`:
1. `event.type === "app_mention"` → `[{ kind: "person", userId: event.user }, { kind: "default" }]`. A DM with the bot cannot be told apart from a DM between two people by the event alone (both are `channel_type: "im"`), so DMs go through rule 3 with `directAuthor = event.user` (unset for bot messages: `bot_id` set or `subtype === "bot_message"`); Task 7 applies rule 1 when Slack's list includes the bot.
2. Interactivity: `owner = slackOwnerFromBlockId(actions[0].block_id)`; → owner ? `[person(owner)]` : `[person(user.id), default]`.
3. Other `message` events with `event_context` → `[{ kind: "people", eventContext, directAuthor? }]` (`directAuthor` only when `channel_type === "im"`).
4. `app_uninstalled` → `[{kind:"all"}]`; `tokens_revoked` → `[{ kind: "persons", userIds: event.tokens.oauth ?? [] }, …bot ? all]` (if `tokens.bot` non-empty → `all`).
Anything else (e.g. `channel_created`) → `[{ kind: "all" }]`.

- [ ] **Step 1: Write failing tests** for each rule, including "private DM reaches only its members" (rule 3 returns `people`, not `all`), "a DM from a person carries directAuthor", "a bot's own DM message has no directAuthor", "click without owner goes to clicker then default", "tokens_revoked with only user tokens names those users".
- [ ] **Step 2: Write failing tests** for `SlackAuthorizations`: posts `event_context` to `https://slack.com/api/apps.event.authorizations.list` with `Authorization: Bearer <xapp>`; follows `response_metadata.next_cursor`; returns `is_bot` entries as `includesBot: true`, not as users; returns cached result for the same `eventId` without a second fetch; throws on `ok: false` and when no app token; never puts the token in an error message.
- [ ] **Step 3: Run both, expect FAIL.**
- [ ] **Step 4: Implement** both modules (pure; no imports from `signal-service.ts`).
- [ ] **Step 5: Run, expect PASS.** Lint. Do not commit.

---

### Task 6: Signal ingress — two route maps and tickets

**Depends on:** Tasks 1, 3 (validate response shape), 5.

**Files:**
- Modify: `remote/api/src/signal-service.ts` (`#slackTeams` → `#slackDefaults` + `#slackPeople`; `#authenticate` ingress branch `:461-513`; `revokeSlackRoute`; new `revokeSlackPersonRoute`; peer cleanup `:276`)
- Modify: `remote/api/src/tokens.ts:75-147` (`validateSlackRoute` returns `{ teams: string[]; routes?: SlackRouteTeam[] }`)
- Modify: `remote/api/src/index.ts:33` (pass the Worker's new response through)
- Modify: `remote/api/src/app.ts:36,63` (accept `slack-person-route-revoked`; unknown auth event types are skipped, not fatal)
- Test: the existing Signal service test file for Slack (search `deliverSlack` in `remote/api/src/*.test.ts`)

**Interfaces — Produces (used by Task 7):**

```ts
// in SignalService
#slackDefaults: Map<string /* appId:teamId */, string /* socketId */>;
#slackPeople: Map<string /* appId:teamId:userId */, string /* socketId */>;
#slackRouteFloor: Map<string, number>; // keys of both kinds
revokeSlackPersonRoute(appId: string, teamId: string, userId: string, through: number): void;
/** Sockets for one target; empty when no host holds it. */
#slackSockets(appId: string, teamId: string, target: SlackTarget, users?: string[]): string[];
```

Ingress registration: for each ticket team, if `isDefaultSlackRoute(team)` and `team.linkedAt >= floor(appId:teamId)` → set default. For each `team.users`, key `appId:teamId:userId`, same floor rule with the user's `linkedAt`. During the validation window use `routes` from the validate response when present, else today's `teams` list.

- [ ] **Step 1: Write failing tests:** "old ticket keeps workspace route" (ticket team without `isDefault`/`users` → default map set); "person-only ticket does not take the workspace" (`isDefault:false`, users `[U2]` → only person key set; an existing default socket stays); "person revocation drops only that person"; "newer person link wins over an older ticket"; "unknown auth event type is ignored".
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.** Lint. Do not commit.

---

### Task 7: Signal delivery — targets, fan-out, `SLACK_APP_TOKEN`

**Depends on:** Task 6 (same files; run after it).

**Files:**
- Modify: `remote/api/src/signal-service.ts` (`deliverSlack` signature and body `:368-410`)
- Modify: `remote/api/src/app.ts:79-110, 204` (compute facts and targets; pass them)
- Modify: `remote/api/src/config.ts:21-41` (parse `SLACK_APP_TOKEN` as `<appId>:<xapp-…>[,…]`, like `SLACK_SIGNING_SECRET`; secret is never logged)
- Modify: `render.yaml` (add `SLACK_APP_TOKEN` with `sync: false`), `remote/.env.example` or equivalent example env (name only)
- Test: the Signal Slack delivery tests + `remote/api/src/app.test.ts` (or the file that tests `/v1/slack/events`)

**Interfaces:**
- Consumes: `slackTargets`, `SlackAuthorizations` (Task 5), maps (Task 6).
- Produces: `deliverSlack(appId: string, teamId: string, targets: SlackTarget[], delivery: SlackDelivery & { eventId: string | null }): Promise<SlackDeliveryResponse>`.

Behaviour: resolve targets to a set of socket ids:
- `person`/`default` lists (rules 1–2): first target that has a socket; none → 503.
- `people`: `usersFor(...)`. If `includesBot` and `directAuthor` is set, the DM is with @GoAhead: use rule 1 (`directAuthor`'s socket, else the default; none → 503). Otherwise send to the person sockets of the listed users only. If the lookup throws → 503. If no listed person has a socket → 200 with nothing delivered (nobody with GoAhead may see it).
- `all`: default socket plus every person socket of the team. `persons`: those users' sockets.
Send the same frame to each socket in parallel (reuse today's pending/limit/timeout logic per socket); answer the first non-200 if any socket fails, else the default socket's response when it was a target, else 200.

- [ ] **Step 1: Write failing tests:** "DM to the bot from Preet goes to Preet's host" (authorizations include the bot); "DM between two people does not go to the default" (authorizations without the bot); "DM from a person without GoAhead goes to the default"; "private DM reaches only its members" (authorizations `[U1, U2]`, hosts for U1, U2, U3 → U3 gets nothing); "one offline member makes Slack retry" (→ 503); "click on Shubham's draft by Preet goes to Shubham's host"; "authorizations failure answers 503"; "SLACK_APP_TOKEN is parsed per app and never logged".
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.** Lint. Do not commit.

---

### Task 8: Host Slack driver — owner block id, owner check, post as user

**Depends on:** Task 1.

**Files:**
- Modify: `src/backend/messaging/slack/slack-driver.ts:440-460` (`#content`), and add `postAsUser`
- Modify: `src/backend/messaging/slack/slack-events.ts:145` (read the clicker; expose it to the service)
- Test: `src/backend/messaging/slack/slack-driver.test.ts`, `slack-events.test.ts` (existing)

**Interfaces — Produces:**

```ts
// slack-driver.ts
// actions block gets block_id: slackOwnerBlockId(ownerUserId) when the driver knows its owner (identity.user.id)
postAsUser(input: { channel: string; threadTs?: string; text: string }): Promise<{ ts: string }>;
// uses the user token; throws MessagingError with sourceText("…reply.failed") on Slack error; never logs the token
```

- [ ] **Step 1: Write failing tests:** "draft buttons carry the owner block id" (driver with identity user `U1` → actions block `block_id === "goahead-owner:U1"`, button `value` unchanged); "no owner, no block id"; "postAsUser posts with the user token in the thread"; "postAsUser without a user token refuses".
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.** Lint. Do not commit.

---

### Task 9: Host service and IPC — reply, routing status, handover, person disconnect

**Depends on:** Tasks 1, 3 (endpoint paths), 8.

**Files:**
- Modify: `src/backend/messaging/messaging-service.ts` (new `sendInboxReply`, `slackRouting`, `handOverSlackDefault`; `#connect.unlink` passes the owner's Slack user id; refuse a draft click whose clicker is not the owner — confirm this check exists at `:345, 1287` and keep it)
- Modify: `src/main/central-auth-manager.ts:366` (`slack-disconnect` body adds `slackUserId`; new `slackDefaultStatus`, `handOverSlackDefault` calls to `/v2/remote/hosts/$hostId/slack-default`)
- Modify: `src/main/ipc/messaging-handlers.ts:31-86` (three handlers), `src/main/ipc/messaging-inputs.ts` (input decoders)
- Modify: `src/preload/index.ts:635-646` (bridge group), `src/renderer/src/preview/mock-messaging.ts` (mocks with behaviour)
- Test: `src/backend/messaging/messaging-service.test.ts`, `src/main/ipc-channel-coverage.test.ts` (must pass unchanged)

**Interfaces:**
- Consumes: `postAsUser` (Task 8), IPC types (Task 1), Worker endpoints (Task 3).
- Produces: `MessagingService.sendInboxReply(input: SendInboxReplyInput): Promise<void>` — owner's connection only; text trimmed, 1–4000 chars; audit-log entry like other sends; no pause/limit check. `slackRouting(workspaceId): Promise<SlackRoutingStatus>` (display names from the driver's user lookup). `handOverSlackDefault(workspaceId, slackUserId): Promise<SlackRoutingStatus>`.

- [ ] **Step 1: Write failing tests:** "reply goes out as the owner even when sends are paused"; "reply over 4000 characters is refused"; "reply without a user token is refused"; "non-owner click is refused" (if not already covered — add only if absent); "disconnect sends the owner's Slack user id".
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the service methods, handlers, preload and mock.
- [ ] **Step 4: Run** `messaging-service.test.ts`, then `src/main/ipc-channel-coverage.test.ts`, one at a time; expect PASS. Lint. Do not commit.

---

### Task 10: Renderer — reply box and default line

**Depends on:** Task 1 (types and keys only; uses `window.openbot.messaging` through the existing port).

**Files:**
- Modify: `src/renderer/src/features/messaging-threads/messaging-threads-port.ts` (add `sendInboxReply`, `getSlackRouting`, `handOverSlackDefault` to the `Pick`)
- Modify: `src/renderer/src/features/messaging-threads/messaging-threads-context.tsx` (`sendInboxReply(text)` for the open inbox selection; after success, reload the page)
- Modify: the inbox conversation view component (find it via `readInboxConversation` usage) — add a reply box (reuse `@openbot/ui` text area and button primitives; read `packages/ui/AGENTS.md`)
- Modify: the Slack connector settings component (find via `connector.slack.pauseTitle`) — default line and "Hand over…" menu of `people`
- Test: the existing `*.test.tsx` of the inbox view and of the Slack connector settings, if present; else one `*.test.tsx` per component using accessible roles

- [ ] **Step 1: Write failing tests:** "Send posts the reply and clears the box" (role `textbox` name from `…reply.placeholder`, role `button` "Send", `await waitFor(() => expect(sendInboxReply).toHaveBeenCalledWith(...))`); "Send is disabled for empty text"; "a failed send keeps the text and shows the error"; "settings shows the default line and hands over to the chosen person".
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** with existing components and catalog keys; no literals, no `data-testid`.
- [ ] **Step 4: Run each test file alone, expect PASS.** Lint. Do not commit.

---

### Task 11: E2E — two hosts in one workspace

**Depends on:** Tasks 3–9.

**Files:**
- Modify: `src/main/slack-workspace.test.ts` (add one `it`, reuse `connectedAsUser`)

- [ ] **Step 1: Write the test** "two people, one workspace": Worker test double with migration 0026; host A (Shubham, `U1`) connects first, host B (Preet, `U2`) second; Signal in process with a fake Slack authorizations endpoint. Assert: a DM to the bot from `U2` reaches only host B and is answered there; a DM from `U3` (no GoAhead) reaches host A (default); a DM between `U1` and `U2` (authorizations `[U1, U2]`) lands in both inboxes; a DM between `U2` and `U3` (authorizations `[U2]`) lands only in B's inbox; B's reply from the inbox is posted with B's user token; B disconnects → A stays default and keeps working. Write a JSON report to `.openbot-build/slack-workspace-e2e/two-people.json`.
- [ ] **Step 2: Run it alone; fix only test wiring.** Product bugs go back to the owning task. Do not commit.

---

### Task 12: Docs and release notes

**Depends on:** none (text only).

**Files:**
- Modify: `docs/goahead-internal-release.md` (new step: create the app-level token with `authorizations:read`, set `SLACK_APP_TOKEN` on Render as `<appId>:<xapp-…>`; deploy order D1 → Signal → Worker → app; each person reconnects Slack once)
- Modify: `docs/ARCHITECTURE.md` (Slack routing: default and person routes)
- Modify: `PRIVACY.md` (Signal sends an event context to Slack's `apps.event.authorizations.list` to learn who may see a message; it keeps the answer in memory for 10 minutes)
- Create: `changelog.d/multi-user-slack.md`

```md
### Added

- Several people in one Slack workspace can now connect their own GoAhead. Each GoAhead answers only
  its own person: their direct messages to @GoAhead, their inbox and the messages it sends for them.
  People who do not use GoAhead are answered by the computer that connected the workspace first.
  **Connect Slack again once after you update**, so your computer receives your own messages.
- Reply to a Slack conversation from the Slack inbox in GoAhead. The reply goes out as you.
```

- [ ] **Step 1: Write the docs.** `bun scripts/check-release-notes.ts` must pass. Do not commit.

---

## Final check (coordinator, one command at a time)

1. `bun run typecheck:node`
2. `bun run typecheck:renderer`
3. `bun run --cwd apps/auth-api typecheck` (or the package's `typecheck` script)
4. The `remote/api` package's `typecheck` script
5. Each task's test files once more, one at a time
6. Report what remains unverified (mobile typecheck, full suites → CI). The user commits and pushes.
