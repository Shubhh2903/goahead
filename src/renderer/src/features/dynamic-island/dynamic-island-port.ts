import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What the dynamic island reaches in main: its presentation, preference, geometry and actions, and
 * the agent events it shows. The island window has no provider tree, so this is a module.
 */
export interface DynamicIslandPort {
  agent: Pick<OpenBotDesktopApi["agent"], "acknowledgeFailedTurn" | "onScopedEvent">;
  dynamicIsland: Pick<
    OpenBotDesktopApi["dynamicIsland"],
    | "getPreference"
    | "getPresentation"
    | "onAction"
    | "onGaze"
    | "onGeometry"
    | "onPreference"
    | "onPresentation"
    | "performAction"
    | "performHaptic"
    | "publishPresentation"
    | "setInteractive"
  >;
  googleConnector: Pick<OpenBotDesktopApi["googleConnector"], "notices" | "onNoticesChanged">;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function dynamicIslandPort(): DynamicIslandPort {
  return window.openbot;
}
