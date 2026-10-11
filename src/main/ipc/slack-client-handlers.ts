// The Slack client of a workspace connected as the person. Local only. The file picker opens here, so
// the renderer never names a path. No result carries a token or a Slack file address.

import { type BrowserWindow, dialog, type OpenDialogOptions } from "electron";
import type { MessagingService } from "../../backend/messaging/messaging-service";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import {
  parseSlackClientAutoReplyInput,
  parseSlackClientDeleteInput,
  parseSlackClientEditInput,
  parseSlackClientListInput,
  parseSlackClientMentionInput,
  parseSlackClientOlderInput,
  parseSlackClientOpenInput,
  parseSlackClientReactInput,
  parseSlackClientSendInput,
  parseSlackClientThreadInput,
  parseSlackClientUploadBytesInput,
  parseSlackClientUploadInput,
} from "./slack-client-inputs";

export interface SlackClientIpcDependencies {
  messaging: Pick<
    MessagingService,
    | "slackClientConversations"
    | "slackClientOpen"
    | "slackClientOlder"
    | "slackClientThread"
    | "slackClientSend"
    | "slackClientEdit"
    | "slackClientDelete"
    | "slackClientReact"
    | "slackClientSetAutoReply"
    | "slackClientUpload"
    | "slackClientMentionCandidates"
  >;
  getMainWindow: () => BrowserWindow | null;
}

export function slackClientIpcHandlers({
  messaging,
  getMainWindow,
}: SlackClientIpcDependencies): Pick<IpcGroupHandlers, "slackClient"> {
  const chooseFile = async (): Promise<string | null> => {
    const mainWindow = getMainWindow();
    const options: OpenDialogOptions = { properties: ["openFile"] };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  };

  return {
    slackClient: {
      listConversations: payloadHandler(parseSlackClientListInput, (input) =>
        messaging.slackClientConversations(input),
      ),
      open: payloadHandler(parseSlackClientOpenInput, (input) => messaging.slackClientOpen(input)),
      older: payloadHandler(parseSlackClientOlderInput, (input) => messaging.slackClientOlder(input)),
      thread: payloadHandler(parseSlackClientThreadInput, (input) => messaging.slackClientThread(input)),
      // The person's own actions: no approval and no send guard. Edit and delete refuse a message
      // that is not theirs before any Slack call.
      send: payloadHandler(parseSlackClientSendInput, (input) => messaging.slackClientSend(input)),
      edit: payloadHandler(parseSlackClientEditInput, (input) => messaging.slackClientEdit(input)),
      delete: payloadHandler(parseSlackClientDeleteInput, (input) => messaging.slackClientDelete(input)),
      react: payloadHandler(parseSlackClientReactInput, (input) => messaging.slackClientReact(input)),
      // The sender check runs first, as for every handler. The service refuses a workspace that is not
      // connected as the person, so only the person who owns the connection changes the list.
      setAutoReply: payloadHandler(parseSlackClientAutoReplyInput, (input) => messaging.slackClientSetAutoReply(input)),
      upload: payloadHandler(parseSlackClientUploadInput, async ({ workspaceId, channelId, threadTs, text }) => {
        const path = await chooseFile();
        if (!path) return null;
        return messaging.slackClientUpload(workspaceId, {
          channelId,
          ...(threadTs === undefined ? {} : { threadTs }),
          ...(text === undefined ? {} : { text }),
          source: { path },
        });
      }),
      // A file dropped on the composer: the renderer sends its name and bytes, never a path.
      uploadBytes: payloadHandler(
        parseSlackClientUploadBytesInput,
        ({ workspaceId, channelId, threadTs, text, name, bytes }) =>
          messaging.slackClientUpload(workspaceId, {
            channelId,
            ...(threadTs === undefined ? {} : { threadTs }),
            ...(text === undefined ? {} : { text }),
            source: { name, bytes },
          }),
      ),
      mentionCandidates: payloadHandler(parseSlackClientMentionInput, (input) =>
        messaging.slackClientMentionCandidates(input),
      ),
    },
  };
}
