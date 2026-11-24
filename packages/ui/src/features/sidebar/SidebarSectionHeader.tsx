/**
 * A section's header row: the collapse toggle, which doubles as the drag handle, and the section
 * context menu. The menu is inline rather than a component of its own because this is its only
 * caller - both regions that show a section header reach it through here.
 */

import {
  ArrowDown,
  ArrowUp,
  buttonVariants,
  Check,
  ChevronDown,
  ChevronRight,
  ContextMenu,
  Folder,
  FolderInput,
  FolderPlus,
  Pencil,
  Trash2,
} from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import { SidebarSectionEditor } from "./SidebarSectionEditor";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarSectionHeader(headerProps: { sectionId: string; name: string }) {
  const {
    customSectionById,
    foldersSupported,
    layoutDraggable,
    layoutMutable,
    moveSection,
    nestSection,
    openDelete,
    pending,
    props,
    sectionCanHoldFolder,
    sectionCanNest,
    sectionIsCollapsed,
    sectionLabel,
    sectionParent,
    sectionSiblings,
    sidebarClickIsSuppressed,
    startCreateSection,
    startRenameSection,
    startSectionDragging,
    stopSidebarDragging,
  } = useSidebarScope();
  const { t } = useText();
  const editing = () => {
    const target = pending.sectionEditor?.target;
    return target?.kind === "rename" && target.sectionId === headerProps.sectionId;
  };
  const collapsed = () => sectionIsCollapsed(headerProps.sectionId);
  const custom = () => customSectionById().has(headerProps.sectionId);
  // "Move up" and "Move down" stay among the folders of the same parent.
  const siblings = () => sectionSiblings(headerProps.sectionId);
  const position = () => siblings().indexOf(headerProps.sectionId);
  const parentId = () => sectionParent(headerProps.sectionId);
  /** The folders this one can move into, and the top level when it is not there already. */
  const nestTargets = () =>
    props.layout.order.filter(
      (sectionId) =>
        customSectionById().has(sectionId) &&
        sectionId !== parentId() &&
        sectionCanNest(headerProps.sectionId, sectionId),
    );
  return (
    <Show when={!editing()} fallback={<SidebarSectionEditor />}>
      <header>
        <ContextMenu.Root modal={false}>
          <ContextMenu.Trigger
            as="button"
            type="button"
            class={buttonVariants({
              variant: "ghost",
              class: "sidebar-section-toggle sidebar-section-drag-handle",
            })}
            draggable={!layoutDraggable() || props.compact ? "false" : "true"}
            title={!layoutMutable() ? t("sidebar.section.layoutUnsupported") : undefined}
            aria-expanded={collapsed() ? "false" : "true"}
            aria-controls={`sidebar-section-body-${headerProps.sectionId}`}
            data-cuelume-open={collapsed() ? "" : undefined}
            data-cuelume-close={collapsed() ? undefined : ""}
            data-cuelume-emphasis="subtle"
            onClick={(event: MouseEvent) => {
              if (!sidebarClickIsSuppressed(event)) props.onToggleSection(headerProps.sectionId);
            }}
            onDragStart={(event: DragEvent & { currentTarget: HTMLElement }) =>
              startSectionDragging(event, headerProps.sectionId)
            }
            onDragEnd={stopSidebarDragging}
          >
            <span class="sidebar-section-name" title={headerProps.name}>
              {headerProps.name}
            </span>
            <ChevronDown
              class={`sidebar-section-chevron size-4${collapsed() ? " sidebar-section-chevron-collapsed" : ""}`}
              aria-hidden="true"
            />
          </ContextMenu.Trigger>
          <Show when={layoutMutable()}>
            <ContextMenu.Portal>
              <ContextMenu.Content class="agent-context-menu" aria-label={t("sidebar.section.actions")}>
                <Show when={custom()}>
                  <ContextMenu.Item onSelect={() => startRenameSection(headerProps.sectionId)}>
                    <Pencil class="agent-context-icon size-4" aria-hidden="true" />
                    <span>{t("common.rename")}</span>
                  </ContextMenu.Item>
                </Show>
                <Show when={foldersSupported() && sectionCanHoldFolder(headerProps.sectionId)}>
                  <ContextMenu.Item onSelect={() => startCreateSection(undefined, headerProps.sectionId)}>
                    <FolderPlus class="agent-context-icon size-4" aria-hidden="true" />
                    <span>{t("sidebar.folder.newInside")}</span>
                  </ContextMenu.Item>
                </Show>
                <Show when={custom() && foldersSupported()}>
                  <ContextMenu.Sub>
                    <ContextMenu.SubTrigger>
                      <FolderInput class="agent-context-icon size-4" aria-hidden="true" />
                      <span>{t("sidebar.moveTo")}</span>
                      <ChevronRight class="agent-context-submenu-chevron size-4" aria-hidden="true" />
                    </ContextMenu.SubTrigger>
                    <ContextMenu.Portal>
                      <ContextMenu.SubContent
                        class="ui-action-menu agent-context-menu agent-context-submenu"
                        aria-label={t("sidebar.moveTo")}
                      >
                        <ContextMenu.Item
                          disabled={parentId() === null}
                          onSelect={() => nestSection(headerProps.sectionId, null)}
                        >
                          <Show
                            when={parentId() === null}
                            fallback={<Folder class="agent-context-icon size-4" aria-hidden="true" />}
                          >
                            <Check class="agent-context-icon size-4" aria-hidden="true" />
                          </Show>
                          <span>{t("sidebar.folder.topLevel")}</span>
                        </ContextMenu.Item>
                        <For each={nestTargets()}>
                          {(sectionId) => (
                            <ContextMenu.Item onSelect={() => nestSection(headerProps.sectionId, sectionId)}>
                              <Folder class="agent-context-icon size-4" aria-hidden="true" />
                              <span>{sectionLabel(sectionId)}</span>
                            </ContextMenu.Item>
                          )}
                        </For>
                      </ContextMenu.SubContent>
                    </ContextMenu.Portal>
                  </ContextMenu.Sub>
                </Show>
                <ContextMenu.Item disabled={position() <= 0} onSelect={() => moveSection(headerProps.sectionId, "up")}>
                  <ArrowUp class="agent-context-icon size-4" aria-hidden="true" />
                  <span>{t("sidebar.section.moveUp")}</span>
                </ContextMenu.Item>
                <ContextMenu.Item
                  disabled={position() < 0 || position() >= siblings().length - 1}
                  onSelect={() => moveSection(headerProps.sectionId, "down")}
                >
                  <ArrowDown class="agent-context-icon size-4" aria-hidden="true" />
                  <span>{t("sidebar.section.moveDown")}</span>
                </ContextMenu.Item>
                <Show when={custom()}>
                  <ContextMenu.Separator />
                  <ContextMenu.Item
                    class="ui-action-menu-danger agent-context-danger"
                    onSelect={() => openDelete("section", headerProps.sectionId)}
                  >
                    <Trash2 class="agent-context-icon agent-context-danger-icon size-4" aria-hidden="true" />
                    <span>{t("common.delete")}</span>
                  </ContextMenu.Item>
                </Show>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </Show>
        </ContextMenu.Root>
      </header>
    </Show>
  );
}
