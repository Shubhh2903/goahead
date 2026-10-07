import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/** What the Slack conversation list and its read-only view reach in main. */
export interface MessagingThreadsPort {
  messaging: Pick<
    OpenBotDesktopApi["messaging"],
    "listThreads" | "readThreadPage" | "markThreadRead" | "onThreadsChanged" | "listDrafts" | "answerDraft"
  >;
  openAttachment: OpenBotDesktopApi["agent"]["openAttachment"];
  openUrl: OpenBotDesktopApi["openUrl"];
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function messagingThreadsPort(): MessagingThreadsPort {
  const api = window.openbot;
  return {
    messaging: api.messaging,
    openAttachment: (input, serverId) => api.agent.openAttachment(input, serverId),
    openUrl: (url) => api.openUrl(url),
  };
}
