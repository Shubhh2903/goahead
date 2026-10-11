import type {
  MessagingInboxWorkspace,
  SlackClientConversation,
  SlackClientMessage,
  SlackClientPage,
} from "@openbot/contracts/ipc";
import { SlackMessagePane, type SlackMessagePaneProps } from "@openbot/ui/features/slack-client/SlackMessagePane";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { App } from "../../App";
import { installOpenbotStub } from "../../app-test-harness";

const conversation: SlackClientConversation = {
  workspaceId: "T1",
  channelId: "C1",
  kind: "channel",
  name: "general",
  memberIds: [],
  unreadCount: 0,
  lastActivityTs: "1760000001.000100",
  isMember: true,
};

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

function renderPane(overrides: Partial<SlackMessagePaneProps> = {}) {
  const props: SlackMessagePaneProps = {
    conversation,
    messages: [
      message("1760000000.000100", "Ana wrote this", { authorId: "U1" }),
      message("1760000001.000100", "I wrote this", { authorId: "U2", mine: true }),
    ],
    lookups: { people: { U1: "Ana", U2: "Me" }, channels: {}, customEmoji: {} },
    hasOlder: false,
    offline: false,
    loading: false,
    loadingOlder: false,
    failed: false,
    onRetry: vi.fn(),
    onLoadOlder: vi.fn(),
    onOpenThread: vi.fn(),
    onEdit: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onReact: vi.fn().mockResolvedValue(undefined),
    onOpenLink: vi.fn(),
    autoReply: false,
    onAutoReplyChange: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(() => <SlackMessagePane {...props} />);
  return props;
}

it("Edit and Delete show only on my messages", async () => {
  const props = renderPane();

  const theirs = screen.getByRole("article", { name: /Ana/ });
  expect(within(theirs).queryByRole("button", { name: "Edit" })).toBeNull();
  expect(within(theirs).queryByRole("button", { name: "Delete" })).toBeNull();

  const mine = screen.getByRole("article", { name: /Me/ });
  await fireEvent.click(within(mine).getByRole("button", { name: "Edit" }));
  const box = within(mine).getByRole("textbox", { name: "Edit" });
  await fireEvent.input(box, { target: { value: "I fixed this" } });
  await fireEvent.click(within(mine).getByRole("button", { name: "Save" }));
  expect(props.onEdit).toHaveBeenCalledWith("1760000001.000100", "I fixed this");

  await fireEvent.click(within(mine).getByRole("button", { name: "Delete" }));
  const dialog = await screen.findByRole("alertdialog", { name: "Delete this message?" });
  expect(props.onDelete).not.toHaveBeenCalled();
  await fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith("1760000001.000100"));
});

it("reaching the top loads older messages", async () => {
  const props = renderPane({ hasOlder: true });
  const log = screen.getByRole("log");
  Object.defineProperty(log, "scrollHeight", { configurable: true, value: 2000 });
  Object.defineProperty(log, "clientHeight", { configurable: true, value: 400 });

  log.scrollTop = 1600;
  await fireEvent.scroll(log);
  expect(props.onLoadOlder).not.toHaveBeenCalled();

  log.scrollTop = 0;
  await fireEvent.scroll(log);
  expect(props.onLoadOlder).toHaveBeenCalledTimes(1);
});

it("a refused reaction rolls back", async () => {
  const workspaces: MessagingInboxWorkspace[] = [
    { workspaceId: "T1", workspaceName: "Acme", agentId: "chief", conversations: [] },
  ];
  const page: SlackClientPage = {
    workspaceId: "T1",
    channelId: "C1",
    messages: [message("1760000000.000100", "Ship it?", { reactions: [{ name: "thumbsup", count: 1, mine: false }] })],
    hasOlder: false,
    people: { U1: "Ana" },
    channels: {},
    customEmoji: {},
    offline: false,
  };
  let refuse: (error: Error) => void = () => undefined;
  const react = vi.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        refuse = reject;
      }),
  );
  installOpenbotStub();
  Object.assign(window.openbot.messaging, {
    listThreads: vi.fn().mockResolvedValue([]),
    listDrafts: vi.fn().mockResolvedValue([]),
    listInbox: vi.fn().mockResolvedValue(workspaces),
  });
  Object.assign(window.openbot.slackClient, {
    listConversations: vi.fn().mockResolvedValue([conversation]),
    open: vi.fn().mockResolvedValue(page),
    react,
    onChanged: vi.fn(() => () => undefined),
  });
  render(() => <App />);
  await fireEvent.click(await screen.findByRole("button", { name: "Slack inbox" }));
  const view = await screen.findByRole("main", { name: "Slack inbox" });
  const list = await within(view).findByRole("navigation", { name: "Inbox conversations" });
  await fireEvent.click(await within(list).findByRole("button", { name: /general/ }));
  const messages = within(view).getByRole("region", { name: "Messages" });
  await within(messages).findByText("Ship it?");

  await fireEvent.click(within(messages).getByRole("button", { name: ":thumbsup: 1" }));
  const added = await within(messages).findByRole("button", { name: ":thumbsup: 2" });
  expect(added).toHaveAttribute("aria-pressed", "true");
  expect(react).toHaveBeenCalledWith({
    workspaceId: "T1",
    channelId: "C1",
    ts: "1760000000.000100",
    name: "thumbsup",
    on: true,
  });

  refuse(new Error("Slack refused the reaction."));
  const restored = await within(messages).findByRole("button", { name: ":thumbsup: 1" });
  expect(restored).toHaveAttribute("aria-pressed", "false");
  expect(await within(view).findByRole("alert")).toBeInTheDocument();
});
