import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/** What the Slack client reaches in main. */
export interface SlackClientPort {
  slackClient: OpenBotDesktopApi["slackClient"];
  /** `@chief` reuses the inbox's ask path: the Slack Orchestrator gets the instruction. */
  askOrchestrator: OpenBotDesktopApi["messaging"]["askOrchestratorAboutInbox"];
  openUrl: OpenBotDesktopApi["openUrl"];
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function slackClientPort(): SlackClientPort {
  const api = window.openbot;
  return {
    slackClient: api.slackClient,
    askOrchestrator: (input) => api.messaging.askOrchestratorAboutInbox(input),
    openUrl: (url) => api.openUrl(url),
  };
}
