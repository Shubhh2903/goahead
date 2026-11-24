import {
  type ChannelSummary,
  SIDEBAR_PEOPLE_SECTION_ID,
  SIDEBAR_UNASSIGNED_SECTION_ID,
  sidebarFolderParents,
} from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import type { AgentProfile } from "../../data";
import { agentMatchesQuery, channelMatchesQuery } from "./sidebar-filtering";
import { groupSidebarChatsBySection, sidebarFolderTree } from "./sidebar-folders";
import {
  SIDEBAR_NO_LIST_FILTER,
  sidebarChatMatchesFilter,
  sidebarKnownFolders,
  sidebarToggleFolder,
} from "./sidebar-list-filter";
import { sortSidebarChatsByRecent } from "./sidebar-types";

const agentProfile = (preview: string): AgentProfile => ({
  id: "chief",
  name: "Chief",
  title: "Chief of staff",
  description: "Coordinates work",
  notifications: true,
  provider: "codex",
  model: "gpt-5.6-luna",
  reasoningEffort: "medium",
  threadId: null,
  avatarSeed: "chief",
  avatarHue: null,
  avatarUrl: null,
  time: "",
  preview,
});

const channelSummary = (text: string | null): ChannelSummary => ({
  id: "launch",
  name: "launch",
  title: "Launch room",
  instructions: "",
  members: [],
  leadAgentId: null,
  archived: false,
  revision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  unreadCount: 0,
  activeTasks: 0,
  lastMessage: text === null ? null : { authorName: "Chief", text, at: "2026-01-02T00:00:00.000Z" },
});

describe("sidebar text filter", () => {
  it("matches an agent by name and by its last message", () => {
    const agent = agentProfile("The invoice is ready");
    expect(agentMatchesQuery(agent, "chief")).toBe(true);
    expect(agentMatchesQuery(agent, "invoice")).toBe(true);
    expect(agentMatchesQuery(agent, "payroll")).toBe(false);
  });

  it("matches a channel by name and by its last message", () => {
    expect(channelMatchesQuery(channelSummary("Ship on Friday"), "launch")).toBe(true);
    expect(channelMatchesQuery(channelSummary("Ship on Friday"), "friday")).toBe(true);
    expect(channelMatchesQuery(channelSummary(null), "friday")).toBe(false);
  });
});

describe("sidebar filter menu", () => {
  const chat = { kind: "agent" as const, folder: "work", unread: false, working: true };

  it("filters by kind, by state and by folder", () => {
    expect(sidebarChatMatchesFilter(chat, SIDEBAR_NO_LIST_FILTER)).toBe(true);
    expect(sidebarChatMatchesFilter(chat, { ...SIDEBAR_NO_LIST_FILTER, show: "channels" })).toBe(false);
    expect(sidebarChatMatchesFilter(chat, { ...SIDEBAR_NO_LIST_FILTER, unread: true })).toBe(false);
    expect(sidebarChatMatchesFilter(chat, { ...SIDEBAR_NO_LIST_FILTER, unread: true, working: true })).toBe(true);
    expect(sidebarChatMatchesFilter(chat, { ...SIDEBAR_NO_LIST_FILTER, folders: ["home"] })).toBe(false);
  });

  it("selects a folder with the folders in it, and drops a folder that is gone", () => {
    const layout = {
      sections: [
        { id: "work", name: "Work" },
        { id: "product", name: "Product", parentId: "work" },
        { id: "home", name: "Home" },
      ],
      order: [SIDEBAR_PEOPLE_SECTION_ID, SIDEBAR_UNASSIGNED_SECTION_ID, "work", "product", "home"],
    };
    const roots = sidebarFolderTree(layout, sidebarFolderParents(layout));
    const work = roots.find((node) => node.id === "work");
    if (!work) throw new Error("The tree has no Work folder.");
    expect(work.children.map((node) => node.id)).toEqual(["product"]);
    expect(sidebarToggleFolder(work, roots, [])).toEqual(["work", "product"]);
    expect(sidebarKnownFolders(roots, ["product", "deleted"])).toEqual(["product"]);
  });
});

describe("recent activity inside a folder", () => {
  it("shows the chats of each folder by last activity", () => {
    const agent = (id: string, updatedAt: string) => ({ kind: "agent" as const, id, agent: { updatedAt } });
    const chats = [
      agent("old-work", "2026-01-01T00:00:00.000Z"),
      agent("home", "2026-01-02T00:00:00.000Z"),
      agent("new-work", "2026-01-03T00:00:00.000Z"),
      agent("loose", "2026-01-04T00:00:00.000Z"),
    ];
    const layout = {
      sections: [
        { id: "work", name: "Work" },
        { id: "home-folder", name: "Home", parentId: "work" },
      ],
      order: [SIDEBAR_PEOPLE_SECTION_ID, SIDEBAR_UNASSIGNED_SECTION_ID, "work", "home-folder"],
      agentAssignments: { "old-work": "work", "new-work": "work", home: "home-folder" },
    };
    const groups = groupSidebarChatsBySection(sortSidebarChatsByRecent(chats), layout);
    expect(groups.get("work")?.map((item) => item.id)).toEqual(["new-work", "old-work"]);
    expect(groups.get("home-folder")?.map((item) => item.id)).toEqual(["home"]);
    expect(groups.get(SIDEBAR_UNASSIGNED_SECTION_ID)?.map((item) => item.id)).toEqual(["loose"]);
  });
});
