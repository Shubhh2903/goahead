import type { ConversationMessageSender, DynamicIslandAction, SendMessageInput } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { routeToServer } from "./ipc/route-to-server";

/** The island actions that main runs against the agent itself, with no help from the main window. */
export type CriticalAction = Extract<
  DynamicIslandAction,
  { type: "answer-prompt" | "respond-approval" | "send-message" | "stop-agent" }
>;

export interface DynamicIslandActionAgent {
  respondToPrompt(input: { requestId: string | number; answers: Record<string, string[]> }): Promise<void>;
  respondToApproval(input: { requestId: string | number; decision: "accept" | "decline" }): Promise<void>;
  sendMessage(input: SendMessageInput, sender?: ConversationMessageSender): Promise<unknown>;
  interrupt(agentId: string, turnId: string): Promise<void>;
}

export interface DynamicIslandRemoteAgent {
  request(
    serverId: string,
    path: string,
    decoder: (value: unknown) => unknown,
    init: { method: "POST"; body: unknown },
  ): Promise<unknown>;
}

export interface DynamicIslandActionDecoders {
  decodeVoid: (value: unknown) => void;
  decodeQueuedMessageReceipt: (value: unknown) => unknown;
}

export async function performDynamicIslandCriticalAction(
  action: CriticalAction,
  local: DynamicIslandActionAgent,
  remote: DynamicIslandRemoteAgent,
  decoders: DynamicIslandActionDecoders,
  sender: () => ConversationMessageSender | undefined,
): Promise<void> {
  const { decodeVoid, decodeQueuedMessageReceipt } = decoders;
  if (action.type === "send-message") {
    const input = { agentId: action.agentId, text: action.text, clientMessageId: action.clientMessageId };
    await routeToServer<unknown>(action.serverId, {
      local: () => local.sendMessage(input, sender()),
      remote: (serverId) =>
        remote.request(serverId, TEAM_API_ROUTES.agent.messages(action.agentId), decodeQueuedMessageReceipt, {
          method: "POST",
          // The host uses this computer's zone for a routine the agent creates from the message.
          body: { ...input, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        }),
    });
    return;
  }
  if (action.type === "stop-agent") {
    await routeToServer<unknown>(action.serverId, {
      local: () => local.interrupt(action.agentId, action.turnId),
      remote: (serverId) =>
        remote.request(serverId, TEAM_API_ROUTES.agent.interrupt(action.agentId), decodeVoid, {
          method: "POST",
          body: { turnId: action.turnId },
        }),
    });
    return;
  }
  if (action.type === "answer-prompt") {
    const input = { requestId: action.requestId, answers: action.answers };
    await routeToServer<unknown>(action.serverId, {
      local: () => local.respondToPrompt(input),
      remote: (serverId) =>
        remote.request(serverId, TEAM_API_ROUTES.respond.prompt, decodeVoid, { method: "POST", body: input }),
    });
    return;
  }
  const input = { requestId: action.requestId, decision: action.decision };
  await routeToServer<unknown>(action.serverId, {
    local: () => local.respondToApproval(input),
    remote: (serverId) =>
      remote.request(serverId, TEAM_API_ROUTES.respond.approval, decodeVoid, { method: "POST", body: input }),
  });
}
