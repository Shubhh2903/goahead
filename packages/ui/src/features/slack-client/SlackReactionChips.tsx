/**
 * The reactions under one Slack message. A chip toggles the person's own reaction; "+" opens a small
 * emoji picker. The store shows each change at once and takes it back when Slack refuses it.
 */

import type { SlackClientReaction } from "@openbot/contracts/ipc";
import { Button, buttonVariants, Input, Plus, Popover } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, For, Match, Switch } from "solid-js";
import { useText } from "../../text";
import { SLACK_EMOJI_SHORTCODES, SLACK_SKIN_TONE } from "../messaging/slack-emoji-shortcodes";
import { resolveSlackEmoji } from "../messaging/slack-mrkdwn";

export interface SlackReactionChipsProps {
  reactions: readonly SlackClientReaction[];
  /** Workspace emoji: an https image address, or `alias:<name>`. */
  customEmoji: Readonly<Record<string, string>>;
  /** Adds (`on`) or removes the person's reaction. Rejects when Slack refuses it. */
  onToggle: (name: string, on: boolean) => Promise<void>;
}

/** What the picker offers before the person types. */
const FREQUENT = ["+1", "heart", "joy", "eyes", "white_check_mark", "tada", "pray", "fire", "raised_hands", "100"];
const PICKER_LIMIT = 48;

export function SlackReactionChips(props: SlackReactionChipsProps): JSX.Element {
  // The store reports a refusal itself; the chip only has to stay quiet.
  const toggle = (name: string, on: boolean) => void props.onToggle(name, on).catch(() => undefined);
  return (
    <div class="slack-reactions">
      <For each={props.reactions} keyed={(reaction) => reaction.name}>
        {(reaction) => (
          <Button
            variant="ghost"
            size="xs"
            class="slack-reaction-chip"
            aria-pressed={reaction().mine ? "true" : "false"}
            aria-label={`:${reaction().name}: ${reaction().count}`}
            onClick={() => toggle(reaction().name, !reaction().mine)}
          >
            <SlackReactionEmoji name={reaction().name} customEmoji={props.customEmoji} />
            <span aria-hidden="true">{reaction().count}</span>
          </Button>
        )}
      </For>
      <SlackEmojiPicker
        customEmoji={props.customEmoji}
        onPick={(name) => {
          const current = props.reactions.find((reaction) => reaction.name === name);
          if (!current?.mine) toggle(name, true);
        }}
      />
    </div>
  );
}

function SlackEmojiPicker(props: {
  customEmoji: Readonly<Record<string, string>>;
  onPick: (name: string) => void;
}): JSX.Element {
  const { t } = useText();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const names = createMemo(() => {
    const search = query().trim().replace(/^:|:$/gu, "").toLowerCase();
    if (!search) return FREQUENT.filter((name) => Object.hasOwn(SLACK_EMOJI_SHORTCODES, name));
    const all = [...Object.keys(props.customEmoji), ...Object.keys(SLACK_EMOJI_SHORTCODES)];
    const found = new Set<string>();
    for (const name of all) {
      if (found.size >= PICKER_LIMIT) break;
      if (!SLACK_SKIN_TONE.test(name) && name.includes(search)) found.add(name);
    }
    return [...found];
  });
  return (
    <Popover.Root
      open={open()}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
      placement="top-start"
      gutter={4}
    >
      <Popover.Trigger
        as="button"
        type="button"
        class={buttonVariants({ variant: "ghost", size: "icon-xs", class: "slack-reaction-add" })}
        aria-label={t("messaging.client.addReaction")}
      >
        <Plus aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="ui-popover-menu-surface slack-emoji-picker">
          <Popover.Title class="sr-only">{t("messaging.client.addReaction")}</Popover.Title>
          <Input
            aria-label={t("messaging.client.addReaction")}
            placeholder={t("messaging.client.addReaction")}
            value={query()}
            onValueChange={setQuery}
          />
          <div class="slack-emoji-picker-grid">
            <For each={names()}>
              {(name) => (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`:${name}:`}
                  onClick={() => {
                    setOpen(false);
                    setQuery("");
                    props.onPick(name);
                  }}
                >
                  <SlackReactionEmoji name={name} customEmoji={props.customEmoji} />
                </Button>
              )}
            </For>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The emoji alone, for a chip or the picker; the button around it carries the name. */
function SlackReactionEmoji(props: { name: string; customEmoji: Readonly<Record<string, string>> }): JSX.Element {
  const resolved = createMemo(() => resolveSlackEmoji(props.name, props.customEmoji));
  const unicode = () => {
    const value = resolved();
    return value?.kind === "unicode" ? value.value : null;
  };
  const image = () => {
    const value = resolved();
    return value?.kind === "image" ? value.url : null;
  };
  return (
    <Switch fallback={<span aria-hidden="true">{`:${props.name}:`}</span>}>
      <Match when={unicode()}>{(value) => <span aria-hidden="true">{value()}</span>}</Match>
      <Match when={image()}>
        {(url) => (
          <img
            class="slack-message-emoji-image"
            src={url()}
            alt=""
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            draggable={false}
          />
        )}
      </Match>
    </Switch>
  );
}
