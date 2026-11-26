import { expect, it, vi } from "vitest";
import { textFor } from "../../../shared/lib/text-value";
import { type MobileSidebarItem, mobileChatFoldersSupported, mobileSidebarItems } from "./sidebar-layout";

// The root test config has no `@/` alias. English text, as the app shows before the language loads.
vi.mock("@/shared/lib/text", async () => {
  const { textFor } = await import("../../../shared/lib/text-value");
  return { currentText: () => textFor("en") };
});

const { t } = textFor("en");
const folders = {
  revision: 1,
  sections: [
    { id: "work", name: "Work" },
    { id: "product", name: "Product", parentId: "work" },
  ],
  order: ["people", "unassigned", "work", "product"],
  agentAssignments: { launch: "product", plans: "product" },
  agentOrder: [],
};
const released = { ...folders, sections: folders.sections.map(({ id, name }) => ({ id, name })) };
const sectionNames = (items: MobileSidebarItem[]) =>
  items.flatMap((item) => (item.kind === "section" ? [item.name] : []));

it("shows the flat list when the host has no chat folders", () => {
  expect(mobileChatFoldersSupported(["sidebar-layout"])).toBe(false);
  expect(mobileChatFoldersSupported(undefined)).toBe(false);
  expect(sectionNames(mobileSidebarItems(released, [], [], new Set(), t))).toEqual(["Work", "Product"]);
});

it("reads the chat-folders route only from a GoAhead v0.40-v0.41 host", () => {
  expect(mobileChatFoldersSupported(["sidebar-layout", "chat-folders-v1"])).toBe(true);
  expect(mobileChatFoldersSupported(["sidebar-layout", "chat-folders-v1", "sidebar-folders-v1"])).toBe(false);
  expect(sectionNames(mobileSidebarItems(folders, [], [], new Set(), t))).toEqual(["Work", "Work / Product"]);
  expect(sectionNames(mobileSidebarItems(folders, [], [], new Set(["work"]), t))).toEqual(["Work"]);
});
