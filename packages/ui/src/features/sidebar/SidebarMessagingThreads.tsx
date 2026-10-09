/**
 * The Slack conversations an agent answers, as rows under its own row. The newest few show; the
 * rest open with "Show more". A row opens the conversation read-only, and its right-click menu hides
 * it until a newer message arrives. The compact sidebar has no room for them.
 */

import { Badge, Button, buttonVariants, Clock3, ContextMenu, EyeOff, Hash, MessageCircle } from "@openbot/ui";
import { createMemo, createSignal, For, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { sidebarMessageTime } from "./sidebar-filtering";
import { useSidebarScope } from "./sidebar-scope";

const VISIBLE_THREADS = 5;

export function SidebarMessagingThreads(threadProps: { agent: AgentProfile }) {
  const { props, sidebarClickIsSuppressed } = useSidebarScope();
  const { t, format } = useText();
  const [expanded, setExpanded] = createSignal(false);
  const threads = createMemo(() =>
    (props.messagingThreads ?? []).filter((thread) => thread.agentId === threadProps.agent.id),
  );
  // The open conversation, and one with a draft that waits for the person, stay in the list even when
  // they are older than the visible few.
  const visible = createMemo(() =>
    expanded()
      ? threads()
      : threads().filter(
          (thread, index) =>
            index < VISIBLE_THREADS || thread.threadId === props.activeMessagingThreadId || thread.pendingDrafts > 0,
        ),
  );
  const hidden = () => threads().length - visible().length;
  const inbox = () => (props.messagingInbox?.agentId === threadProps.agent.id ? props.messagingInbox : null);
  return (
    <Show when={!props.compact && (threads().length > 0 || inbox())}>
      <ul
        class="sidebar-messaging-threads"
        aria-label={t("sidebar.messagingThreads.label", { name: threadProps.agent.name })}
      >
        <Show when={inbox()}>
          {(current) => (
            <li>
              <Button
                variant="ghost"
                class={[
                  "sidebar-messaging-thread sidebar-messaging-inbox",
                  {
                    "sidebar-messaging-thread-active": props.messagingInboxActive === true,
                    "sidebar-messaging-thread-unread": current().unreadCount > 0,
                  },
                ]}
                aria-label={`${t("sidebar.messagingInbox.row")}${
                  current().unreadCount > 0
                    ? `. ${t("sidebar.messagingInbox.unread", { count: current().unreadCount })}`
                    : ""
                }`}
                aria-pressed={props.messagingInboxActive ? "true" : "false"}
                data-cuelume-navigate=""
                onClick={(event: MouseEvent) => {
                  if (!sidebarClickIsSuppressed(event)) props.onSelectMessagingInbox?.();
                }}
              >
                <span class="sidebar-messaging-thread-icon" aria-hidden="true">
                  <MessageCircle />
                </span>
                <span class="sidebar-messaging-thread-title">{t("sidebar.messagingInbox.row")}</span>
                <Show when={current().unreadCount > 0}>
                  <Badge class="sidebar-messaging-thread-badge" tone="accent" shape="pill" aria-hidden="true">
                    {Math.min(current().unreadCount, 99)}
                  </Badge>
                </Show>
              </Button>
            </li>
          )}
        </Show>
        <For each={visible()} keyed={(thread) => thread.threadId}>
          {(thread) => {
            const active = () => props.activeMessagingThreadId === thread().threadId;
            const unread = () => thread().unreadCount;
            const drafts = () => thread().pendingDrafts;
            return (
              <li>
                <ContextMenu.Root modal={false}>
                  <ContextMenu.Trigger
                    as="button"
                    type="button"
                    class={[
                      buttonVariants({ variant: "ghost" }),
                      "sidebar-messaging-thread",
                      {
                        "sidebar-messaging-thread-active": active(),
                        "sidebar-messaging-thread-unread": unread() > 0,
                        "sidebar-messaging-thread-with-preview": Boolean(thread().preview),
                      },
                    ]}
                    aria-label={`${t("sidebar.messagingThreads.row", { title: thread().title })}${
                      thread().preview ? `. ${thread().preview}` : ""
                    }${unread() > 0 ? `. ${t("sidebar.messagingThreads.unread", { count: unread() })}` : ""}${
                      drafts() > 0 ? `. ${t("sidebar.messagingThreads.draftWaiting", { count: drafts() })}` : ""
                    }`}
                    aria-pressed={active() ? "true" : "false"}
                    data-cuelume-navigate=""
                    onClick={(event: MouseEvent) => {
                      if (!sidebarClickIsSuppressed(event)) props.onSelectMessagingThread?.(thread().threadId);
                    }}
                  >
                    <span class="sidebar-messaging-thread-icon" aria-hidden="true">
                      <Show when={thread().isDirect} fallback={<Hash />}>
                        <MessageCircle />
                      </Show>
                    </span>
                    <span class="sidebar-messaging-thread-title">{thread().title}</span>
                    <Show when={thread().preview}>
                      {(preview) => <span class="sidebar-messaging-thread-preview">{preview()}</span>}
                    </Show>
                    <span class="sidebar-messaging-thread-time">{sidebarMessageTime(thread().updatedAt, format)}</span>
                    <Show when={drafts() > 0}>
                      <span
                        class="sidebar-messaging-thread-waiting"
                        title={t("sidebar.messagingThreads.draftWaiting", { count: drafts() })}
                      >
                        <Clock3 aria-hidden="true" />
                      </span>
                    </Show>
                    <Show when={unread() > 0}>
                      <Badge class="sidebar-messaging-thread-badge" tone="accent" shape="pill" aria-hidden="true">
                        {Math.min(unread(), 99)}
                      </Badge>
                    </Show>
                  </ContextMenu.Trigger>
                  <Show when={props.onHideMessagingThreads}>
                    {(hide) => (
                      <ContextMenu.Portal>
                        <ContextMenu.Content
                          class="agent-context-menu"
                          aria-label={t("sidebar.messagingThreads.row", { title: thread().title })}
                        >
                          <ContextMenu.Item onSelect={() => void hide()([thread().threadId]).catch(() => undefined)}>
                            <EyeOff class="agent-context-icon size-4" aria-hidden="true" />
                            <span>{t("sidebar.messagingThreads.hide")}</span>
                          </ContextMenu.Item>
                        </ContextMenu.Content>
                      </ContextMenu.Portal>
                    )}
                  </Show>
                </ContextMenu.Root>
              </li>
            );
          }}
        </For>
        <Show when={hidden() > 0 || expanded()}>
          <li>
            <Button
              variant="ghost"
              size="sm"
              class="sidebar-messaging-thread-more"
              onClick={() => setExpanded(!expanded())}
            >
              {expanded()
                ? t("sidebar.messagingThreads.showLess")
                : t("sidebar.messagingThreads.showMore", { count: hidden() })}
            </Button>
          </li>
        </Show>
      </ul>
    </Show>
  );
}
