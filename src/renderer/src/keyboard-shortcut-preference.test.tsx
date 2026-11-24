import { render } from "@solidjs/web";
import { flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceShortcuts } from "./features/window/workspace-shortcuts";
import {
  KEYBOARD_SHORTCUTS_STORAGE_KEY,
  matchesShortcut,
  resetShortcuts,
  setShortcut,
} from "./keyboard-shortcut-preference";

const mac = navigator.platform.toLowerCase().includes("mac");

function press(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

const primary = mac ? { metaKey: true } : { ctrlKey: true };

afterEach(() => {
  resetShortcuts();
  window.localStorage.clear();
});

describe("keyboard shortcut preference", () => {
  it("saves a rebound shortcut and removes the entry on reset", () => {
    setShortcut("newAgent", { ctrl: !mac, alt: false, shift: false, meta: mac, code: "KeyJ" });
    expect(JSON.parse(window.localStorage.getItem(KEYBOARD_SHORTCUTS_STORAGE_KEY) ?? "{}")).toMatchObject({
      newAgent: { code: "KeyJ" },
    });
    resetShortcuts();
    expect(window.localStorage.getItem(KEYBOARD_SHORTCUTS_STORAGE_KEY)).toBeNull();
  });

  it("runs the action on the rebound key and no longer on the old one", () => {
    const newAgent = vi.fn(() => true);
    const root = document.createElement("div");
    document.body.append(root);
    const dispose = render(() => {
      useWorkspaceShortcuts({ newAgent });
      return null;
    }, root);

    press({ key: "E", code: "KeyE", shiftKey: true, ...primary });
    expect(newAgent).toHaveBeenCalledTimes(1);

    setShortcut("newAgent", { ctrl: !mac, alt: false, shift: false, meta: mac, code: "KeyJ" });
    // A Solid signal write shows to readers after the flush; a real keypress comes later.
    flush();
    press({ key: "E", code: "KeyE", shiftKey: true, ...primary });
    expect(newAgent).toHaveBeenCalledTimes(1);
    const event = press({ key: "j", code: "KeyJ", ...primary });
    expect(newAgent).toHaveBeenCalledTimes(2);
    expect(event.defaultPrevented).toBe(true);
    expect(matchesShortcut(event, "newAgent")).toBe(true);

    dispose();
    root.remove();
  });
});
