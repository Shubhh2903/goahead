import type { ChannelSummary } from "@openbot/contracts/ipc";
import { expect, it } from "vitest";
import { textFor } from "../../../shared/lib/text-value";
import {
  type MobileSidebarItem,
  mobileChatFoldersSupported,
  mobileSidebarItems,
  sortMobileChatsByRecent,
} from "./sidebar-layout";
import type { MobileAgent } from "./workspace-types";

const agent = (id: string, updatedAt: string | null) => ({ kind: "agent" as const, id, agent: { updatedAt } });
const channel = (id: string, at: string | null) => ({
  kind: "channel" as const,
  id,
  channel: { createdAt: "2026-01-01T00:00:00.000Z", lastMessage: at ? { at } : null },
});

it("shows the newest chat first and keeps the saved order for chats with no activity", () => {
  const chats = [
    agent("quiet-a", null),
    agent("old", "2026-01-02T00:00:00.000Z"),
    channel("talk", "2026-03-01T00:00:00.000Z"),
    agent("new", "2026-02-01T00:00:00.000Z"),
    agent("quiet-b", "not a date"),
  ];
  expect(sortMobileChatsByRecent(chats).map((chat) => chat.id)).toEqual(["talk", "new", "old", "quiet-a", "quiet-b"]);
  expect(chats.map((chat) => chat.id)[0]).toBe("quiet-a");
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
const summary = (id: string, at: string): ChannelSummary => ({
  id,
  name: id,
  title: "",
  instructions: "",
  members: [],
  leadAgentId: null,
  archived: false,
  revision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  unreadCount: 0,
  activeTasks: 0,
  lastMessage: { authorName: "Chief", text: "Hello", at },
});
const sectionNames = (items: MobileSidebarItem[]) =>
  items.flatMap((item) => (item.kind === "section" ? [item.name] : []));

it("shows the flat list when the host has no chat folders", () => {
  expect(mobileChatFoldersSupported(["sidebar-layout"])).toBe(false);
  expect(mobileChatFoldersSupported(undefined)).toBe(false);
  expect(sectionNames(mobileSidebarItems(released, [], [], new Set(), t))).toEqual(["Work", "Product"]);
});

it("shows each folder with its path when the host has chat folders", () => {
  expect(mobileChatFoldersSupported(["sidebar-layout", "chat-folders-v1"])).toBe(true);
  expect(sectionNames(mobileSidebarItems(folders, [], [], new Set(), t))).toEqual(["Work", "Work / Product"]);
  expect(sectionNames(mobileSidebarItems(folders, [], [], new Set(["work"]), t))).toEqual(["Work"]);
});

const mobileAgent = (id: string, updatedAt: string | null): MobileAgent => ({
  id,
  serverId: "host",
  name: id,
  title: "",
  description: "",
  preview: "",
  updatedLabel: "",
  updatedAt,
  avatarSeed: id,
  avatarHue: null,
});

it("shows the chats of a folder by recent activity", () => {
  const channels = [summary("plans", "2026-01-02T00:00:00.000Z"), summary("launch", "2026-01-03T00:00:00.000Z")];
  const layout = { ...folders, agentAssignments: { ...folders.agentAssignments, chief: "product" } };
  const agents = [mobileAgent("chief", "2026-01-04T00:00:00.000Z")];
  const items = mobileSidebarItems(layout, agents, channels, new Set(), t, "recent");
  expect(items.map((item) => item.id)).toEqual(["work", "product", "chief", "launch", "plans"]);
});

it("sorts the top-level agents by recent activity", () => {
  const agents = [mobileAgent("old", "2026-01-01T00:00:00.000Z"), mobileAgent("new", "2026-01-05T00:00:00.000Z")];
  const items = mobileSidebarItems(null, agents, [], new Set(), t, "recent");
  expect(items.map((item) => item.id)).toEqual(["new", "old"]);
});
