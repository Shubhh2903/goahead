# Multi-user Slack: one workspace, one GoAhead per person

Date: 2026-10-08. Status: approved design, not built. Project A of two; project B (requests between
people's GoAheads) gets its own spec after A.

## Goal

Several people in one Slack workspace connect their own GoAhead. Each GoAhead serves only its owner:
inbox, reminders, sends on the owner's behalf. A person without GoAhead who writes to @GoAhead gets an
answer from the workspace's default computer. People can also reply to Slack from inside GoAhead.

Success: Preet and Shubham both connect GoAhead to Multi Code Genius. A DM to @GoAhead from each one is
answered by their own computer. A DM from a person without GoAhead is answered by the default computer.
A private DM between two people reaches only those two people's computers.

## Today (why Preet is refused)

One workspace has exactly one route:

- D1 `slack_workspace_routes` has `team_id` as primary key (`apps/auth-api/migrations/0025`). The
  callback upsert changes the row only for the same account; another account gets
  `slack_workspace_taken` (`apps/auth-api/src/server/slack-app.ts:194-220`).
- Signal maps `appId:teamId` to one ingress socket (`remote/api/src/signal-service.ts:133`).
- The host keeps one connection row per workspace, `UNIQUE(platform, workspace_id)`
  (`src/backend/messaging/messaging-schema.ts`), with one `userId`/`userToken`.

## Decisions

- One Slack app and one @GoAhead bot per workspace. Each person adds their own user access.
- People with GoAhead are answered only by their own GoAhead.
- People without GoAhead are answered by the default computer: the first installer. The default's
  owner can hand it over. When the default's owner disconnects, the default moves to the earliest
  remaining connected person.
- Private data never passes through another person's computer (no hub computer).
- A reply that the person types in GoAhead is sent as them with no approval. Pause, quiet hours and
  the hourly limit apply to agent sends only.

## 1. Account service (Cloudflare Worker, D1)

### Migration `0026_slack_person_routes.sql` (additive only)

- `slack_workspace_routes` stays. Its meaning becomes "the workspace's default computer and bot".
  No column is dropped or renamed.
- New table `slack_person_routes`:
  - `team_id TEXT NOT NULL`, `slack_user_id TEXT NOT NULL`, primary key `(team_id, slack_user_id)`.
  - `host_id TEXT NOT NULL REFERENCES remote_hosts(host_id) ON DELETE CASCADE`.
  - `account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE`.
  - `connected_at INTEGER NOT NULL`.
  - Index on `host_id`.
- Backfill: none needed in SQL. The installer of an existing workspace route gets a person row at
  their next connect (see Rollout). Until then the workspace row routes as today.

### Connect (`complete()` in `slack-app.ts`)

- First person in a workspace: create the workspace row (default) and the person row.
- Another person: require `authed_user` with `token_type === "user"`. Without it, refuse with a new
  error code `slack_user_access_required` and its catalog text. Add or move the person row to the
  person's host. Do not touch the workspace row.
- Same person, other computer: move their person row (and the workspace row, if they own it).
- The sealed grant keeps its shape: bot token, bot user, app, workspace, user token and user id.
- Not confirmed: whether Slack returns the same bot token to the second installer. Token rotation is
  off, so the first token stays valid either way. Check it at Preet's first connect.

### Disconnect and revocation

- A person's disconnect deletes their person row and revokes only their user token.
- If they own the default: move the workspace row to the person row with the earliest
  `connected_at`. If no person remains, delete the workspace row and revoke the bot token, as today.
- `app_uninstalled`: delete every row of the team. `tokens_revoked` for user tokens: delete those
  people's rows.
- Hand over: a new endpoint lets the default's owner move the workspace row to another person row of
  the same team.

### Route ticket

`issueSlackRoute` lists, for the host, its default workspaces and its person routes
`(team_id, slack_user_id)`. `validateSlackRoute` checks both kinds. The ticket contract in
`packages/contracts/src/signal-protocol/slack-route.ts` gets an optional `people` list, so an old
host's ticket stays valid.

## 2. Signal

Signal keeps two maps: `appId:teamId` to the default socket, and `appId:teamId:userId` to a person's
socket. Both come from route tickets, as today.

Routing per event:

1. Requests to the bot (`app_mention`; a message in a DM with the bot user): the author's computer if
   the author has a person route, else the default.
2. Interactivity (draft buttons): the actions block's `block_id` carries the draft owner's Slack user
   id (the button value stays the opaque token, so older drafts keep working); send to that person's
   computer. Without it: the clicker's computer, else the default.
3. Other message events (people's DMs, group DMs, channels): call `apps.event.authorizations.list`
   with the event's `event_context`, and send to the computer of each listed person who has a route.
   Cache the answer per `event_id`. Needs a new Signal secret: an app-level token with
   `authorizations:read` (`SLACK_APP_TOKEN`, one per app id).
4. `app_uninstalled`: every computer of the team. `tokens_revoked`: the computers of the listed users.

Delivery: send to all targets in parallel. Answer Slack `200` only when every target accepted;
otherwise `503`, so Slack retries. Hosts drop repeats by `event_id`. Keep the signature check, route
ticket check and revocation floors.

## 3. Desktop host

- One computer still holds one Slack person per workspace. No local database migration.
- The owner is the connected Slack user (`auth.test` on the user token), as today. Inbox, sends as the
  person, approvals and `fromGoAheadUser` key on the owner.
- Requests from other people arrive only on the default computer. Today's behaviour stays: the agent
  answers; a send for another person waits for the owner's approval and goes out as the bot.
- The inbox keeps only the owner's conversations. `isPersonConversation` stays as a second guard.
- Draft buttons carry the owner's Slack user id in the actions block's `block_id`.
- Settings > Connectors > Slack: a line "This computer answers people without GoAhead" (yes/no); the
  default's owner gets "Hand over…" with the other connected people.

## 4. Reply from GoAhead

- The open inbox conversation gets a message box. Send posts the text as the person (user token,
  `chat.postMessage`) in that conversation or the open thread.
- New IPC endpoint `messaging:send-inbox-reply` `{ workspaceId, conversation, threadKey?, text }`
  with handler, preload bridge and preview mock. Text from `@openbot/i18n` keys.
- The send is kept in the audit log like other sends. It needs the user token; without it, the box is
  hidden.

## Rollout

1. D1 migration `0026`.
2. Signal with `SLACK_APP_TOKEN` (create the app-level token in the Slack app settings; the manifest
   does not change). Signal goes before the Worker: the old Signal refuses an auth event type that
   it does not know, and it reads a person-only route ticket as "this host owns the workspace".
3. Worker.
4. GoAhead release. Each person reconnects Slack once, so their route ticket carries their person
   route. The first installer's computer stays the default.

## Failure modes and tests

| Failure | Test |
| --- | --- |
| Migration loses or changes an existing workspace route | D1 migration test with a 0025 fixture |
| Second person still gets `slack_workspace_taken` | Worker test: two accounts, one team |
| Second person connects without user access and gets a bot-only route | Worker test: refusal `slack_user_access_required` |
| Disconnect of the default owner leaves no default while people remain | Worker test: default moves to earliest person |
| Uninstall leaves rows behind | Worker test |
| A private DM reaches a third person's computer | Signal test: authorizations list with two of three people |
| A DM to @GoAhead from Preet is answered by Shubham's computer | Signal test, rule 1; E2E with two hosts |
| A person without GoAhead gets no answer | Signal test (default); E2E |
| Preet's click approves Shubham's draft | Signal test, rule 2; host refuses a non-owner |
| One offline computer makes the others lose the event | Signal test: 503, retry, dedup |
| An old host's route ticket is refused after the deploy | Contract and Signal test with a ticket without `people` |
| A typed reply goes out as the wrong person | E2E: reply uses the owner's user token |

The E2E extends `src/main/slack-workspace.test.ts` to two hosts in one workspace and writes its report
under `.openbot-build/slack-workspace-e2e/`. A live check with Preet and Shubham in Multi Code Genius
finishes the work.

## Out of scope

- Project B: one person's agent asks another person's GoAhead to work on that computer.
- The phone app.
- Enterprise Grid installs (still refused).
