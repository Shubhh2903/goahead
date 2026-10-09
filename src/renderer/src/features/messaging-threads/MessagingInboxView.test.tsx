import type { MessagingInboxPage, MessagingInboxWorkspace } from "@openbot/contracts/ipc";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { App } from "../../App";
import { installOpenbotStub } from "../../app-test-harness";
import { AccountDock } from "../../lazy-views";

// The App loads the account dock lazily; load it first so no import runs after the test environment closes.
beforeAll(async () => {
  await AccountDock.preload();
});

const workspaces: MessagingInboxWorkspace[] = [
  {
    workspaceId: "T1",
    workspaceName: "Acme",
    agentId: "chief",
    conversations: ["D1", "D2"].map((conversation, index) => ({
      conversation,
      kind: "direct",
      place: index === 0 ? "Ana" : "Ben",
      unreadCount: 0,
      latestAt: "2026-10-09T10:00:00.000Z",
      latestFrom: index === 0 ? "Ana" : "Ben",
      preview: index === 0 ? "Lunch at noon?" : "Report is ready",
    })),
  },
];

function page(conversation: string, text: string): MessagingInboxPage {
  return {
    workspaceId: "T1",
    conversation,
    place: conversation === "D1" ? "Ana" : "Ben",
    messages: [
      { id: `${conversation}-1`, from: "Ana", isOwn: false, text, sentAt: "2026-10-09T10:00:00.000Z", thread: null },
    ],
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  installOpenbotStub();
  Object.assign(window.openbot.messaging, {
    listThreads: vi.fn().mockResolvedValue([]),
    listDrafts: vi.fn().mockResolvedValue([]),
    listInbox: vi.fn().mockResolvedValue(workspaces),
  });
});

async function openInbox() {
  render(() => <App />);
  await fireEvent.click(await screen.findByRole("button", { name: "Slack inbox" }));
  return screen.findByRole("region", { name: "Messages" });
}

it("opening another conversation keeps the current messages until the new ones arrive", async () => {
  const second = deferred<MessagingInboxPage>();
  const read = vi.fn().mockResolvedValueOnce(page("D1", "Lunch at noon?")).mockReturnValueOnce(second.promise);
  window.openbot.messaging.readInboxConversation = read;
  const messages = await openInbox();

  await fireEvent.click(screen.getByRole("button", { name: /^Ana\./ }));
  await within(messages).findByText("Lunch at noon?");
  await fireEvent.click(screen.getByRole("button", { name: /^Ben\./ }));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));

  expect(within(messages).getByText("Lunch at noon?")).toBeInTheDocument();
  second.resolve(page("D2", "Report is ready"));
  await within(messages).findByText("Report is ready");
  expect(within(messages).queryByText("Lunch at noon?")).not.toBeInTheDocument();
});

it("a sent reply shows at once", async () => {
  const sent = deferred<undefined>();
  const send = vi.fn().mockReturnValue(sent.promise);
  window.openbot.messaging.readInboxConversation = vi.fn().mockResolvedValue(page("D1", "Lunch at noon?"));
  window.openbot.messaging.sendInboxReply = send;
  const messages = await openInbox();

  await fireEvent.click(screen.getByRole("button", { name: /^Ana\./ }));
  await within(messages).findByText("Lunch at noon?");
  const box = screen.getByRole("textbox", { name: "Reply as you" });
  await fireEvent.input(box, { target: { value: "On my way" } });
  await fireEvent.click(screen.getByRole("button", { name: "Send" }));

  await waitFor(() => expect(send).toHaveBeenCalled());
  expect(within(messages).getByText("On my way")).toBeInTheDocument();
  expect(box).toHaveValue("");
  sent.resolve(undefined);
});

it("an inbox message shows names, emoji and an image", async () => {
  const open = vi.fn().mockResolvedValue(undefined);
  window.openbot.openUrl = open;
  const text = "<@U083KAUM7TK> :tada: :clapclap-e: in <#C1ABCDEFG|> see <https://example.com|the plan> *now*";
  const base = page("D1", text);
  window.openbot.messaging.readInboxConversation = vi.fn().mockResolvedValue({
    ...base,
    people: { U083KAUM7TK: "Dana Lee" },
    channels: { C1ABCDEFG: "launch" },
    customEmoji: { "clapclap-e": "https://emoji.slack-edge.com/T1/clapclap-e/abc.gif" },
    messages: base.messages.map((message) => ({
      ...message,
      files: [
        {
          id: "F1",
          name: "photo.png",
          mimeType: "image/png",
          size: 2048,
          previewUrl: "openbot-attachment://slack/T1/F1",
          permalink: "https://acme.slack.com/files/U1/F1/photo.png",
        },
      ],
    })),
  } satisfies MessagingInboxPage);
  const messages = await openInbox();

  await fireEvent.click(screen.getByRole("button", { name: /^Ana\./ }));
  expect(await within(messages).findByText("@Dana Lee")).toBeInTheDocument();
  expect(within(messages).getByText("#launch")).toBeInTheDocument();
  expect(within(messages).getByRole("img", { name: "tada" })).toHaveTextContent("🎉");
  expect(within(messages).getByAltText(":clapclap-e:")).toHaveAttribute(
    "src",
    "https://emoji.slack-edge.com/T1/clapclap-e/abc.gif",
  );
  expect(within(messages).getByAltText("photo.png")).toHaveAttribute("src", "openbot-attachment://slack/T1/F1");

  await fireEvent.click(within(messages).getByRole("link", { name: "the plan" }));
  await waitFor(() => expect(open).toHaveBeenCalledWith("https://example.com"));
});
