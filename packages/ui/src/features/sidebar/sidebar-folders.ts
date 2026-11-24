/**
 * The folders of the sidebar as plain data: which folder shows each chat, and the folder tree that the
 * filter menu lists. No component and no store, so the rules can be read and tested alone.
 */

import {
  SIDEBAR_PEOPLE_SECTION_ID,
  SIDEBAR_UNASSIGNED_SECTION_ID,
  type SidebarLayoutSnapshot,
} from "@openbot/contracts/ipc";
import type { SidebarFolderNode } from "./sidebar-list-filter";

/**
 * The chats of each section, in the order of `chats`. A chat whose folder is not in both `sections` and
 * `order` goes to the unassigned section, so it stays on screen. Sort `chats` first: each folder keeps
 * that order, so the "Recent activity" order applies inside each folder.
 */
export function groupSidebarChatsBySection<T extends { id: string }>(
  chats: readonly T[],
  layout: Pick<SidebarLayoutSnapshot, "sections" | "order" | "agentAssignments">,
): Map<string, T[]> {
  const sectionIds = new Set(layout.sections.map((section) => section.id));
  const orderedIds = new Set(layout.order);
  const groups = new Map<string, T[]>();
  for (const chat of chats) {
    const assigned = layout.agentAssignments[chat.id];
    const sectionId =
      assigned && sectionIds.has(assigned) && orderedIds.has(assigned) ? assigned : SIDEBAR_UNASSIGNED_SECTION_ID;
    const group = groups.get(sectionId);
    if (group) group.push(chat);
    else groups.set(sectionId, [chat]);
  }
  return groups;
}

/** The folders at the top of the list and the folders in each, in sidebar order. Unassigned has no name. */
export function sidebarFolderTree(
  layout: Pick<SidebarLayoutSnapshot, "sections" | "order">,
  parents: ReadonlyMap<string, string>,
): SidebarFolderNode[] {
  const names = new Map(layout.sections.map((section) => [section.id, section.name]));
  const children = new Map<string | null, string[]>();
  for (const sectionId of layout.order) {
    if (sectionId === SIDEBAR_PEOPLE_SECTION_ID) continue;
    if (sectionId !== SIDEBAR_UNASSIGNED_SECTION_ID && !names.has(sectionId)) continue;
    const parentId = parents.get(sectionId) ?? null;
    children.set(parentId, [...(children.get(parentId) ?? []), sectionId]);
  }
  const node = (id: string): SidebarFolderNode => ({
    id,
    name: names.get(id) ?? null,
    children: (children.get(id) ?? []).map(node),
  });
  return (children.get(null) ?? []).map(node);
}
