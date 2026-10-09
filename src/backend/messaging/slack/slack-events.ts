import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import {
  DIRECT_CONVERSATION_KEY,
  type HistoryEvent,
  type HistoryMessage,
  type InboundAction,
  type InboundFile,
  type InboundMessage,
  type InboxCandidate,
  type InboxFile,
} from "../messaging-types";

/** The Block Kit action ids of the buttons the agent posts. */
export const SLACK_ACTION_IDS = {
  accept: "openbot_accept",
  decline: "openbot_decline",
  stop: "openbot_stop",
} as const;

/**
 * One Events API payload as a message for OpenBot, or null when it does not address OpenBot.
 *
 * - `app_mention` in a channel starts or continues the thread it is in.
 * - A direct message always addresses OpenBot. OpenBot answers in a thread under it, but every
 *   direct message from one person is one conversation (`DIRECT_CONVERSATION_KEY`), with one agent.
 * - A message in a group direct message without a mention never starts a conversation
 *   (`groupDirect`). It comes back only as a reply to a message OpenBot sent to that group.
 * - A reply in a thread without a mention counts only in a thread that an agent already answers
 *   (`requiresLink`). A reply with a mention also arrives as `app_mention`, and both have the same
 *   dedup key, so it runs once.
 * - Messages of bots, of OpenBot itself, edits, deletions and joins are ignored.
 */
export function slackInboundMessage(payload: unknown, workspaceId: string, botUserId: string): InboundMessage | null {
  if (!isDynamicRecord(payload) || payload.team_id !== workspaceId) return null;
  const event = payload.event;
  if (!isDynamicRecord(event)) return null;
  const channel = event.channel;
  const ts = event.ts;
  const user = event.user;
  if (!isString(channel) || !isString(ts) || !isString(user)) return null;
  if (event.bot_id !== undefined || user === botUserId) return null;
  if (event.subtype !== undefined && event.subtype !== "file_share") return null;
  const threadTs = isString(event.thread_ts) ? event.thread_ts : null;
  const base = {
    dedupKey: `${channel}:${ts}`,
    platformChannelId: channel,
    platformMessageId: ts,
    authorId: user,
    text: plainText(isString(event.text) ? event.text : "", botUserId),
    files: inboundFiles(event.files),
  };
  if (event.type === "app_mention") {
    const threadKey = threadTs ?? ts;
    return {
      ...base,
      threadKey,
      target: { platformChannelId: channel, replyThreadId: threadKey },
      isDirect: false,
      requiresLink: false,
    };
  }
  if (event.type !== "message") return null;
  if (event.channel_type === "im") {
    return {
      ...base,
      threadKey: DIRECT_CONVERSATION_KEY,
      target: { platformChannelId: channel, replyThreadId: threadTs ?? ts },
      isDirect: true,
      requiresLink: false,
    };
  }
  if (event.channel_type === "mpim") {
    const threadKey = threadTs ?? ts;
    return {
      ...base,
      threadKey,
      target: { platformChannelId: channel, replyThreadId: threadKey },
      isDirect: false,
      requiresLink: true,
      groupDirect: true,
    };
  }
  if (!threadTs || threadTs === ts) return null;
  return {
    ...base,
    threadKey: threadTs,
    target: { platformChannelId: channel, replyThreadId: threadTs },
    isDirect: false,
    requiresLink: true,
  };
}

const INBOX_PLACES: Record<string, InboxCandidate["place"]> = {
  im: "direct",
  mpim: "group",
  channel: "channel",
  group: "channel",
};

/**
 * One `message` event as a message for the person's inbox, or null. Bots, OpenBot itself, edits,
 * deletions and joins are left out. A reply shared to the channel counts like a reply.
 */
