import type { SlackClientMessage } from "@openbot/contracts/ipc";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { SlackComposer } from "./SlackComposer";
import { SlackThreadPanel } from "./SlackThreadPanel";
import type { SlackComposerActions } from "./slack-client-types";

function actions(extra: Partial<SlackComposerActions> = {}): SlackComposerActions {
  return {
    onSend: vi.fn().mockResolvedValue(undefined),
    onAsk: vi.fn().mockResolvedValue(undefined),
    onMentionSearch: vi.fn().mockResolvedValue([]),
    onAttach: vi.fn().mockResolvedValue(undefined),
    onDropFile: vi.fn().mockResolvedValue(undefined),
    ...extra,
  };
}

function message(ts: string, text: string): SlackClientMessage {
  return {
    ts,
    threadTs: "1760000000.000100",
    replyCount: 0,
    latestReplyTs: null,
    authorId: "U1",
    text,
    files: [],
    reactions: [],
    editedAt: null,
    deleted: false,
    mine: false,
  };
}

it("@mention picker inserts a mention", async () => {
  const composer = actions({ onMentionSearch: vi.fn().mockResolvedValue([{ id: "U1", name: "Ana" }]) });
  render(() => <SlackComposer {...composer} uploads={[]} customEmoji={{}} />);
  const box = screen.getByRole("textbox", { name: "Reply as you" });

  await fireEvent.input(box, { target: { value: "Hi @an" } });
  await waitFor(() => expect(composer.onMentionSearch).toHaveBeenCalledWith("an"));
  const picker = await screen.findByRole("listbox", { name: "Insert mention" });
  // A screen reader announces the option that the arrow keys reach while the box keeps focus.
  expect(box).toHaveAttribute("aria-activedescendant", within(picker).getByRole("option", { name: "Ana" }).id);
  await fireEvent.click(within(picker).getByRole("option", { name: "Ana" }));

  expect(box).toHaveValue("Hi @Ana ");
  await fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(composer.onSend).toHaveBeenCalledWith({ text: "Hi <@U1>" }));
});

it("@chief asks the orchestrator", async () => {
  const composer = actions();
  render(() => <SlackComposer {...composer} uploads={[]} customEmoji={{}} />);
  const box = screen.getByRole("textbox", { name: "Reply as you" });

  await fireEvent.input(box, { target: { value: "@chief summarize this" } });
  await fireEvent.keyDown(box, { key: "Enter" });

  await waitFor(() => expect(composer.onAsk).toHaveBeenCalledWith("@chief summarize this"));
  expect(composer.onSend).not.toHaveBeenCalled();
});

it("@chief keeps text typed while the ask is on its way", async () => {
  let answer: () => void = () => undefined;
  const composer = actions({ onAsk: vi.fn(() => new Promise<void>((resolve) => (answer = resolve))) });
  render(() => <SlackComposer {...composer} uploads={[]} customEmoji={{}} />);
  const box = screen.getByRole("textbox", { name: "Reply as you" });

  await fireEvent.input(box, { target: { value: "@chief summarize this" } });
  await fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => expect(composer.onAsk).toHaveBeenCalledWith("@chief summarize this"));
  await fireEvent.input(box, { target: { value: "@chief summarize this\nThanks all" } });
  answer();

  await waitFor(() => expect(box).toHaveValue("Thanks all"));
});

it("a thread reply can also go to the channel", async () => {
  const composer = actions();
  render(() => (
    <SlackThreadPanel
      parent={message("1760000000.000100", "Why did the deploy fail?")}
      replies={[message("1760000001.000100", "The token expired.")]}
      lookups={{ people: { U1: "Ana" }, channels: {}, customEmoji: {} }}
      loading={false}
      failed={false}
      onRetry={() => undefined}
      onClose={() => undefined}
      composer={composer}
      uploads={[]}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onReact={vi.fn()}
      onOpenLink={vi.fn()}
    />
  ));
  expect(screen.getByText("The token expired.")).toBeInTheDocument();

  await fireEvent.click(screen.getByRole("checkbox", { name: "Also send to channel" }));
  await fireEvent.input(screen.getByRole("textbox", { name: "Reply as you" }), {
    target: { value: "Fixed now" },
  });
  await fireEvent.click(screen.getByRole("button", { name: "Send" }));

  await waitFor(() => expect(composer.onSend).toHaveBeenCalledWith({ text: "Fixed now", broadcast: true }));
});
