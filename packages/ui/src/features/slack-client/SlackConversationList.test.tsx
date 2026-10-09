import type { SlackClientConversation } from "@openbot/contracts/ipc";
import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import { SlackConversationList } from "./SlackConversationList";

function conversation(channelId: string, extra: Partial<SlackClientConversation> = {}): SlackClientConversation {
  return {
    workspaceId: "T1",
    channelId,
    kind: "channel",
    name: channelId.toLowerCase(),
    memberIds: [],
    unreadCount: 0,
    lastActivityTs: "1760000000.000100",
    isMember: true,
    ...extra,
  };
}

const conversations: SlackClientConversation[] = [
  conversation("C1", { name: "general" }),
  conversation("C2", { name: "deploys", unreadCount: 3 }),
  conversation("C3", { name: "design", kind: "private" }),
  conversation("D1", { name: "Ana", kind: "im", memberIds: ["U1"] }),
];

function renderList() {
  return render(() => (
    <SlackConversationList
      conversations={conversations}
      workspaces={[{ workspaceId: "T1", workspaceName: "Acme" }]}
      activeKey={null}
      onSelect={() => undefined}
    />
  ));
}

it("search filters conversations", () => {
  renderList();
  fireEvent.input(screen.getByRole("searchbox", { name: "Find a conversation" }), { target: { value: "DE" } });

  expect(screen.getByRole("button", { name: /^deploys/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /^design/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^general/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Ana/ })).toBeNull();
  expect(screen.queryByRole("list", { name: "Direct messages" })).toBeNull();
});

it("unread conversations are listed under Unreads", () => {
  renderList();

  const unreads = screen.getByRole("list", { name: "Unreads" });
  expect(within(unreads).getByRole("button", { name: "deploys. 3 unread" })).toBeTruthy();
  expect(within(unreads).queryByRole("button", { name: /^general/ })).toBeNull();

  const channels = screen.getByRole("list", { name: "Channels" });
  expect(
    within(channels)
      .getAllByRole("button")
      .map((row) => row.getAttribute("aria-label")),
  ).toEqual(["design", "general"]);
  const direct = screen.getByRole("list", { name: "Direct messages" });
  expect(within(direct).getByRole("button", { name: "Ana" })).toBeTruthy();
});

it("each section lists the most recent activity first, with group DMs under Direct messages", () => {
  render(() => (
    <SlackConversationList
      conversations={[
        conversation("C1", { name: "alpha", lastActivityTs: "1760000000.000100" }),
        conversation("C2", { name: "zulu", lastActivityTs: "1760000900.000100" }),
        conversation("C3", { name: "mid", lastActivityTs: null }),
        conversation("D1", { name: "Ana", kind: "im", lastActivityTs: "1760000100.000100" }),
        conversation("G1", { name: "Bob, Cy", kind: "mpim", lastActivityTs: "1760000500.000100" }),
      ]}
      workspaces={[{ workspaceId: "T1", workspaceName: "Acme" }]}
      activeKey={null}
      onSelect={() => undefined}
    />
  ));

  const labels = (name: string) =>
    within(screen.getByRole("list", { name }))
      .getAllByRole("button")
      .map((row) => row.getAttribute("aria-label"));
  expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["Channels", "Direct messages"]);
  expect(labels("Channels")).toEqual(["zulu", "alpha", "mid"]);
  expect(labels("Direct messages")).toEqual(["Bob, Cy", "Ana"]);
});
