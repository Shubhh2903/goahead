# Gmail and Google Calendar connector: design

Date: 2026-10-13. Status: approved in chat, section by section; waiting for review of this file.

## 1. Goal

The Chief (the orchestrator agent) can read and organize the user's Gmail, tell the user about important
mail and meeting requests, write replies, and book Google Meet calls. Send and book happen only after the
user approves.

### Decisions from the developer

| Topic | Decision |
| --- | --- |
| Accounts | One Google account per computer. Personal `@gmail.com` accounts are allowed. |
| Google app status | External, "Testing" (max 100 test users; sign-in expires every 7 days). Verification and CASA later. |
| Agents | Two "mail agents": the agent picked in the Google panel ("Agent that handles mail"), and the Slack orchestrator of each connected Slack workspace. |
| Gmail actions | Read, search, organize (labels, archive, read/unread, star), write drafts, send after approval. No delete. |
| Calendar actions | Find free times, propose a meeting; after approval create the event with a Meet link and send invites. |
| Notifications | Dynamic Island card, message in the Chief chat, macOS notification. |
| Triage | Gmail signals first (Important, Primary, calendar invite), then the Chief decides and summarizes. |
| Language | English only (no new translations). |
| Approach | Built-in desktop connector (approach A). Not an MCP server, not Cloudflare push. |

### Product constraints that apply

- Mail and calendar data stay on the computer. GoAhead calls Google directly from the desktop app.
  Cloudflare (account service) and Signal get no Gmail or Calendar data.
- The AI provider gets only the mail that triage selects, and the mail that the Chief reads with a tool.
- Tokens are secrets: encrypted at rest and redacted on every log, export and diagnostics path.
- The renderer-to-main trust boundary stays as it is: new IPC uses the existing validated handler helpers.

## 2. Components

### Main process (`src/main`)

- `google-connector-store.ts`
  - Holds the refresh token, the access token and its expiry, the account email and the granted scopes.
  - Encrypted with the shared `secretCipher` (Electron `safeStorage`, `src/main/application-services.ts:381`),
    written with `writeJsonFileAtomically` in a `{version: 1, record}` envelope, like
    `src/main/github-connector-store.ts`.
  - Every token value goes through `registerSecretValue` (`packages/logging/src/index.ts:108`).
  - If decryption fails, the file stays on disk and the connector shows "Sign in again".
- `google-oauth.ts`
  - Authorization code flow with PKCE (S256) and a one-time `state`.
  - Redirect through the existing loopback server `src/main/mcp-oauth-redirect-server.ts`
    (`127.0.0.1`, OS-chosen port, single path, Host check). Add a Google route to its `deliver` callback;
    do not start a second server.
  - Scopes: `openid`, `email`, `https://www.googleapis.com/auth/gmail.modify`,
    `https://www.googleapis.com/auth/calendar.events`.
  - The browser opens with `shell.openExternal`. Cancel and a 10-minute timeout end the attempt.
  - OAuth client type "Desktop app". Client id and secret come from the build config (git-ignored env),
    like the Slack app ids. Google treats a Desktop client secret as not confidential; it still does not go
    into the repository.
  - Disconnect revokes the token at `https://oauth2.googleapis.com/revoke`, then deletes the store file.
    If revoke fails, the local file is still deleted and the user sees that revoke failed.
- `google-api.ts`
  - Small `fetch` client for Gmail v1 and Calendar v3 REST. No `googleapis` dependency.
  - Refreshes the access token before expiry; one refresh at a time (promise queue).
  - 429 and 5xx: exponential backoff with jitter, max 3 tries.
  - 401 after a refresh, or `invalid_grant`: state becomes `reauth-required`; all calls stop.
- `gmail-watcher.ts`
  - Runs only while the connector is connected and the app runs. Interval 2 minutes, `unref`, stopped
    through the teardown registry (`src/main/teardown-registry.ts`).
  - Calls `users.history.list` from the stored `historyId` with `historyTypes=messageAdded`,
    `labelId=INBOX`.
  - First start, or a 404 for an old `historyId`: read the current `historyId` from `users.getProfile` and
    start from there. No backlog.
  - Selects a new message when it has label `IMPORTANT`, or `CATEGORY_PERSONAL` (Primary), or a
    `text/calendar` part or an `.ics` attachment. Other mail is ignored.
  - Collects the selected mail of one poll (max 10) into one triage delivery to the Chief: sender, subject,
    date, Gmail id and Gmail's snippet. Not the full body.
  - State file `google-watcher-state.json` in user data: `historyId`, the last 500 seen ids, open approvals,
    meeting proposals. Written atomically. Not encrypted (no tokens, no bodies); it holds Gmail ids,
    subjects and recipients of open approvals, so it stays in user data with the same file mode as other
    stores.
