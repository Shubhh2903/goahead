// The one Google connection of this computer: sign in through the browser, cancel, and sign out.

import type { AgentSummary } from "@openbot/contracts/ipc";
import type { GoogleConnectorService } from "../google-connector-service";
import type { GoogleNotices } from "../google-notices";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { stringPayload } from "./validation";

// Only the methods these endpoints call, so a test can pass a double without an assertion.
export interface GoogleConnectorIpcDependencies {
  googleConnector: Pick<GoogleConnectorService, "status" | "connect" | "cancel" | "disconnect" | "setMailAgent">;
  googleNotices: Pick<GoogleNotices, "list">;
  /** The local agents now, read at each call. */
  listAgents: () => AgentSummary[];
}

/**
 * The renderer cannot name a URL, a client id or a token: the main process builds each Google
 * address from the client that this build ships with. The one payload is an agent id, decoded first
 * and checked against the local agents.
 */
export function googleConnectorIpcHandlers({
  googleConnector,
  googleNotices,
  listAgents,
}: GoogleConnectorIpcDependencies): Pick<IpcGroupHandlers, "googleConnector"> {
  return {
    googleConnector: {
      status: handler(() => googleConnector.status()),
      notices: handler(() => googleNotices.list()),
      connect: handler(() => googleConnector.connect()),
      cancel: handler(() => googleConnector.cancel()),
      disconnect: handler(() => googleConnector.disconnect()),
      setMailAgent: payloadHandler(stringPayload("agentId"), (agentId) =>
        googleConnector.setMailAgent(
          agentId,
          listAgents().map((agent) => agent.id),
        ),
      ),
    },
  };
}
