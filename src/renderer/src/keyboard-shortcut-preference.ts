import {
  parseShortcutOverrides,
  resolveShortcut,
  type ShortcutChord,
  type ShortcutCommand,
  type ShortcutEnvironment,
  type ShortcutKeyEvent,
  type ShortcutOverrides,
  serializeShortcutOverrides,
  shortcutMatches,
  withShortcut,
} from "@openbot/ui/features/settings/keyboard-shortcuts";
import { createSignal } from "solid-js";
import { currentDevicePlatform } from "./send-shortcut-preference";

export const KEYBOARD_SHORTCUTS_STORAGE_KEY = "openbot:keyboard-shortcuts:v1";

/** The overrides of this page after the browser did not save them. They win over an older saved value. */
let unsavedOverrides: ShortcutOverrides | undefined;

function readOverrides(): ShortcutOverrides {
  if (unsavedOverrides !== undefined) return unsavedOverrides;
  try {
    return parseShortcutOverrides(window.localStorage.getItem(KEYBOARD_SHORTCUTS_STORAGE_KEY));
  } catch {
    return {};
  }
}

function writeOverrides(overrides: ShortcutOverrides): void {
  try {
    if (Object.keys(overrides).length === 0) window.localStorage.removeItem(KEYBOARD_SHORTCUTS_STORAGE_KEY);
    else window.localStorage.setItem(KEYBOARD_SHORTCUTS_STORAGE_KEY, serializeShortcutOverrides(overrides));
    unsavedOverrides = undefined;
  } catch {
    unsavedOverrides = overrides;
  }
}

const [overrides, setOverridesSignal] = createSignal<ShortcutOverrides>(
  typeof window === "undefined" ? {} : readOverrides(),
);

function readStorageIntoSignal(event: StorageEvent): void {
  if (event.key !== null && event.key !== KEYBOARD_SHORTCUTS_STORAGE_KEY) return;
  setOverridesSignal(readOverrides());
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", readStorageIntoSignal);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", readStorageIntoSignal);
  });
}

export function shortcutEnvironment(): ShortcutEnvironment {
  return { platform: currentDevicePlatform(), browser: typeof window === "undefined" || !("openbot" in window) };
}

export function useShortcutOverrides(): () => ShortcutOverrides {
  return overrides;
}

export function setShortcut(command: ShortcutCommand, key: ShortcutChord | null): void {
  const next = withShortcut(overrides(), command, key);
  writeOverrides(next);
  setOverridesSignal(next);
}

export function resetShortcuts(): void {
  writeOverrides({});
  setOverridesSignal({});
}

/** Whether the keydown is the shortcut the user set for the command, or its default. */
export function matchesShortcut(event: ShortcutKeyEvent, command: ShortcutCommand): boolean {
  return shortcutMatches(event, resolveShortcut(command, overrides(), shortcutEnvironment()));
}
