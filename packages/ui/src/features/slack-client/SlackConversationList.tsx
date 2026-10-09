/**
 * The left pane of the Slack client: every conversation of the workspaces connected as the person.
 * A search field filters by name. The rows show in three sections: Unreads (any conversation with
 * unread messages), Channels and Direct messages (DMs and group DMs), each with the most recent
 * activity first. The view
 * around it holds the navigation landmark and decides what a selection opens and what Hide does.
 */

import type { SlackClientConversation } from "@openbot/contracts/ipc";
import { Badge, buttonVariants, ContextMenu, EyeOff, Hash, Input, Lock, MessageCircle, Search } from "@openbot/ui";
import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js";
import { useText } from "../../text";
import { slackClientKey } from "./slack-client-types";

export interface SlackClientWorkspaceName {
  workspaceId: string;
  workspaceName: string;
}

export interface SlackConversationListProps {
  /** Every conversation of every workspace, in the order main gives. */
  conversations: SlackClientConversation[];
  /** The workspaces connected as the person, to name a workspace when there is more than one. */
  workspaces: SlackClientWorkspaceName[];
  /** The open conversation, as `slackClientKey(workspaceId, channelId)`. */
  activeKey: string | null;
  onSelect: (workspaceId: string, channelId: string) => void;
  /** Names of people by Slack user id, to name a direct message that has no name. */
  people?: Readonly<Record<string, string>>;
  /**
   * Hides a conversation (right-click menu). Without it, the row has no menu. The view owns the
   * request and reports its failure to the person (for example, as the view's action error).
   */
  onHide?: (workspaceId: string, channelId: string) => void;
}

type SectionId = "unreads" | "channels" | "direct";

const SECTION_TEXT = {
  unreads: "messaging.client.section.unreads",
  channels: "messaging.client.section.channels",
  direct: "messaging.client.section.direct",
} as const;

/** Compares two Slack `ts` values ("seconds.micros") without loss of precision. Null is oldest. */
function compareTs(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  const [aSeconds = "", aFraction = ""] = a.split(".");
  const [bSeconds = "", bFraction = ""] = b.split(".");
  if (aSeconds.length !== bSeconds.length) return aSeconds.length - bSeconds.length;
  if (aSeconds !== bSeconds) return aSeconds < bSeconds ? -1 : 1;
  const width = Math.max(aFraction.length, bFraction.length);
  const left = aFraction.padEnd(width, "0");
  const right = bFraction.padEnd(width, "0");
  return left === right ? 0 : left < right ? -1 : 1;
}

function isDirect(item: SlackClientConversation): boolean {
  return item.kind === "im" || item.kind === "mpim";
}

export function SlackConversationList(props: SlackConversationListProps) {
  const { t } = useText();
  const idPrefix = `slack-conversation-list-${createUniqueId()}`;
  const [search, setSearch] = createSignal("");

  const nameOf = (item: SlackClientConversation): string => {
    if (item.name) return item.name;
    const people = props.people;
    const names = people ? item.memberIds.map((id) => people[id] ?? id) : [];
    return names.length > 0 ? names.join(", ") : item.channelId;
  };
  const workspaceNameOf = (workspaceId: string): string | null =>
    props.workspaces.length > 1
      ? (props.workspaces.find((workspace) => workspace.workspaceId === workspaceId)?.workspaceName ?? null)
      : null;

  const sections = createMemo(() => {
    const query = search().trim().toLocaleLowerCase();
    const visible = props.conversations.filter(
      (item) => query === "" || nameOf(item).toLocaleLowerCase().includes(query),
    );
    const newestFirst = (a: SlackClientConversation, b: SlackClientConversation) =>
      compareTs(b.lastActivityTs, a.lastActivityTs) || nameOf(a).localeCompare(nameOf(b));
    const read = visible.filter((item) => item.unreadCount <= 0);
    const all: { id: SectionId; items: SlackClientConversation[] }[] = [
      { id: "unreads", items: visible.filter((item) => item.unreadCount > 0).sort(newestFirst) },
      { id: "channels", items: read.filter((item) => !isDirect(item)).sort(newestFirst) },
      { id: "direct", items: read.filter(isDirect).sort(newestFirst) },
    ];
    return all.filter((section) => section.items.length > 0);
  });

  return (
    <div class="slack-conversation-list">
      <div class="slack-conversation-search">
        <Search class="slack-conversation-search-icon" aria-hidden="true" />
        <Input
          type="search"
          size="sm"
          class="slack-conversation-search-input"
          placeholder={t("messaging.client.search.placeholder")}
          aria-label={t("messaging.client.search.placeholder")}
          value={search()}
          onValueChange={setSearch}
        />
      </div>
      <For each={sections()} keyed={(section) => section.id}>
        {(section) => {
          const headingId = `${idPrefix}-${section().id}`;
          return (
            <section class="slack-conversation-section">
              <h2 id={headingId} class="slack-conversation-section-title">
                {t(SECTION_TEXT[section().id])}
              </h2>
              <ul class="slack-conversation-rows" aria-labelledby={headingId}>
                <For each={section().items} keyed={(item) => slackClientKey(item.workspaceId, item.channelId)}>
                  {(item) => {
                    const active = () => props.activeKey === slackClientKey(item().workspaceId, item().channelId);
                    const unread = () => item().unreadCount;
                    const workspaceName = () => workspaceNameOf(item().workspaceId);
                    const label = () =>
                      `${nameOf(item())}${workspaceName() ? `. ${workspaceName()}` : ""}${
                        unread() > 0 ? `. ${t("messaging.inbox.unread", { count: unread() })}` : ""
                      }`;
                    return (
                      <li>
                        <ContextMenu.Root modal={false}>
                          <ContextMenu.Trigger
                            as="button"
                            type="button"
                            class={[
                              buttonVariants({ variant: "ghost" }),
                              "slack-conversation-row",
                              {
                                "slack-conversation-row-active": active(),
                                "slack-conversation-row-unread": unread() > 0,
                              },
                            ]}
                            aria-label={label()}
                            aria-pressed={active() ? "true" : "false"}
                            onClick={() => props.onSelect(item().workspaceId, item().channelId)}
                          >
                            <span class="slack-conversation-row-icon" aria-hidden="true">
                              <Show when={!isDirect(item())} fallback={<MessageCircle />}>
                                <Show when={item().kind === "private"} fallback={<Hash />}>
                                  <Lock />
                                </Show>
                              </Show>
                            </span>
                            <span class="slack-conversation-row-name">{nameOf(item())}</span>
                            <Show when={workspaceName()}>
                              {(name) => <span class="slack-conversation-row-workspace">{name()}</span>}
                            </Show>
                            <Show when={unread() > 0}>
                              <Badge class="slack-conversation-row-badge" tone="accent" shape="pill" aria-hidden="true">
                                {Math.min(unread(), 99)}
                              </Badge>
                            </Show>
                          </ContextMenu.Trigger>
                          <Show when={props.onHide}>
                            {(hide) => (
                              <ContextMenu.Portal>
                                <ContextMenu.Content class="agent-context-menu" aria-label={nameOf(item())}>
                                  <ContextMenu.Item onSelect={() => hide()(item().workspaceId, item().channelId)}>
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
              </ul>
            </section>
          );
        }}
      </For>
    </div>
  );
}
