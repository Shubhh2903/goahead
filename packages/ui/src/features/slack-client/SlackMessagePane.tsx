/**
 * The middle pane of the Slack client: the messages of the open conversation, oldest first, grouped by
 * author and day. The list stays at the newest message while the person is there, reads older
 * messages when the person scrolls to the top, and renders only the rows near the view when it is
 * long. The view around it holds the region landmark and the composer.
 */

import type { MessagingInboxFile, SlackClientConversation, SlackClientMessage } from "@openbot/contracts/ipc";
import { Button, ConfirmDialog, Textarea, UserAvatar } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, For, onSettled, Show } from "solid-js";
import { useText } from "../../text";
import { calculateChatScrollMargin, createChatVirtualizer } from "../conversation/createChatVirtualizer";
import { SlackMessageContent } from "../messaging/SlackMessageContent";
import { SlackReactionChips } from "./SlackReactionChips";
import type { SlackClientLookups, SlackMessageActions } from "./slack-client-types";

export interface SlackMessagePaneProps extends SlackMessageActions {
  /** The open conversation, for the header. Null before the person picks one. */
  conversation: SlackClientConversation | null;
  /** Top-level messages, oldest first, with the person's actions that Slack has not confirmed. */
  messages: SlackClientMessage[];
  lookups: SlackClientLookups;
  /** Older messages exist in Slack or in the cache. */
  hasOlder: boolean;
  /** The messages come from the cache only: Slack could not be reached. */
  offline: boolean;
  /** The messages come from the cache only: Slack refused the last read. */
  loadError?: boolean;
  /** The messages on screen are not the chosen conversation yet: its read is on its way. */
  loading: boolean;
  loadingOlder: boolean;
  /** The last read failed. */
  failed: boolean;
  onRetry: () => void;
  onLoadOlder: () => void;
  onOpenThread: (threadTs: string) => void;
}

/** The reader is at the newest message when less than this many pixels are below the view. */
const STICK_DISTANCE = 80;
/** The reader has reached the top when less than this many pixels are above the view. */
const TOP_DISTANCE = 80;
/** Messages of one author closer together than this show under one name. */
const GROUP_SECONDS = 5 * 60;
const ROW_ESTIMATE = 64;

interface PaneRow {
  message: SlackClientMessage;
  /** The first message of its day: a day line goes above it. */
  newDay: boolean;
  /** The same author wrote the message above it a short time before. */
  grouped: boolean;
}

/** A `ts` that is not a Slack time shows as now: an invalid date stops the whole renderer. */
function seconds(ts: string): number {
  const value = Number.parseFloat(ts);
  return Number.isFinite(value) ? value : Date.now() / 1000;
}

