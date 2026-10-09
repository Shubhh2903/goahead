/**
 * The box that writes as the person in a Slack conversation or in one of its threads. It needs no
 * approval. The store binds the actions to the place the composer writes in. Text that starts with
 * `@chief` never goes to Slack: it goes to the Slack Orchestrator with `onAsk`.
 *
 * `@name` opens a picker of the workspace's people; the picked person goes to Slack as `<@id>`.
 * `:name` opens a picker of emoji shortcodes. Enter sends, Shift+Enter starts a new line. A dropped
 * file goes to Slack with the text; the attach button lets main open the file picker.
 */

import { SLACK_CLIENT_LIMITS, type SlackClientMentionCandidate } from "@openbot/contracts/ipc";
import { Button, Checkbox, IconButton, Listbox, Textarea, Upload } from "@openbot/ui";
import { createStore, createUniqueId, For, flush, onCleanup, Show } from "solid-js";
import { useText } from "../../text";
import { SLACK_EMOJI_SHORTCODES } from "../messaging/slack-emoji-shortcodes";
import type { SlackClientUpload, SlackComposerActions } from "./slack-client-types";

/** Text that starts with `@chief`, then a space or nothing, goes to the Slack Orchestrator. */
const CHIEF_PREFIX = /^@chief(?:\s|$)/i;
/** The `@name` or `:name` that the caret is at the end of. */
const MENTION_TRIGGER = /(?:^|\s)@([^\s@]{0,40})$/u;
const EMOJI_TRIGGER = /(?:^|\s):([a-z0-9_+-]{2,40})$/u;
const PICKER_ROWS = 8;

interface PickerOption {
  key: string;
  /** What the option shows and its accessible name. */
  label: string;
  /** What replaces the typed `@query` or `:query`. */
  insert: string;
  mention?: SlackClientMentionCandidate;
}

interface Trigger {
  kind: "mention" | "emoji";
  query: string;
  /** Where the `@` or `:` is in the text. */
  start: number;
  end: number;
}

export interface SlackComposerProps extends SlackComposerActions {
  /** The composer writes in a thread: it offers "Also send to channel". */
  inThread?: boolean;
  /** Uploads on their way from this composer, oldest first. */
  uploads: SlackClientUpload[];
  /** Workspace emoji, for the shortcode picker. */
  customEmoji: Readonly<Record<string, string>>;
}

/** Writes each picked `@Name` as Slack's `<@id>`. Longer names first, so "Ana Lima" wins over "Ana". */
function slackText(text: string, mentions: Readonly<Record<string, string>>): string {
  return Object.keys(mentions)
    .sort((left, right) => right.length - left.length)
    .reduce((current, name) => current.split(`@${name}`).join(`<@${mentions[name]}>`), text);
}

function emojiOptions(query: string, customEmoji: Readonly<Record<string, string>>): PickerOption[] {
  const options: PickerOption[] = [];
  for (const name of Object.keys(customEmoji)) {
    if (options.length >= PICKER_ROWS) return options;
    if (name.startsWith(query)) options.push({ key: `:${name}`, label: `:${name}:`, insert: `:${name}: ` });
  }
  for (const [name, emoji] of Object.entries(SLACK_EMOJI_SHORTCODES)) {
    if (options.length >= PICKER_ROWS) return options;
    if (name.startsWith(query)) options.push({ key: `:${name}`, label: `${emoji} :${name}:`, insert: `:${name}: ` });
  }
  return options;
}

