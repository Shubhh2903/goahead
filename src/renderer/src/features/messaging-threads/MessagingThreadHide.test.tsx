import type { MessagingThreadSummary } from "@openbot/contracts/ipc";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "../../App";
import { installOpenbotStub } from "../../app-test-harness";

function thread(threadId: string, title: string): MessagingThreadSummary {
  return {
    threadId,
    agentId: "chief",
    workspaceId: "T1",
    platform: "slack",
    title,
    preview: null,
    isDirect: true,
    updatedAt: "2026-10-09T10:00:00.000Z",
    unreadCount: 0,
    pendingDrafts: 0,
  };
}

let threads: MessagingThreadSummary[] = [];

beforeEach(() => {
  installOpenbotStub();
  threads = [thread("thread-ana", "Ana"), thread("thread-ben", "Ben")];
  Object.assign(window.openbot.messaging, {
    listThreads: vi.fn(async () => threads),
    listDrafts: vi.fn().mockResolvedValue([]),
    listInbox: vi.fn().mockResolvedValue([]),
    hideThreads: vi.fn(async ({ threadIds }: { threadIds: string[] }) => {
      threads = threads.filter((candidate) => !threadIds.includes(candidate.threadId));
    }),
  });
});

it("Clear history hides all rows after confirm", async () => {
  render(() => <App />);
  await screen.findByRole("button", { name: "Ana, Slack conversation" });
  const [chief] = screen.getAllByRole("button", { name: /^Chief, Chief of staff/ });
  if (!chief) throw new Error("The sidebar has no Chief row.");

  await fireEvent.contextMenu(chief);
  await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "Clear history" }), { button: 0 });
  await screen.findByRole("alertdialog", { name: "Clear Slack history?" });
  // Nothing is hidden before the person confirms.
  expect(window.openbot.messaging.hideThreads).not.toHaveBeenCalled();
  await fireEvent.click(screen.getByRole("button", { name: "Clear" }));

  await waitFor(() =>
    expect(window.openbot.messaging.hideThreads).toHaveBeenCalledWith({ threadIds: ["thread-ana", "thread-ben"] }),
  );
  await waitFor(() => expect(screen.queryByRole("button", { name: "Ana, Slack conversation" })).toBeNull());
  expect(screen.queryByRole("button", { name: "Ben, Slack conversation" })).toBeNull();
});
