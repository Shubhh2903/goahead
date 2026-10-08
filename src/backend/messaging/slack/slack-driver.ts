import { readFile } from "node:fs/promises";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { slackOwnerBlockId } from "@openbot/contracts/signal-protocol/slack-route";
import { SLACK_BOT_SCOPES, SLACK_USER_SCOPES } from "@openbot/contracts/slack-app";
import { sourceText } from "@openbot/i18n/source";
import type { MessagingAnswerFile } from "../messaging-threads";
import {
  type ConnectionIdentity,
  type ContextEntry,
  type InboundFile,
  type InboxCandidate,
  type MessageBody,
  type MessageSender,
  type MessageTarget,
  type MessagingAdapter,
  MessagingConnectionError,
  type MessagingDriver,
  type MessagingDriverOptions,
  type MessagingIngress,
  type StatusReaction,
} from "../messaging-types";
import { plainText, SLACK_ACTION_IDS, slackInboxCandidate } from "./slack-events";
import { SlackEventsTransport } from "./slack-events-transport";
import { slackChunks, slackMrkdwn } from "./slack-render";
import { SlackApiError, SlackWebApi } from "./slack-web-api";

/** Slack's own limit for one uploaded file is 1 GB; the host holds its uploads to this. */
const UPLOAD_BYTES = 100 * 1024 * 1024;
const HISTORY_LIMIT = 100;
/** What `conversations.info` answers with the bot token for a conversation that the bot is not in. */
const NOT_OWN_CONVERSATION = new Set(["channel_not_found", "not_in_channel"]);
const CHANNEL_PAGE_LIMIT = 200;
/** Pages of 200 channels: enough for a person, and a bound for a very large workspace. */
const PERSON_PLACE_PAGES = 5;

const REACTIONS: Record<StatusReaction, string> = {
  received: "eyes",
  done: "white_check_mark",
  failed: "x",
  stopped: "black_square_for_stop",
};

const BUTTON_ACTIONS = {
  accept: SLACK_ACTION_IDS.accept,
  decline: SLACK_ACTION_IDS.decline,
  stop: SLACK_ACTION_IDS.stop,
} as const;

/**
 * The Slack Web API side of one connection: the bot's token, and the token of the person who
 * installed the app when the install gave one. It never logs message text or a response body.
 */
export class SlackAdapter implements MessagingAdapter {
  readonly platform = "slack" as const;
  readonly #api: SlackWebApi;
  readonly #userApi: SlackWebApi | null;
  readonly #names = new Map<string, Promise<string>>();
  readonly #places = new Map<string, Promise<string>>();
  readonly #own = new Map<string, Promise<boolean>>();
  readonly #personIn = new Map<string, boolean>();
  #botUserId = "";
  #workspaceId = "";
  /** The connected person's Slack user id, known after `identify` when the install gave a user token. */
  #ownerUserId: string | null = null;

  constructor(
    tokens: { botToken: string; userToken: string | undefined },
    options: MessagingDriverOptions & { origin?: string | undefined },
  ) {
    this.#api = new SlackWebApi({ token: tokens.botToken, origin: options.origin, rateLimited: options.rateLimited });
    this.#userApi = tokens.userToken
      ? new SlackWebApi({ token: tokens.userToken, origin: options.origin, rateLimited: options.rateLimited })
      : null;
  }

  async identify(): Promise<ConnectionIdentity> {
    const { payload, scopes } = await this.#api.authTest();
    const workspaceId = payload.team_id;
    const botUserId = payload.user_id;
    const botId = payload.bot_id;
    if (!isString(workspaceId) || !isString(botUserId) || !isString(botId))
      throw new SlackApiError("auth.test", "not_a_bot_token");
    const bot = await this.#api.call("bots.info", { bot: botId });
    const appId = isDynamicRecord(bot.bot) && isString(bot.bot.app_id) ? bot.bot.app_id : "";
    this.#botUserId = botUserId;
    this.#workspaceId = workspaceId;
    const person = await this.#identifyUser(workspaceId);
    this.#ownerUserId = person?.id ?? null;
    return {
      workspaceId,
      workspaceName: isString(payload.team) ? payload.team : workspaceId,
      botUserId,
      appId,
      missingScopes: [
        ...new Set([
          ...SLACK_BOT_SCOPES.filter((scope) => !scopes.includes(scope)),
          ...SLACK_USER_SCOPES.filter((scope) => person !== null && !person.scopes.includes(scope)),
        ]),
      ],
      user: person && { id: person.id, name: person.name },
    };
  }

