/**
 * The filter button beside New, and its menu: the kind of chat, its state and the folders. A dot on the
 * button shows that a filter is set. The counts come from the data store and are read only while the
 * menu is open. The search field filters by text; this menu filters by what a chat is.
 */

import { Check, ChevronRight, DropdownMenu, Folder, ListFilter, Minus, X } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import {
  SIDEBAR_LIST_SHOW_LABEL,
  SIDEBAR_LIST_SHOW_OPTIONS,
  SIDEBAR_NO_LIST_FILTER,
  type SidebarFolderNode,
  type SidebarListFilter,
  sidebarFolderMark,
  sidebarFolderTreeIds,
  sidebarListFilterParts,
  sidebarToggleFolder,
} from "./sidebar-list-filter";
import { useSidebarScope } from "./sidebar-scope";

function MenuMark(props: { on: boolean; mixed?: boolean }) {
  return (
    <span class="ui-menu-check" data-checked={props.on || props.mixed ? "" : undefined} aria-hidden="true">
      <Show when={props.mixed} fallback={<Show when={props.on}>{<Check />}</Show>}>
        <Minus />
      </Show>
    </span>
  );
}

/** A checkbox for a folder and the folders in it. It stays open, so more folders can be picked. */
function FolderCheck(props: { node: SidebarFolderNode }) {
  const { filterFolders, listFilter, listFilterCount, setListFilter } = useSidebarScope();
  const { t } = useText();
  const mark = () => sidebarFolderMark(props.node, listFilter().folders);
  return (
    <DropdownMenu.CheckboxItem
      checked={mark() === "on"}
      closeOnSelect={false}
      onChange={() =>
        setListFilter({
          ...listFilter(),
          folders: sidebarToggleFolder(props.node, filterFolders(), listFilter().folders),
        })
      }
    >
      <MenuMark on={mark() === "on"} mixed={mark() === "mixed"} />
      <span>{props.node.name ?? t("sidebar.section.unassigned")}</span>
      <span class="ui-menu-trailing">{listFilterCount({ folders: sidebarFolderTreeIds(props.node) })}</span>
    </DropdownMenu.CheckboxItem>
  );
}

/**
 * A folder with folders in it opens its own menu. The menu starts with the folder itself, which selects
 * it with all the folders in it, then lists each folder in it.
 */
function FolderSub(props: { node: SidebarFolderNode }) {
  const { listFilter, listFilterCount } = useSidebarScope();
  const mark = () => sidebarFolderMark(props.node, listFilter().folders);
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger>
        <MenuMark on={mark() === "on"} mixed={mark() === "mixed"} />
        <span>{props.node.name}</span>
        <span class="ui-menu-trailing">{listFilterCount({ folders: sidebarFolderTreeIds(props.node) })}</span>
        <ChevronRight class="agent-context-submenu-chevron size-4" aria-hidden="true" />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent class="ui-action-menu agent-context-menu" aria-label={props.node.name ?? undefined}>
          <FolderCheck node={props.node} />
          <DropdownMenu.Separator />
          <FolderEntries nodes={props.node.children} />
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

function FolderEntries(props: { nodes: readonly SidebarFolderNode[] }) {
  return (
    <For each={props.nodes}>
      {(node) => (
        <Show when={node.children.length > 0} fallback={<FolderCheck node={node} />}>
          <FolderSub node={node} />
        </Show>
      )}
    </For>
  );
}

export function SidebarFilterMenu() {
  const { filterFolders, listFilter, listFilterCount, listFiltered, props, setListFilter } = useSidebarScope();
  const { t } = useText();
  const set = (patch: Partial<SidebarListFilter>) => setListFilter({ ...listFilter(), ...patch });
  const parts = () => sidebarListFilterParts(listFilter());
  return (
    <DropdownMenu.Root placement="bottom-end" gutter={4}>
      <DropdownMenu.Trigger
        class={["sidebar-icon-button sidebar-filter-button no-drag", { "sidebar-filter-button-active": parts() > 0 }]}
        aria-label={parts() > 0 ? t("sidebar.filter.buttonActive", { count: parts() }) : t("sidebar.filter.button")}
        title={t("sidebar.filter.button")}
        aria-hidden={props.compact ? "true" : undefined}
        tabindex={props.compact ? -1 : 0}
      >
        <ListFilter aria-hidden="true" />
        <Show when={parts() > 0}>
          <span class="sidebar-filter-dot" aria-hidden="true" />
        </Show>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="sidebar-filter-menu-content" aria-label={t("sidebar.filter.button")}>
          <span class="ui-menu-label" aria-hidden="true">
            {t("sidebar.filter.show")}
          </span>
          <DropdownMenu.RadioGroup
            aria-label={t("sidebar.filter.show")}
            value={listFilter().show}
            onChange={(value: string) => {
              const show = SIDEBAR_LIST_SHOW_OPTIONS.find((candidate) => candidate === value);
              if (show) set({ show });
            }}
          >
            <For each={SIDEBAR_LIST_SHOW_OPTIONS}>
              {(option) => (
                <DropdownMenu.RadioItem value={option} closeOnSelect={false}>
                  <MenuMark on={listFilter().show === option} />
                  <span>{t(SIDEBAR_LIST_SHOW_LABEL[option])}</span>
                  <span class="ui-menu-trailing">{listFilterCount({ show: option })}</span>
                </DropdownMenu.RadioItem>
              )}
            </For>
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator />
          <span class="ui-menu-label" aria-hidden="true">
            {t("sidebar.filter.state")}
          </span>
          <DropdownMenu.CheckboxItem
            checked={listFilter().unread}
            closeOnSelect={false}
            onChange={(on: boolean) => set({ unread: on })}
          >
            <MenuMark on={listFilter().unread} />
            <span>{t("sidebar.filter.unread")}</span>
            <span class="ui-menu-trailing">{listFilterCount({ unread: true, working: false })}</span>
          </DropdownMenu.CheckboxItem>
          <DropdownMenu.CheckboxItem
            checked={listFilter().working}
            closeOnSelect={false}
            onChange={(on: boolean) => set({ working: on })}
          >
            <MenuMark on={listFilter().working} />
            <span>{t("sidebar.filter.working")}</span>
            <span class="ui-menu-trailing">{listFilterCount({ unread: false, working: true })}</span>
          </DropdownMenu.CheckboxItem>
          <Show when={props.layout.sections.length > 0}>
            <DropdownMenu.Separator />
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger>
                <Folder class="agent-context-icon size-4" aria-hidden="true" />
                <span>{t("sidebar.filter.folders")}</span>
                <ChevronRight class="agent-context-submenu-chevron size-4" aria-hidden="true" />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  class="ui-action-menu agent-context-menu"
                  aria-label={t("sidebar.filter.folders")}
                >
                  <DropdownMenu.CheckboxItem
                    checked={listFilter().folders.length === 0}
                    closeOnSelect={false}
                    onChange={() => set({ folders: [] })}
                  >
                    <MenuMark on={listFilter().folders.length === 0} />
                    <span>{t("sidebar.filter.allFolders")}</span>
                    <span class="ui-menu-trailing">{listFilterCount({ folders: [] })}</span>
                  </DropdownMenu.CheckboxItem>
                  <DropdownMenu.Separator />
                  <FolderEntries nodes={filterFolders()} />
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          </Show>
          <Show when={listFiltered()}>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onSelect={() => setListFilter(SIDEBAR_NO_LIST_FILTER)}>
              <X class="agent-context-icon size-4" aria-hidden="true" />
              <span>{t("sidebar.filter.clear")}</span>
            </DropdownMenu.Item>
          </Show>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
