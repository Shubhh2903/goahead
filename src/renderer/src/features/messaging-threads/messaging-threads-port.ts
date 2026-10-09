import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/** What the Slack conversation list, the inbox and its reply box reach in main. */
export interface MessagingThreadsPort {
  messaging: Pick<
    OpenBotDesktopApi["messaging"],
    | "listThreads"
    | "readThreadPage"
    | "markThreadRead"
    | "hideThreads"
    | "onThreadsChanged"
    | "listDrafts"
    | "answerDraft"
    | "listInbox"
    | "readInboxConversation"
    | "onInboxChanged"
    | "sendInboxReply"
    | "askOrchestratorAboutInbox"
    | "getSlackRouting"
    | "handOverSlackDefault"
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
