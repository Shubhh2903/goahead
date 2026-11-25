# GoAhead architecture

GoAhead is a Bun workspace with desktop, browser, and mobile applications, two Cloudflare Workers,
a self-hosted Signal service, and shared packages.

The architecture notes are in one file for each topic:

- [Repository structure](architecture/structure.md)
  - [Workspace map](architecture/structure.md#workspace-map)
  - [Dependency direction](architecture/structure.md#dependency-direction)
  - [State ownership](architecture/structure.md#state-ownership)
  - [Shared UI package](architecture/structure.md#shared-ui-package)
- [Change rules and verification](architecture/change-rules.md)
  - [Effect service execution](architecture/change-rules.md#effect-service-execution)
  - [Change rules](architecture/change-rules.md#change-rules)
  - [Required verification](architecture/change-rules.md#required-verification)
- [Team API compatibility](architecture/team-api.md)
  - [Team API compatibility boundary](architecture/team-api.md#team-api-compatibility-boundary)
- [Browser](architecture/browser.md)
  - [Browser client](architecture/browser.md#browser-client)
  - [Browser tool execution](architecture/browser.md#browser-tool-execution)
  - [Secure browser authentication](architecture/browser.md#secure-browser-authentication)
- [Side panel](architecture/side-panel.md)
  - [Side panel panes](architecture/side-panel.md#side-panel-panes)
- [Computer Use and remote desktop](architecture/computer-use.md)
  - [Computer Use](architecture/computer-use.md#computer-use)
  - [Remote desktop permission checks and live tests](architecture/computer-use.md#remote-desktop-permission-checks-and-live-tests)
- [Providers](architecture/providers.md)
  - [Provider CLI updates](architecture/providers.md#provider-cli-updates)
  - [OpenCode and ACP](architecture/providers.md#opencode-and-acp)
- [Agents](architecture/agents.md)
  - [Local scripts API](architecture/agents.md#local-scripts-api)
  - [Routine flows](architecture/agents.md#routine-flows)
  - [Agent communication policy](architecture/agents.md#agent-communication-policy)
  - [Prompt-driven agent profiles](architecture/agents.md#prompt-driven-agent-profiles)
  - [Agent import](architecture/agents.md#agent-import)
  - [Instance transfer](architecture/agents.md#instance-transfer)
  - [Agent templates](architecture/agents.md#agent-templates)
- [Analytics](architecture/analytics.md)
  - [Mobile product analytics](architecture/analytics.md#mobile-product-analytics)
  - [Website analytics](architecture/analytics.md#website-analytics)
  - [Agent usage analytics](architecture/analytics.md#agent-usage-analytics)
- [Servers, storage, and billing](architecture/servers.md)
  - [Storage and files](architecture/servers.md#storage-and-files)
  - [Desktop server notifications](architecture/servers.md#desktop-server-notifications)
  - [Billing](architecture/servers.md#billing)
  - [macOS Host Manager](architecture/servers.md#macos-host-manager)
  - [Hosted servers](architecture/servers.md#hosted-servers)
- [Channels, messaging, and mobile](architecture/channels-and-messaging.md)
  - [iPhone Live Activity updates](architecture/channels-and-messaging.md#iphone-live-activity-updates)
  - [iPhone notifications](architecture/channels-and-messaging.md#iphone-notifications)
  - [Android notifications](architecture/channels-and-messaging.md#android-notifications)
  - [Shared channel chats](architecture/channels-and-messaging.md#shared-channel-chats)
  - [Messaging connections](architecture/channels-and-messaging.md#messaging-connections)
  - [Mobile chat queue](architecture/channels-and-messaging.md#mobile-chat-queue)
- [Skills and plugins](architecture/skills-and-plugins.md)
  - [Skill folders and MCP configuration](architecture/skills-and-plugins.md#skill-folders-and-mcp-configuration)
  - [Local skill library](architecture/skills-and-plugins.md#local-skill-library)
  - [Plugin distribution](architecture/skills-and-plugins.md#plugin-distribution)
- [Integrations and sign-in](architecture/integrations.md)
  - [How a sign-in reaches GoAhead](architecture/integrations.md#how-a-sign-in-reaches-openbot)
  - [Remote sign-in: the callback relay](architecture/integrations.md#remote-sign-in-the-callback-relay)
  - [Add a provider](architecture/integrations.md#add-a-provider)
  - [Add an application](architecture/integrations.md#add-an-application)
  - [Add a connector](architecture/integrations.md#add-a-connector)
  - [Add a Team API capability](architecture/integrations.md#add-a-team-api-capability)

## GoAhead additions

These notes cover GoAhead features that are not in the upstream topic files.

### Missed routine runs

Migration 36 (upstream OpenBot migration 33) adds `missed_policy` (`skip` or `run-once`, default
`skip`) to both routine tables, and `missed_count` and `missed_until` to both run tables. It only adds
columns, so every routine, trigger and run stays. At startup, `RoutineStore.skipMissed` records the
times that came due while GoAhead was closed as one `cancelled` run with a count and a time range, in
the same transaction that moves the trigger. With `run-once`, the newest missed time stays due, so the
scheduler runs it once. The count is exact up to 999. Only the local run history (the IPC run lists)
reads these records. The Team API run routes, the calendar and the flows canvas do not get them,
because a released client reads such a record as a run that a person cancelled. Only this computer's
host shows the setting.

### Token settings of an agent

Three local-only agent settings lower token use. The Team API agent allowlist does not carry them, and
the remote IPC branch refuses them (`error.agent.tokenSettingsLocalOnly`).

- `compactWindow` (80K or 120K tokens; absent means the full window). `ThreadLifecycle` sends it to
  Claude as a thread param, and `claude-client.ts` sets `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, so Claude
  Code summarizes the conversation sooner and each model call reads less context. A change restarts
  the Claude query with the next turn. Other providers keep their own compaction.
- `disabledMcpServerIds` (absent means every enabled MCP panel server). `agentMcpServers` leaves these
  servers out for Codex, Claude and the ACP clients, so a server added later still reaches every agent.
- `weeklyTokenBudget` (5M to 100M tokens). `AgentTokenBudget` (`src/main/agent-token-budget.ts`)
  reads the agent's processed tokens since Monday after each completed turn and shows one desktop
  notification at 80% and one at 100% per week. It never stops work. The alerts already shown are
  kept in memory, so a restart can show a level once more.

#### Agent memories

Only essential memories enter an agent's startup instructions, in a block limited to 8,192 UTF-8
bytes after secret redaction. A Slack reply context gets the same block without ids. All saved
memories stay on the host in SQLite. Agents recall the other entries with bounded local search
(`openbot.search_memories`: FTS5, `unicode61`, BM25, at most 10 entries) and ID-paged listing
(`openbot.list_memories`, at most 25 entries). Each response is limited to 8,192 UTF-8 bytes. The
search index stays local. Migration 35 (upstream OpenBot 32) adds the selection table, the index and
its triggers, keeps memory text, ids and dates, and selects recent manual entries before recent
automatic ones. After that, a new memory that the user adds is essential when the essential block
still fits (a GoAhead choice; upstream starts it searchable), and a memory that an agent saves starts
searchable. The index uses the rowid of `projection_agent_memories`, so a later migration that
vacuums must rebuild `agent_memory_search`. Automatic text and selection changes stay pending until
the turn completes. Agent tools cannot change a user-controlled selection. The storage limit is 64,
128, 256 or 512 per agent; a lower limit deletes no memories.

The optional `agent-memories-v1` capability (`team-protocol/agent-memories-v1.ts`, the upstream name
and payloads) adds three POST routes for the iPhone app and joined members. `/v1/agent-memories/page`
returns up to 256 memories. `/v1/agent-memories/selection` returns up to 256 selection records, the
agent id and essential-memory byte usage. Both use ascending memory ids and an `after` cursor (`null`
for the first page); clients check the owner and the cursor order. `/v1/agent-memories/inclusion`
changes up to 25 selections with expected revisions and returns an empty acknowledgement. Each route
needs authentication and a visible agent. Selection writes use the same member access as memory text
writes. The released full-list GET route and the 2 MiB frame limit do not change: a new client on an
older host keeps text editing and hides the selection controls.

#### Pi and Muse

These two providers do not use ACP. `pi-client.ts` starts `pi --mode rpc` (`pi-rpc.ts` owns the
request IDs and the line framing). A successful `prompt` response only accepts the prompt;
`agent_settled` completes the turn. Cancellation clears the queued work before `abort`. A thread
keeps its Pi session file and active branch across restarts and provider switches. Models come from
the running CLI. `pi-mcp.ts` writes a temporary extension that calls Pi's `registerMcpServer` for
the enabled MCP servers and the GoAhead tool bridge; secrets go through the process environment and
never into the extension file. Sign in is the `terminal` sign-in kind: `provider-terminal-login.ts`
opens Pi in a terminal on the host (Terminal on macOS, PowerShell on Windows, `xterm` on Linux), and
the provider is checked again when it closes. `resolvePiCli` refuses a CLI older than 1.1.0.

`muse-client.ts` runs `muse serve` over MSP through `@muse-code/sdk`, pinned to 1.4.2 (MIT). It
supplies the session MCP servers, keeps the native session identity, and reads durable history to
recover missed events before a turn completes. A cached model list does not prove a sign-in, so
the client reports the account as `muse-unverified` and the status asks for a sign-in, as upstream
OpenBot does. Sign in runs `muse login`; a Meta API key is stored in the provider credential store,
as the OpenCode Go key is. Muse cannot generate an agent profile without tools, so its profile client
fails before the CLI starts.

`native-provider-runtime.ts` stages both downloads: Pi's release archive (its `pi` folder becomes
`bin`) and Muse's single binary. A pinned install is checked file by file against `files` in
`native-runtime.lock.json`. Update checks read GitHub releases for Pi and Meta's stable channel and
manifest for Muse, both with SHA-256. `piStatePaths` and `museStatePaths` let a confined process
write only session data; settings, credentials, extensions, hooks, and plugins stay read-only, and
`.pi` and `.muse` are protected project settings. Migration 32 removed the provider CHECK, so these
providers need no table rebuild.

No released Team API protocol knows `pi` or `muse`. `isPeerHiddenProvider` hides their agents,
models, status, and sign-in state from every peer, and GoAhead adds no protocol version for them.
Upstream OpenBot's Team API v7, `providers-v5`, and `agent-session-settings-v1` are not ported.

#### Android live update

Android has no Live Activity, so `agent-live-activity.android.tsx` gives the same interface with one
ongoing notification (`model/android-live-update.ts`), and its push token is the phone's FCM token.
The phone registers with `android-live-update-push-v1` (`POST /v1/android-live-update/registration`):
the same fields without the APNs environment and the pictures. `LiveActivityPushService` keeps both
kinds of registration and builds the same sealed props. For Android it sends them to
`POST /v2/remote/hosts/:hostId/android-live-update`, where the Worker signs in with the Firebase
service account and sends a data-only FCM message, with `high` priority for a change of state and
`normal` inside one state. On the phone, `android-live-update-task.ts`, which `index.ts` loads before
the router, opens the message with the keys of the active host from secure storage and updates the
notification. It ignores an update older than the shown content. Without `google-services.json` in
the build, the phone has no FCM token and registers nothing.

### Claude text preview

Claude cannot tell its narration from its answer while text arrives, so `claude-client.ts` holds the
text until a tool or thinking boundary or the end of the turn. While it holds text, it sends
`openbot/textPreview` (`src/backend/text-preview.ts`) at most every 150 ms with the last 4,000
characters, and an empty preview right before the held text is published. `TurnLifecycle` turns it
into the local AgentEvent `turn-text-preview`. `sharedAgentEvent` drops that event, so no Team API peer
receives it, and channel and messaging threads swallow it like `turn-progress`. The renderer keeps it
per agent in `turnTextPreview` (not seeded or saved), clears it on turn start, turn completion and a
runtime snapshot, and `AgentActivityIndicator` shows its end under the activity line. It is never a
message.

### Routine run conditions

A routine can store a run condition (migration 37: `run_condition` JSON and
`run_condition_fingerprint` on both routine tables). Before a scheduled run starts a turn,
`RoutineScheduler.#skipByRunCondition` and `ChannelRoutineScheduler.#runConditionSkip` call
`decideRunCondition` (`src/backend/agent/routine-run-condition.ts`). It runs the command in the login
shell, in the agent's working directory or, for a channel, the shared directory, with a 30-second
limit. `exit-zero` runs the agent when the command succeeds; `output-changes` also needs its output
hash to differ from the stored fingerprint. A skipped run is a cancelled run row with the reason as
its error, and no delivery. A check that cannot start, times out or prints too much starts the agent
(fail open). Test runs always start the agent. Only the local host offers the field: the released
Team API key lists drop it in both directions.

### Google connector

The Gmail and Google Calendar connection of this computer. One Google account. The mail agents are
the agent picked in the Google panel and the orchestrator of each connected Slack workspace.
[google-connector-setup.md](google-connector-setup.md) has the Google Cloud setup.

| Part | File | Owns |
| --- | --- | --- |
| Token store | `src/main/google-connector-store.ts` | `{version: 1, record}`, encrypted with the shared `secretCipher` (Electron `safeStorage`). A file that cannot be decrypted stays on disk; the panel asks for a new sign-in. |
| Sign-in | `src/main/google-oauth.ts`, `google-connector-service.ts` | PKCE (S256), a one-time `state`, the shared loopback listener `mcp-oauth-redirect-server.ts`, one token refresh at a time, revoke on disconnect. |
| API client | `src/main/google-api.ts`, `gmail-api.ts`, `google-calendar.ts` | Plain `fetch`. Backoff for 429 and 5xx (3 tries). `reauth-required` after a refused refresh. |
| Watcher | `src/main/gmail-watcher.ts`, `google-watcher-state.ts` | `history.list` every 2 minutes. One triage batch for each poll (10 mails at most). The state file holds the history position, the last 500 ids and the open approvals. |
| Triage | `src/backend/messaging/google-triage.ts`, `src/main/google-mail-triage.ts` | One restricted Claude session for each batch: no built-in tools, one in-process MCP server with `gmail_read`, `gmail_organize` and `gmail_notify`, no setting sources, a temporary `cwd`. Without Claude, the notices come from Gmail's signals. A notice goes to the island, a macOS notification, and a system note in the mail agent's chat that starts no turn. |
| Port | `src/backend/messaging/google-tools.ts` (`GoogleWorkspace`), `src/main/google-workspace.ts` | The backend sees data objects only, never a token. |
| Gate | `googleToolRefusal`, `isSlackOwnerDirectTurn` | Mail agents only. The turn must be a local-owner turn. For a Slack orchestrator, the turn can also be a message of the connected Slack owner in the owner's own direct message with GoAhead, with the same rule as the Slack inbox tools. A message from any other sender, a reply in a thread, a channel or a group message is refused. |
| Approvals | `AttentionRegistry.surfaceLocalApproval`, `ipc-local-only.ts` | `local-only:` cards that Auto approve and Turbo never answer, that the Team API never shows or answers, and that the state file keeps across a restart. The record leaves the file before the send or the booking, so it runs once. A send re-reads the Gmail draft and compares its digest with the digest that the card showed; a changed draft is not sent. |
| Local-only items | `LOCAL_ONLY_CONVERSATION_ITEM_TYPES` in `ipc-local-only.ts` | The `google-mail-notice` chat notes. The conversation queries leave them out of every Team API read, and the event filter leaves them out of every Team API event and push. Desktop search never shows them. |
| Results | `google-workspace.ts` (`postInformation`) | The result of an approved send or booking is a system note for the person. The agent is not told. A mail agent's own replies are ordinary chat messages that every viewer of that agent sees. |
| Disconnect | `src/main/index.ts` (`googleConnector.onChanged`) | Clears the notices and the open approvals, aborts the running poll and its triage, and resets the history position, seen ids and waiting mails. A call that runs during the disconnect fails with `GoogleNotConnectedError` and does not ask for a new sign-in. An account change also aborts the running poll. |

Change rules:

- Background triage never runs in an agent turn. Do not add a tool, a setting source, a plugin or an
  MCP server to the triage session.
- The local-owner proof is in memory only. After a restart, a waiting delivery gets no Google tool.
- Do not send a `local-only:` approval or a `LOCAL_ONLY_CONVERSATION_ITEM_TYPES` item through a path
  that leaves this computer. Any new Team API read, event or push that carries messages or attention
  must go through the local-only filters (`sharedAgentEvent`, `markerSupported`,
  `conversationPageForTeam`, and the conversation queries).
- Known limits. A reconnect does not revoke the refresh token that it replaces. A disconnect during
  the last write of a sign-in can leave a grant active at Google; the user can remove it in the
  Google account. Gmail history pages are capped, so a very long offline gap can skip mail (the
  Gmail API logs a warning). A `gmail_read` result holds at most 60,000 characters: the oldest
  messages of a long thread are left out, and the result says how many. A 409 on an event id that
  was cancelled earlier reports that event as booked.
