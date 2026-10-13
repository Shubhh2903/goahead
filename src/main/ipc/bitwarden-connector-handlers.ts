// The one Bitwarden connection of this computer: connect with a CLI session key, and disconnect.

import type { BitwardenConnectorService } from "../bitwarden-connector-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { stringPayload } from "./validation";

/** A `bw unlock --raw` session key is under a hundred characters; a much longer value is not one. */
const MAX_SESSION_KEY_LENGTH = 4096;

// Only the methods these endpoints call, so a test can pass a double without an assertion.
export interface BitwardenConnectorIpcDependencies {
  bitwardenConnector: Pick<BitwardenConnectorService, "status" | "connect" | "disconnect">;
}

/**
 * The renderer hands over a session key once. It never names a CLI path, a folder, an item or a
 * command, and every answer is the connection state only.
 */
export function bitwardenConnectorIpcHandlers({
  bitwardenConnector,
}: BitwardenConnectorIpcDependencies): Pick<IpcGroupHandlers, "bitwardenConnector"> {
  return {
    bitwardenConnector: {
      status: handler(() => bitwardenConnector.status()),
      connect: payloadHandler(stringPayload("sessionKey", MAX_SESSION_KEY_LENGTH), (key) =>
        bitwardenConnector.connect(key),
      ),
      disconnect: handler(() => bitwardenConnector.disconnect()),
    },
  };
}
