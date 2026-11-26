# Agent Usage Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop runaway agent turns (tokens, disk, RAM) found in the 2026-11-24 usage incident: a per-turn pause-and-ask limit, earlier compaction, an install guard, and the useful parts of the Codex incident branch.

**Architecture:** All providers send app-server-style notifications through `src/backend/agent/turn-lifecycle.ts`. Counters live on its `#runningTurns` entry. At a limit, the host interrupts the turn (`AgentService.interrupt`) and shows a host-originated card (`AttentionRegistry.surfaceLocalApproval`). "Continue" queues a host message to the agent; "Stop" closes the card. Claude can block a guarded command before it runs (`canUseTool`); Codex and Grok are stopped when the command starts.

**Tech Stack:** Bun, TypeScript, Electron main/backend, SolidJS (`packages/ui`), Vitest via `bun run test:desktop`.

**Spec:** this file, section "Decisions". Incident evidence: branch `codex/agent-usage-incident`, `docs/incidents/2026-11-24-agent-usage.md`.

## Decisions (from the user, 2026-11-25)

- Every turn, of every origin (user, agent, routine, Slack), pauses at **40 tool calls or 3,000,000 processed tokens**, whichever comes first.
- Per-agent setting "Turn limit": 40 (default when absent), 100, 200, or Off. The token limit is the call limit × 75,000 (40 → 3 M, 100 → 7.5 M, 200 → 15 M).
- Compaction at **120,000** tokens for Claude and Codex by default.
- Install guard on: `xcrun simctl create`, `xcrun simctl runtime add`, `xcodebuild -downloadPlatform`, `xcodebuild -downloadAllPlatforms`, `sdkmanager` (install forms), `avdmanager create`, `pod install`, `pod repo update`.
- New branch from master. Keep only these Codex parts: shorter scope text, the greeting on creation, Claude idle release 2 min, storage counting of unassigned folders, mobile QA reservation with an expiry. Do NOT port: removal of the cheap Slack reply model, forced subagent model, removal of custom-endpoint and model fallbacks, the delivery-id interrupt rewrite, non-en i18n edits.

## Global Constraints

- No database migration. Per-agent settings live in the agents JSON (`src/backend/agent-store.ts`, `OPTIONAL_SETTING_FIELDS`), like `autoModel`.
- Do not change a released Team API adapter (v1–v6). The new setting and cards stay local; the local-only card is answered only at this computer (existing `surfaceLocalApproval` rule).
- User-visible text from `@openbot/i18n` `en` keys only; backend text sent to an agent uses `sourceText(key)`. No literals. No other languages.
- Redact secrets: a guarded command shown on a card goes through the existing redaction used for approval commands.
- Checks: one test file at a time, `bun run test:desktop -- <path> --maxWorkers=1`; Biome on changed files; `typecheck:node` or `typecheck:renderer` only. Never the mobile typecheck by hand.
- The developer commits. Subagents never `git commit` or `git push`. Leave work uncommitted.
- Release notes in `changelog.d/agent-usage-limits.md`.

## Review Focus

1. A turn that a limit interrupts while a hand-off group or a question card is open: the interrupt must not drop queued deliveries or leave the agent "working". Test in Task 1.
2. "Continue" pressed after the agent was already stopped by the user, deleted, or started a new turn: the card answer must do nothing harmful (no message to a deleted agent, no double turn). Test in Task 1.
3. Codex `thread/tokenUsage/updated` totals are per thread: the turn count must use the delta from the turn start, and a compaction that lowers the total must not make the count negative. Test in Task 1.
4. Guard false positives: `xcrun simctl list`, `xcrun simctl boot`, `pod --version`, `sdkmanager --list`, and a command that only mentions "pod install" inside an `echo` string must NOT trigger. Test in Task 4.
5. Moving a large unassigned folder to Trash while an agent workspace is registered at a path inside it: refuse. Test in Task 6.

---

### Task 1: Turn limit in the backend

