/**
 * One section - the unassigned one included. A custom section is a folder. It stays visible while
 * empty so it can be dropped into, but not during a search or a filter: then an empty folder is noise,
 * not a target. A folder hides while a folder that holds it is collapsed.
 *
 * The unassigned section keeps its heading only once a custom section exists. Before that it is the
 * whole list, and "Unassigned" names it against nothing.
 */

import { SIDEBAR_UNASSIGNED_SECTION_ID } from "@openbot/contracts/ipc";
import { For, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { SidebarAgentRow } from "./SidebarAgentRow";
import { SidebarChannelRow } from "./SidebarChannelRow";
import { SidebarSectionHeader } from "./SidebarSectionHeader";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarAgentSection(sectionProps: { sectionId: string }) {
  const {
    customSectionById,
    dragOffset,
    filteredChatsBySection,
    props,
    sectionDragClasses,
    sectionIsCollapsed,
    sectionIsVisible,
    sectionLabel,
  } = useSidebarScope();
  const { t } = useText();
  const sectionId = () => sectionProps.sectionId;
  const chats = () => filteredChatsBySection().get(sectionId()) ?? [];
  const custom = () => customSectionById().get(sectionId());
  // A folder in a folder shows its path, "Parent / Name", so the list stays flat for dragging.
  const name = () =>
    sectionId() === SIDEBAR_UNASSIGNED_SECTION_ID
      ? t("sidebar.section.unassigned")
      : custom()
        ? sectionLabel(sectionId())
        : "";
  const headed = () => Boolean(custom()) || props.layout.sections.length > 0;
  const collapsed = () => headed() && sectionIsCollapsed(sectionId());
  return (
    <Show when={name() && sectionIsVisible(sectionId())}>
      <section
        class={["sidebar-chat-group sidebar-section", sectionDragClasses(sectionId())]}
        style={`--sidebar-drag-y: ${dragOffset(sectionId()).y}px;`}
        aria-label={name()}
        data-section-id={sectionId()}
      >
        <Show when={headed()}>
          <SidebarSectionHeader sectionId={sectionId()} name={name()} />
        </Show>
        <div
          class="sidebar-section-collapse"
          data-collapsed={collapsed() ? "" : undefined}
          aria-hidden={collapsed() ? "true" : undefined}
          inert={collapsed() ? true : undefined}
        >
          <div id={`sidebar-section-body-${sectionId()}`} class="sidebar-section-body">
            <For each={chats()}>
              {(chat) => (
                <Switch>
                  <Match when={chat.kind === "agent" ? chat.agent : undefined}>
                    {(agent) => <SidebarAgentRow agent={agent()} threads />}
                  </Match>
                  <Match when={chat.kind === "channel" ? chat.channel : undefined}>
                    {(channel) => <SidebarChannelRow channel={channel()} />}
                  </Match>
                </Switch>
              )}
            </For>
          </div>
        </div>
      </section>
    </Show>
  );
}