export function slackInboxCandidate(payload: unknown, workspaceId: string, botUserId: string): InboxCandidate | null {
  if (!isDynamicRecord(payload) || payload.team_id !== workspaceId) return null;
  const event = payload.event;
  if (!isDynamicRecord(event) || event.type !== "message") return null;
  const { channel, ts, user } = event;
  if (!isString(channel) || !isString(ts) || !isString(user)) return null;
  if (event.bot_id !== undefined || user === botUserId) return null;
  if (event.subtype !== undefined && event.subtype !== "file_share" && event.subtype !== "thread_broadcast")
    return null;
  const place = isString(event.channel_type) ? INBOX_PLACES[event.channel_type] : undefined;
  if (!place) return null;
  const raw = isString(event.text) ? event.text : "";
  const threadTs = isString(event.thread_ts) && event.thread_ts !== ts ? event.thread_ts : null;
  const seconds = Number(ts);
  return {
    platformChannelId: channel,
    platformMessageId: ts,
    threadKey: threadTs,
    place,
    authorId: user,
    // Kept in Slack's markup, so the desktop can show names, links and emoji as Slack does. An agent
    // and the list preview read it through `plainText`.
    text: raw,
    sentAt: Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : new Date().toISOString(),
    mentionedUserIds: [...raw.matchAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g)].flatMap((match) => (match[1] ? [match[1]] : [])),
    files: inboxFiles(event.files),
  };
}

/** `message` subtypes that change another message, or that Slack sends only to update a thread. */
const CHANGE_SUBTYPES = new Set(["message_changed", "message_deleted", "message_replied"]);

/**
 * One Events API payload as a live change for the Slack client's cache, or null. Every message the
 * person can see counts, bots and OpenBot included, as Slack shows them. An edit, a deletion, a
 * reaction and the person joining or leaving a channel never reach an agent. `ownerUserId` is the
 * connected person.
 */
export function slackHistoryEvent(
  payload: unknown,
  workspaceId: string,
  ownerUserId: string | null,
): HistoryEvent | null {
  if (!isDynamicRecord(payload) || payload.team_id !== workspaceId) return null;
  const event = payload.event;
  if (!isDynamicRecord(event)) return null;
  switch (event.type) {
    case "message":
      return historyMessageEvent(event);
    case "reaction_added":
    case "reaction_removed": {
      const { item, user, reaction } = event;
      if (!isDynamicRecord(item) || item.type !== "message" || !isString(item.channel) || !isString(item.ts))
        return null;
      if (!isString(user) || !isString(reaction)) return null;
      return {
        type: "reaction",
        channelId: item.channel,
        ts: item.ts,
        name: reaction,
        userId: user,
        on: event.type === "reaction_added",
        ownerUserId,
      };
    }
    case "member_joined_channel":
      // Slack also sends it when another person joins a channel the person is in.
      if (!isString(event.channel) || ownerUserId === null || event.user !== ownerUserId) return null;
      return { type: "membership", channelId: event.channel, kind: channelKind(event.channel_type), isMember: true };
    case "channel_left":
      // A user event: it comes only for the person who left.
      if (!isString(event.channel)) return null;
      return { type: "membership", channelId: event.channel, kind: channelKind(event.channel_type), isMember: false };
    case "group_left":
      // The private-channel form of channel_left. Follow-up: the manifests do not subscribe to it yet.
      if (!isString(event.channel)) return null;
      return { type: "membership", channelId: event.channel, kind: "private", isMember: false };
    default:
      return null;
  }
}

function historyMessageEvent(event: DynamicRecord): HistoryEvent | null {
  const channelId = event.channel;
  if (!isString(channelId)) return null;
  if (event.subtype === "message_deleted")
    return isString(event.deleted_ts) ? { type: "deleted", channelId, ts: event.deleted_ts } : null;
  if (event.subtype === "message_changed") {
    const changed = event.message;
    if (!isDynamicRecord(changed) || !isString(changed.ts)) return null;
    // A thread parent deleted in Slack stays as a placeholder.
    if (changed.subtype === "tombstone") return { type: "deleted", channelId, ts: changed.ts };
    // Other changes, such as a link preview, are not edits.
    const editedAt =
      isDynamicRecord(changed.edited) && isString(changed.edited.ts) ? slackTime(changed.edited.ts) : null;
    if (editedAt === null) return null;
    return { type: "edited", channelId, ts: changed.ts, text: isString(changed.text) ? changed.text : "", editedAt };
  }
  if (isString(event.subtype) && CHANGE_SUBTYPES.has(event.subtype)) return null;
  if (event.hidden === true) return null;
  const message = historyMessage(event);
  return message ? { type: "message", channelId, message } : null;
}

/**
 * A new message from an event. It has no reactions yet. Follow-up: slack-driver.ts has a copy of this
 * mapper and of slackTime; move both to one module that does not import the transport.
 */
