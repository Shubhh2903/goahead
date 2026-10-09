/**
 * The sidebar's agent, channel and section confirmations, and the Slack history clear, share one
 * pending state.
 */

import { ConfirmDialog } from "@openbot/ui";
import { Show } from "solid-js";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { ChannelAvatar } from "../channels/ChannelAvatar";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarDialogs() {
  const {
    closeDelete,
    confirmClearHistory,
    confirmDelete,
    confirmSectionDelete,
    deleteError,
    deleteTarget,
    channelDeleteTarget,
    deleting,
    historyClearTarget,
    props,
    sectionDeleteTarget,
  } = useSidebarScope();
  const { t } = useText();
  const shared = {
    get confirmLabel() {
      return t("common.delete");
    },
    get pendingLabel() {
      return t("sidebar.delete.pending");
    },
    onCancel: closeDelete,
  };
  // Each dialog unmounts with its target, so its text never shows an empty name while it closes.
  return (
    <>
      <Show when={deleteTarget()}>
        {(agent) => (
          <ConfirmDialog
            {...shared}
            open
            pending={deleting()}
            error={deleteError()}
            media={<AgentAvatar agent={agent()} style={{ width: "44px", height: "44px" }} />}
            title={t("sidebar.delete.title", { name: agent().name })}
            description={t("sidebar.delete.agentDescription")}
            onConfirm={confirmDelete}
          />
        )}
      </Show>

      <Show when={channelDeleteTarget()}>
        {(channel) => (
          <ConfirmDialog
            {...shared}
            open
            pending={deleting()}
            error={deleteError()}
            media={<ChannelAvatar members={channel().members} agents={props.agents} layout="cluster" />}
            title={t("sidebar.delete.title", { name: channel().name })}
            description={t("sidebar.delete.channelDescription")}
            onConfirm={confirmDelete}
          />
        )}
      </Show>

      <Show when={historyClearTarget()}>
        {(agent) => (
          <ConfirmDialog
            open
            pending={deleting()}
            error={deleteError()}
            media={<AgentAvatar agent={agent()} style={{ width: "44px", height: "44px" }} />}
            tone="default"
            title={t("sidebar.clearHistory.title")}
            description={t("sidebar.clearHistory.description", { agent: agent().name })}
            confirmLabel={t("sidebar.clearHistory.confirm")}
            pendingLabel={t("sidebar.clearHistory.pending")}
            onCancel={closeDelete}
            onConfirm={confirmClearHistory}
          />
        )}
      </Show>

      <Show when={sectionDeleteTarget()}>
        {(section) => (
          <ConfirmDialog
            {...shared}
            open
            pending={deleting()}
            error={deleteError()}
            title={t("sidebar.delete.title", { name: section().name })}
            description={t("sidebar.delete.sectionDescription")}
            onConfirm={confirmSectionDelete}
          />
        )}
      </Show>
    </>
  );
}
