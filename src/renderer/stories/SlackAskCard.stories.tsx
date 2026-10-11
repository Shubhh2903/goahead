import { SlackAskCard } from "@openbot/ui/features/conversation/SlackAskCard";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

/*
 * A message that GoAhead wrote to a Slack Orchestrator for the person: an auto-reply request, an
 * `@chief` instruction from the Slack inbox, or a loop-pause note. The chat shows this card, not the
 * full prompt; the full text opens on request.
 */

const FULL_TEXT = [
  "Auto-reply is on for a Slack conversation in Acme: direct message with Preet (conversation D1).",
  "--- newest messages, oldest first ---",
  "Preet: how are you?",
  "Preet: free later? I want to go over the launch checklist before Friday, and the design review notes.",
  "--- GoAhead's instruction ---",
  "Auto-reply is on for this conversation. Read the new messages from Preet and reply in this conversation.",
].join("\n");

const meta = {
  title: "Conversation/Slack ask card",
  component: SlackAskCard,
  render: (args) => (
    <main style={{ width: "min(560px, 100vw)", padding: "var(--openbot-space-4)" }}>
      <SlackAskCard {...args} />
    </main>
  ),
  args: {
    slackAsk: {
      kind: "auto-reply",
      workspaceId: "T1",
      channelId: "D1",
      place: "Preet",
      trigger: [
        { author: "Preet", text: "how are you?" },
        {
          author: "Preet",
          text: "free later? I want to go over the launch checklist before Friday, and the design review notes.\nAlso the budget.\nAnd the hiring plan.\nAnd one more line that the card clips.",
        },
      ],
    },
    text: FULL_TEXT,
    time: "10:42",
    onOpenConversation: fn(),
  },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof SlackAskCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AutoReply: Story = {};

export const InboxAsk: Story = {
  args: {
    slackAsk: {
      kind: "inbox-ask",
      workspaceId: "T1",
      channelId: "C1",
      place: "#launch",
      trigger: [{ author: "Dhruvi", text: "draft a short answer about the release date" }],
    },
  },
};

export const AutoReplyPaused: Story = {
  args: {
    slackAsk: { kind: "auto-reply-paused", workspaceId: "T1", channelId: "D1", place: "Preet", trigger: [] },
    onOpenConversation: undefined,
  },
};