**Files:**
- Modify: `packages/contracts/src/ipc-agents.ts` (new setting next to `AGENT_COMPACT_WINDOWS`)
- Modify: `src/backend/agent-store.ts` (store/validate, add to `OPTIONAL_SETTING_FIELDS`), `src/main/ipc/agent-inputs.ts` (accept in update input)
- Create: `src/backend/agent/turn-limit.ts`, `src/backend/agent/turn-limit.test.ts`
- Modify: `src/backend/agent/turn-lifecycle.ts` (counters on `#runningTurns`, checks at `item/started` and usage notifications)
- Modify: `src/backend/claude-client.ts` (mid-turn token feed), `src/backend/agent-service.ts` (wire card and interrupt)
- i18n: `packages/i18n/src/messages/en/agent.ts` (card text, continue message)

**Interfaces:**
- Produces:
  - `export const AGENT_TURN_LIMITS = [40, 100, 200, 0] as const;` (`0` = Off); `type AgentTurnLimit`; `isAgentTurnLimit(value): value is AgentTurnLimit`; `AgentSummary.turnLimit?: AgentTurnLimit`; absent means 40.
  - `turn-limit.ts`: `export const TOKENS_PER_TOOL_CALL_LIMIT = 75_000;` `export function turnLimitFor(setting: AgentTurnLimit | undefined): { calls: number; tokens: number } | null` (null for Off); `export class TurnBudget { constructor(limit); recordToolCall(): boolean; recordProcessedTokens(total: number): boolean; readonly calls: number; readonly tokens: number }` — `recordProcessedTokens` takes the thread total; the first call sets the baseline; it ignores a total lower than the last one (compaction) by moving the baseline; each method returns true exactly once, when a limit is first reached.
  - Claude client emits `openbot/turnTokens` `{ threadId, turnId, processedTokens }` after each assistant message, where `processedTokens` is the running sum of `input_tokens + cache_read_input_tokens + cache_creation_input_tokens + output_tokens` from the SDK assistant message `usage` in this turn. If the SDK message has no usage, emit nothing (verify against the installed `@anthropic-ai/claude-agent-sdk` types and report).
  - Local card key prefix `turn-limit:`; key `turn-limit:<agentId>:<turnId>`.

- [ ] **Step 1: Write failing tests in `turn-limit.test.ts`**: `turnLimitFor(undefined)` → `{calls: 40, tokens: 3_000_000}`; `turnLimitFor(0)` → `null`; `turnLimitFor(100).tokens === 7_500_000`; `TurnBudget` returns true on the 40th `recordToolCall` and false on the 41st; tokens: baseline 1_000_000, then 3_999_999 → false, 4_000_000 → true; a lower total (compaction) then a rise counts only the rise.
- [ ] **Step 2: Run** `bun run test:desktop -- src/backend/agent/turn-limit.test.ts --maxWorkers=1`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `turn-limit.ts`, the contract setting, store validation (same shape as `weeklyTokenBudget` at `agent-store.ts:602-606`), and the IPC input.
- [ ] **Step 4: Wire `turn-lifecycle.ts`.** On `turn/started` create a `TurnBudget` from the agent's setting. On `item/started` with a tool item (`toolUsage()` in `thread-items.ts` returns non-null) call `recordToolCall()`. On `thread/tokenUsage/updated` (Codex `tokenUsage.total.totalTokens`) and `openbot/turnTokens` (Claude) call `recordProcessedTokens`. When one returns true, call a new hook `turnLimitReached(agentId, threadId, turnId, { calls, tokens })`. Grok has no mid-turn token feed: tool calls only.
- [ ] **Step 5: In `agent-service.ts`** implement the hook: `interrupt(agentId, turnId)`, then `surfaceLocalApproval({ key: "turn-limit:"+agentId+":"+turnId, … detail: sourceText(card text with calls and tokens), complete: true }, answer)`. On `accept`: if the agent still exists and has no running turn, queue a host message with `sourceText("agent.turnLimit.continue")` as a user-kind delivery (same path as a typed message); else do nothing. On `decline`: nothing. Deleting the agent drops its cards (`dropLocalApprovals("turn-limit:"+agentId)`). The renderer card title for this key kind: find where Google card titles come from the request id kind and add one `en` key.
- [ ] **Step 6: Add tests in `src/backend/agent-service.queue.test.ts` (or the closest existing service test that drives turn notifications)**: 40 tool `item/started` events → `turn/interrupt` sent once and one local approval with key prefix `turn-limit:`; accept → one queued delivery; accept after the agent is deleted → no delivery; a turn with setting `0` and 500 tool calls → no interrupt; Review Focus 1: a limit hit while another delivery is queued keeps that delivery queued.
- [ ] **Step 7: Run** each touched test file alone; `bun run typecheck:node`; Biome on changed files. Expected: PASS.

