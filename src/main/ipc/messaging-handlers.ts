// The Slack workspaces where this computer's agents answer. Tokens only travel towards the host; no
// result carries one.

import type { AgentService } from "../../backend/agent-service";
import type { MessagingService } from "../../backend/messaging/messaging-service";
import type { HostService } from "../host-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import {
  parseAddSlackOrchestratorInput,
  parseMarkMessagingThreadReadInput,
  parseMessagingThreadPageInput,
  parseSetSlackEnabledInput,
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
      markThreadRead: payloadHandler(parseMarkMessagingThreadReadInput, ({ threadId, throughMessageId }) =>
        agents.markThreadRead(messaging.threadAgent(threadId), threadId, host.agentReaderId(), throughMessageId),
      ),
    },
  };
}