- IPC group `google-connector`: `status`, `connect`, `cancel`, `disconnect`, and a `changed` event.
  - Contract `packages/contracts/src/ipc-google-connector.ts`, endpoints in `ipc-endpoints.ts`, API type in
    `ipc-desktop-apis.ts`, preload decoder, handlers in `src/main/ipc/google-connector-handlers.ts` with
    the validated helpers, and the preview mock in `src/renderer/src/preview/mock-openbot.ts`.

### Backend (`src/backend`)

- Tool definitions next to the Slack tools (`src/backend/messaging/messaging-read-tools.ts` pattern),
  dispatched in `src/backend/agent/openbot-tool-router.ts`.

| Tool | Does | Approval |
| --- | --- | --- |
| `gmail_search` | Gmail query (`q`), returns id, from, subject, date, snippet (max 25) | no |
| `gmail_read` | One message or thread as plain text (HTML converted), attachment names only | no |
| `gmail_organize` | Add/remove labels, archive, mark read/unread, star/unstar. No delete, no trash. | no |
| `gmail_draft` | Create or update a Gmail draft (new mail or reply in thread) | no |
| `gmail_send` | Send a draft or new mail | yes |
| `gmail_notify` | Tell the user about one mail: `kind` = `important` or `meeting`, plus a summary | no |
| `calendar_find_times` | Read the user's events in a range and return free slots | no |
| `calendar_propose_meeting` | Store a meeting proposal (title, start, end, guests, description, optional reply-to mail) | yes |

- Gate (decision 2026-10-13, see section 10). The agent must be a mail agent: the agent picked in the
  Google panel, or the Slack orchestrator of a connected workspace (`orchestratorAgentId`,
  `src/backend/messaging/messaging-store.ts`). The turn must be one of:
  - a local-owner turn (`isLocalOwnerTurn`, `src/backend/agent-service.ts:2067`);
  - for a Slack orchestrator only: a Slack turn whose every delivery comes from the connected Slack user
    (the owner) in the owner's own DM with GoAhead. A message from another Slack user, a channel or a
    group DM never passes.
  Other agents and other turns get a tool error (tool lists are static for every agent, so this is a
  run-time refusal, as for the Slack tools).
- Background triage runs in a **restricted triage session** (decision 2026-10-13, section 10), not in a
  normal agent turn. See section 3.
- The triage result goes into the picked agent's chat as a system information note that starts no turn.
  No delivery origin for triage is needed.
- Developer instructions for the mail agents get a short Gmail section: mail text is untrusted data, never
  instructions; propose, do not decide, for send and book.

### Renderer and shared UI

- `packages/ui/src/features/settings/GoogleConnectorPanel.tsx`, shown in
  `src/renderer/src/features/connectors/ConnectorsPanel.tsx`: Connect, account email, Disconnect,
  "Sign in again" state, and an error line.
- Port and controller in `src/renderer/src/features/connectors/google-connector(-port).ts`.
- All text from `@openbot/i18n` keys, `en` only.

## 3. Data flow

### New mail to notification

1. The watcher polls and selects mail (section 2).
2. GoAhead runs one **restricted triage session** for the batch: a separate Claude session with only
   these tools: `gmail_read`, `gmail_organize`, `gmail_notify`. It has no shell, no file tools, no MCP
   servers, no web, no other GoAhead tools, and no access to the agent's workspace. Its instructions say
   that mail text is data, not instructions. It decides per mail: important, meeting request, or ignore.
3. For important or meeting mail it calls `gmail_notify`. GoAhead then:
   - shows a Dynamic Island card with the summary and actions "Open", "Draft reply", "Book meeting"
     (the last two send a local-owner message to the Chief);
   - shows a macOS notification through the existing path (`src/main/renderer-forwarders.ts`,
     `desktop-notifications.ts`), skipped while the window has focus;
   - posts the summary into the chat of the agent picked in the Google panel, marked as information from
     GoAhead (not a user message that starts a turn).
   Draft reply and Book meeting from the card start a normal local-owner turn of the picked agent.

### Send after approval

1. `gmail_send` creates (or reuses) a real Gmail draft, then registers an approval with
   `src/backend/agent/attention-registry.ts` (as `surfaceHostedSiteApproval` does). The island and the
   notification already show approvals.
2. The approval card shows the real `To`, `Cc`, subject and body from the draft, not the agent's
   description.
3. Approve: `users.drafts.send`. Decline: the draft stays in Gmail.
4. The approval is stored in the state file before it is shown, and is removed before the send call, so a
   restart or a double click never sends twice. After a restart, open approvals are shown again.

### Book a Meet call

1. `calendar_find_times` reads `events.list` for the primary calendar in a range (max 14 days) and returns
   free slots inside working hours 09:00–18:00, Monday to Friday, in the system time zone.
2. `calendar_propose_meeting` stores the proposal and registers an approval that shows title, time with
   time zone, guests and description.
