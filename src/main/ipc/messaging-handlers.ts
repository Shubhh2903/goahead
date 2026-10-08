// The Slack workspaces where this computer's agents answer. Tokens only travel towards the host; no
// result carries one.

import type { AgentService } from "../../backend/agent-service";
import type { MessagingService } from "../../backend/messaging/messaging-service";
import type { HostService } from "../host-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import {
  parseAddSlackOrchestratorInput,
  parseAnswerMessagingDraftInput,
  parseHandOverSlackDefaultInput,
  parseMarkMessagingThreadReadInput,
  parseMessagingThreadPageInput,
  parseReadInboxConversationInput,
  parseSendInboxReplyInput,
  parseSetSlackEnabledInput,
  parseSetSlackSendGuardsInput,
  parseSetSlackWatchedChannelsInput,
  parseSlackWorkspaceInput,
} from "./messaging-inputs";

interface MessagingIpcDependencies {
  messaging: Pick<
    MessagingService,
    | "slackOverview"
    | "connectSlackWorkspace"
    | "disconnectSlackWorkspace"
    | "reconnect"
    | "setEnabled"
    | "addOrchestrator"
    | "threadSummaries"
    | "threadAgent"
    | "listSlackChannels"
    | "setSlackWatchedChannels"
    | "listDrafts"
    | "answerDraft"
    | "setSendGuards"
    | "listInbox"
    | "readInboxConversation"
    | "sendInboxReply"
    | "slackRouting"
    | "handOverSlackDefault"
  >;
  agents: Pick<AgentService, "readThreadPageFor" | "threadReadState" | "markThreadRead">;
  host: Pick<HostService, "agentReaderId">;
}

export function messagingIpcHandlers({
  messaging,
  agents,
  host,
}: MessagingIpcDependencies): Pick<IpcGroupHandlers, "messaging"> {
  return {
    messaging: {
      getSlackOverview: handler(() => messaging.slackOverview()),
      connectSlackWorkspace: handler(() => messaging.connectSlackWorkspace()),
      disconnectSlackWorkspace: payloadHandler(parseSlackWorkspaceInput, ({ workspaceId }) =>
        messaging.disconnectSlackWorkspace(workspaceId),
      ),
      reconnectSlackWorkspace: payloadHandler(parseSlackWorkspaceInput, ({ workspaceId }) =>
        messaging.reconnect(workspaceId),
      ),
      setSlackEnabled: payloadHandler(parseSetSlackEnabledInput, ({ workspaceId, enabled }) =>
        messaging.setEnabled(workspaceId, enabled),
      ),
      addSlackOrchestrator: payloadHandler(parseAddSlackOrchestratorInput, (input) => messaging.addOrchestrator(input)),
      // `threadAgent` refuses any thread that is not an external conversation, so these never read an
      // agent's chat or a channel.
      listThreads: handler(() => {
        const readerId = host.agentReaderId();
        return messaging.threadSummaries().map((summary) => ({
          ...summary,
          unreadCount: agents.threadReadState(readerId, summary.threadId).unreadCount,
        }));
      }),
      readThreadPage: payloadHandler(parseMessagingThreadPageInput, ({ threadId, anchor, limit }) =>
        agents.readThreadPageFor(messaging.threadAgent(threadId), threadId, host.agentReaderId(), anchor, limit),
      ),
      listSlackChannels: payloadHandler(parseSlackWorkspaceInput, ({ workspaceId }) =>
        messaging.listSlackChannels(workspaceId),
      ),
      setSlackWatchedChannels: payloadHandler(parseSetSlackWatchedChannelsInput, ({ workspaceId, channels }) =>
        messaging.setSlackWatchedChannels(workspaceId, channels),
      ),
      listDrafts: handler(() => messaging.listDrafts()),
      // Read-only: the inbox list never sends. Only `sendInboxReply` posts, as the person.
      listInbox: handler(() => messaging.listInbox()),
      readInboxConversation: payloadHandler(parseReadInboxConversationInput, ({ workspaceId, conversation, limit }) =>
        messaging.readInboxConversation(workspaceId, conversation, limit),
      ),
      sendInboxReply: payloadHandler(parseSendInboxReplyInput, (input) => messaging.sendInboxReply(input)),
      getSlackRouting: payloadHandler(parseSlackWorkspaceInput, ({ workspaceId }) =>
        messaging.slackRouting(workspaceId),
      ),
      handOverSlackDefault: payloadHandler(parseHandOverSlackDefaultInput, ({ workspaceId, slackUserId }) =>
        messaging.handOverSlackDefault(workspaceId, slackUserId),
      ),
      setSlackSendGuards: payloadHandler(parseSetSlackSendGuardsInput, ({ workspaceId, ...change }) =>
        messaging.setSendGuards(workspaceId, change),
      ),
      answerDraft: payloadHandler(parseAnswerMessagingDraftInput, ({ draftId, decision, text }) =>
        messaging.answerDraft(draftId, decision, text),
      ),
      markThreadRead: payloadHandler(parseMarkMessagingThreadReadInput, ({ threadId, throughMessageId }) =>
        agents.markThreadRead(messaging.threadAgent(threadId), threadId, host.agentReaderId(), throughMessageId),
      ),
    },
  };
}
