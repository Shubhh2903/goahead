import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What the storage panels reach in main: the stored files of a server, and the agent names that
 * label them.
 */
export interface FilesPort {
  agent: Pick<OpenBotDesktopApi["agent"], "listAgents">;
  storage: Pick<OpenBotDesktopApi["storage"], "clear" | "deleteFile" | "getUsage" | "openFile"> &
    // This computer only. A client with no `window.openbot`, such as the web client, leaves them out.
    Partial<Pick<OpenBotDesktopApi["storage"], "listUnassignedFolders" | "trashUnassignedFolder">>;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function filesPort(): FilesPort {
  return window.openbot;
}
