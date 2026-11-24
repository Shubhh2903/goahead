import { CHAT_FOLDERS_CAPABILITY, CHAT_FOLDERS_ROUTES } from "@openbot/contracts/team-protocol/chat-folders-v1";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiSidebarLayout } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson } from "./request-helpers";

/**
 * `chat-folders-v1`: the sidebar layout with the parent of each folder. Any member reads it, as with
 * `/v1/sidebar-layout`. The response leaves out the agents that this member cannot see, as every JSON
 * response does. Read only: changes go through `/v1/sidebar-layout/actions`.
 */
export async function routeChatFolders(
  context: TeamApiRequestContext,
  sidebarLayout: Pick<TeamApiSidebarLayout, "getSnapshot">,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || url.pathname !== CHAT_FOLDERS_ROUTES.read) return "unmatched";
  if (!capabilities.has(CHAT_FOLDERS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.chatFoldersUnsupported"));
  // `readJson` has already run the empty body through the chat-folders wire codec.
  await readJson(request);
  return json(200, sidebarLayout.getSnapshot());
}
