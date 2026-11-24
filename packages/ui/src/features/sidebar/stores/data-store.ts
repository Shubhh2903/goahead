/**
 * Every read projection the sidebar renders and drags against: the props filtered, sorted, grouped
 * and indexed. Nothing here mutates and nothing here calls a prop callback, which is what makes it
 * safe for the drag engine to hold - it satisfies the engine's list model and can do nothing else.
 */

import {
  type ChannelSummary,
  SIDEBAR_FOLDER_LEVELS,
  SIDEBAR_PEOPLE_SECTION_ID,
  SIDEBAR_UNASSIGNED_SECTION_ID,
  sidebarFolderAncestors,
  sidebarFolderHeight,
  sidebarFolderParents,
} from "@openbot/contracts/ipc";
import { createMemo, createSignal } from "solid-js";
import type { AgentProfile } from "../../../data";
import { currentText } from "../../../text";
import { teamMemberName } from "../../team/TeamPersonAvatar";
import { agentMatchesQuery, channelMatchesQuery, personMatchesQuery } from "../sidebar-filtering";
import { groupSidebarChatsBySection, sidebarFolderTree } from "../sidebar-folders";
import {
  SIDEBAR_NO_LIST_FILTER,
  type SidebarChatFacts,
  type SidebarListFilter,
  sidebarChatMatchesFilter,
  sidebarKnownFolders,
  sidebarListFilterIsSet,
} from "../sidebar-list-filter";
import { sidebarPinnedItemKey } from "../sidebar-pins";
import {
  type ResolvedPinnedItem,
  type SidebarChatItem,
  type SidebarProps,
  sortSidebarChatsByRecent,
} from "../sidebar-types";

type PinnedItemSource = SidebarProps["agents"][number] | NonNullable<SidebarProps["channels"]>[number];