function historyMessage(event: DynamicRecord): HistoryMessage | null {
  const ts = event.ts;
  if (!isString(ts)) return null;
  return {
    ts,
    threadTs: isString(event.thread_ts) && event.thread_ts !== ts ? event.thread_ts : null,
    replyCount: isNumber(event.reply_count) ? event.reply_count : 0,
    latestReplyTs: isString(event.latest_reply) ? event.latest_reply : null,
    authorId: [event.user, event.bot_id].find(isString) ?? "",
    text: isString(event.text) ? event.text : "",
    files: inboxFiles(event.files),
    reactions: [],
    editedAt: null,
    deleted: false,
    subtype: isString(event.subtype) ? event.subtype : null,
  };
}

/** Slack's `channel_type` of a membership event: `G` is a private channel. */
function channelKind(value: unknown): "channel" | "private" {
  return value === "G" ? "private" : "channel";
}

function slackTime(ts: string): string | null {
  const seconds = Number(ts);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

/** The files of an inbox message. Slack's own addresses are kept; each needs the token. */
function inboxFiles(value: unknown): InboxFile[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isDynamicRecord).flatMap((file: DynamicRecord) => {
    const url = isString(file.url_private_download) ? file.url_private_download : file.url_private;
    if (!isString(file.id) || !isString(url)) return [];
    const thumbnail = [file.thumb_480, file.thumb_360, file.thumb_720].find(isString) ?? null;
    return [
      {
        id: file.id,
        name: isString(file.name) ? file.name : isString(file.title) ? file.title : file.id,
        mimeType: isString(file.mimetype) ? file.mimetype : "application/octet-stream",
        size: isNumber(file.size) ? file.size : 0,
        url,
        thumbnailUrl: thumbnail,
        permalink: isString(file.permalink) ? file.permalink : null,
      },
    ];
  });
}

/** One `block_actions` payload as a button press on an OpenBot message, or null. */
export function slackInboundAction(payload: unknown, workspaceId: string): InboundAction | null {
  if (!isDynamicRecord(payload) || payload.type !== "block_actions") return null;
  const team = payload.team;
  const user = payload.user;
  const channel = payload.channel;
  const message = payload.message;
  if (!isDynamicRecord(team) || team.id !== workspaceId) return null;
  if (!isDynamicRecord(user) || !isString(user.id)) return null;
  if (!isDynamicRecord(channel) || !isString(channel.id)) return null;
  if (!isDynamicRecord(message) || !isString(message.ts)) return null;
  const action = Array.isArray(payload.actions) ? payload.actions[0] : undefined;
  if (!isDynamicRecord(action) || !isString(action.value)) return null;
  const target = {
    platformChannelId: channel.id,
    replyThreadId: isString(message.thread_ts) ? message.thread_ts : null,
  };
  const common = { token: action.value, actorId: user.id, target, platformMessageId: message.ts };
  switch (action.action_id) {
    case SLACK_ACTION_IDS.accept:
      return { type: "approval", decision: "accept", ...common };
    case SLACK_ACTION_IDS.decline:
      return { type: "approval", decision: "decline", ...common };
    case SLACK_ACTION_IDS.stop:
      return { type: "stop", ...common };
    default:
      return null;
  }
}

function inboundFiles(value: unknown): InboundFile[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isDynamicRecord).flatMap((file: DynamicRecord) =>
    isString(file.id) && isString(file.url_private_download)
      ? [
          {
            id: file.id,
            name: isString(file.name) ? file.name : file.id,
            mimeType: isString(file.mimetype) ? file.mimetype : "application/octet-stream",
            size: isNumber(file.size) ? file.size : 0,
            url: file.url_private_download,
          },
        ]
      : [],
  );
}

/**
 * Slack's markup as plain text: OpenBot's own mention goes, other mentions stay as ids, a
 * channel link keeps its name, a link keeps its label and address, and the three escaped
 * characters come back.
 */
export function plainText(text: string, botUserId: string): string {
  return text
    .replaceAll(`<@${botUserId}>`, "")
    .replace(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g, "@$1")
    .replace(/<#([A-Z0-9]+)(?:\|([^>]*))?>/g, (_match, id: string, name: string | undefined) => `#${name || id}`)
    .replace(/<!(here|channel|everyone)>/g, "@$1")
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .trim();
}