### Task 2: Turn limit setting in the UI

**Files:**
- Modify: `packages/ui/src/features/conversation/AgentSettingsPanel.tsx` (row next to "Compact early" at :626-633 and the weekly budget at :638)
- Modify: the renderer adapter that saves agent settings (follow `weeklyTokenBudget`), `src/renderer/src/preview/mock-openbot.ts` if it lists settings
- i18n: `packages/i18n/src/messages/en/agentSettings.ts`

**Interfaces:** Consumes `AGENT_TURN_LIMITS`, `AgentSummary.turnLimit` from Task 1.

- [ ] **Step 1:** Add a select "Turn limit" with options "40 tool calls (default)", "100 tool calls", "200 tool calls", "Off", and a hint: "The agent stops and asks you to continue after this many tool calls or about 75,000 tokens per call in one turn." Choosing the default saves `null` (absent).
- [ ] **Step 2:** If a test file already covers the settings panel save path for `weeklyTokenBudget`, add one case that saves `turnLimit: 100`; otherwise add no test.
- [ ] **Step 3:** `bun run typecheck:renderer`; Biome on changed files; `bun run check:ui` is the hook's job, not yours.

### Task 3: Compaction at 120k

**Files:**
- Modify: `packages/contracts/src/ipc-agents.ts` (`AGENT_COMPACT_WINDOWS` → `[80_000, 120_000, 200_000]`, doc: absent = 120,000)
- Modify: `src/backend/agent/thread-lifecycle.ts:685` / `src/backend/claude-client.ts:744-746` (absent → 120,000)
- Modify: `src/backend/agent/context-compaction.ts` (threshold), `context-compaction.test.ts`
- Modify: `AgentSettingsPanel.tsx` "Compact early" options and `en/agentSettings.ts` labels

**Interfaces:**
- Produces: `export const DEFAULT_COMPACT_WINDOW = 120_000;` in `ipc-agents.ts`; `context-compaction.ts`: compact when `used >= Math.min(CONTEXT_COMPACTION_THRESHOLD * modelContextWindow, DEFAULT_COMPACT_WINDOW)`.

- [ ] **Step 1: Failing tests in `context-compaction.test.ts`**: window 272,000, used 125,000 → compaction armed; used 110,000 → not armed; window 100,000, used 81,000 → armed (the 0.8 rule still applies to small windows).
- [ ] **Step 2: Run, expect FAIL. Step 3: implement. Step 4: run, expect PASS.**
- [ ] **Step 5: Codex mid-turn compaction.** Check whether the pinned Codex (`native-runtime.lock.json` → `codex` version) accepts `model_auto_compact_token_limit` in the app-server `config` (search the Codex binary or its config docs for the exact key). If yes, add `model_auto_compact_token_limit: 120000` to the config in `thread-lifecycle.ts:544-574` and extend the existing config test. If not, report it and change nothing; post-turn compaction from Step 3 stays.
- [ ] **Step 6:** Claude: an agent with no `compactWindow` now gets `CLAUDE_CODE_AUTO_COMPACT_WINDOW=120000`; extend the existing claude-client env test. UI: options "80,000", "120,000 (default)", "200,000"; the default saves `null`.
- [ ] **Step 7:** run each test file alone, `typecheck:node`, `typecheck:renderer`, Biome.
- [ ] **Step 8: Compatibility.** `compactWindow` appears in `packages/contracts/src/ipc-conversation-messages.ts`. Check whether a v0.40 peer or an older stored agents file would reject `200_000` (validation with `isAgentCompactWindow`). If a released peer rejects it, drop `200_000` and keep `[80_000, 120_000]`; report the result.

### Task 4: Install guard