export function createSidebarDataStore(deps: {
  normalizedQuery: () => string;
  props: SidebarProps;
  /** True while a sidebar drag is in flight. */
  dragActive: () => boolean;
}) {
  const { normalizedQuery, props } = deps;

  const directThreadByMember = createMemo(
    () => new Map(props.directThreads.map((thread) => [thread.otherMemberId, thread])),
  );
  const chatPinnedItems = createMemo(() =>
    props.pinnedItems.filter((item) => item.kind === "agent" || item.kind === "channel"),
  );
  const pinnedKeys = createMemo(() => new Set(chatPinnedItems().map(sidebarPinnedItemKey)));
  const agentById = createMemo(() => new Map(props.agents.map((agent) => [agent.id, agent])));
  const personById = createMemo(() => new Map(props.people.map((member) => [member.id, member])));
  const matchingChannels = createMemo(() =>
    (props.channels ?? []).filter((channel) => channelMatchesQuery(channel, normalizedQuery())),
  );
  const channelById = createMemo(() => new Map(matchingChannels().map((channel) => [channel.id, channel])));
  let pinnedItemCache = new Map<string, { source: PinnedItemSource; item: ResolvedPinnedItem }>();
  /** Both kinds of pinned chat, resolved against the chats the sidebar has: a pin that names none is
   * kept in storage and simply not drawn, because the chat can be absent for a passing reason.
   *
   * Keep a resolved wrapper while its source chat is the same store. Solid's `For` keys by object
   * identity, so rebuilding every wrapper for an unrelated profile update remounted all pinned
   * tiles and replayed the unread-badge entrance animation. */
  const resolvedPinnedItems = createMemo<ResolvedPinnedItem[]>(() => {
    const items: ResolvedPinnedItem[] = [];
    const nextCache = new Map<string, { source: PinnedItemSource; item: ResolvedPinnedItem }>();
    const resolve = (ref: ResolvedPinnedItem["ref"], source: PinnedItemSource, item: ResolvedPinnedItem) => {
      const key = sidebarPinnedItemKey(ref);
      const cached = pinnedItemCache.get(key);
      const resolved = cached?.source === source ? cached.item : item;
      nextCache.set(key, { source, item: resolved });
      return resolved;
    };
    for (const ref of chatPinnedItems()) {
      if (ref.kind === "agent") {
        const agent = agentById().get(ref.id);
        if (agent && agentMatchesQuery(agent, normalizedQuery())) {
          items.push(resolve(ref, agent, { ref, chat: { kind: "agent", id: agent.id, agent } }));
        }
      }
      if (ref.kind === "channel") {
        const channel = channelById().get(ref.id);
        if (channel) items.push(resolve(ref, channel, { ref, chat: { kind: "channel", id: channel.id, channel } }));
      }
    }
    pinnedItemCache = nextCache;
    return items;
  });
  const listedAgents = createMemo(() =>
    props.agents.filter(
      (agent) =>
        !pinnedKeys().has(sidebarPinnedItemKey({ kind: "agent", id: agent.id })) &&
        agentMatchesQuery(agent, normalizedQuery()),
    ),
  );
  /**
   * Agents that wait for the user leave their section for the "Needs you" group, the same way a
   * pinned agent leaves it for the pinned strip. The layout keeps their place, so an agent goes back
   * to it when the wait ends. A pinned agent stays in its tile, which shows the same badge.
   *
   * The set is keyed by a string so that a badge change that keeps the same agents waiting stops
   * here. Without it, each new reply would rebuild the chat items and remount every row.
   *
   * The set holds still during a drag. The drag engine measures the rows when the drag starts, so a
   * row that moved to the group after that would make the drop land at an old position, and the
   * dragged row itself would leave the DOM.
   */
  let heldWaitingKey = "";
  const waitingKey = createMemo(() => {
    const next = Object.keys(props.agentStates)
      .filter((agentId) => props.agentStates[agentId]?.kind === "waiting")
      .sort()
      .join("\n");
    if (!deps.dragActive()) heldWaitingKey = next;
    return heldWaitingKey;
  });
  const waitingIds = createMemo(() => new Set(waitingKey() ? waitingKey().split("\n") : []));
  const agentWaits = (agentId: string) => waitingIds().has(agentId);
  const waitingAgents = createMemo(() => sortByLayoutOrder(listedAgents().filter((agent) => agentWaits(agent.id))));
  const filteredAgents = createMemo(() => listedAgents().filter((agent) => !agentWaits(agent.id)));
  const filteredChannels = createMemo(() =>
    matchingChannels().filter(
      (channel) => !pinnedKeys().has(sidebarPinnedItemKey({ kind: "channel", id: channel.id })),
    ),
  );
  function sortByLayoutOrder<T extends { id: string }>(items: T[]): T[] {
    const orderIndex = new Map(props.layout.agentOrder.map((chatId, index) => [chatId, index]));
    const naturalIndex = new Map(items.map((item, index) => [item.id, index]));
    return items.sort(
      (left, right) =>
        (orderIndex.get(left.id) ?? props.layout.agentOrder.length + (naturalIndex.get(left.id) ?? 0)) -
        (orderIndex.get(right.id) ?? props.layout.agentOrder.length + (naturalIndex.get(right.id) ?? 0)),
    );
  }
  /**
   * Agents and channels as one ordered list, because the layout places them together: a channel is a
   * chat the user files and drags exactly like an agent. `agentOrder` is the persisted sequence and
   * keeps its released name; an id it does not carry yet falls in behind the ones it does, channels
   * first, which is where channels sat while they had a list of their own.
   */
  type ChatSource = AgentProfile | ChannelSummary;
  let chatItemCache = new Map<ChatSource, SidebarChatItem>();
  const listedChats = createMemo<SidebarChatItem[]>(() => {
    // Keep each wrapper while its chat is the same store, as `resolvedPinnedItems` does: an agent
    // that starts or stops waiting must not remount the rows of every other agent.
    const nextCache = new Map<ChatSource, SidebarChatItem>();
    const keep = (source: ChatSource, item: () => SidebarChatItem) => {
      const resolved = chatItemCache.get(source) ?? item();
      nextCache.set(source, resolved);
      return resolved;
    };
    const items = sortByLayoutOrder<SidebarChatItem>([
      ...filteredChannels().map((channel) => keep(channel, () => ({ kind: "channel", id: channel.id, channel }))),
      ...filteredAgents().map((agent) => keep(agent, () => ({ kind: "agent", id: agent.id, agent }))),
    ]);
    chatItemCache = nextCache;
    // The "recent activity" order shows each section by last activity. The saved `agentOrder` does not change.
    return props.chatOrder === "recent" ? sortSidebarChatsByRecent(items) : items;
  });
  const customSectionById = createMemo(() => new Map(props.layout.sections.map((section) => [section.id, section])));
  /** The folder that holds each folder that has one. */
  const folderParents = createMemo(() => sidebarFolderParents(props.layout));
  /** The folders that the filter menu lists. */
  const filterFolders = createMemo(() => sidebarFolderTree(props.layout, folderParents()));
  /**
   * The filter menu's choice. A folder that is gone drops out here, so a deleted folder cannot keep the
   * list empty.
   */
  const [chosenListFilter, setListFilter] = createSignal<SidebarListFilter>(SIDEBAR_NO_LIST_FILTER);
  const listFilter = createMemo<SidebarListFilter>(() => {
    const chosen = chosenListFilter();
    return { ...chosen, folders: sidebarKnownFolders(filterFolders(), chosen.folders) };
  });
  const listFiltered = createMemo(() => sidebarListFilterIsSet(listFilter()));
  function chatFacts(item: SidebarChatItem): SidebarChatFacts {
    const state = props.agentStates[item.id];
    return {
      kind: item.kind,
      folder: assignedSectionId(item.id),
      unread: item.kind === "channel" ? item.channel.unreadCount > 0 : state?.kind === "unread",
      working: state?.kind === "working" || (state?.kind === "routine" && state.phase === "running"),
    };
  }
  /** The chats in the folders, after the filter menu. Pinned chats and "Needs you" are not filtered. */
  const filteredChats = createMemo<SidebarChatItem[]>(() => {
    const filter = listFilter();
    if (!sidebarListFilterIsSet(filter)) return listedChats();
    return listedChats().filter((item) => sidebarChatMatchesFilter(chatFacts(item), filter));
  });
  /** How many chats a changed filter would show, for the counts in the menu. */
  function listFilterCount(patch: Partial<SidebarListFilter>): number {
    const filter = { ...listFilter(), ...patch };
    return listedChats().filter((item) => sidebarChatMatchesFilter(chatFacts(item), filter)).length;
  }
  const orderedPeople = createMemo(() => {
    const natural = [...props.people].sort((left, right) => {
      const leftThread = directThreadByMember().get(left.id);
      const rightThread = directThreadByMember().get(right.id);
      if (leftThread || rightThread) {
        return (rightThread?.updatedAt ?? "").localeCompare(leftThread?.updatedAt ?? "");
      }
      if (left.online !== right.online) return left.online ? -1 : 1;
      return teamMemberName(left).localeCompare(teamMemberName(right));
    });
    const orderIndex = new Map(props.peopleOrder.map((memberId, index) => [memberId, index]));
    const naturalIndex = new Map(natural.map((member, index) => [member.id, index]));
    return natural.sort(
      (left, right) =>
        (orderIndex.get(left.id) ?? props.peopleOrder.length + (naturalIndex.get(left.id) ?? 0)) -
        (orderIndex.get(right.id) ?? props.peopleOrder.length + (naturalIndex.get(right.id) ?? 0)),
    );
  });
  const filteredPeople = createMemo(() =>
    orderedPeople().filter((member) => {
      const thread = directThreadByMember().get(member.id);
      return personMatchesQuery(member, thread, normalizedQuery());
    }),
  );
  const collapsedSectionIds = createMemo(() => new Set(props.collapsedSectionIds));
  // A section has to be in `order` as well as in `sections` for its group to be drawn, because
  // `visibleSectionIds` walks `order`. An agent grouped under a section that `order` leaves out is on
  // no screen while its chat and every message in it are intact, which reads as history that
  // disappeared -- so it goes to the unassigned section, where the user can still open it and move it.
  // `isCompleteSectionOrder` rejects such a layout at the IPC boundary; this keeps the agent visible if
  // one ever reaches the sidebar another way.
  // `filteredChats` is sorted, and grouping keeps that order, so "Recent activity" applies in each folder.
  const filteredChatsBySection = createMemo(() => groupSidebarChatsBySection(filteredChats(), props.layout));
  /** True when a folder that holds this one is collapsed. A search shows every folder. */
  function sectionHiddenByParent(sectionId: string): boolean {
    return (
      !normalizedQuery() &&
      sidebarFolderAncestors(folderParents(), sectionId).some((ancestorId) => collapsedSectionIds().has(ancestorId))
    );
  }
  const visibleSectionIds = createMemo(() =>
    props.layout.order.filter((sectionId) => {
      // While a filter is set, the people show only under "All chats" with no other part set.
      if (sectionId === SIDEBAR_PEOPLE_SECTION_ID)
        return props.showPeople !== false && !listFiltered() && filteredPeople().length > 0;
      if (customSectionById().has(sectionId)) {
        if (sectionHiddenByParent(sectionId)) return false;
        return (!normalizedQuery() && !listFiltered()) || (filteredChatsBySection().get(sectionId)?.length ?? 0) > 0;
      }
      if (sectionId !== SIDEBAR_UNASSIGNED_SECTION_ID) return false;
      return (filteredChatsBySection().get(sectionId)?.length ?? 0) > 0;
    }),
  );
  const visibleSectionSet = createMemo(() => new Set(visibleSectionIds()));

  function sectionIsVisible(sectionId: string): boolean {
    return visibleSectionSet().has(sectionId);
  }

  function sectionIsCollapsed(sectionId: string): boolean {
    return !normalizedQuery() && collapsedSectionIds().has(sectionId);
  }

  /** The folder that holds `sectionId`, or null at the top of the list. */
  function sectionParent(sectionId: string): string | null {
    return folderParents().get(sectionId) ?? null;
  }

  /** The visible sections in the same folder as `sectionId`, in order, `sectionId` included. */
  function sectionSiblings(sectionId: string): string[] {
    const parentId = sectionParent(sectionId);
    return visibleSectionIds().filter((candidate) => sectionParent(candidate) === parentId);
  }

  /** 0 for a folder at the top of the list. */
  function sectionDepth(sectionId: string): number {
    return sidebarFolderAncestors(folderParents(), sectionId).length;
  }

  /** Whether a new folder can go inside `sectionId`: it is a folder, and not on the last level. */
  function sectionCanHoldFolder(sectionId: string): boolean {
    return customSectionById().has(sectionId) && sectionDepth(sectionId) + 1 < SIDEBAR_FOLDER_LEVELS;
  }

  /**
   * Whether a section can go into `parentId` (null: the top of the list): not into itself or a folder in
   * it, and three levels at most with the folders it holds. People and Unassigned stay at the top.
   */
  function sectionCanNest(sectionId: string, parentId: string | null): boolean {
    if (!customSectionById().has(sectionId)) return parentId === null;
    if (parentId === null) return true;
    if (!customSectionById().has(parentId) || parentId === sectionId) return false;
    if (sidebarFolderAncestors(folderParents(), parentId).includes(sectionId)) return false;
    return sectionDepth(parentId) + 1 + sidebarFolderHeight(folderParents(), sectionId) < SIDEBAR_FOLDER_LEVELS;
  }

  function sectionPosition(sectionId: string): number {
    return visibleSectionIds().indexOf(sectionId);
  }

  function sectionAcceptsChat(sectionId: string): boolean {
    return sectionId === SIDEBAR_UNASSIGNED_SECTION_ID || customSectionById().has(sectionId);
  }

  /**
   * The section a dragged chat counts as leaving. Deliberately not the menu's `currentSectionId`,
   * which answers `null` for an unassigned chat because that is where its tick goes.
   */
  function assignedSectionId(chatId: string): string {
    const assigned = props.layout.agentAssignments[chatId];
    return assigned && customSectionById().has(assigned) ? assigned : SIDEBAR_UNASSIGNED_SECTION_ID;
  }

  /** The name for an announcement, whichever kind of chat the id belongs to. */
  function chatName(chatId: string): string {
    return (
      agentById().get(chatId)?.name ??
      channelById().get(chatId)?.name ??
      currentText().t("sidebar.announce.chatFallback")
    );
  }

  /** Which kind of chat an id names, or null when the sidebar shows no chat under it. */
  function chatKind(chatId: string): "agent" | "channel" | null {
    if (agentById().has(chatId)) return "agent";
    return channelById().has(chatId) ? "channel" : null;
  }

  function sectionLabel(sectionId: string): string {
    const { t } = currentText();
    if (sectionId === SIDEBAR_PEOPLE_SECTION_ID) return t("sidebar.section.people");
    if (sectionId === SIDEBAR_UNASSIGNED_SECTION_ID) return t("sidebar.section.unassigned");
    // A folder in a folder shows its path, "Parent / Name".
    const names = sidebarFolderAncestors(folderParents(), sectionId).flatMap((ancestorId) => {
      const name = customSectionById().get(ancestorId)?.name;
      return name === undefined ? [] : [name];
    });
    return [...names, customSectionById().get(sectionId)?.name ?? t("sidebar.section.fallback")].join(" / ");
  }

  function visiblePinnedKeys(): string[] {
    return resolvedPinnedItems().map((item) => sidebarPinnedItemKey(item.ref));
  }

  return {
    assignedSectionId,
    agentById,
    channelById,
    chatKind,
    chatName,
    chatPinnedItems,
    customSectionById,
    directThreadByMember,
    filterFolders,
    filteredAgents,
    filteredChannels,
    filteredChats,
    filteredChatsBySection,
    filteredPeople,
    listFilter,
    listFilterCount,
    listFiltered,
    orderedPeople,
    personById,
    resolvedPinnedItems,
    sectionAcceptsChat,
    sectionCanHoldFolder,
    sectionCanNest,
    sectionIsCollapsed,
    sectionIsVisible,
    sectionLabel,
    sectionParent,
    sectionPosition,
    sectionSiblings,
    setListFilter,
    visiblePinnedKeys,
    visibleSectionIds,
    waitingAgents,
  };
}
