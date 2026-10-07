// The `openbot.slack_send_message` tool: an agent asks OpenBot to send a new Slack message to a
// person or a channel. When the person who connected the workspace asked for it themselves, the
// messaging service sends it at once. Anyone else's request becomes a draft that the connected
// person approves in Slack. The message goes out as that person when the install gave their token,
// or as the bot. The agent never reaches Slack itself.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { z } from "zod";

const SLACK_ID = /^[A-Z0-9]{2,32}$/u;

/** A person or a conversation of the workspace, from the forms an agent sees in Slack text. */
export interface SlackSendTarget {
  kind: "user" | "channel";
  id: string;
}

export const SLACK_SEND_MESSAGE_TOOL = {
  name: "slack_send_message",
  description:
    'Send a new Slack message to a person or a channel of the workspace this conversation is in. Call it once for each recipient. The text is the exact message the recipient reads, and it goes out as the GoAhead user: write only the content that was asked for, with no "From …" line, no signature, and no mention of GoAhead or of who asked. The result says `sent`, or `waiting_for_approval` when the GoAhead user must press Approve in Slack first. Report what the result says, nothing more.',
  shape: {
    to: z
      .string()
      .min(1)
      .max(64)
      .describe(
        "The Slack user id (U…) or channel id (C…) to send to, as it appears in the conversation, such as <@U0123>.",
      ),
    text: z.string().min(1).max(INPUT_LIMITS.messageText).describe("The message, in plain text or simple markdown."),
    threadTs: z
      .string()
      .max(64)
      .optional()
      .describe("Reply in this thread of the target channel instead of posting a new message."),
  },
} as const;

export const slackSendMessageSchema = z.object(SLACK_SEND_MESSAGE_TOOL.shape);

/** `<@U0123>`, `@U0123` and `U0123` name a person; `<#C0123|name>`, `#C0123` and `C0123` a conversation. */
export function parseSlackSendTarget(value: string): SlackSendTarget | null {
  const trimmed = value.trim();
  const mention = /^<@([A-Z0-9]+)(?:\|[^>]*)?>$/u.exec(trimmed);
  const place = /^<#([A-Z0-9]+)(?:\|[^>]*)?>$/u.exec(trimmed);
  const bare = mention?.[1] ?? place?.[1] ?? trimmed.replace(/^[@#]/u, "");
  if (!SLACK_ID.test(bare)) return null;
  if (mention) return { kind: "user", id: bare };
  if (place) return { kind: "channel", id: bare };
  return { kind: bare.startsWith("U") || bare.startsWith("W") ? "user" : "channel", id: bare };
}