**Files:**
- Create: `src/backend/agent/install-guard.ts`, `src/backend/agent/install-guard.test.ts`
- Modify: `src/backend/claude-client.ts` (`canUseTool` :640-650, `Bash`), `src/backend/agent/turn-lifecycle.ts` (`item/started` command items for Codex `commandExecution` and ACP `toolKind: "execute"`), `src/backend/agent-service.ts` (card + allowance)
- i18n: `en/agent.ts`

**Interfaces:**
- Produces: `export type InstallGuardRule = "simulator-create" | "simulator-runtime" | "xcode-platform" | "android-sdk" | "android-avd" | "cocoapods";` `export function guardedInstall(command: string): InstallGuardRule | null;` `export class InstallAllowances { allow(agentId, rule, now): void; isAllowed(agentId, rule, now): boolean }` (an allowance lasts 60 minutes).
- Local card key `install-guard:<agentId>:<turnId>:<rule>`.

- [ ] **Step 1: Failing tests in `install-guard.test.ts`**: each of these returns its rule: `xcrun simctl create "iPhone 17" …`, `xcrun simctl runtime add x.dmg`, `xcodebuild -downloadPlatform iOS`, `xcodebuild -downloadAllPlatforms`, `sdkmanager "system-images;android-35;google_apis;arm64-v8a"`, `sdkmanager --install platform-tools`, `avdmanager create avd -n x -k …`, `pod install`, `cd ios && pod install --repo-update`, `pod repo update`. These return null (Review Focus 4): `xcrun simctl list`, `xcrun simctl boot X`, `pod --version`, `sdkmanager --list`, `echo "run pod install later"`, `grep -r "pod install" docs`. Allowance: allowed at +59 min, not at +61 min; per agent and per rule.
- [ ] **Step 2: Run, expect FAIL. Step 3: implement** by splitting the command on `&&`, `||`, `;`, `|` and newlines, then matching each part's leading program (after `sudo`/`env VAR=…`) and its arguments. Do not match inside quotes of another program's arguments.
- [ ] **Step 4: Claude.** In `canUseTool`, for `Bash` with a guarded command not allowed: await a host decision through a new server request `openbot/installGuard` `{threadId, turnId, command, rule}` that `agent-service.ts` answers with the local card (`accept` → allow + `behavior: "allow"`, `decline` → `behavior: "deny"` with message `sourceText("agent.installGuard.denied")`). Auto-approve and Turbo must not answer it (they cannot: it is a local card).
- [ ] **Step 5: Codex and Grok.** On `item/started` with a guarded command not allowed: interrupt the turn and show the card. `accept` → allow the rule and queue `sourceText("agent.installGuard.continue")` naming the command; `decline` → queue nothing.
- [ ] **Step 6:** Service-level test (same file as Task 1 Step 6): a Codex `commandExecution` `item/started` with `pod install` → interrupt + card; after accept, the same command in the next turn → no interrupt.
- [ ] **Step 7:** run each test file alone, `typecheck:node`, Biome. The card shows the command through the existing approval redaction.

### Task 5: Port the useful Codex parts

**Files:**
- Modify: `src/backend/agent/developer-instructions.ts` (scope text), `src/backend/claude-client.ts:220` (idle 2 min), new `src/backend/agent/mobile-qa-reservation.ts` + `.test.ts` and its tool in `src/backend/agent/openbot-tool-router.ts` and `src/backend/openbot-tools.ts`, agent creation greeting (`src/renderer/src/features/agents/agent-initial-message.ts` and its callers, mobile `add-agent-screen.tsx`), `en/agent.ts`, `en/mobile/agent.ts`
- Source: `git show codex/agent-usage-incident:<path>` and `git diff 9a9742541 codex/agent-usage-incident -- <path>`

