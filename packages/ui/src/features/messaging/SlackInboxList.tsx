/**
 * The conversations of the person's local Slack inbox: the ones with unread messages first, then the
 * newest. A row opens the conversation; the view around it decides what that does.
 */

import type { MessagingInboxConversation } from "@openbot/contracts/ipc";
import { Badge, Button, Hash, MessageCircle } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import { sidebarMessageTime } from "../sidebar/sidebar-filtering";

/** One conversation, with the workspace it belongs to. */
export type SlackInboxListItem = MessagingInboxConversation & { workspaceId: string };

export interface SlackInboxListProps {
  items: SlackInboxListItem[];
  /** The open conversation, as `workspaceId:conversation`. */
  activeKey: string | null;
  onSelect: (workspaceId: string, conversation: string) => void;
}

export function slackInboxKey(workspaceId: string, conversation: string): string {
  return `${workspaceId}:${conversation}`;
}

export function SlackInboxList(props: SlackInboxListProps) {
  const { t, format } = useText();
  return (
    <ul class="slack-inbox-list" aria-label={t("messaging.inbox.conversations")}>
      <For each={props.items} keyed={(item) => slackInboxKey(item.workspaceId, item.conversation)}>
        {(item) => {
          const active = () => props.activeKey === slackInboxKey(item().workspaceId, item().conversation);
          const unread = () => item().unreadCount;
          return (
            <li>
              <Button
                variant="ghost"
                class={[
                  "slack-inbox-row",
                  { "slack-inbox-row-active": active(), "slack-inbox-row-unread": unread() > 0 },
                ]}
                aria-pressed={active() ? "true" : "false"}
                aria-label={`${item().place}. ${item().preview}${
                  unread() > 0 ? `. ${t("messaging.inbox.unread", { count: unread() })}` : ""
                }`}
                onClick={() => props.onSelect(item().workspaceId, item().conversation)}
              >
                <span class="slack-inbox-row-icon" aria-hidden="true">
                  <Show when={item().kind === "direct" || item().kind === "group"} fallback={<Hash />}>
                    <MessageCircle />
                  </Show>
                </span>
                <span class="slack-inbox-row-copy">
                  <span class="slack-inbox-row-heading">
                    <span class="slack-inbox-row-place">{item().place}</span>
                    <span class="slack-inbox-row-time">{sidebarMessageTime(item().latestAt, format)}</span>
                  </span>
                  <span class="slack-inbox-row-preview">{item().preview}</span>
                </span>
                <Show when={unread() > 0}>
                  <Badge class="slack-inbox-row-badge" tone="accent" shape="pill" aria-hidden="true">
                    {Math.min(unread(), 99)}
                  </Badge>
                </Show>
              </Button>
            </li>
          );
        }}
      </For>
    </ul>
  );
}
