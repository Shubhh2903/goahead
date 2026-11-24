/**
 * Everything `Sidebar` is, minus the markup. The component builds this once and reads it, and the
 * regions read it through the scope context.
 *
 * The body here is composition: each store under `stores/` owns one concern and is built in
 * dependency order, because a store can only be handed what already exists. The drag&drop pipeline
 * is the one part that needs a closure of its own, and `createSidebarDragEngine` is it.
 */

import { createContext, createEffect, onCleanup, useContext } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { createSidebarDragEngine } from "./createSidebarDragEngine";
import { SIDEBAR_NO_LIST_FILTER } from "./sidebar-list-filter";
import { type SidebarProps, sidebarChatOrderSortsSections } from "./sidebar-types";
import { createSidebarAnnouncementStore } from "./stores/announcement-store";
import { createSidebarDataStore } from "./stores/data-store";
import { createSidebarDragStateStore } from "./stores/drag-state-store";
import { createSidebarLayoutActions } from "./stores/layout-actions";
import { createSidebarPendingStore } from "./stores/pending-store";
import { createSidebarSearchStore } from "./stores/search-store";

export function createSidebarScope(props: SidebarProps) {
  const layoutMutable = () => props.layoutMutable !== false;
  /** Folders in folders: only a host that keeps them, and only while the layout can change. */
  const foldersSupported = () => props.foldersSupported === true && layoutMutable();
  const scrollFades = createScrollFades();

  const { announce, announceError, reorderAnnouncement } = createSidebarAnnouncementStore();
  const { expandToSearch, normalizedQuery, query, setQuery, setSearchInputElement } = createSidebarSearchStore({
    props,
  });
  // The drag state is built from the data store, so the data store reads it through this reference,
  // which is set once the drag state exists.
  let dragActive = () => false;
  const {
    assignedSectionId,
    chatKind,
    chatName,
    chatPinnedItems,
    customSectionById,
    directThreadByMember,
    filterFolders,
    filteredAgents,
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
  } = createSidebarDataStore({ normalizedQuery, props, dragActive: () => dragActive() });
  /**
   * Nothing drags while a filter is set: a drop places a row among the rows that show, and the rows that
   * the filter hides would lose their place. A chat drags only in the manual order, because "Recent
   * activity" sorts each section itself.
   */
  const layoutDraggable = () => layoutMutable() && !listFiltered();
  const chatsDraggable = () => layoutDraggable() && !sidebarChatOrderSortsSections(props.chatOrder);
  const {
    cancelSectionEditor,
    closeDelete,
    confirmClearHistory,
    confirmDelete,
    confirmSectionDelete,
    deleteError,
    deleteTarget,
    channelDeleteTarget,
    deleting,
    historyClearTarget,
    openDelete,
    pending,
    releaseSectionNameInput,
    saveSectionEditor,
    sectionDeleteTarget,
    setSectionNameInput,
    startCreateSection: startCreateSectionEditor,
    startRenameSection,
    updateSectionEditorName,
  } = createSidebarPendingStore({ customSectionById, props });
  /** A new folder has no chats, so a filter would hide it and its name editor. It clears the filter first. */
  const startCreateSection = (agentId?: string, parentId?: string) => {
    setListFilter(SIDEBAR_NO_LIST_FILTER);
    startCreateSectionEditor(agentId, parentId);
  };
  let agentList: HTMLElement | undefined;

  const dragState = createSidebarDragStateStore({ chatKind, sectionAcceptsChat });
  dragActive = () => dragState.draggingKind() !== undefined;
  const { assignChatSection, commitSidebarDrop, movePersonByKeyboard, movePinnedItem, moveSection, nestSection } =
    createSidebarLayoutActions({
      announce,
      announceError,
      assignedSectionId,
      canPinDraggedSidebarItem: dragState.canPinDraggedSidebarItem,
      chatName,
      chatPinnedItems,
      draggedSidebarItem: dragState.draggedSidebarItem,
      filteredChatsBySection,
      filteredPeople,
      foldersSupported,
      layoutMutable,
      orderedPeople,
      personById,
      props,
      sectionLabel,
      sectionParent,
      sectionSiblings,
      visiblePinnedKeys,
      visibleSectionIds,
    });
  const {
    dropSidebarNativeDrag,
    endChatDragging,
    handleListDragLeave,
    sidebarClickIsSuppressed,
    startChatDragging,
    startNativeItemDragging,
    startPersonDragging,
    startSectionDragging,
    stopSidebarDragging,
    updateSidebarNativeDrag,
  } = createSidebarDragEngine({
    assignedSectionId,
    canPinDraggedItem: dragState.canPinDraggedSidebarItem,
    chatKind,
    chatPinnedItems,
    commitSidebarDrop,
    dragState,
    filteredChatsBySection,
    filteredPeople,
    getAgentList: () => agentList,
    props,
    scrollFades,
    sectionAcceptsChat,
    visiblePinnedKeys,
    visibleSectionIds,
  });

  onCleanup(() => {
    stopSidebarDragging();
    scrollFades.stop();
  });

  createEffect(
    () => [resolvedPinnedItems(), waitingAgents(), filteredChats(), filteredPeople()],
    () => {
      scrollFades.remeasure();
    },
  );

  /** The two statements the list's `ref` used to run inline, in the same order. */
  const setAgentListElement = (element: HTMLElement) => {
    agentList = element;
    scrollFades.bind(element);
  };

  /**
   * The scope's public surface, and the whole of what a region component may reach for. The drag
   * store's writers are deliberately absent: only the engine may move a drag along.
   */
  return {
    assignChatSection,
    cancelSectionEditor,
    closeDelete,
    confirmClearHistory,
    confirmDelete,
    confirmSectionDelete,
    customSectionById,
    deleteError,
    deleteTarget,
    channelDeleteTarget,
    deleting,
    chatPinnedItems,
    directThreadByMember,
    dragOffset: dragState.dragOffset,
    dragOverPinnedKey: dragState.dragOverPinnedKey,
    draggedChatId: dragState.draggedChatId,
    draggedPinnedKey: dragState.draggedPinnedKey,
    draggingKind: dragState.draggingKind,
    dropSidebarNativeDrag,
    emptyPinnedDropVisible: dragState.emptyPinnedDropVisible,
    endChatDragging,
    expandToSearch,
    filterFolders,
    filteredAgents,
    filteredChats,
    filteredChatsBySection,
    filteredPeople,
    handleListDragLeave,
    historyClearTarget,
    foldersSupported,
    layoutDraggable,
    layoutMutable,
    listFilter,
    listFilterCount,
    listFiltered,
    chatsDraggable,
    movePersonByKeyboard,
    movePinnedItem,
    moveSection,
    nestSection,
    normalizedQuery,
    openDelete,
    pending,
    pinnedDropActive: dragState.pinnedDropActive,
    props,
    query,
    releaseSectionNameInput,
    reorderAnnouncement,
    resolvedPinnedItems,
    saveSectionEditor,
    scrollFades,
    sectionDeleteTarget,
    sectionCanHoldFolder,
    sectionCanNest,
    sectionDragClasses: dragState.sectionDragClasses,
    sectionIsCollapsed,
    sectionIsVisible,
    sectionLabel,
    sectionParent,
    sectionPosition,
    sectionSiblings,
    setAgentListElement,
    setListFilter,
    setQuery,
    setSearchInputElement,
    setSectionNameInput,
    sidebarClickIsSuppressed,
    startChatDragging,
    startCreateSection,
    startNativeItemDragging,
    startPersonDragging,
    startRenameSection,
    startSectionDragging,
    stopSidebarDragging,
    updateSectionEditorName,
    updateSidebarNativeDrag,
    visibleSectionIds,
    waitingAgents,
  };
}

export type SidebarScope = ReturnType<typeof createSidebarScope>;

export const SidebarScopeContext = createContext<SidebarScope>();

export function useSidebarScope(): SidebarScope {
  const scope = useContext(SidebarScopeContext);
  if (!scope) throw new Error("Sidebar scope is unavailable outside Sidebar.");
  return scope;
}