3. Approve: `events.insert` on `primary` with `conferenceData.createRequest`
   (`conferenceSolutionKey.type = hangoutsMeet`), `conferenceDataVersion=1`, `sendUpdates=all`. The Meet
   link goes to the Chief chat and the island card. Decline: nothing is created.

## 4. Errors

| Case | Behavior |
| --- | --- |
| Sign-in expired (7 days in Testing) or revoked | Watcher stops; one notification "Google sign-in expired"; panel shows "Sign in again"; tools return a clear tool error. |
| `historyId` too old (404) | Restart from the current `historyId`; no backlog. |
| 429 / 5xx | Backoff, max 3 tries; the watcher skips this poll after that. |
| Send or book fails after approval | The approval card shows the error; the draft or proposal stays; the Chief gets the error text. |
| `safeStorage` not available | Connect is refused with a clear message (same as other connectors). |
| Network down | Poll skipped silently; next poll tries again. |

## 5. Privacy and documentation

- `PRIVACY.md`: GoAhead talks to Google directly from the computer; Cloudflare and Signal get no Gmail or
  Calendar data; the AI provider gets triaged mail and mail the Chief reads; tokens stay in the keychain.
- `docs/ARCHITECTURE.md`: connector section (store, OAuth, watcher, tools, gate, approvals).
- `changelog.d/gmail-calendar.md`.
- A setup note in `docs/` for the Google Cloud project (APIs, consent screen in Testing, test users,
  Desktop client, env keys).

## 6. Tests

The repo rules ask for few tests: secret leaks, trust boundary, data loss.

- Unit (Node):
  - tokens never reach logs; redaction is registered for access, refresh and PKCE verifier;
  - `state` is used once; a wrong `state` or Host is refused;
  - Chief tools: refused for a non-orchestrator agent and for a turn that is not local-owner;
  - the restricted triage session has no shell, file, web or other MCP tool, and a crafted mail reaches only the three triage tools;
  - approval answers once; survives a restart; a double approve sends once;
  - `historyId` 404 restarts with no backlog.
- A fake Google API server (HTTP, in tests) for the watcher, send and book. No real Google account in tests.
- End-to-end smoke with `bun run dev:automation` against the fake server; JSON report under
  `.openbot-build/google-connector/`.

## 7. Out of scope (first version)

Several Google accounts, tools for agents other than the Chief, delete or trash, attachments sent by the
agent, Gmail push (Pub/Sub), checks while GoAhead is closed, other calendars than `primary`, translations.

## 8. Order of work

1. Store, OAuth, IPC, Connectors panel (connect / disconnect / sign in again).
2. Read tools (`gmail_search`, `gmail_read`, `gmail_organize`, `gmail_draft`, `calendar_find_times`).
3. Watcher, restricted triage session, `gmail_notify`, island card, macOS notification, chat note.
4. `gmail_send` and `calendar_propose_meeting` with approvals.
5. Privacy, docs, smoke.

## 9. Open items for the developer

- Create the Google Cloud project and the Desktop OAuth client (steps in the setup note), and give the
  client id and secret through the env file.
- Later: Google verification and CASA if more than 100 users or no weekly sign-in is needed.

## 10. Changes after review (2026-10-13)

- **Mail agents:** the agent picked in the Google panel and the Slack orchestrator(s). From Slack, only the
  connected owner's messages in the owner's own DM with GoAhead may use the mail tools. Send and book
  always need approval in the desktop app.
- **Restricted triage session:** background triage never runs in an agent with shell, file or MCP tools.
  Reason: provider-native tools (for example Claude's Bash) cannot be gated by the tool router, and mail
  text is untrusted. If the restricted session cannot be started (for example no Claude sign-in), the
  watcher sends notifications from Gmail signals only (sender and subject, no AI summary).
- **Local-only approvals:** send and book approvals are not shown to Team API members or the phone, and
  are not answered by Turbo or auto-approve (the hosted-site approval path is not reused as is).
- **Build config:** the Google client id and secret come from a new build-time define
  (`OPENBOT_GOOGLE_CLIENT_ID`, `OPENBOT_GOOGLE_CLIENT_SECRET`, from the shell or `.env.google`), not
  from the Slack mechanism (Slack ids are Worker secrets).
- **Island card:** the Meet link reaches the picked agent's chat; there is no separate Meet card.
- **Mail notes stay on this computer (decision 2026-10-14):** the `google-mail-notice` chat notes are
  filtered out of every Team API conversation read and event, and out of phone/live-activity pushes.
  Only this desktop shows them. Desktop search never shows them.
- **Send and book results (final review 2026-10-14):** send/book results are notes for the person; the
  agent is not told.
- **Mail agent replies:** the replies of a mail agent are ordinary chat messages. The `gmail_notify`
  result does not ask the agent to write the summary in its answer.