- [ ] **Step 1: Scope text.** Port `TASK_SCOPE_INSTRUCTIONS` and the shorter first line from the Codex diff of `developer-instructions.ts`. Keep the v0.40 text everywhere else. Do not port the `interrupt_agent` sentence that requires a delivery id.
- [ ] **Step 2: Idle release.** `CLAUDE_THREAD_IDLE_RELEASE_MS = 2 * 60_000`. Update a test only if one asserts 10 minutes.
- [ ] **Step 3: Greeting.** A role-only agent creation sends `t("agent.setup.firstGreeting")` = "Greet me briefly." as the first message instead of the role text, on desktop and mobile, as in the Codex diff. Keep v0.40 auto-model and creation-model code unchanged.
- [ ] **Step 4: Mobile QA reservation.** Port `mobile-qa-reservation.ts`, its test, and the `reserve_mobile_qa` tool route (Codex router :761). The lock must expire (keep the Codex expiry); check that the test covers expiry and release by another agent being refused.
- [ ] **Step 5:** run `mobile-qa-reservation.test.ts`, the developer-instructions test if one exists, `claude-client.test.ts`, each alone; `typecheck:node`; `typecheck:renderer`; Biome. Report that mobile typecheck is left to the hook.

### Task 6: Storage — unassigned folders, warning and Trash

**Files:**
- Modify: `src/backend/agent-store.ts` (`workspaceRoots` getter as in the Codex diff), `src/backend/storage-usage.ts` + `.test.ts`, `src/main/application-services.ts`, `packages/contracts/src/ipc-storage.ts`, `packages/ui/src/features/files/StorageOverview.tsx`, `src/renderer/src/features/files/ServerStoragePanel.tsx`, IPC handler + preload + `mock-openbot.ts` for the new action, `en/files.ts`

**Interfaces:**
- Produces: host scan adds `unassignedFolders: { path: string; bytes: number }[]` (folders directly under `workspaceRoots` that no agent owns, sorted by size). New IPC `storage:trashUnassignedFolder({ path })` that re-checks in main that `path` is a direct child of a workspace root, not owned by any agent, and no agent workspace is inside it, then calls Electron `shell.trashItem(path)`.

- [ ] **Step 1: Failing tests in `storage-usage.test.ts`**: an unowned folder under the Agents root is listed with its size; an owned one is not; the legacy Bots root is scanned too.
- [ ] **Step 2: Test for the trash check** (pure function `canTrashUnassignedFolder(path, roots, agentWorkspaces)` in `storage-usage.ts`): refuses a path outside the roots, a nested path (`root/a/b`), an owned folder, and a folder that contains a registered agent workspace (Review Focus 5); accepts an unowned direct child.
- [ ] **Step 3: Implement** scanner, check, IPC (sender validation like the other storage handlers), preload decoding, mock.
- [ ] **Step 4: UI.** In `StorageOverview`, a section "Folders with no agent" lists folders ≥ 1 GiB with size and a "Move to Trash" button with a confirm dialog naming the folder. Show a warning line when their total is ≥ 5 GiB.
- [ ] **Step 5:** run each test file alone; `typecheck:node`; `typecheck:renderer`; Biome.

### Task 7: Notes and docs

- [ ] Create `changelog.d/agent-usage-limits.md` (Added: turn limit, install guard, storage folders; Changed: compaction 120k default, Claude releases idle processes after 2 minutes, greeting, scope text). Plain words, as in `CHANGELOG.md` 0.40.0.
- [ ] Mobile note in `apps/mobile/changelog.d/agent-usage-limits.md` only for the greeting change.
- [ ] Update `docs/ARCHITECTURE.md` only where it describes compaction, approvals or storage scanning.

---

## Added 2026-11-25 (user decisions after the final review)

- Turns that a teammate or a routine starts run on the provider's small model (Claude Sonnet 5.5, Codex small model) when the agent's model is larger (Claude Opus/Fable; Codex Terra/Sol/Astra). Turns that the person starts keep the agent's model. Per-agent setting to turn this off; default on.
- When the install guard blocks a command, the agent gets the exact way to reuse an installed device.

### Task 8: Small model for teammate and routine turns

**Files:**
- Modify: `src/backend/agent/auto-model.ts` (+ its test), `src/backend/agent/drain-scheduler.ts` (where the choice is applied)
- Modify: `packages/contracts/src/ipc-agents.ts`, `src/backend/agent-store.ts`, `src/main/ipc/agent-inputs.ts` (setting, same pattern as `turnLimit`)
- Modify: `packages/ui/src/features/conversation/AgentSettingsPanel.tsx`, `en/agentSettings.ts` (switch)
- Modify: `changelog.d/agent-usage-limits.md`