export function SlackComposer(props: SlackComposerProps) {
  const { t, errorMessage } = useText();
  const pickerId = `slack-composer-picker-${createUniqueId()}`;
  const broadcastId = `slack-composer-broadcast-${createUniqueId()}`;
  const [draft, setDraft] = createStore<{
    text: string;
    sending: boolean;
    error: string | null;
    broadcast: boolean;
    /** Picked people by the name the text shows. */
    mentions: Record<string, string>;
    trigger: Trigger | null;
    options: PickerOption[];
    active: number;
  }>({
    text: "",
    sending: false,
    error: null,
    broadcast: false,
    mentions: {},
    trigger: null,
    options: [],
    active: 0,
  });
  let box: HTMLTextAreaElement | undefined;
  // Only the newest people search may fill the picker.
  let searches = 0;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  const asksChief = () => CHIEF_PREFIX.test(draft.text.trim());
  const ready = () => {
    const text = draft.text.trim();
    if (draft.sending || !text) return false;
    return !asksChief() || text.replace(CHIEF_PREFIX, "").trim().length > 0;
  };
  const activeKey = () => {
    const option = draft.options[draft.active];
    return option ? new Set([option.key]) : new Set<string>();
  };
  /** The textarea keeps focus; `aria-activedescendant` names the option the arrow keys reach. */
  const optionId = (index: number) => `${pickerId}-option-${index}`;
  const pickerOpen = () => draft.trigger !== null && draft.options.length > 0;
  const closePicker = () =>
    setDraft((state) => {
      state.trigger = null;
      state.options = [];
      state.active = 0;
    });

  /** Reads the `@` or `:` word that ends at the caret, and fills the picker for it. */
  const readTrigger = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const mention = MENTION_TRIGGER.exec(before);
    const emoji = mention ? null : EMOJI_TRIGGER.exec(before);
    const match = mention ?? emoji;
    // `@chief` at the start asks the orchestrator; it is not a person.
    if (!match || (mention && CHIEF_PREFIX.test(before))) {
      searches++;
      closePicker();
      return;
    }
    const query = match[1] ?? "";
    const trigger: Trigger = {
      kind: mention ? "mention" : "emoji",
      query,
      start: caret - query.length - 1,
      end: caret,
    };
    if (trigger.kind === "emoji") {
      searches++;
      setDraft((state) => {
        state.trigger = trigger;
        state.options = emojiOptions(query.toLowerCase(), props.customEmoji);
        state.active = 0;
      });
      return;
    }
    setDraft((state) => {
      state.trigger = trigger;
    });
    const search = ++searches;
    props.onMentionSearch(query).then(
      (candidates) => {
        if (disposed || search !== searches) return;
        setDraft((state) => {
          state.options = candidates.slice(0, PICKER_ROWS).map((candidate) => ({
            key: `@${candidate.id}`,
            label: candidate.name,
            insert: `@${candidate.name} `,
            mention: { id: candidate.id, name: candidate.name },
          }));
          state.active = 0;
        });
      },
      () => {
        if (!disposed && search === searches) closePicker();
      },
    );
  };

  const pick = (option: PickerOption) => {
    const trigger = draft.trigger;
    if (!trigger) return;
    const text = `${draft.text.slice(0, trigger.start)}${option.insert}${draft.text.slice(trigger.end)}`;
    const caret = trigger.start + option.insert.length;
    searches++;
    setDraft((state) => {
      state.text = text;
      if (option.mention) state.mentions[option.mention.name] = option.mention.id;
      state.trigger = null;
      state.options = [];
      state.active = 0;
    });
    flush();
    box?.focus();
    box?.setSelectionRange(caret, caret);
  };

  /** Clears the box for a new message, and answers what was in it. */
  const takeDraft = () => {
    const taken = { text: draft.text.trim(), mentions: { ...draft.mentions }, broadcast: draft.broadcast };
    searches++;
    setDraft((state) => {
      state.text = "";
      state.mentions = {};
      state.broadcast = false;
      state.trigger = null;
      state.options = [];
    });
    return taken;
  };
  /** Puts back text that did not go, before what the person wrote since. */
  const restoreDraft = (taken: { text: string; mentions: Record<string, string>; broadcast: boolean }) =>
    setDraft((state) => {
      state.text = state.text ? `${taken.text}\n${state.text}` : taken.text;
      Object.assign(state.mentions, taken.mentions);
      state.broadcast = taken.broadcast;
    });

  const send = () => {
    if (!ready()) return;
    if (asksChief()) {
      // An `@chief` instruction keeps its text until the orchestrator has it.
      const text = draft.text.trim();
      setDraft((state) => {
        state.sending = true;
        state.error = null;
      });
      props.onAsk(text).then(
        () =>
          setDraft((state) => {
            state.sending = false;
            // Keep what the person wrote while the ask was on its way: remove only the asked text.
            if (state.text.trim() === text) {
              state.text = "";
              state.mentions = {};
              return;
            }
            const at = state.text.indexOf(text);
            if (at >= 0) state.text = `${state.text.slice(0, at)}${state.text.slice(at + text.length)}`.trimStart();
          }),
        (error: unknown) =>
          setDraft((state) => {
            state.sending = false;
            state.error = errorMessage(error, t("messaging.inbox.reply.askFailed"));
          }),
      );
      return;
    }
    // A message shows in the conversation at once, so the box clears at once.
    const taken = takeDraft();
    setDraft((state) => {
      state.sending = true;
      state.error = null;
    });
    const text = slackText(taken.text, taken.mentions);
    props.onSend(props.inThread && taken.broadcast ? { text, broadcast: true } : { text }).then(
      () =>
        setDraft((state) => {
          state.sending = false;
        }),
      () => {
        // The store shows why Slack refused the message.
        setDraft((state) => {
          state.sending = false;
        });
        restoreDraft(taken);
      },
    );
  };

  const dropFiles = async (files: File[]) => {
    const limit = SLACK_CLIENT_LIMITS.uploadBytes;
    if (files.some((file) => file.size > limit)) {
      setDraft((state) => {
        // Slack gets nothing: say why, with the limit main also enforces.
        state.error = t("error.messaging.clientFileTooLarge", { limit: limit / (1024 * 1024) });
      });
      return;
    }
    setDraft((state) => {
      state.error = null;
    });
    // The text goes with the first file, as Slack shows a message with its files.
    const taken = asksChief() || !draft.text.trim() ? null : takeDraft();
    const text = taken ? slackText(taken.text, taken.mentions) : undefined;
    for (const [index, file] of files.entries()) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await props.onDropFile({ name: file.name, bytes }, index === 0 ? text : undefined);
      } catch {
        // The store shows why Slack refused the file.
        if (index === 0 && taken && !disposed) restoreDraft(taken);
        return;
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // The browser owns the IME composition buffer.
    if (event.isComposing || event.keyCode === 229) return;
    if (pickerOpen()) {
      const count = draft.options.length;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setDraft((state) => {
          state.active = (state.active + step + count) % count;
        });
        return;
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault();
        const option = draft.options[draft.active];
        if (option) pick(option);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        searches++;
        closePicker();
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
    <form
      class="slack-composer"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
      onDragOver={(event) => {
        if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length === 0) return;
        event.preventDefault();
        void dropFiles(files);
      }}
    >
      <Show when={draft.error}>
        {(error) => (
          <p role="alert" class="slack-composer-error">
            {error()}
          </p>
        )}
      </Show>
      <Show when={props.uploads.length > 0}>
        <ul class="slack-composer-uploads" aria-live="polite">
          <For each={props.uploads} keyed={(upload) => upload.id}>
            {(upload) => <li>{t("messaging.client.uploading", { name: upload().name })}</li>}
          </For>
        </ul>
      </Show>
      <Show when={pickerOpen()}>
        <Listbox.Root<PickerOption>
          id={pickerId}
          class="slack-composer-picker"
          aria-label={t(draft.trigger?.kind === "emoji" ? "chat.actions.moreEmoji" : "composer.picker.mentionLabel")}
          options={draft.options}
          optionValue={(option) => option.key}
          optionTextValue={(option) => option.label}
          selectionMode="single"
          disallowEmptySelection={true}
          allowDuplicateSelectionEvents={true}
          shouldUseVirtualFocus={true}
          shouldFocusOnHover={true}
          shouldSelectOnPressUp={true}
          value={activeKey()}
          onChange={(keys) => {
            const key = keys.values().next().value;
            const option = draft.options.find((candidate) => candidate.key === key);
            if (option) pick(option);
          }}
          renderItem={(item) => (
            <Listbox.Item
              item={item}
              id={optionId(draft.options.findIndex((option) => option.key === item.key))}
              aria-label={item.rawValue.label}
              class={[
                "slack-composer-picker-option",
                { "slack-composer-picker-option-active": draft.options[draft.active]?.key === item.key },
              ]}
              onPointerDown={(event: PointerEvent) => event.preventDefault()}
            >
              {item.rawValue.label}
            </Listbox.Item>
          )}
        />
      </Show>
      <Textarea
        ref={(element: HTMLTextAreaElement) => {
          box = element;
        }}
        rows={2}
        value={draft.text}
        maxlength={SLACK_CLIENT_LIMITS.textLength}
        aria-label={t("messaging.inbox.reply.placeholder")}
        aria-controls={pickerOpen() ? pickerId : undefined}
        aria-activedescendant={pickerOpen() ? optionId(draft.active) : undefined}
        aria-autocomplete="list"
        placeholder={t("messaging.inbox.reply.placeholder")}
        onKeyDown={onKeyDown}
        onBlur={() => {
          searches++;
          closePicker();
        }}
        onValueChange={(text: string) => {
          setDraft((state) => {
            state.text = text;
          });
          readTrigger(text, box?.selectionStart ?? text.length);
        }}
      />
      <div class="slack-composer-actions">
        <Show when={props.inThread}>
          <span class="slack-composer-broadcast">
            <Checkbox
              id={broadcastId}
              checked={draft.broadcast}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setDraft((state) => {
                  state.broadcast = checked;
                });
              }}
            />
            <label for={broadcastId}>{t("messaging.client.alsoSendToChannel")}</label>
          </span>
        </Show>
        <IconButton
          type="button"
          variant="ghost"
          label={t("messaging.client.attach")}
          onClick={() => {
            // Main opens the file picker. The text stays: a cancelled picker must not lose it.
            props.onAttach().catch(() => undefined);
          }}
        >
          <Upload aria-hidden="true" />
        </IconButton>
        <Button type="submit" size="sm" disabled={!ready()}>
          {asksChief() ? t("messaging.inbox.reply.askChief") : t("messaging.inbox.reply.send")}
        </Button>
      </div>
    </form>
  );
}
