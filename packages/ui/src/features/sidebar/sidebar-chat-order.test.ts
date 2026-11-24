import { describe, expect, it } from "vitest";
import { parseSidebarChatOrder, sortSidebarChatsByRecent } from "./sidebar-types";

const agent = (id: string, updatedAt?: string | null) => ({ kind: "agent" as const, id, agent: { updatedAt } });
const channel = (id: string, lastMessageAt?: string) => ({
  kind: "channel" as const,
  id,
  channel: { createdAt: "2026-02-01T00:00:00.000Z", lastMessage: lastMessageAt ? { at: lastMessageAt } : null },
});

describe("recent activity order", () => {
  it("puts the newest chat first and a chat with no activity last, in its saved order", () => {
    const chats = [
      agent("quiet-a"),
      agent("old", "2026-01-01T00:00:00.000Z"),
      channel("new-channel", "2026-03-01T00:00:00.000Z"),
      agent("quiet-b", "not a date"),
      channel("empty-channel"),
    ];
    expect(sortSidebarChatsByRecent(chats).map((chat) => chat.id)).toEqual([
      "new-channel",
      "empty-channel",
      "old",
      "quiet-a",
      "quiet-b",
    ]);
    expect(chats[0]?.id).toBe("quiet-a");
  });

  it("reads an unknown saved order as manual", () => {
    expect(parseSidebarChatOrder("recent")).toBe("recent");
    expect(parseSidebarChatOrder("unread-first")).toBe("manual");
    expect(parseSidebarChatOrder(null)).toBe("manual");
  });
});
