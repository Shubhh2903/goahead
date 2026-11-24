import {
  type SidebarLayoutAction,
  type SidebarLayoutSnapshot,
  sidebarFolderParents,
  sidebarFolderTreeOrder,
} from "@openbot/contracts/ipc";

/** The preview keeps the folders in tree order, as the layout store does. */
function withFolderTree(layout: SidebarLayoutSnapshot): SidebarLayoutSnapshot {
  const parents = sidebarFolderParents(layout);
  return {
    ...layout,
    sections: layout.sections.map(({ id, name }) => {
      const parentId = parents.get(id);
      return parentId === undefined ? { id, name } : { id, name, parentId };
    }),
    order: sidebarFolderTreeOrder(layout.order, parents),
  };
}

export function applySidebarLayoutAction(
  layout: SidebarLayoutSnapshot,
  action: SidebarLayoutAction,
): SidebarLayoutSnapshot {
  return withFolderTree(applyFlatSidebarLayoutAction(layout, action));
}

function applyFlatSidebarLayoutAction(
  layout: SidebarLayoutSnapshot,
  action: SidebarLayoutAction,
): SidebarLayoutSnapshot {
  const revision = layout.revision + 1;
  if (action.type === "create") {
    const id = crypto.randomUUID();
    return {
      ...layout,
      revision,
      sections: [
        ...layout.sections,
        action.parentId
          ? { id, name: action.name.trim(), parentId: action.parentId }
          : { id, name: action.name.trim() },
      ],
      order: [...layout.order, id],
      agentAssignments: action.agentId
        ? { ...layout.agentAssignments, [action.agentId]: id }
        : { ...layout.agentAssignments },
      agentOrder: [...layout.agentOrder],
    };
  }
  if (action.type === "rename") {
    return {
      ...layout,
      revision,
      sections: layout.sections.map((section) =>
        section.id === action.sectionId ? { ...section, name: action.name.trim() } : section,
      ),
    };
  }
  if (action.type === "delete") {
    // The chats and folders of the folder move up one level.
    const parentId = sidebarFolderParents(layout).get(action.sectionId);
    return {
      ...layout,
      revision,
      sections: layout.sections
        .filter((section) => section.id !== action.sectionId)
        .map((section) =>
          section.parentId !== action.sectionId
            ? section
            : parentId === undefined
              ? { id: section.id, name: section.name }
              : { ...section, parentId },
        ),
      order: layout.order.filter((sectionId) => sectionId !== action.sectionId),
      agentAssignments: Object.fromEntries(
        Object.entries(layout.agentAssignments).flatMap(([chatId, sectionId]) => {
          if (sectionId !== action.sectionId) return [[chatId, sectionId]];
          return parentId === undefined ? [] : [[chatId, parentId]];
        }),
      ),
      agentOrder: [...layout.agentOrder],
    };
  }
  if (action.type === "nest") {
    const order = layout.order.filter((sectionId) => sectionId !== action.sectionId);
    const index = action.beforeSectionId === null ? order.length : order.indexOf(action.beforeSectionId);
    order.splice(index < 0 ? order.length : index, 0, action.sectionId);
    return {
      ...layout,
      revision,
      order,
      sections: layout.sections.map((section) =>
        section.id !== action.sectionId
          ? section
          : action.parentId === null
            ? { id: section.id, name: section.name }
            : { ...section, parentId: action.parentId },
      ),
    };
  }
  if (action.type === "move") {
    const order = [...layout.order];
    const index = order.indexOf(action.sectionId);
    const target = index + (action.direction === "up" ? -1 : 1) * (action.steps ?? 1);
    if (index >= 0 && target >= 0 && target < order.length) {
      const [movedSectionId] = order.splice(index, 1);
      if (movedSectionId) order.splice(target, 0, movedSectionId);
    }
    return { ...layout, revision, order };
  }
  if (action.type === "move-agent") {
    const agentOrder = layout.agentOrder.filter((agentId) => agentId !== action.agentId);
    const insertionIndex = action.beforeAgentId === null ? agentOrder.length : agentOrder.indexOf(action.beforeAgentId);
    agentOrder.splice(insertionIndex < 0 ? agentOrder.length : insertionIndex, 0, action.agentId);
    const agentAssignments = { ...layout.agentAssignments };
    if (action.sectionId === null) delete agentAssignments[action.agentId];
    else agentAssignments[action.agentId] = action.sectionId;
    return { ...layout, revision, agentAssignments, agentOrder };
  }
  const agentAssignments = { ...layout.agentAssignments };
  if (action.sectionId === null) delete agentAssignments[action.agentId];
  else agentAssignments[action.agentId] = action.sectionId;
  return { ...layout, revision, agentAssignments };
}
