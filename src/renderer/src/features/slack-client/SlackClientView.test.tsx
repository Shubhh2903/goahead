import type {
  MessagingInboxWorkspace,
  SlackClientConversation,
  SlackClientMessage,
  SlackClientPage,
  SlackClientThread,
} from "@openbot/contracts/ipc";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "../../App";
import { installOpenbotStub } from "../../app-test-harness";

const workspaces: MessagingInboxWorkspace[] = [
  { workspaceId: "T1", workspaceName: "Acme", agentId: "chief", conversations: [] },
];

const conversations: SlackClientConversation[] = [
  {
    workspaceId: "T1",
    channelId: "C1",
    kind: "channel",
    name: "general",
    memberIds: [],
    unreadCount: 0,
    lastActivityTs: "1760000000.000100",
    isMember: true,
  },
];

function message(ts: string, text: string, extra: Partial<SlackClientMessage> = {}): SlackClientMessage {
  return {
    ts,
    threadTs: null,
    replyCount: 0,
    latestReplyTs: null,
    authorId: "U1",
    text,
    files: [],
    reactions: [],
    editedAt: null,
    deleted: false,
    mine: false,
    ...extra,
  };
}

const parent = message("1760000000.000100", "Why did the deploy fail?", {
  threadTs: "1760000000.000100",
  replyCount: 1,
  latestReplyTs: "1760000001.000100",
});

const page: SlackClientPage = {
  workspaceId: "T1",
  channelId: "C1",
  messages: [parent],
  hasOlder: false,
  people: { U1: "Ana" },
  channels: {},
  customEmoji: {},
  offline: false,
};

const thread: SlackClientThread = {
  workspaceId: "T1",
  channelId: "C1",
  parent,
  replies: [message("1760000001.000100", "The token expired.", { threadTs: parent.ts })],
  people: { U1: "Ana" },
  channels: {},
  customEmoji: {},
};

beforeEach(() => {
  installOpenbotStub();
  Object.assign(window.openbot.messaging, {
    listThreads: vi.fn().mockResolvedValue([]),
    listDrafts: vi.fn().mockResolvedValue([]),
    listInbox: vi.fn().mockResolvedValue(workspaces),
  });
  Object.assign(window.openbot.slackClient, {
    listConversations: vi.fn().mockResolvedValue(conversations),
    open: vi.fn().mockResolvedValue(page),
    thread: vi.fn().mockResolvedValue(thread),
    onChanged: vi.fn(() => () => undefined),
  });
});

it("opens the Slack client with three panes", async () => {
  render(() => <App />);
  await fireEvent.click(await screen.findByRole("button", { name: "Slack inbox" }));

  const view = await screen.findByRole("main", { name: "Slack inbox" });
  const list = await within(view).findByRole("navigation", { name: "Inbox conversations" });
  await fireEvent.click(await within(list).findByRole("button", { name: /general/ }));
  const messages = within(view).getByRole("region", { name: "Messages" });
  await within(messages).findByText("Why did the deploy fail?");
  expect(window.openbot.slackClient.open).toHaveBeenCalledWith({ workspaceId: "T1", channelId: "C1" });

  await fireEvent.click(within(messages).getByRole("button", { name: "1 reply" }));
  const panel = await within(view).findByRole("complementary", { name: "Thread" });
  await within(panel).findByText("The token expired.");
  await waitFor(() =>
    expect(window.openbot.slackClient.thread).toHaveBeenCalledWith({
      workspaceId: "T1",
      channelId: "C1",
      threadTs: parent.ts,
    }),
  );
});

it("gives @chief text to the Slack Orchestrator and does not send it to Slack", async () => {
  const send = vi.fn().mockResolvedValue(undefined);
  const ask = vi.fn().mockResolvedValue({ agentId: "chief" });
  Object.assign(window.openbot.slackClient, { send });
  Object.assign(window.openbot.messaging, { askOrchestratorAboutInbox: ask });
  render(() => <App />);
  await fireEvent.click(await screen.findByRole("button", { name: "Slack inbox" }));

  const view = await screen.findByRole("main", { name: "Slack inbox" });
  const list = await within(view).findByRole("navigation", { name: "Inbox conversations" });
  await fireEvent.click(await within(list).findByRole("button", { name: /general/ }));
  const messages = within(view).getByRole("region", { name: "Messages" });
  const box = await within(messages).findByRole("textbox", { name: "Reply as you" });
  await fireEvent.input(box, { target: { value: "@chief draft an answer" } });
  await fireEvent.click(within(messages).getByRole("button", { name: "Ask Chief" }));

  await waitFor(() =>
    expect(ask).toHaveBeenCalledWith({ workspaceId: "T1", conversation: "C1", text: "@chief draft an answer" }),
  );
  expect(send).not.toHaveBeenCalled();
});

it("a live message in the open DM shows after the change event", async () => {
  const dm: SlackClientConversation = {
    workspaceId: "T1",
    channelId: "D1",
    kind: "im",
    name: "Preet",
    memberIds: ["U1"],
    unreadCount: 0,
    lastActivityTs: "1760000000.000100",
    isMember: true,
  };
  const empty: SlackClientPage = { ...page, channelId: "D1", messages: [] };
  const fresh: SlackClientPage = { ...empty, messages: [message("1760000009.000100", "Are you there?")] };
  const open = vi.fn().mockResolvedValueOnce(empty).mockResolvedValue(fresh);
  let changed: (change: { workspaceId: string; channelId: string | null }) => void = () => undefined;
  Object.assign(window.openbot.slackClient, {
    listConversations: vi.fn().mockResolvedValue([dm]),
    open,
    onChanged: vi.fn((listener: typeof changed) => {
      changed = listener;
      return () => undefined;
    }),
  });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  render(() => <App />);
  await fireEvent.click(await screen.findByRole("button", { name: "Slack inbox" }));

  const view = await screen.findByRole("main", { name: "Slack inbox" });
  const list = await within(view).findByRole("navigation", { name: "Inbox conversations" });
  await fireEvent.click(await within(list).findByRole("button", { name: /Preet/ }));
  await waitFor(() => expect(open).toHaveBeenCalledTimes(1));

  changed({ workspaceId: "T1", channelId: "D1" });
  const messages = within(view).getByRole("region", { name: "Messages" });
  await within(messages).findByText("Are you there?");
});
