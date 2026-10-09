# Emotion Faces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The GoAhead face in the macOS Dynamic Island and the Dock icon shows one of 22 emotions that follows what the agents do, and a random calm one when idle.

**Architecture:** A pure emotion engine in the main process turns agent state into one emotion (fixed priority, timers, idle randomness, 3 s minimum hold). Main sends it to the island window inside the existing presentation and sets the Dock icon to a pre-rendered PNG. The island renders the animated SVG face in place of the GoAhead logo (static SVG with Reduce Motion). A Dynamic Island setting turns it off.

**Tech Stack:** Electron main (TypeScript), SolidJS 2.0 RC renderer + `@openbot/ui` / `@openbot/brand`, Vitest.

**Spec (approved in chat, 2026-10-09):** this file's "Design" section.

## Design

- Assets: kit at `/Users/ensureprotect/Downloads/yellow-emotions-kit.zip` (untrusted download: extract into a new empty temp directory, copy only `.svg` and `emotions.config.json`, never run its `examples/`). 22 emotions: neutral, happy, joy, cute, wink, loved, listening, thinking, focused, curious, confused, surprised, doubtful, unamused, strain, sad, oops, dizzy, sleepy, learned, money, needs-you. 128×128 viewBox, yellow #F5C84C, ink #080609. Kit README: neutral traced from the user's logo; others adapt a supplied reference (opencharm.dev) — user accepted for internal use.
- Mapping (approved): idle → random calm (neutral, happy, wink, cute) changing every 20–40 s; sleepy after 10 min without activity · message arrives → listening · thinking → thinking · working with tools → focused · work > 2 min → strain · hand-off to another agent → curious · turn done → joy for 3 s, then happy · memory saved → learned · waiting for approval/input → needs-you · error → oops · usage limit → money · 3+ errors in a row → dizzy.
- Several agents: most important wins. Priority: needs-you > dizzy > oops > money > strain > focused > thinking > curious > listening > learned > joy > happy > idle.
- Island: animated face replaces `AppLogo` in `CompactLeading` for every mode; in working mode the avatar stack stays next to it. Reduce Motion → static SVG.
- Dock: static PNG per emotion; feature off → the normal (color) app icon.
- Change rate: at most one emotion change per 3 s (except needs-you, which shows at once).
- Setting: `DynamicIslandPreference.emotionsEnabled` (default true) in Settings > Dynamic Island, "Show emotions" — controls island and Dock.

## Global Constraints

- WORKTREE: all work in `/Users/ensureprotect/projects/openbot/.claude/worktrees/emotions` (branch `emotions`). Absolute paths under it; run commands from it. Never edit the main checkout or `.claude/worktrees/slack-client`.
- No `git commit/push/tag/stash/reset/checkout/restore`. The user commits.
- Change only your task's files; report if you need another.
- Checks: only your task's test files, one per command (`bun run test:desktop -- <path>`); `bunx biome check --write --max-diagnostics=none <paths>`; `bun run typecheck:node` / `bun run typecheck:renderer` only where the task says. No full suites, builds, `bun run typecheck`, `bun run format`.
- i18n keys for user text (English). No `data-testid`. No `biome-ignore`/`ts-ignore`/`as any`.
- Keep the renderer-to-main trust boundary; the island window only receives an emotion id.
- Preference stores: an added optional field must default when absent (old preference files keep working).

## Tasks

