import {
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  SettingsSection,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createSignal, createUniqueId, For, onCleanup, Show } from "solid-js";
import {
  defaultShortcut,
  FIXED_SHORTCUT_TITLE,
  fixedOpenSettingsChord,
  resolveShortcut,
  SHORTCUT_COMMANDS,
  SHORTCUT_TITLES,
  type ShortcutChord,
  type ShortcutCommand,
  type ShortcutEnvironment,
  type ShortcutOverrides,
  type ShortcutRefusal,
  sameShortcut,
  shortcutCodeOfEvent,
  shortcutRefusal,
  shortcutText,
} from "./keyboard-shortcuts";

export interface KeyboardShortcutsSettingsProps {
  environment: ShortcutEnvironment;
  overrides: ShortcutOverrides;
  onChange: (command: ShortcutCommand, key: ShortcutChord | null) => void;
  onResetAll: () => void;
}

interface ShortcutRowProps {
  command: ShortcutCommand;
  environment: ShortcutEnvironment;
  overrides: ShortcutOverrides;
  onChange: (key: ShortcutChord | null) => void;
}

const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/;

function hasNoModifier(event: KeyboardEvent): boolean {
  return !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
}

function ShortcutRow(props: ShortcutRowProps): JSX.Element {
  const { t } = useText();
  const [recording, setRecording] = createSignal(false);
  const [refusal, setRefusal] = createSignal<ShortcutRefusal | null>(null);
  let recorder!: HTMLDivElement;
  const keysId = `keyboard-shortcut-keys-${createUniqueId()}`;
  const title = () => t(SHORTCUT_TITLES[props.command]);
  const current = () => resolveShortcut(props.command, props.overrides, props.environment);
  const currentText = () => shortcutText(current(), props.environment.platform);
  const isDefault = () => sameShortcut(current(), defaultShortcut(props.command, props.environment));

  const refusalText = (value: ShortcutRefusal): string => {
    if (value.kind === "invalid") return t("settings.shortcuts.refused.invalid");
    if (value.kind === "reserved") return t("settings.shortcuts.refused.reserved");
    return t("settings.shortcuts.refused.taken", { command: t(SHORTCUT_TITLES[value.command]) });
  };

  const down = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.code === "Escape" && hasNoModifier(event)) {
      stop();
      return;
    }
    if (event.repeat) return;
    if (MODIFIER_CODES.test(event.code)) {
      setRefusal(null);
      return;
    }
    const chord: ShortcutChord = {
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      meta: event.metaKey,
      code: shortcutCodeOfEvent(event),
    };
    const refused = shortcutRefusal(props.command, chord, props.overrides, props.environment);
    if (refused) {
      setRefusal(refused);
      return;
    }
    stop();
    if (sameShortcut(chord, current())) return;
    props.onChange(sameShortcut(chord, defaultShortcut(props.command, props.environment)) ? null : chord);
  };
  const pressOutside = (event: PointerEvent) => {
    if (!(event.target instanceof Node && recorder.contains(event.target))) stop();
  };

  // A Reset to a key that another command now uses would give two commands one key.
  const reset = () => {
    const refused = shortcutRefusal(
      props.command,
      defaultShortcut(props.command, props.environment),
      props.overrides,
      props.environment,
    );
    if (refused) setRefusal(refused);
    else props.onChange(null);
  };

  function start(): void {
    if (recording()) return;
    setRefusal(null);
    setRecording(true);
    window.addEventListener("keydown", down, true);
    window.addEventListener("blur", stop);
    window.addEventListener("pointerdown", pressOutside, true);
  }

  function stop(): void {
    if (!recording()) return;
    setRecording(false);
    setRefusal(null);
    window.removeEventListener("keydown", down, true);
    window.removeEventListener("blur", stop);
    window.removeEventListener("pointerdown", pressOutside, true);
  }

  onCleanup(stop);

  return (
    <Item class="settings-modal-row">
      <ItemContent>
        <ItemTitle>{title()}</ItemTitle>
        <Show when={refusal()}>
          {(value) => (
            <ItemDescription class="keyboard-shortcut-refusal" role="alert">
              {refusalText(value())}
            </ItemDescription>
          )}
        </Show>
      </ItemContent>
      <ItemActions>
        <div class="keyboard-shortcut-recorder" ref={recorder}>
          <Show when={!isDefault() && !recording()}>
            <Button variant="ghost" size="sm" type="button" onClick={reset}>
              {t("settings.shortcuts.reset")}
            </Button>
          </Show>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            class="keyboard-shortcut-button"
            aria-label={t("settings.shortcuts.change", { command: title() })}
            aria-describedby={keysId}
            aria-pressed={recording() ? "true" : "false"}
            data-refused={refusal() === null ? undefined : "true"}
            onClick={start}
            onBlur={stop}
          >
            <Show
              when={recording()}
              fallback={
                <span id={keysId} class="keyboard-shortcut-keys">
                  {currentText()}
                </span>
              }
            >
              <span class="keyboard-shortcut-prompt">{t("settings.shortcuts.recording")}</span>
            </Show>
          </Button>
        </div>
      </ItemActions>
    </Item>
  );
}

export function KeyboardShortcutsSettings(props: KeyboardShortcutsSettingsProps): JSX.Element {
  const { t } = useText();
  const changed = () => SHORTCUT_COMMANDS.some((command) => props.overrides[command] !== undefined);

  return (
    <>
      <SettingsSection
        title={t("settings.shortcuts.section")}
        actions={
          <Show when={changed()}>
            <Button variant="ghost" size="sm" type="button" onClick={() => props.onResetAll()}>
              {t("settings.shortcuts.resetAll")}
            </Button>
          </Show>
        }
      >
        <ItemGroup class="settings-modal-card">
          <For each={SHORTCUT_COMMANDS}>
            {(command) => (
              <ShortcutRow
                command={command}
                environment={props.environment}
                overrides={props.overrides}
                onChange={(key) => props.onChange(command, key)}
              />
            )}
          </For>
        </ItemGroup>
      </SettingsSection>

      <SettingsSection title={t("settings.shortcuts.fixed.section")}>
        <ItemGroup class="settings-modal-card">
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{t(FIXED_SHORTCUT_TITLE)}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <span class="keyboard-shortcut-fixed">
                {shortcutText(fixedOpenSettingsChord(props.environment), props.environment.platform)}
              </span>
            </ItemActions>
          </Item>
        </ItemGroup>
      </SettingsSection>
    </>
  );
}
