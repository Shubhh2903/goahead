import type { ChannelSummary, SidebarLayoutSnapshot } from "@openbot/contracts/ipc";
import {
  SIDEBAR_UNASSIGNED_SECTION_ID,
  sidebarFolderAncestors,
  sidebarFolderParents,
  sidebarFolderPath,
} from "@openbot/contracts/ipc";
import { CHAT_FOLDERS_CAPABILITY } from "@openbot/contracts/team-protocol/chat-folders-v1";
import type { MobileTranslate } from "@openbot/i18n/mobile";
import { currentText } from "@/shared/lib/text";
import type { MobileChatOrder } from "./chat-order";
import type { MobileAgent } from "./workspace-types";

export type MobileSidebarItem =
  | { kind: "section"; id: string; name: string; empty: boolean }
  | { kind: "agent"; id: string; agent: MobileAgent }
  | { kind: "channel"; id: string; channel: ChannelSummary };

type MobileChatItem = Extract<MobileSidebarItem, { kind: "agent" | "channel" }>;

/** The fields of a chat that its last activity comes from. */
type MobileChatActivitySource =
  | { kind: "agent"; agent: { updatedAt: string | null } }
  | { kind: "channel"; channel: { createdAt: string; lastMessage: { at: string } | null } };

/** When a chat last had activity, in epoch milliseconds: the agent's last update, or the channel's last message. */
function chatActivity(chat: MobileChatActivitySource): number {
  const at = chat.kind === "agent" ? chat.agent.updatedAt : (chat.channel.lastMessage?.at ?? chat.channel.createdAt);
  const time = at ? Date.parse(at) : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

/** The chats by last activity, the most recent first. Chats with the same time keep their order. */
export function sortMobileChatsByRecent<T extends MobileChatActivitySource>(chats: T[]): T[] {
  return [...chats].sort((a, b) => chatActivity(b) - chatActivity(a));
}

/**
 * True when the host sends folders in folders (`chat-folders-v1`). Then the phone reads the layout from
 * the chat-folders route, which keeps `parentId`. An older host gives the released layout, which has no
 * parents, so the phone shows the flat list.
 */
export function mobileChatFoldersSupported(capabilities: readonly string[] | undefined): boolean {
  return capabilities?.includes(CHAT_FOLDERS_CAPABILITY) ?? false;
}

export function mobileSidebarItems(
  layout: SidebarLayoutSnapshot | null,
  agents: MobileAgent[],
  channels: ChannelSummary[],
  collapsedSectionIds: ReadonlySet<string> = new Set(),
  t: MobileTranslate = currentText().t,
  order: MobileChatOrder = "manual",
): MobileSidebarItem[] {
  const saved: MobileChatItem[] = [
    ...channels.map((channel) => ({ kind: "channel" as const, id: channel.id, channel })),
    ...agents.map((agent) => ({ kind: "agent" as const, id: agent.id, agent })),
  ];
  if (!layout) return order === "recent" ? sortMobileChatsByRecent(saved) : saved;
  const positions = new Map(layout.agentOrder.map((id, index) => [id, index]));
  saved.sort((a, b) => (positions.get(a.id) ?? positions.size) - (positions.get(b.id) ?? positions.size));
  const chats = order === "recent" ? sortMobileChatsByRecent(saved) : saved;
  const names = new Map(layout.sections.map((section) => [section.id, section.name]));
  // A folder in a folder shows its path, "Parent / Name". A layout with no parent gives each name alone.
  const parents = sidebarFolderParents(layout);
  const groups = new Map<string, MobileSidebarItem[]>();
  for (const chat of chats) {
    const assigned = layout.agentAssignments[chat.id];
    const sectionId = assigned && names.has(assigned) ? assigned : SIDEBAR_UNASSIGNED_SECTION_ID;
    const group = groups.get(sectionId) ?? [];
    group.push(chat);
    groups.set(sectionId, group);
  }
  return layout.order.flatMap((id) => {
    const group = groups.get(id) ?? [];
    const name = names.has(id)
      ? sidebarFolderPath(layout, parents, id).join(" / ")
      : id === SIDEBAR_UNASSIGNED_SECTION_ID
        ? t("mobile.workspace.section.agents")
        : null;
    if (!name || (id === SIDEBAR_UNASSIGNED_SECTION_ID && group.length === 0)) return [];
    // A folder hides while a folder that holds it is collapsed.
    if (sidebarFolderAncestors(parents, id).some((ancestorId) => collapsedSectionIds.has(ancestorId))) return [];
    return [
      { kind: "section" as const, id, name, empty: group.length === 0 },
      ...(collapsedSectionIds.has(id) ? [] : group),
    ];
  });
}
