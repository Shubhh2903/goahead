// The backdrop behind this computer's window. It is local only: a joined server does not see it.
//
// The renderer names a scene or an upload id, never a path or bytes. The uploads are the ones that
// GoAhead v0.40 and v0.41 saved; there is no new upload here.

import type { ChatBackdropChoice } from "@openbot/contracts/chat-backdrop";
import { isChatBackdropChoice, isChatBackdropUploadId } from "@openbot/contracts/chat-backdrop";
import type { ChatBackdropStore } from "../chat-backdrop-store";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface BackdropIpcDependencies {
  backdrops: ChatBackdropStore;
}

function parseChatBackdropChoice(value: unknown): ChatBackdropChoice | null {
  if (value === null) return null;
  if (!isChatBackdropChoice(value)) throw new Error("Invalid backdrop choice.");
  return value;
}

function parseChatBackdropUploadId(value: unknown): string {
  if (!isChatBackdropUploadId(value)) throw new Error("Invalid backdrop upload id.");
  return value;
}

export function backdropIpcHandlers({ backdrops }: BackdropIpcDependencies): Pick<IpcGroupHandlers, "backdrops"> {
  return {
    backdrops: {
      getState: handler(() => backdrops.state()),
      setChoice: payloadHandler(parseChatBackdropChoice, (choice) => backdrops.setChoice(choice)),
      remove: payloadHandler(parseChatBackdropUploadId, (id) => backdrops.remove(id)),
    },
  };
}