**Interfaces:**
- Produces: `AgentSummary.delegatedSmallModel?: boolean` — absent or true = on; false = off. Update input `delegatedSmallModel?: boolean | null` (null = default).
- New `AutoModelReason` `"delegated-small-model"`.

- [ ] **Step 1: Failing tests in the auto-model test file:** an agent on `claude-fable-5-2` with `autoModel` off, every message of the turn from a teammate → small model with reason `delegated-small-model`; same with every message from a routine; one message from the person in the turn → own model; setting `delegatedSmallModel: false` → own model; agent already on Sonnet → own model (`not-larger-model`); small model not in a listed catalog → own model; a thread profile (Slack reply) → unchanged existing rule.
- [ ] **Step 2: Run, expect FAIL. Step 3: implement** the rule before the existing `autoModel` rules: it needs neither `autoModel` nor the short-text / work-word checks, and it ignores the warm-cache rule (the small model is cheaper even on a cold read). Keep the catalog and availability checks. Effort: the agent's own effort, capped at medium.
- [ ] **Step 4:** setting stored like `turnLimit`; UI switch "Use the smaller model for teammate and routine turns" with hint "Turns that you start keep this agent's model." under the Turn limit row.
- [ ] **Step 5:** the answer shows "Answered by <model>" as v0.40 auto-model already does (check that the same path is used).
- [ ] **Step 6:** run each test file alone; `typecheck:node`; `typecheck:renderer`; Biome. Changelog line under Changed.

### Task 9: Install guard text: reuse an installed device

- [ ] Change `status.agent.installGuardDenied` (en) so it says: do not run it again; to test on iOS, list installed simulators with `xcrun simctl list devices available`, boot one with `xcrun simctl boot <id>` and use it; on Android, list installed emulators with `emulator -list-avds` and start one; if none fits, ask the person. Keep `{…}` placeholders unchanged if any. Update a test only if one asserts the exact text. Run `bun run i18n:check`.

## Added 2026-11-26: routine that repeats "Cancelled routine" every 3 minutes

User report: a routine meant to run one time ran once at 11:45 and then wrote a "Cancelled routine" chat row every 3 minutes. GoAhead cannot save a one-time routine ("A one-time routine cannot be saved yet"), so the routine repeats, and each tick is cancelled (run condition, plan limit skip, or missed-run record). Exact cause on that Mac not confirmed.

### Task 11: One chat row for repeated cancelled runs

- [ ] A scheduled run that is cancelled (run condition says no, plan limit skip, missed runs) writes its run record as now, but adds a chat marker only when the previous run of the same routine was not cancelled for the same reason. Repeats update nothing in the chat. The Usage tab count of skipped runs stays correct.
- [ ] Tests (routine scheduler test file): 10 consecutive condition cancels → 1 marker, 10 run records; a completed run between cancels → a new marker for the next cancel; a different reason → a new marker.
- [ ] Desktop and mobile render existing markers unchanged (no wire change).

### Task 12: Real one-time routines

- [ ] "Once on <date> at <time>" can be saved from the desktop picker and by the agent routine tool (`src/backend/routine-tool-schema.ts`). The routine runs one time at that moment (or once when GoAhead opens if it was closed then), and then turns itself off (`active = false`). No more checks, runs or rows after that.
- [ ] Storage must not add a schedule kind that a released Team API peer, an older stored-routine reader or the v0.40 mobile app rejects. Check `packages/team-client/src/routine-schedule.ts` validation, the routine Team API routes and adapters, and mobile. Preferred: store it as an existing schedule kind (an `interval` with `anchorAt` = the chosen moment) plus a new optional routine field such as `endsAfterFirstRun: true` that older readers ignore; an older peer then sees a repeating routine, never an error. If a released reader rejects unknown fields, report it and stop.
- [ ] The routine list and settings show "Once on <date> at <time>"; after the run, "Done" (inactive).
- [ ] Tests: a once routine runs exactly one time and becomes inactive; a missed once routine runs once when GoAhead opens if the missed policy says so, else is recorded as missed and becomes inactive; an older stored routine without the field is unchanged.
