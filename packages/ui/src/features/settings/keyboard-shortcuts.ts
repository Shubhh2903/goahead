import type { AppTextKey } from "@openbot/i18n";

/** The DOM-free rules for the rebindable keyboard shortcuts. The renderer owns persistence. */

export const SHORTCUT_COMMANDS = ["globalSearch", "searchChat", "newAgent", "toggleSidebar", "showShortcuts"] as const;

export type ShortcutCommand = (typeof SHORTCUT_COMMANDS)[number];

export type ShortcutPlatform = "darwin" | "win32" | "linux";

/** A key with its modifiers. `code` is a letter, digit or punctuation name, such as `KeyK`. */
export interface ShortcutChord {
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
  readonly code: string;
}

export type ShortcutOverrides = Partial<Record<ShortcutCommand, ShortcutChord>>;

export interface ShortcutEnvironment {
  readonly platform: ShortcutPlatform;
  readonly browser: boolean;
}

function primary(code: string, platform: ShortcutPlatform, shift = false): ShortcutChord {
  const mac = platform === "darwin";
  return { ctrl: !mac, alt: false, shift, meta: mac, code };
}

const DEFAULT_KEYS: Record<ShortcutCommand, { code: string; shift: boolean }> = {
  globalSearch: { code: "KeyK", shift: false },
  searchChat: { code: "KeyF", shift: false },
  newAgent: { code: "KeyE", shift: true },
  toggleSidebar: { code: "KeyB", shift: false },
  showShortcuts: { code: "Slash", shift: false },
};

export const SHORTCUT_TITLES: Record<ShortcutCommand, AppTextKey> = {
  globalSearch: "settings.shortcuts.command.globalSearch",
  searchChat: "settings.shortcuts.command.searchChat",
  newAgent: "settings.shortcuts.command.newAgent",
  toggleSidebar: "settings.shortcuts.command.toggleSidebar",
  showShortcuts: "settings.shortcuts.command.showShortcuts",
};

export const FIXED_SHORTCUT_TITLE: AppTextKey = "settings.shortcuts.command.openSettings";

export function fixedOpenSettingsChord(environment: ShortcutEnvironment): ShortcutChord {
  return primary("Comma", environment.platform);
}

export function defaultShortcut(command: ShortcutCommand, environment: ShortcutEnvironment): ShortcutChord {
  const { code, shift } = DEFAULT_KEYS[command];
  return primary(code, environment.platform, shift);
}

export function resolveShortcut(
  command: ShortcutCommand,
  overrides: ShortcutOverrides,
  environment: ShortcutEnvironment,
): ShortcutChord {
  return overrides[command] ?? defaultShortcut(command, environment);
}

export function sameShortcut(a: ShortcutChord, b: ShortcutChord): boolean {
  return a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.meta === b.meta && a.code === b.code;
}

const PUNCTUATION_CODES = new Set([
  "BracketLeft",
  "BracketRight",
  "Slash",
  "Backslash",
  "Comma",
  "Period",
  "Semicolon",
  "Quote",
  "Backquote",
  "Minus",
  "Equal",
]);

function isShortcutCode(code: string): boolean {
  return /^Key[A-Z]$/.test(code) || /^Digit[0-9]$/.test(code) || /^F\d{1,2}$/.test(code) || PUNCTUATION_CODES.has(code);
}

/** A shortcut needs a modifier, so typing in a text field never triggers it. */
export function isValidShortcut(key: { ctrl: boolean; alt: boolean; meta: boolean; code: string | null }): boolean {
  if (key.code === null || !isShortcutCode(key.code)) return false;
  return key.ctrl || key.alt || key.meta || /^F\d/.test(key.code);
}

/** Keys the system, the text fields, chat search or the server rail already use. */
const PRIMARY_RESERVED_CODES = new Set([
  "KeyA",
  "KeyC",
  "KeyG",
  "KeyH",
  "KeyL",
  "KeyM",
  "KeyN",
  "KeyQ",
  "KeyR",
  "KeyT",
  "KeyV",
  "KeyW",
  "KeyX",
  "KeyZ",
  "Comma",
  "Period",
  "Equal",
  "Minus",
  ...Array.from({ length: 10 }, (_, digit) => `Digit${digit}`),
]);

export function isReservedShortcut(key: ShortcutChord, environment: ShortcutEnvironment): boolean {
  const mac = environment.platform === "darwin";
  const primaryOnly = (mac ? key.meta && !key.ctrl : key.ctrl && !key.meta) && !key.alt;
  if (!primaryOnly) return false;
  if (!key.shift) return PRIMARY_RESERVED_CODES.has(key.code);
  return key.code === "KeyZ" || key.code === "KeyG";
}

export type ShortcutRefusal =
  | { readonly kind: "invalid" }
  | { readonly kind: "reserved" }
  | { readonly kind: "taken"; readonly command: ShortcutCommand };

