import { describe, expect, it } from "vitest";
import { CHAT_FOLDERS_CAPABILITY, CHAT_FOLDERS_ROUTES, decodeChatFoldersLayout } from "./chat-folders-v1";
import { TEAM_CURRENT_CAPABILITIES } from "./current";
import { optionalRouteCodec } from "./optional-routes";

const layout = {
  revision: 4,
  sections: [
    { id: "work", name: "Work" },
    { id: "product", name: "Product", parentId: "work" },
  ],
  order: ["people", "unassigned", "work", "product"],
  agentAssignments: { chief: "product" },
  agentOrder: ["chief"],
};

describe("chat-folders-v1", () => {
  it("is a current capability with a read route that keeps the folder parents", () => {
    expect(TEAM_CURRENT_CAPABILITIES).toContain(CHAT_FOLDERS_CAPABILITY);
    const codec = optionalRouteCodec(CHAT_FOLDERS_ROUTES.read);
    if (!codec) throw new Error("No chat folders codec.");
    expect(codec.request({})).toEqual({});
    expect(codec.response(200, { ...layout, extra: true })).toEqual(layout);
    expect(decodeChatFoldersLayout(layout)).toEqual(layout);
  });

  it("rejects a layout that breaks the wire bounds or the layout rules", () => {
    expect(() => decodeChatFoldersLayout({ ...layout, sections: [{ id: "work", name: "" }] })).toThrow();
    expect(() => decodeChatFoldersLayout({ ...layout, sections: [{ id: "work", name: "x".repeat(41) }] })).toThrow();
    expect(() => decodeChatFoldersLayout({ ...layout, order: ["people", "work"] })).toThrow();
  });
});
