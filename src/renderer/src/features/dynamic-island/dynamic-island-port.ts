import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

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
    | "setInputRegion"
  >;
  googleConnector: Pick<OpenBotDesktopApi["googleConnector"], "notices" | "onNoticesChanged">;
}

export function dynamicIslandPort(): DynamicIslandPort {
  return window.openbot;
}