function dayOf(ts: string): string {
  const date = new Date(seconds(ts) * 1000);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function paneRows(messages: readonly SlackClientMessage[]): PaneRow[] {
  return messages.map((message, index) => {
    const previous = index > 0 ? messages[index - 1] : undefined;
    const newDay = !previous || dayOf(previous.ts) !== dayOf(message.ts);
    const grouped =
      previous !== undefined &&
      !newDay &&
      !previous.deleted &&
      !message.deleted &&
      previous.authorId === message.authorId &&
      seconds(message.ts) - seconds(previous.ts) < GROUP_SECONDS;
    return { message, newDay, grouped };
  });
}

export function SlackMessagePane(props: SlackMessagePaneProps): JSX.Element {
  const { t, format } = useText();
  const [scrollMargin, setScrollMargin] = createSignal(0);
  let scroller: HTMLDivElement | undefined;
  let listRoot: HTMLOListElement | undefined;
  // Read in scroll handlers and frames, never rendered.
  let stick = true;
  let fromBottom = 0;
  let lastPlace = "";
  let lastFirst = "";
  let lastLast = "";

  const rows = createMemo(() => paneRows(props.messages));
  const virtualizer = createChatVirtualizer<HTMLDivElement, HTMLLIElement>({
    count: () => props.messages.length,
    getScrollElement: () => scroller ?? null,
    estimateSize: () => ROW_ESTIMATE,
    getItemKey: (index) => props.messages[index]?.ts ?? index,
    keyVersion: () => `${props.messages[0]?.ts ?? ""}:${props.messages.at(-1)?.ts ?? ""}:${props.messages.length}`,
    scrollMargin,
  });

  const updateScrollMargin = () => setScrollMargin(calculateChatScrollMargin(scroller, listRoot));

  function loadOlderAtTop(element: HTMLElement): void {
    if (!props.hasOlder || props.loadingOlder || props.loading) return;
    if (element.scrollTop <= TOP_DISTANCE) props.onLoadOlder();
  }

  createEffect(
    () => {
      const conversation = props.conversation;
      return {
        place: conversation ? `${conversation.workspaceId}:${conversation.channelId}` : "",
        first: props.messages[0]?.ts ?? "",
        last: props.messages.at(-1),
        count: props.messages.length,
      };
    },
    ({ place, first, last }) => {
      const samePlace = place === lastPlace;
      const prepended = samePlace && lastFirst !== "" && first !== lastFirst;
      // A message the person just sent is news to them wherever they are reading.
      if (!samePlace || (last?.mine && last.ts !== lastLast && lastLast !== "")) stick = true;
      lastPlace = place;
      lastFirst = first;
      lastLast = last?.ts ?? "";
      requestAnimationFrame(() => {
        if (!scroller) return;
        updateScrollMargin();
        if (stick) scroller.scrollTop = scroller.scrollHeight;
        else if (prepended) scroller.scrollTop = scroller.scrollHeight - fromBottom;
        fromBottom = scroller.scrollHeight - scroller.scrollTop;
        // A conversation shorter than the view cannot scroll, so its top is already in view.
        if (scroller.scrollHeight > 0 && scroller.scrollHeight <= scroller.clientHeight) loadOlderAtTop(scroller);
      });
    },
  );

  onSettled(() => {
    const observer = new ResizeObserver(() => updateScrollMargin());
    if (scroller) observer.observe(scroller);
    if (listRoot) observer.observe(listRoot);
    return () => observer.disconnect();
  });

  return (
    <div class="slack-message-pane" aria-busy={props.loading || props.loadingOlder ? "true" : "false"}>
      <Show when={props.conversation} fallback={<p class="slack-client-note">{t("messaging.inbox.choose")}</p>}>
        {(conversation) => (
          <header class="slack-message-pane-header">
            <h2 class="slack-message-pane-title">{conversation().name}</h2>
          </header>
        )}
      </Show>
      <Show when={props.failed}>
        <p role="alert" class="slack-client-note">
          {t("messaging.inbox.loadFailed")}
          <Button variant="ghost" onClick={props.onRetry}>
            {t("common.retry")}
          </Button>
        </p>
      </Show>
      <Show when={props.offline}>
        <p class="slack-client-note">{t("messaging.client.offline")}</p>
      </Show>
      <Show when={props.loadError && !props.failed && !props.offline}>
        <p role="alert" class="slack-client-note">
          {t("messaging.client.loadError")}
          <Button variant="ghost" onClick={props.onRetry}>
            {t("common.retry")}
          </Button>
        </p>
      </Show>
      <div
        ref={(element) => {
          scroller = element;
        }}
        class="slack-message-scroll"
        role="log"
        onScroll={(event) => {
          const element = event.currentTarget;
          stick = element.scrollHeight - element.scrollTop - element.clientHeight <= STICK_DISTANCE;
          fromBottom = element.scrollHeight - element.scrollTop;
          loadOlderAtTop(element);
        }}
      >
        <Show when={props.loadingOlder}>
          <p role="status" class="slack-message-older">
            {t("common.loading")}
          </p>
        </Show>
        <Show when={props.hasOlder && !props.loadingOlder}>
          <div class="slack-message-older">
            <Button variant="ghost" size="sm" onClick={props.onLoadOlder}>
              {t("messaging.client.loadOlder")}
            </Button>
          </div>
        </Show>
        <ol
          ref={(element) => {
            listRoot = element;
          }}
          class={["slack-message-list", { "slack-message-list-static": !virtualizer.isVirtualized() }]}
          style={{ height: virtualizer.isVirtualized() ? `${virtualizer.getTotalSize()}px` : "auto" }}
        >
          {/* Keyed by message: a row keeps its state, such as an open editor, while the list moves. */}
          <For each={virtualizer.getVirtualItems()} keyed={(item) => item.key}>
            {(item) => {
              const row = () => rows()[item().index];
              return (
                <Show when={row()}>
                  {(current) => (
                    <li
                      data-index={item().index}
                      ref={virtualizer.measureElement}
                      class="slack-message-row"
                      style={{
                        transform: virtualizer.isVirtualized()
                          ? `translateY(${item().start - virtualizer.scrollMargin()}px)`
                          : "none",
                      }}
                    >
                      <Show when={current().newDay}>
                        <p class="slack-message-day">
                          {format.date(seconds(current().message.ts) * 1000, {
                            weekday: "long",
                            month: "long",
                            day: "numeric",
                          })}
                        </p>
                      </Show>
                      <SlackMessageItem
                        message={current().message}
                        grouped={current().grouped}
                        lookups={props.lookups}
                        onEdit={props.onEdit}
                        onDelete={props.onDelete}
                        onReact={props.onReact}
                        onOpenLink={props.onOpenLink}
                        onOpenThread={props.onOpenThread}
                      />
                    </li>
                  )}
                </Show>
              );
            }}
          </For>
        </ol>
      </div>
    </div>
  );
}

export interface SlackMessageItemProps extends SlackMessageActions {
  message: SlackClientMessage;
  /** Shows the message under the name of the message above it. */
  grouped: boolean;
  lookups: SlackClientLookups;
  /** Absent where the message is already in its thread. */
  onOpenThread?: (threadTs: string) => void;
}

/**
 * One Slack message: author and time, the text as Slack shows it, files, reactions and the reply
 * count. The person's own messages also offer Edit and Delete; Delete asks first.
 */
export function SlackMessageItem(props: SlackMessageItemProps): JSX.Element {
  const { t, format } = useText();
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const [confirming, setConfirming] = createSignal(false);
  const author = () => props.lookups.people[props.message.authorId] ?? props.message.authorId;
  const time = () => new Date(seconds(props.message.ts) * 1000);
  const files = (): MessagingInboxFile[] =>
    props.message.files.map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimetype,
      size: file.size,
      previewUrl: file.previewUrl,
      permalink: file.permalink,
    }));
  const canChange = () => props.message.mine && !props.message.deleted && props.message.pending === undefined;
  // Only the conversation's list opens a thread: the thread panel passes no `onOpenThread`.
  const canReply = () =>
    props.onOpenThread !== undefined && !props.message.deleted && props.message.pending === undefined;
  // The store reports a refusal itself and takes the change back.
  const quiet = (result: Promise<void>) => void result.catch(() => undefined);

  function startEdit(): void {
    setDraft(props.message.text);
    setEditing(true);
  }

  function saveEdit(): void {
    const text = draft().trim();
    setEditing(false);
    if (!text || text === props.message.text) return;
    quiet(props.onEdit(props.message.ts, text));
  }

  return (
    <article
      class={[
        "slack-message-item",
        {
          "slack-message-item-grouped": props.grouped,
          "slack-message-item-pending": props.message.pending !== undefined,
        },
      ]}
      aria-label={author()}
      aria-busy={props.message.pending ? "true" : undefined}
    >
      <div class="slack-message-gutter">
        <Show when={!props.grouped}>
          <UserAvatar class="slack-message-avatar" user={{ name: author(), email: "", avatarUrl: null }} decorative />
        </Show>
      </div>
      <div class="slack-message-body">
        <Show when={!props.grouped}>
          <header class="slack-message-meta">
            <strong>{author()}</strong>
            <time datetime={time().toISOString()}>{format.date(time(), { hour: "numeric", minute: "2-digit" })}</time>
          </header>
        </Show>
        <Show
          when={editing()}
          fallback={
            <Show
              when={!props.message.deleted}
              fallback={<span class="slack-message-deleted">{t("messaging.client.message.deleted")}</span>}
            >
              <SlackMessageContent
                text={props.message.text}
                files={files()}
                people={props.lookups.people}
                channels={props.lookups.channels}
                customEmoji={props.lookups.customEmoji}
                onOpenLink={props.onOpenLink}
              />
              <Show when={props.message.editedAt !== null}>
                <span class="slack-message-edited">{t("messaging.client.message.edited")}</span>
              </Show>
            </Show>
          }
        >
          <div class="slack-message-editor">
            <Textarea
              ref={(element: HTMLTextAreaElement) => queueMicrotask(() => element.focus())}
              aria-label={t("messaging.client.message.edit")}
              value={draft()}
              onValueChange={setDraft}
              rows={2}
              onKeyDown={(event: KeyboardEvent) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setEditing(false);
                } else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
                  event.preventDefault();
                  saveEdit();
                }
              }}
            />
            <div class="slack-message-editor-actions">
              <Button variant="ghost" size="sm" type="button" onClick={() => setEditing(false)}>
                {t("common.cancel")}
              </Button>
              <Button size="sm" type="button" disabled={!draft().trim()} onClick={saveEdit}>
                {t("common.save")}
              </Button>
            </div>
          </div>
        </Show>
        <Show when={!props.message.deleted}>
          <SlackReactionChips
            reactions={props.message.reactions}
            customEmoji={props.lookups.customEmoji}
            onToggle={(name, on) => props.onReact(props.message.ts, name, on)}
          />
        </Show>
        <Show when={props.message.replyCount > 0 ? props.onOpenThread : undefined}>
          {(open) => (
            <Button variant="link" size="xs" class="slack-message-replies" onClick={() => open()(props.message.ts)}>
              {t("messaging.client.replies", { count: props.message.replyCount })}
            </Button>
          )}
        </Show>
      </div>
      <Show when={(canChange() || canReply()) && !editing()}>
        <div class="slack-message-actions">
          {/* A message with no replies yet starts its thread here. */}
          <Show when={canReply() ? props.onOpenThread : undefined}>
            {(open) => (
              <Button variant="ghost" size="xs" onClick={() => open()(props.message.threadTs ?? props.message.ts)}>
                {t("messaging.client.replyInThread")}
              </Button>
            )}
          </Show>
          <Show when={canChange()}>
            <Button variant="ghost" size="xs" onClick={startEdit}>
              {t("messaging.client.message.edit")}
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setConfirming(true)}>
              {t("messaging.client.message.delete")}
            </Button>
          </Show>
        </div>
      </Show>
      <Show when={confirming()}>
        <ConfirmDialog
          open
          title={t("messaging.client.deleteConfirm.title")}
          confirmLabel={t("messaging.client.deleteConfirm.confirm")}
          cancelLabel={t("messaging.client.deleteConfirm.cancel")}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            quiet(props.onDelete(props.message.ts));
          }}
        />
      </Show>
    </article>
  );
}
