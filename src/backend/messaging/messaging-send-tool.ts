// The `openbot.slack_send_message` tool: an agent asks OpenBot to send a new Slack message to a
// person or a channel. When the person who connected the workspace asked for it themselves, the
// messaging service sends it at once. Anyone else's request becomes a draft that the connected
// person approves in Slack. The message goes out as that person when the install gave their token,
// or as the bot. The agent never reaches Slack itself.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { z } from "zod";

const SLACK_ID = /^[A-Z0-9]{2,32}$/u;

/** Slack opens a group direct message with up to 8 people besides the sender. */
export const SLACK_GROUP_LIMIT = 8;

/**
 * A person, a conversation, or a group direct message of the workspace, from the forms an agent sees
 * in Slack text. A group's `id` is its people's ids, sorted and joined with commas, which is the form
 * `conversations.open` takes.
 */
export interface SlackSendTarget {
  kind: "user" | "channel" | "group";
  id: string;
}

export const SLACK_SEND_MESSAGE_TOOL = {
  name: "slack_send_message",
  description:
    'Send a new Slack message to a person, a channel, or a group direct message with several people, in the workspace this conversation is in. Call it once for each recipient; for a group direct message, call it once with every person in `to`. The text is the exact message the recipient reads: write only the content that was asked for, with no "From …" line, no signature, and no mention of GoAhead or of who asked. It goes out as the GoAhead user when they asked for it themselves; otherwise GoAhead sends it as the app, with a first line that names who asked. The result says `sent`, or `waiting_for_approval` when the GoAhead user must press Approve in Slack first. Report what the result says, nothing more.',
  shape: {
    to: z
      .string()
      .min(1)
      .max(400)
      .describe(
        "Who gets it. Use the person's or channel's name, such as Harsh Patel or #general; ids are not required. A Slack user id (U…) or channel id (C…), such as <@U0123>, also works. For a group direct message, up to 8 user ids separated by commas, such as <@U0123>, <@U0456>.",
      ),
    text: z
      .string()
      .min(1)
      .max(INPUT_LIMITS.messageText)
      .describe(
        "The message, in plain text or simple markdown. When the GoAhead user asked in GoAhead, write @Name, such as @Harsh Patel, to mention a person.",
      ),
    threadTs: z
      .string()
      .max(64)
      .optional()
      .describe("Reply in this thread of the target channel instead of posting a new message."),
  },
} as const;

export const slackSendMessageSchema = z.object(SLACK_SEND_MESSAGE_TOOL.shape);

/**
 * `<@U0123>`, `@U0123` and `U0123` name a person; `<#C0123|name>`, `#C0123` and `C0123` a conversation.
 * Several people, separated by commas or spaces, name a group direct message; one of them repeated
 * is still one person.
 */
export function parseSlackSendTarget(value: string): SlackSendTarget | null {
  const parts = value
    .split(/[,\s]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) return parseOne(value);
  const people = new Set<string>();
  for (const part of parts) {
    const target = parseOne(part);
    if (target?.kind !== "user") return null;
    people.add(target.id);
  }
  if (people.size > SLACK_GROUP_LIMIT) return null;
  const ids = [...people].sort();
  return ids.length === 1 ? { kind: "user", id: ids[0] ?? "" } : { kind: "group", id: ids.join(",") };
}

/** The people of a group target, or the one person of a user target. */
export function slackTargetPeople(target: SlackSendTarget): string[] {
  if (target.kind === "user") return [target.id];
  return target.kind === "group" ? target.id.split(",") : [];
}

function parseOne(value: string): SlackSendTarget | null {
  const trimmed = value.trim();
  const mention = /^<@([A-Z0-9]+)(?:\|[^>]*)?>$/u.exec(trimmed);
  const place = /^<#([A-Z0-9]+)(?:\|[^>]*)?>$/u.exec(trimmed);
  const bare = mention?.[1] ?? place?.[1] ?? trimmed.replace(/^[@#]/u, "");
  if (!SLACK_ID.test(bare)) return null;
  if (mention) return { kind: "user", id: bare };
  if (place) return { kind: "channel", id: bare };
  return { kind: bare.startsWith("U") || bare.startsWith("W") ? "user" : "channel", id: bare };
}