export function shortcutRefusal(
  command: ShortcutCommand,
  key: ShortcutChord,
  overrides: ShortcutOverrides,
  environment: ShortcutEnvironment,
): ShortcutRefusal | null {
  if (!isValidShortcut(key)) return { kind: "invalid" };
  // The embedded browser forwards the default search chord to the window, so no other command may take it.
  const forwarded = command !== "globalSearch" && sameShortcut(key, defaultShortcut("globalSearch", environment));
  if (forwarded || isReservedShortcut(key, environment) || sameShortcut(key, fixedOpenSettingsChord(environment))) {
    return { kind: "reserved" };
  }
  const owner = SHORTCUT_COMMANDS.find(
    (other) => other !== command && sameShortcut(resolveShortcut(other, overrides, environment), key),
  );
  return owner ? { kind: "taken", command: owner } : null;
}

export function withShortcut(
  overrides: ShortcutOverrides,
  command: ShortcutCommand,
  key: ShortcutChord | null,
): ShortcutOverrides {
  const next: ShortcutOverrides = {};
  for (const name of SHORTCUT_COMMANDS) {
    const value = name === command ? key : overrides[name];
    if (value) next[name] = value;
  }
  return next;
}

export interface ShortcutKeyEvent {
  readonly code: string;
  readonly key?: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly isComposing?: boolean;
}

const CHARACTER_CODES: Readonly<Record<string, string>> = {
  "[": "BracketLeft",
  "]": "BracketRight",
  "/": "Slash",
  "\\": "Backslash",
  ",": "Comma",
  ".": "Period",
  ";": "Semicolon",
  "'": "Quote",
  "`": "Backquote",
  "-": "Minus",
  "=": "Equal",
};

/**
 * The code of the typed character, so a Dvorak or AZERTY user keeps the keys that they know. An
 * autofill keydown has no `key`, so it falls back to the physical code.
 */
export function shortcutCodeOfEvent(event: Pick<ShortcutKeyEvent, "code" | "key">): string {
  const character = event.key ?? "";
  if (/^[a-z]$/i.test(character)) return `Key${character.toUpperCase()}`;
  if (/^[0-9]$/.test(character)) return `Digit${character}`;
  return CHARACTER_CODES[character] ?? (event.code || character);
}

export function shortcutMatches(event: ShortcutKeyEvent, key: ShortcutChord): boolean {
  if (event.isComposing === true || shortcutCodeOfEvent(event) !== key.code) return false;
  return (
    event.ctrlKey === key.ctrl && event.altKey === key.alt && event.shiftKey === key.shift && event.metaKey === key.meta
  );
}

function parseChord(value: unknown): ShortcutChord | null {
  if (typeof value !== "object" || value === null || !("code" in value) || typeof value.code !== "string") return null;
  const key: ShortcutChord = {
    ctrl: "ctrl" in value && value.ctrl === true,
    alt: "alt" in value && value.alt === true,
    shift: "shift" in value && value.shift === true,
    meta: "meta" in value && value.meta === true,
    code: value.code,
  };
  return isValidShortcut(key) ? key : null;
}

/** The stored overrides. Anything that is not a valid chord for a known command is dropped. */
export function parseShortcutOverrides(value: string | null): ShortcutOverrides {
  if (!value) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const overrides: ShortcutOverrides = {};
  for (const [name, entry] of Object.entries(parsed)) {
    const command = SHORTCUT_COMMANDS.find((candidate) => candidate === name);
    const key = command ? parseChord(entry) : null;
    if (command && key) overrides[command] = key;
  }
  return overrides;
}

export function serializeShortcutOverrides(overrides: ShortcutOverrides): string {
  const entries = SHORTCUT_COMMANDS.flatMap((command) => {
    const key = overrides[command];
    return key ? [[command, { ctrl: key.ctrl, alt: key.alt, shift: key.shift, meta: key.meta, code: key.code }]] : [];
  });
  return JSON.stringify(Object.fromEntries(entries));
}

const PUNCTUATION_CAPS: Record<string, string> = {
  BracketLeft: "[",
  BracketRight: "]",
  Slash: "/",
  Backslash: "\\",
  Comma: ",",
  Period: ".",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
};

function keyCap(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return PUNCTUATION_CAPS[code] ?? code;
}

/** The label of a chord: symbols on macOS (`⌘⇧E`), words elsewhere (`Ctrl+Shift+E`). */
export function shortcutText(key: ShortcutChord, platform: ShortcutPlatform): string {
  const mac = platform === "darwin";
  const parts = [
    ...(key.ctrl ? [mac ? "⌃" : "Ctrl"] : []),
    ...(key.alt ? [mac ? "⌥" : "Alt"] : []),
    ...(key.shift ? [mac ? "⇧" : "Shift"] : []),
    ...(key.meta ? [mac ? "⌘" : "Win"] : []),
    keyCap(key.code),
  ];
  return parts.join(mac ? "" : "+");
}
