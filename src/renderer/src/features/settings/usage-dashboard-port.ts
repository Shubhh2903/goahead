import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/** What the Usage tab reaches in main: this computer's usage, and its agents to name the rows. */
export interface UsageDashboardPort {
  usage: OpenBotDesktopApi["usage"];
  agent: Pick<OpenBotDesktopApi["agent"], "listAgents">;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function usageDashboardPort(): UsageDashboardPort {
  return window.openbot;
}
