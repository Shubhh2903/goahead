import { beforeEach, expect, it, vi } from "vitest";
import { loadChatOrderPreference, saveChatOrderPreference, useChatOrderPreference } from "./chat-order";

// Device storage is the integration boundary.
const native = vi.hoisted(() => ({ stored: new Map<string, string>() }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => native.stored.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    native.stored.set(key, value);
  },
}));
// The root test config has no `@/` alias, so the app modules load through their relative paths.
vi.mock("@/features/workspace/model/sidebar-layout", () => import("../../workspace/model/sidebar-layout"));
vi.mock("@/shared/lib/writes-in-order", () => import("../../../shared/lib/writes-in-order"));
vi.mock("@/shared/lib/text", async () => {
  const { textFor } = await import("../../../shared/lib/text-value");
  return { currentText: () => textFor("en") };
});
beforeEach(() => {
  native.stored.clear();
  useChatOrderPreference.setState({ order: "unread-group", ready: false });
});

it("restores the chosen order after restart", async () => {
  await loadChatOrderPreference();
  await saveChatOrderPreference("recent");
  useChatOrderPreference.setState({ order: "unread-group", ready: false });
  await loadChatOrderPreference();
  expect(useChatOrderPreference.getState().order).toBe("recent");
});

it("keeps the order that GoAhead v0.41 saved, and the new key wins after a save", async () => {
  native.stored.set("goahead.mobile.chat-order.v1", "manual");
  await loadChatOrderPreference();
  expect(useChatOrderPreference.getState().order).toBe("manual");
  await saveChatOrderPreference("unread-first");
  useChatOrderPreference.setState({ order: "unread-group", ready: false });
  await loadChatOrderPreference();
  expect(useChatOrderPreference.getState().order).toBe("unread-first");
});
