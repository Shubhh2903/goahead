import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export interface UsagePort {
  agent: Pick<OpenBotDesktopApi["agent"], "getHostAnalytics" | "listAgents" | "listModels" | "onScopedEvent">;
  servers: Pick<OpenBotDesktopApi["servers"], "onEvent">;
}

export function usagePort(): UsagePort {
  return window.openbot;
}
