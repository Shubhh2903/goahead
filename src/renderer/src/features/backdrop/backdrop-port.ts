import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * The backdrop calls this feature makes in main. Null where the bridge has no backdrop group, such
 * as a preview host without one: the window then shows no backdrop. Read on each call, because
 * tests and stories replace `window.openbot` per case.
 */
export function backdropPort(): OpenBotDesktopApi["backdrops"] | null {
  return window.openbot?.backdrops ?? null;
}
