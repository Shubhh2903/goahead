// Frozen optional chat-folders-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: any signed-in member reads the
// sidebar layout of the host with the parent of each folder. A sidebar section is a folder, and it can
// carry `parentId`; a folder without it is at the top of the list. Three levels at most. The route takes
// an empty body and answers the whole layout, the same layout as `/v1/sidebar-layout` plus `parentId`,
// without the agents that the member cannot see. It changes nothing: a client changes the layout through
// `/v1/sidebar-layout/actions`, and reads this route again on `sidebar-layout-changed`. Bounds and meaning
// do not follow IPC changes; widening any of it needs a second capability string.
import { isSidebarLayoutSnapshot, type SidebarLayoutSnapshot } from "../ipc-sidebar-layout";
import { isDynamicRecord } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  count,
  empty,
  fields,
  identifier,
  list,
  type OptionalRouteCodec,
  string,
} from "./admin-wire";

export const CHAT_FOLDERS_CAPABILITY = "chat-folders-v1";

export const CHAT_FOLDERS_ROUTES = {
  read: "/v1/chat-folders",
} as const;

const SECTION_LIMIT = 100;
const NAME_LIMIT = 40;
const CHAT_LIMIT = 10_000;

const name: AdminDecoder = (input) => {
  const value = string(NAME_LIMIT)(input);
  if (value === "") throw new Error("Invalid chat folder name.");
  return value;
};
const assignments: AdminDecoder = (input) => {
  if (!isDynamicRecord(input) || Object.keys(input).length > CHAT_LIMIT) throw new Error("Invalid chat folders.");
  return Object.fromEntries(
    Object.entries(input).map(([chatId, sectionId]) => [identifier(chatId), identifier(sectionId)]),
  );
};
const layout = fields({
  revision: count,
  sections: list(fields({ id: identifier, name }, { parentId: identifier }), SECTION_LIMIT),
  order: list(identifier, SECTION_LIMIT + 2),
  agentAssignments: assignments,
  agentOrder: list(identifier, CHAT_LIMIT),
});

export const CHAT_FOLDERS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [CHAT_FOLDERS_ROUTES.read, adminRoute(empty, layout)],
]);

/** The layout a client reads from the route: the wire bounds above, then the IPC layout rules. */
export function decodeChatFoldersLayout(value: unknown): SidebarLayoutSnapshot {
  const decoded = layout(value);
  if (!isSidebarLayoutSnapshot(decoded)) throw new Error("Invalid chat folders.");
  return decoded;
}
