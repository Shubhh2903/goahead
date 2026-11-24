import { beforeEach, expect, it, vi } from "vitest";
import { loadChatOrderPreference, saveChatOrderPreference, useChatOrderPreference } from "./chat-order";

// Device storage is the integration boundary.
const native = vi.hoisted((): { stored: string | null; fail: boolean } => ({ stored: null, fail: false }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => native.stored,
  setItemAsync: async (_key: string, value: string) => {
    if (native.fail) throw new Error("Storage unavailable");
    native.stored = value;
  },
}));
beforeEach(() => {
  native.stored = null;
  native.fail = false;
  useChatOrderPreference.setState({ order: "manual", ready: false });
});

it("restores the chosen order after restart and reads an unknown value as manual", async () => {
  await loadChatOrderPreference();
  await saveChatOrderPreference("recent");
  useChatOrderPreference.setState({ order: "manual", ready: false });
  await loadChatOrderPreference();
  expect(useChatOrderPreference.getState().order).toBe("recent");
  native.stored = "unread-first";
  useChatOrderPreference.setState({ order: "recent", ready: false });
  await loadChatOrderPreference();
  expect(useChatOrderPreference.getState().order).toBe("manual");
});

it("keeps the choice for this session when storage fails", async () => {
  await loadChatOrderPreference();
  native.fail = true;
  await saveChatOrderPreference("recent");
  expect(useChatOrderPreference.getState().order).toBe("recent");
});