  /**
   * The person whose token came with the install. A token for another workspace is refused as a
   * whole: the host acts as a person only in the workspace that the bot is in, and a connect that
   * gives both tokens again is the way back.
   */
  async #identifyUser(workspaceId: string): Promise<{ id: string; name: string; scopes: string[] } | null> {
    if (!this.#userApi) return null;
    const { payload, scopes } = await this.#userApi.authTest();
    const id = payload.user_id;
    if (payload.team_id !== workspaceId || !isString(id)) throw new MessagingConnectionError("invalid_token");
    return { id, name: isString(payload.user) ? payload.user : id, scopes };
  }

  async post(target: MessageTarget, body: MessageBody): Promise<string> {
    const response = await this.#api.call("chat.postMessage", {
      channel: target.platformChannelId,
      thread_ts: target.replyThreadId ?? undefined,
      ...this.#content(body),
      unfurl_links: false,
      unfurl_media: false,
    });
    if (!isString(response.ts)) throw new SlackApiError("chat.postMessage", "no_ts");
    return response.ts;
  }

  async edit(target: MessageTarget, messageId: string, body: MessageBody): Promise<void> {
    await this.#api.call("chat.update", { channel: target.platformChannelId, ts: messageId, ...this.#content(body) });
  }

  async postPrivate(target: MessageTarget, userId: string, text: string): Promise<void> {
    await this.#api.call("chat.postEphemeral", {
      channel: target.platformChannelId,
      thread_ts: target.replyThreadId ?? undefined,
      user: userId,
      text: this.#statusText(text),
    });
  }

  async react(target: MessageTarget, messageId: string, reaction: StatusReaction, on: boolean): Promise<void> {
    try {
      await this.#api.call(on ? "reactions.add" : "reactions.remove", {
        channel: target.platformChannelId,
        timestamp: messageId,
        name: REACTIONS[reaction],
      });
    } catch (error) {
      // A reaction is only a signal. It is already there, or already gone.
      if (!(error instanceof SlackApiError && ["already_reacted", "no_reaction"].includes(error.code))) throw error;
    }
  }

  async postAnswer(target: MessageTarget, markdown: string, replaceMessageId: string | null): Promise<void> {
    const [first = "", ...rest] = slackChunks(slackMrkdwn(markdown));
    if (replaceMessageId) {
      try {
        await this.#api.call("chat.update", {
          channel: target.platformChannelId,
          ts: replaceMessageId,
          text: first,
          blocks: [],
        });
      } catch {
        await this.#api
          .call("chat.delete", { channel: target.platformChannelId, ts: replaceMessageId })
          .catch(() => undefined);
        await this.#postText(target, first);
      }
    } else await this.#postText(target, first);
    for (const chunk of rest) await this.#postText(target, chunk);
  }

  async upload(target: MessageTarget, files: MessagingAnswerFile[]): Promise<string[]> {
    const skipped: string[] = [];
    const uploaded: Array<{ id: string; title: string }> = [];
    for (const file of files) {
      try {
        const bytes = await readFile(file.path);
        if (bytes.byteLength > UPLOAD_BYTES || bytes.byteLength === 0) {
          skipped.push(file.name);
          continue;
        }
        const ticket = await this.#api.call("files.getUploadURLExternal", {
          filename: file.name,
          length: String(bytes.byteLength),
        });
        if (!isString(ticket.upload_url) || !isString(ticket.file_id))
          throw new SlackApiError("files", "no_upload_url");
        await this.#api.uploadBytes(ticket.upload_url, bytes, file.mimeType);
        uploaded.push({ id: ticket.file_id, title: file.name });
      } catch {
        skipped.push(file.name);
      }
    }
    if (uploaded.length)
      await this.#api.call("files.completeUploadExternal", {
        files: uploaded,
        channel_id: target.platformChannelId,
        thread_ts: target.replyThreadId ?? undefined,
      });
    return skipped;
  }

  async history(
    platformChannelId: string,
    threadKey: string,
    afterId: string | null,
    beforeId: string,
  ): Promise<ContextEntry[]> {
    // Every conversation is a thread, in a direct message too.
    const response = await this.#api.call("conversations.replies", {
      channel: platformChannelId,
      ts: threadKey,
      latest: beforeId,
      oldest: afterId ?? undefined,
      inclusive: false,
      limit: HISTORY_LIMIT,
    });
    const messages = Array.isArray(response.messages) ? response.messages.filter(isDynamicRecord) : [];
    const entries: ContextEntry[] = [];
    for (const message of messages) {
      const ts = message.ts;
      const user = message.user;
      if (!isString(ts) || !isString(user) || user === this.#botUserId || message.bot_id !== undefined) continue;
      if (Number(ts) >= Number(beforeId) || (afterId && Number(ts) <= Number(afterId))) continue;
      entries.push({
        id: ts,
        authorName: await this.authorName(user),
        text: plainText(isString(message.text) ? message.text : "", this.#botUserId),
        sentAt: new Date(Number(ts) * 1000).toISOString(),
      });
    }
    return entries.sort((left, right) => Number(left.id) - Number(right.id));
  }

  download(file: InboundFile, destination: string, maxBytes: number): Promise<void> {
    return this.#api.download(file.url, destination, maxBytes);
  }

  async openDirectMessage(userIds: string, as: MessageSender): Promise<string> {
    const response = await this.#apiFor(as).call("conversations.open", { users: userIds });
    const channel = isDynamicRecord(response.channel) ? response.channel.id : undefined;
    if (!isString(channel)) throw new SlackApiError("conversations.open", "no_channel");
    return channel;
  }

  async postAs(target: MessageTarget, markdown: string, as: MessageSender): Promise<string> {
    const [first = "", ...rest] = slackChunks(slackMrkdwn(markdown));
    const api = this.#apiFor(as);
    const post = async (text: string) => {
      const response = await api.call("chat.postMessage", {
        channel: target.platformChannelId,
        thread_ts: target.replyThreadId ?? undefined,
        text,
        unfurl_links: false,
        unfurl_media: false,
      });
      if (!isString(response.ts)) throw new SlackApiError("chat.postMessage", "no_ts");
      return response.ts;
    };
    const ts = await post(first);
    for (const chunk of rest) await post(chunk);
    return ts;
  }

  /**
   * A reply that the person typed in GoAhead, posted as them with the user token. The text is sent as
   * they wrote it, only escaped, so it cannot ping a workspace. A failure names only Slack's error code.
   */
  async postAsUser(input: { channel: string; threadTs?: string; text: string }): Promise<{ ts: string }> {
    const response = await this.#apiFor("user").call("chat.postMessage", {
      channel: input.channel,
      thread_ts: input.threadTs,
      text: input.text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
      unfurl_links: false,
      unfurl_media: false,
    });
    if (!isString(response.ts)) throw new SlackApiError("chat.postMessage", "no_ts");
    return { ts: response.ts };
  }

  async listPersonPlaces(): Promise<Array<{ id: string; name: string; isPrivate: boolean }>> {
    const api = this.#apiFor("user");
    const places: Array<{ id: string; name: string; isPrivate: boolean }> = [];
    let cursor: string | undefined;
    for (let page = 0; page < PERSON_PLACE_PAGES; page += 1) {
      const response = await api.call("users.conversations", {
        types: "public_channel,private_channel",
        exclude_archived: "true",
        limit: "200",
        ...(cursor ? { cursor } : {}),
      });
      const channels = Array.isArray(response.channels) ? response.channels.filter(isDynamicRecord) : [];
      for (const channel of channels)
        if (isString(channel.id) && isString(channel.name))
          places.push({ id: channel.id, name: channel.name, isPrivate: channel.is_private === true });
      const next = isDynamicRecord(response.response_metadata) ? response.response_metadata.next_cursor : undefined;
      if (!isString(next) || !next) break;
      cursor = next;
    }
    return places;
  }

  // Slack allows apps outside its Marketplace one `conversations.history` call a minute, of at most 15
  // messages. The caller spaces the calls.
  async recentMessages(platformChannelId: string, limit: number): Promise<InboxCandidate[]> {
    const response = await this.#apiFor("user").call("conversations.history", {
      channel: platformChannelId,
      limit: String(limit),
    });
    const messages = Array.isArray(response.messages) ? response.messages.filter(isDynamicRecord) : [];
    return messages.flatMap((message) => {
      const candidate = slackInboxCandidate(
        {
          team_id: this.#workspaceId,
          event: { ...message, type: "message", channel: platformChannelId, channel_type: "channel" },
        },
        this.#workspaceId,
        this.#botUserId,
      );
      return candidate ? [candidate] : [];
    });
  }

  async permalink(platformChannelId: string, messageId: string): Promise<string | null> {
    try {
      const response = await this.#api.call("chat.getPermalink", { channel: platformChannelId, message_ts: messageId });
      return isString(response.permalink) ? response.permalink : null;
    } catch {
      return null;
    }
  }

  isOwnConversation(platformChannelId: string): Promise<boolean> {
    let own = this.#own.get(platformChannelId);
    if (!own) {
      // The bot token sees only the conversations the bot is in. Any other failure keeps the
      // conversation the bot's, as before user events existed.
      own = this.#api
        .call("conversations.info", { channel: platformChannelId })
        .then(() => true)
        .catch((error) => !(error instanceof SlackApiError && NOT_OWN_CONVERSATION.has(error.code)));
      this.#own.set(platformChannelId, own);
    }
    return own;
  }

  /**
   * Fails closed: without the person's token, or on any failure, the answer is no. Only a clear answer
   * is remembered, so a network error does not drop the conversation for good.
   */
  async isPersonConversation(platformChannelId: string): Promise<boolean> {
    const known = this.#personIn.get(platformChannelId);
    if (known !== undefined) return known;
    if (!this.#userApi) return false;
    try {
      await this.#userApi.call("conversations.info", { channel: platformChannelId });
      this.#personIn.set(platformChannelId, true);
      return true;
    } catch (error) {
      if (error instanceof SlackApiError && NOT_OWN_CONVERSATION.has(error.code))
        this.#personIn.set(platformChannelId, false);
      return false;
    }
  }

  /** The user token is only there when the install gave one; a send as the user without it fails. */
  #apiFor(as: MessageSender): SlackWebApi {
    if (as === "bot") return this.#api;
    if (!this.#userApi) throw new SlackApiError("chat.postMessage", "no_user_token");
    return this.#userApi;
  }

  authorName(userId: string): Promise<string> {
    let name = this.#names.get(userId);
    if (!name) {
      name = this.#api
        .call("users.info", { user: userId })
        .then((response) => {
          const user = isDynamicRecord(response.user) ? response.user : {};
          const profile = isDynamicRecord(user.profile) ? user.profile : {};
          for (const candidate of [profile.display_name, profile.real_name, user.real_name, user.name])
            if (isString(candidate) && candidate.trim()) return candidate.trim();
          return userId;
        })
        .catch(() => userId);
      this.#names.set(userId, name);
    }
    return name;
  }

  placeName(platformChannelId: string): Promise<string> {
    let name = this.#places.get(platformChannelId);
    if (!name) {
      name = this.#api
        .call("conversations.info", { channel: platformChannelId })
        .then((response) =>
          isDynamicRecord(response.channel) && isString(response.channel.name)
            ? `#${response.channel.name}`
            : platformChannelId,
        )
        .catch(() => platformChannelId);
      this.#places.set(platformChannelId, name);
    }
    return name;
  }

  /** Every public channel of the workspace that OpenBot is not in yet. Archived ones are left out. */
  async joinPublicPlaces(): Promise<void> {
    let cursor: string | undefined;
    do {
      const page = await this.#api.call("conversations.list", {
        types: "public_channel",
        exclude_archived: true,
        limit: CHANNEL_PAGE_LIMIT,
        cursor,
      });
      const channels = Array.isArray(page.channels) ? page.channels.filter(isDynamicRecord) : [];
      for (const channel of channels)
        if (isString(channel.id) && channel.is_member !== true) await this.joinPlace(channel.id);
      const next = isDynamicRecord(page.response_metadata) ? page.response_metadata.next_cursor : undefined;
      cursor = isString(next) && next ? next : undefined;
    } while (cursor);
  }

  async joinPlace(platformChannelId: string): Promise<void> {
    try {
      await this.#api.call("conversations.join", { channel: platformChannelId });
    } catch (error) {
      // A channel that was archived, or that the workspace keeps apps out of, stays without OpenBot.
      if (!(error instanceof SlackApiError)) throw error;
    }
  }

  /**
   * A marker, not Slack markup: status text is escaped as a whole, which would make `<@U…>` inert.
   * `#statusText` turns the marker back into a mention after the escape. The answer of an agent never
   * goes through it, so an answer cannot mention anyone.
   */
  mention(userId: string): string {
    return /^[A-Z0-9]+$/.test(userId) ? `\uE000@${userId}\uE000` : userId;
  }

  #statusText(text: string): string {
    return slackMrkdwn(text).replace(/\uE000@([A-Z0-9]+)\uE000/g, "<@$1>");
  }

  async #postText(target: MessageTarget, text: string): Promise<void> {
    await this.#api.call("chat.postMessage", {
      channel: target.platformChannelId,
      thread_ts: target.replyThreadId ?? undefined,
      text,
      unfurl_links: false,
      unfurl_media: false,
    });
  }

  /**
   * Status text is written by the host, so it is only escaped. Buttons become Block Kit. The actions
   * block names the draft's owner, so Signal sends a click to the owner's computer.
   */
  #content(body: MessageBody): DynamicRecord {
    const text = this.#statusText(body.text);
    if (!body.buttons?.length) return { text, blocks: [] };
    return {
      text,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text } },
        {
          type: "actions",
          ...(this.#ownerUserId ? { block_id: slackOwnerBlockId(this.#ownerUserId) } : {}),
          elements: body.buttons.map((button) => ({
            type: "button",
            action_id: BUTTON_ACTIONS[button.action],
            text: { type: "plain_text", text: button.label },
            value: button.token,
            ...(button.style ? { style: button.style } : {}),
          })),
        },
      ],
    };
  }
}

export interface SlackDriverOptions {
  /** Only tests change this. */
  origin?: string;
  /** The relay that brings the workspace's events. Without it, no workspace connects. */
  ingress?: MessagingIngress;
}

/** Each workspace installed the OpenBot app, and its events come through the ingress relay. */
export function slackDriver(options: SlackDriverOptions = {}): MessagingDriver {
  return {
    platform: "slack",
    createAdapter(credentials, driverOptions) {
      return new SlackAdapter(
        { botToken: credentials.botToken ?? "", userToken: credentials.userToken },
        { ...driverOptions, origin: options.origin },
      );
    },
    createTransport(_credentials, identity) {
      if (!options.ingress) throw new Error(sourceText("error.messaging.unsupported"));
      return new SlackEventsTransport({ identity, ingress: options.ingress });
    },
  };
}
