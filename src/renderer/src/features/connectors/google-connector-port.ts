import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/** What the Connectors section reaches in main: the one Google connection of this computer. */
export type GoogleConnectorPort = OpenBotDesktopApi["googleConnector"];

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function googleConnectorPort(): GoogleConnectorPort {
  return window.openbot.googleConnector;
}
