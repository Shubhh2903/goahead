// The backdrop behind this computer's window. It is local only: a joined server does not see it.
//
// The renderer names a scene or an upload id, never a path or bytes. `upload` opens the file dialog
// here, and `ChatBackdropStore` checks the type, the signature and the size before it copies the file.

import type { ChatBackdropChoice, ChatBackdropUploadResult } from "@openbot/contracts/chat-backdrop";
import {
  CHAT_BACKDROP_UPLOAD_TYPES,
  isChatBackdropChoice,
  isChatBackdropUploadId,
} from "@openbot/contracts/chat-backdrop";
import type { AppTranslate } from "@openbot/i18n";
import { type BrowserWindow, dialog, type OpenDialogOptions } from "electron";
import type { ChatBackdropStore } from "../chat-backdrop-store";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface BackdropIpcDependencies {
  backdrops: ChatBackdropStore;
  getMainWindow: () => BrowserWindow | null;
  translate: AppTranslate;
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

export function backdropIpcHandlers({
  backdrops,
  getMainWindow,
  translate,
}: BackdropIpcDependencies): Pick<IpcGroupHandlers, "backdrops"> {
  return {
    backdrops: {
      getState: handler(() => backdrops.state()),
      setChoice: payloadHandler(parseChatBackdropChoice, (choice) => backdrops.setChoice(choice)),
      upload: handler(async (): Promise<ChatBackdropUploadResult> => {
        const mainWindow = getMainWindow();
        const options: OpenDialogOptions = {
          title: translate("dialog.chooseBackdrop"),
          properties: ["openFile"],
          filters: [
            { name: translate("dialog.filter.backdrops"), extensions: Object.keys(CHAT_BACKDROP_UPLOAD_TYPES) },
          ],
        };
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options);
        const path = result.canceled ? undefined : result.filePaths[0];
        if (path === undefined) return { status: "cancelled" };
        return backdrops.importFile(path);
      }),
      remove: payloadHandler(parseChatBackdropUploadId, (id) => backdrops.remove(id)),
    },
  };
}