### Task 1: Assets, contracts, Dock PNGs
**Files:** `packages/brand/src/emotions/{animated,static}/*.svg` (from the kit; the kit's `static/` set if present, else `png/` is NOT used for the island), `packages/brand/src/emotions/emotions.ts` (typed list: `EMOTION_IDS`, `EmotionId`, `emotionLabel` keys, durations from config, `animatedSvg(id)`/`staticSvg(id)` via `?raw` imports or inline strings — follow how `packages/brand` exports today), `packages/brand/package.json` export subpath; `packages/contracts/src/ipc-dynamic-island.ts` (`EmotionId` union, optional `emotion?: EmotionId` on `DynamicIslandPresentation`, `emotionsEnabled?: boolean` on `DynamicIslandPreference` + guards accept them); `scripts/generate-emotion-dock-icons.ts` (render the 22 static SVGs to 1024×1024 PNGs with macOS safe-area padding the way `scripts/generate-logo-color-icons.ts` does for the logo) and the generated `build/emotions/emotion-<id>-macos-safe-area.png` files committed-ready; electron-builder `extraResources`/files entry so packaged builds include `build/emotions` (follow how `build/logo-colors` icons are shipped). English keys `dynamicIsland.emotion.<id>` labels ("GoAhead: focused") and settings `settings.dynamicIsland.emotions.title` "Show emotions" + description.
**Tests:** contracts guard accepts presentation with/without emotion and preference with/without `emotionsEnabled`; a brand test that every `EMOTION_IDS` entry has animated + static SVG and a Dock PNG exists.

### Task 2: Emotion engine (pure)
**Files:** `src/main/emotion-engine.ts` + `emotion-engine.test.ts`.
`createEmotionEngine({ now, random, onChange })` with inputs: `presentation(mode, …)`, `turnStarted(agentId)`, `toolUse(agentId)`, `turnCompleted(agentId, status)`, `handoff(status)`, `memorySaved()`, `usageLimit()`, `activity()`, `tick()`; computes the approved priority, timers (joy 3 s → happy; strain after 2 min of continuous work; dizzy after 3 failed turns in a row, reset on a success; sleepy after 10 min no activity; idle random calm every 20–40 s), 3 s minimum hold except needs-you. Deterministic with injected clock/random.
**Tests:** one per priority/timer rule; idle randomness with a seeded random; hold rule; needs-you bypasses hold.

### Task 3: Main wiring and Dock
**Files:** `src/main/dynamic-island-window.ts` (attach `emotion` to the presentation sent to the island window), `src/main/renderer-forwarders.ts` or `src/main/index.ts` (feed engine from agent events, handoffs, memories-changed, usage-limit-reached; tick timer `unref`), new `src/main/dock-emotion.ts` (set `app.dock.setIcon(nativeImage.createFromPath(png))` on change, throttled; restore the normal/colored icon via the existing `applyAppIconColor`/app-icon path when disabled; darwin only; respect `emotionsEnabled`), preference wiring (default true). Depends on T1, T2.
**Tests:** `dock-emotion.test.ts` (fake dock: sets the PNG for an emotion, throttles, restores on disable); one wiring test that a `turn-started` event leads to `thinking` in the presentation (use existing test patterns for dynamic-island-window if present).

### Task 4: Island face and setting
**Files:** `packages/ui/src/features/dynamic-island/EmotionFace.tsx` (+ CSS; `role="img"`, `aria-label` from `dynamicIsland.emotion.<id>`; animated SVG, static with `prefersReducedMotion()`), `OpenBotDynamicIsland.tsx` `CompactLeading` uses it when `presentation.emotion` is set and emotions are enabled, else `AppLogo` as today; working mode keeps the avatar stack beside the face; `SettingsDynamicIslandTab.tsx` "Show emotions" switch; stories in `src/renderer/stories/DynamicIsland.stories.tsx` (one per emotion via the Playground or a new story). Depends on T1.
**Tests:** island shows the face with the right accessible name; Reduce Motion uses the static face; setting switch toggles `emotionsEnabled`.

### Task 5: Docs and notes
**Files:** `changelog.d/emotion-faces.md` (Added: the face shows what agents do in the Dynamic Island and the Dock; Show emotions setting), `docs/ARCHITECTURE.md` one line (emotion engine in main). Run `bun scripts/check-release-notes.ts`.

## Final check
`bun run typecheck:node`, `bun run typecheck:renderer`, `bun run i18n:check`, each task's tests once, one at a time; whole-branch review.
