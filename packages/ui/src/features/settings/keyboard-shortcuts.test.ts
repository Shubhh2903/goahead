import { describe, expect, it } from "vitest";
import {
  defaultShortcut,
  parseShortcutOverrides,
  type ShortcutChord,
  type ShortcutEnvironment,
  serializeShortcutOverrides,
  shortcutMatches,
  shortcutRefusal,
  withShortcut,
} from "./keyboard-shortcuts";

const mac: ShortcutEnvironment = { platform: "darwin", browser: false };

function chord(code: string, modifiers: Partial<Omit<ShortcutChord, "code">> = {}): ShortcutChord {
  return { ctrl: false, alt: false, shift: false, meta: false, code, ...modifiers };
}

describe("shortcut rebinding rules", () => {
  it("refuses a key with no modifier", () => {
    expect(shortcutRefusal("newAgent", chord("KeyJ"), {}, mac)).toEqual({ kind: "invalid" });
  });

  it("refuses a key that the system, chat search or the open-settings shortcut uses", () => {
    expect(shortcutRefusal("newAgent", chord("KeyC", { meta: true }), {}, mac)?.kind).toBe("reserved");
    expect(shortcutRefusal("newAgent", chord("KeyG", { meta: true }), {}, mac)?.kind).toBe("reserved");
    expect(shortcutRefusal("newAgent", chord("Comma", { meta: true }), {}, mac)?.kind).toBe("reserved");
  });

  it("refuses a key that another command uses, and names that command", () => {
    expect(shortcutRefusal("newAgent", defaultShortcut("toggleSidebar", mac), {}, mac)).toEqual({
      kind: "taken",
      command: "toggleSidebar",
    });
  });

  it("keeps the default search key for the search command, because the browser view forwards it", () => {
    const search = defaultShortcut("globalSearch", mac);
    expect(shortcutRefusal("newAgent", search, {}, mac)?.kind).toBe("reserved");
    expect(shortcutRefusal("globalSearch", search, {}, mac)).toBeNull();
  });

  it("frees the key of a rebound command for another command", () => {
    const overrides = withShortcut({}, "toggleSidebar", chord("KeyJ", { meta: true }));
    expect(shortcutRefusal("newAgent", defaultShortcut("toggleSidebar", mac), overrides, mac)).toBeNull();
    expect(shortcutRefusal("showShortcuts", chord("KeyJ", { meta: true }), overrides, mac)?.kind).toBe("taken");
  });
});

describe("shortcut matching and storage", () => {
  const event = (key: string, code: string) => ({
    key,
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: true,
  });

  it("matches the typed character, so another keyboard layout keeps its keys", () => {
    const search = defaultShortcut("globalSearch", mac);
    expect(shortcutMatches(event("k", "KeyV"), search)).toBe(true);
    expect(shortcutMatches(event("j", "KeyK"), search)).toBe(false);
  });

  it("does not match with an extra modifier", () => {
    expect(shortcutMatches({ ...event("k", "KeyK"), shiftKey: true }, defaultShortcut("globalSearch", mac))).toBe(
      false,
    );
  });

  it("round trips overrides and drops bad stored data", () => {
    const overrides = withShortcut({}, "newAgent", chord("KeyJ", { meta: true, shift: true }));
    expect(parseShortcutOverrides(serializeShortcutOverrides(overrides))).toEqual(overrides);
    expect(parseShortcutOverrides("not json")).toEqual({});
    expect(
      parseShortcutOverrides(JSON.stringify({ newAgent: chord("KeyJ"), unknown: chord("KeyJ", { meta: true }) })),
    ).toEqual({});
  });
});
