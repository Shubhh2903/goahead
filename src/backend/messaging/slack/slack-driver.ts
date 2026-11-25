import { readFile } from "node:fs/promises";
import { SLACK_CLIENT_LIMITS } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { slackOwnerBlockId } from "@openbot/contracts/signal-protocol/slack-route";
import { SLACK_BOT_SCOPES, SLACK_USER_SCOPES } from "@openbot/contracts/slack-app";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Result } from "effect";
import { causeHelpers, runCauseEffect } from "../../effect-boundary";
import { mentionNames, withMentionNames } from "../messaging-mentions";
import type { MessagingAnswerFile } from "../messaging-threads";
import {
  type ConnectionIdentity,
  type ContextEntry,
  type HistoryConversation,
  type HistoryConversationPage,
  type HistoryConversationState,
  type HistoryMessage,
  type HistoryPage,
  type HistoryReaction,
  type HistoryThreadPage,
  type HistoryUpload,
  type InboundFile,
  type InboxCandidate,
  type InboxFile,
  type MessageBody,
  type MessageSender,
  type MessageTarget,
  type MessagingAdapter,
  MessagingAdapterError,
  MessagingConnectionError,
  type MessagingDriver,
  type MessagingDriverOptions,
  type MessagingIngress,
  type MessagingPlace,
  type MessagingPlaces,
  type RecentMessages,
  type StatusReaction,
} from "../messaging-types";
import { plainText, SLACK_ACTION_IDS, slackInboxCandidate, slackMentionIds } from "./slack-events";
import { SlackEventsTransport } from "./slack-events-transport";
import { slackChunks, slackMrkdwn } from "./slack-render";
import { SlackApiError, type SlackCallOptions, SlackWebApi } from "./slack-web-api";

const { io: adapterIo } = causeHelpers(MessagingAdapterError);

const TEMPORARY_SLACK_ERRORS = new Set([
  "ratelimited",
  "internal_error",
  "fatal_error",
  "service_unavailable",
  "request_timeout",
]);

function isTemporaryLookupFailure(failure: MessagingAdapterError): boolean {
  const error = failure.cause;
  if (error instanceof MessagingConnectionError) return false;
  return !(error instanceof SlackApiError) || error.code.startsWith("http_") || TEMPORARY_SLACK_ERRORS.has(error.code);
}

const UPLOAD_BYTES = 100 * 1024 * 1024;
const HISTORY_LIMIT = 100;
const RECENT_THREAD_LIMIT = 200;
const RECENT_THREAD_PAGES = 5;
const RECENT_SUBTYPES = new Set(["file_share", "bot_message", "thread_broadcast", "me_message"]);
const CHANNEL_PAGE_LIMIT = 200;
const PLACES_LIMIT = 500;
/** What `conversations.info` answers with the bot token for a conversation that the bot is not in. */
const NOT_OWN_CONVERSATION = new Set(["channel_not_found", "not_in_channel"]);
/** Pages of 200 channels: enough for a person, and a bound for a very large workspace. */
const PERSON_PLACE_PAGES = 5;
/** How long the workspace's own emoji are kept before `emoji.list` is read again. */
const EMOJI_CACHE_MS = 60 * 60_000;
const EMOJI_RETRY_MS = 5 * 60_000;
/** Reads of the Slack client go through its own queue, which waits on a 429. */
const QUEUED: SlackCallOptions = { retryRateLimit: false };
/** 50 pages of 200 people for the mention picker. */
const PEOPLE_PAGES = 50;
const PEOPLE_CACHE_MS = 60 * 60_000;
/** After a failed `users.list` read, searches answer with that failure this long before a new read. */
const PEOPLE_RETRY_MS = 60_000;
const PEOPLE_MATCHES = 20;
/** A send by name reads `users.list` again when the list is older than this, or on a miss after a minute. */
const PEOPLE_SEND_MAX_AGE_MS = 5 * 60_000;
const PEOPLE_MISS_MAX_AGE_MS = 60_000;

interface SlackPerson {
  id: string;
  /** The lower-case display, real, first and handle names, for a match. */
  names: string[];
  name: string;
  title: string;
}

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
  readonly #names = new Map<string, Deferred.Deferred<string>>();
  readonly #places = new Map<string, Deferred.Deferred<string>>();
  readonly #own = new Map<string, Promise<boolean>>();
  readonly #personIn = new Map<string, boolean>();
  #emoji: { value: Promise<Record<string, string>>; until: number } | null = null;
  #people: { value: Promise<SlackPerson[]>; until: number; readAt: number } | null = null;
  #botUserId = "";
  #workspaceId = "";
  /** The connected person's Slack user id, known after `identify` when the install gave a user token. */
  #ownerUserId: string | null = null;

  constructor(
    tokens: { botToken: string; userToken: string | undefined },
    options: MessagingDriverOptions & {
      origin?: string | undefined;
      /** Waits between rate-limit retries. Only tests replace it. */
      delay?: ((milliseconds: number) => Promise<void>) | undefined;
    },
  ) {
    const shared = { origin: options.origin, rateLimited: options.rateLimited, delay: options.delay };
    this.#api = new SlackWebApi({ token: tokens.botToken, ...shared });
    this.#userApi = tokens.userToken ? new SlackWebApi({ token: tokens.userToken, ...shared }) : null;
  }

  readonly identify = Effect.fnUntraced(function* (
    this: SlackAdapter,
  ): Effect.fn.Return<ConnectionIdentity, MessagingAdapterError> {
    const { payload, scopes } = yield* this.#api.authTest();
    const workspaceId = payload.team_id;
    const botUserId = payload.user_id;
    const botId = payload.bot_id;
    if (!isString(workspaceId) || !isString(botUserId) || !isString(botId))
      return yield* new MessagingAdapterError({ cause: new SlackApiError("auth.test", "not_a_bot_token") });
    const bot = yield* this.#api.call("bots.info", { bot: botId });
    const appId = isDynamicRecord(bot.bot) && isString(bot.bot.app_id) ? bot.bot.app_id : "";
    this.#botUserId = botUserId;
    this.#workspaceId = workspaceId;
    const person = yield* this.#identifyUser(workspaceId);
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
  });

  /**
   * The person whose token came with the install. A token for another workspace is refused as a
   * whole: the host acts as a person only in the workspace that the bot is in, and a connect that
   * gives both tokens again is the way back.
   */
  readonly #identifyUser = Effect.fnUntraced(function* (
    this: SlackAdapter,
    workspaceId: string,
  ): Effect.fn.Return<{ id: string; name: string; scopes: string[] } | null, MessagingAdapterError> {
    if (!this.#userApi) return null;
    const { payload, scopes } = yield* this.#userApi.authTest();
    const id = payload.user_id;
    if (payload.team_id !== workspaceId || !isString(id))
      return yield* new MessagingAdapterError({ cause: new MessagingConnectionError("invalid_token") });
    return { id, name: isString(payload.user) ? payload.user : id, scopes };
  });

  readonly post = Effect.fnUntraced(function* (
    this: SlackAdapter,
    target: MessageTarget,
    body: MessageBody,
  ): Effect.fn.Return<string, MessagingAdapterError> {
    const response = yield* this.#api.call("chat.postMessage", {
      channel: target.platformChannelId,
      thread_ts: target.replyThreadId ?? undefined,
      ...this.#content(body),
      unfurl_links: false,
      unfurl_media: false,
    });
    if (!isString(response.ts))
      return yield* new MessagingAdapterError({ cause: new SlackApiError("chat.postMessage", "no_ts") });
    return response.ts;
  });

  readonly edit = Effect.fnUntraced(function* (
    this: SlackAdapter,
    target: MessageTarget,
    messageId: string,
    body: MessageBody,
  ): Effect.fn.Return<void, MessagingAdapterError> {
    yield* this.#api.call("chat.update", {
      channel: target.platformChannelId,
      ts: messageId,
      ...this.#content(body),
    });
  });

  readonly remove = Effect.fnUntraced(function* (
    this: SlackAdapter,
    target: MessageTarget,
    messageId: string,
  ): Effect.fn.Return<void, MessagingAdapterError> {
    yield* this.#api.call("chat.delete", { channel: target.platformChannelId, ts: messageId });
  });

  readonly postPrivate = Effect.fnUntraced(function* (
    this: SlackAdapter,
    target: MessageTarget,
    userId: string,
    text: string,
  ): Effect.fn.Return<void, MessagingAdapterError> {
    yield* this.#api.call("chat.postEphemeral", {
      channel: target.platformChannelId,
      thread_ts: target.replyThreadId ?? undefined,
      user: userId,
      text: this.#statusText(text),
    });
  });

  readonly react = Effect.fnUntraced(function* (
    this: SlackAdapter,
    target: MessageTarget,
    messageId: string,
    reaction: StatusReaction,
    on: boolean,
  ) {
    yield* this.#api
      .call(on ? "reactions.add" : "reactions.remove", {
        channel: target.platformChannelId,
        timestamp: messageId,
        name: REACTIONS[reaction],
      })
      .pipe(
        Effect.catch((failure) => {
          const error = failure.cause;
          return error instanceof SlackApiError && ["already_reacted", "no_reaction"].includes(error.code)
            ? Effect.void
            : Effect.fail(failure);
        }),
      );
  });

  readonly addEmoji = Effect.fnUntraced(function* (
    this: SlackAdapter,
    target: MessageTarget,
    messageId: string,
    emoji: string,
  ) {
    yield* this.#api
      .call("reactions.add", { channel: target.platformChannelId, timestamp: messageId, name: emoji })
      .pipe(
        Effect.catch((failure) =>
          failure.cause instanceof SlackApiError && failure.cause.code === "already_reacted"
            ? Effect.void
            : Effect.fail(failure),
        ),
      );
  });

  readonly postAnswer = Effect.fnUntraced(function* (
    this: SlackAdapter,
    target: MessageTarget,
    markdown: string,
    replaceMessageId: string | null,
  ) {
    const [first = "", ...rest] = slackChunks(slackMrkdwn(markdown, true));
    let firstId: string;
    if (replaceMessageId) {
      firstId = replaceMessageId;
      const updated = yield* Effect.result(
        this.#api.call("chat.update", {
          channel: target.platformChannelId,
          ts: replaceMessageId,
          text: first,
          blocks: [],
        }),
      );
      if (Result.isFailure(updated)) {
        yield* this.#api
          .call("chat.delete", { channel: target.platformChannelId, ts: replaceMessageId })
          .pipe(Effect.catch(() => Effect.void));
        firstId = yield* this.#postText(target, first);
      }
    } else firstId = yield* this.#postText(target, first);
    for (const chunk of rest) yield* this.#postText(target, chunk);
    return firstId;
  });

  readonly upload = Effect.fnUntraced(function* (
    this: SlackAdapter,
    target: MessageTarget,
    files: MessagingAnswerFile[],
  ) {
    const skipped: string[] = [];
    const uploaded: Array<{ id: string; title: string }> = [];
    for (const file of files) {
      const attempt = yield* Effect.result(
        Effect.gen({ self: this }, function* () {
          const bytes = yield* adapterIo(() => readFile(file.path));
          if (bytes.byteLength > UPLOAD_BYTES || bytes.byteLength === 0) return null;
          const ticket = yield* this.#api.call("files.getUploadURLExternal", {
            filename: file.name,
            length: String(bytes.byteLength),
          });
          if (!isString(ticket.upload_url) || !isString(ticket.file_id))
            return yield* new MessagingAdapterError({ cause: new SlackApiError("files", "no_upload_url") });
          yield* this.#api.uploadBytes(ticket.upload_url, bytes, file.mimeType);
          return { id: ticket.file_id, title: file.name };
        }),
      );
      if (Result.isFailure(attempt) || attempt.success === null) skipped.push(file.name);
      else uploaded.push(attempt.success);
    }
    if (uploaded.length)
      yield* this.#api.call("files.completeUploadExternal", {
        files: uploaded,
        channel_id: target.platformChannelId,
        thread_ts: target.replyThreadId ?? undefined,
      });
    return { skipped, firstId: null };
  });

  readonly history = Effect.fnUntraced(function* (
    this: SlackAdapter,
    platformChannelId: string,
    threadKey: string,
    afterId: string | null,
    beforeId: string,
  ): Effect.fn.Return<ContextEntry[], MessagingAdapterError> {
    const response = yield* this.#api.call("conversations.replies", {
      channel: platformChannelId,
      ts: threadKey,
      latest: beforeId,
      oldest: afterId ?? undefined,
      inclusive: false,
      limit: HISTORY_LIMIT,
    });
    const messages = Array.isArray(response.messages) ? response.messages.filter(isDynamicRecord) : [];
    const kept = messages.filter((message) => {
      const ts = message.ts;
      const user = message.user;
      if (!isString(ts) || !isString(user) || user === this.#botUserId || message.bot_id !== undefined) return false;
      return Number(ts) < Number(beforeId) && !(afterId && Number(ts) <= Number(afterId));
    });
    return yield* this.#entries(kept, false);
  });

  readonly recent = Effect.fnUntraced(function* (
    this: SlackAdapter,
    platformChannelId: string,
    threadKey: string | null,
    limit: number,
  ): Effect.fn.Return<RecentMessages, MessagingAdapterError> {
    const messages = threadKey
      ? yield* this.#threadReplies(platformChannelId, threadKey)
      : yield* this.#api
          .call("conversations.history", { channel: platformChannelId, limit }, { rateLimitRetries: 0 })
          .pipe(Effect.map(responseMessages));
    const kept = messages.filter(
      (message) =>
        isString(message.ts) &&
        (message.subtype === undefined || RECENT_SUBTYPES.has(String(message.subtype))) &&
        (isString(message.user) || message.bot_id !== undefined),
    );
    return { messages: (yield* this.#entries(kept, threadKey === null)).slice(-limit) };
  });

  readonly #threadReplies = Effect.fnUntraced(function* (
    this: SlackAdapter,
    platformChannelId: string,
    threadKey: string,
  ): Effect.fn.Return<DynamicRecord[], MessagingAdapterError> {
    const messages: DynamicRecord[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < RECENT_THREAD_PAGES; page += 1) {
      const read = this.#api.call(
        "conversations.replies",
        { channel: platformChannelId, ts: threadKey, limit: RECENT_THREAD_LIMIT, cursor },
        { rateLimitRetries: 0 },
      );
      const response = page === 0 ? yield* read : yield* read.pipe(Effect.catch(() => Effect.succeed(null)));
      if (!response) break;
      messages.push(...responseMessages(response));
      const metadata = isDynamicRecord(response.response_metadata) ? response.response_metadata : {};
      cursor = isString(metadata.next_cursor) && metadata.next_cursor ? metadata.next_cursor : undefined;
      if (!cursor) break;
    }
    return messages;
  });

  readonly #entries = Effect.fnUntraced(function* (
    this: SlackAdapter,
    messages: DynamicRecord[],
    withReplyCounts: boolean,
  ): Effect.fn.Return<ContextEntry[], MessagingAdapterError> {
    const raw = messages.map((message) => (isString(message.text) ? message.text : ""));
    const names = yield* mentionNames(
      raw.flatMap((text) => slackMentionIds(text, this.#botUserId)),
      (userId) => this.authorName(userId),
    );
    const entries: ContextEntry[] = [];
    for (const [index, message] of messages.entries()) {
      const ts = String(message.ts);
      const replies = withReplyCounts && typeof message.reply_count === "number" ? message.reply_count : 0;
      const text = withMentionNames(plainText(raw[index] ?? "", this.#botUserId), names);
      entries.push({
        id: ts,
        authorName: yield* this.#author(message),
        text: replies ? `${text} (thread with ${replies} replies)` : text,
        sentAt: new Date(Number(ts) * 1000).toISOString(),
      });
    }
    return entries.sort((left, right) => Number(left.id) - Number(right.id));
  });

  readonly #author = Effect.fnUntraced(function* (this: SlackAdapter, message: DynamicRecord) {
    if (message.user === this.#botUserId) return "GoAhead";
    if (message.bot_id !== undefined || !isString(message.user)) {
      const profile = isDynamicRecord(message.bot_profile) ? message.bot_profile.name : undefined;
      const name = isString(message.username) ? message.username : isString(profile) ? profile : "a bot";
      return `${name} (bot)`;
    }
    return yield* this.authorName(message.user);
  });

  download(file: InboundFile, destination: string, maxBytes: number): Effect.Effect<void, MessagingAdapterError> {
    return this.#api.download(file.url, destination, maxBytes);
  }

  /**
   * A file of the person's inbox. The person's token reads their direct messages; the bot's reads the
   * channels it is in. Each refuses an address outside Slack, a sign-in page and a file over the cap.
   */
  async downloadInboxFile(url: string, destination: string, maxBytes: number): Promise<void> {
    const apis = this.#userApi ? [this.#userApi, this.#api] : [this.#api];
    let failure: unknown = null;
    for (const api of apis) {
      try {
        await runCauseEffect(api.download(url, destination, maxBytes, { refusePage: true }));
        return;
      } catch (error) {
        failure = error;
        // A file that is too large or not Slack's is the same for each token.
        if (error instanceof SlackApiError && ["too_large", "untrusted_file_url"].includes(error.code)) break;
      }
    }
    throw failure;
  }

  /**
   * The workspace's own emoji, read once an hour. `emoji.list` needs `emoji:read`, which the person's
   * token has only when the install asked for it; without it the inbox shows the `:name:` text.
   */
  customEmoji(): Promise<Record<string, string>> {
    const now = Date.now();
    if (this.#emoji && this.#emoji.until > now) return this.#emoji.value;
    const value = this.#readCustomEmoji();
    this.#emoji = { value, until: now + EMOJI_CACHE_MS };
    void value.then((emoji) => {
      // A failure is tried again sooner than a success.
      if (Object.keys(emoji).length === 0 && this.#emoji?.value === value)
        this.#emoji = { value, until: now + EMOJI_RETRY_MS };
    });
    return value;
  }

  async #readCustomEmoji(): Promise<Record<string, string>> {
    for (const api of this.#userApi ? [this.#userApi, this.#api] : [this.#api]) {
      try {
        const response = await runCauseEffect(api.call("emoji.list"));
        const emoji = isDynamicRecord(response.emoji) ? response.emoji : {};
        const result: Record<string, string> = {};
        for (const [name, value] of Object.entries(emoji))
          if (isString(value) && (value.startsWith("alias:") || value.startsWith("https://"))) result[name] = value;
        return result;
      } catch {
        // `missing_scope` with one token can still work with the other.
      }
    }
    return {};
  }

  plainText(text: string): string {
    return plainText(text, this.#botUserId);
  }

  async openDirectMessage(userIds: string, as: MessageSender): Promise<string> {
    const response = await runCauseEffect(
      this.#apiFor(as, "conversations.open").call("conversations.open", { users: userIds }),
    );
    const channel = isDynamicRecord(response.channel) ? response.channel.id : undefined;
    if (!isString(channel)) throw new SlackApiError("conversations.open", "no_channel");
    return channel;
  }

  async postAs(
    target: MessageTarget,
    markdown: string,
    as: MessageSender,
    options: { keepMentions?: boolean } = {},
  ): Promise<string> {
    const converted = slackMrkdwn(markdown);
    // Only user mentions come back: `<!here>`, `<!channel>` and links stay inert.
    const [first = "", ...rest] = slackChunks(
      options.keepMentions ? converted.replace(/&lt;@([UW][A-Z0-9]+)&gt;/g, "<@$1>") : converted,
    );
    const api = this.#apiFor(as, "chat.postMessage");
    const post = async (text: string) => {
      const response = await runCauseEffect(
        api.call("chat.postMessage", {
          channel: target.platformChannelId,
          thread_ts: target.replyThreadId ?? undefined,
          text,
          unfurl_links: false,
          unfurl_media: false,
        }),
      );
      if (!isString(response.ts)) throw new SlackApiError("chat.postMessage", "no_ts");
      return response.ts;
    };
    const ts = await post(first);
    for (const chunk of rest) await post(chunk);
    return ts;
  }

  /**
   * A reply that the person typed in GoAhead, posted as them with the user token. The text is sent as
   * they wrote it, only escaped, so it cannot ping a workspace. With `keepMentions` the text is client
   * text (see `clientText`): user mentions stay. `broadcast` also shows a thread reply in the
   * conversation (`reply_broadcast`). A failure names only Slack's error code.
   */
  async postAsUser(input: {
    channel: string;
    threadTs?: string;
    text: string;
    keepMentions?: boolean;
    broadcast?: boolean;
  }): Promise<{ ts: string }> {
    const response = await runCauseEffect(
      this.#apiFor("user", "chat.postMessage").call("chat.postMessage", {
        channel: input.channel,
        thread_ts: input.threadTs,
        reply_broadcast: input.broadcast && input.threadTs ? "true" : undefined,
        text: input.keepMentions ? clientText(input.text) : escapeText(input.text),
        unfurl_links: false,
        unfurl_media: false,
      }),
    );
    if (!isString(response.ts)) throw new SlackApiError("chat.postMessage", "no_ts");
    return { ts: response.ts };
  }

  /** Marks the conversation read up to `ts` for the person in Slack too, with the user token. */
  async markReadAsUser(channel: string, ts: string): Promise<void> {
    if (!this.#userApi) return;
    await runCauseEffect(this.#userApi.call("conversations.mark", { channel, ts }));
  }

  async listPersonPlaces(): Promise<Array<{ id: string; name: string; isPrivate: boolean }>> {
    const api = this.#apiFor("user", "users.conversations");
    const places: Array<{ id: string; name: string; isPrivate: boolean }> = [];
    let cursor: string | undefined;
    for (let page = 0; page < PERSON_PLACE_PAGES; page += 1) {
      const response = await runCauseEffect(
        api.call("users.conversations", {
          types: "public_channel,private_channel",
          exclude_archived: "true",
          limit: "200",
          ...(cursor ? { cursor } : {}),
        }),
      );
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
    const response = await runCauseEffect(
      this.#apiFor("user", "conversations.history").call("conversations.history", {
        channel: platformChannelId,
        limit: String(limit),
      }),
    );
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
      const response = await runCauseEffect(
        this.#api.call("chat.getPermalink", { channel: platformChannelId, message_ts: messageId }),
      );
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
      own = runCauseEffect(this.#api.call("conversations.info", { channel: platformChannelId }))
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
      await runCauseEffect(this.#userApi.call("conversations.info", { channel: platformChannelId }));
      this.#personIn.set(platformChannelId, true);
      return true;
    } catch (error) {
      if (error instanceof SlackApiError && NOT_OWN_CONVERSATION.has(error.code))
        this.#personIn.set(platformChannelId, false);
      return false;
    }
  }

  /**
   * The people of a direct or group direct message, read with the person's token: the bot is not in
   * the person's own direct messages. Null for any other conversation, without the token, or on error.
   */
  async conversationPeople(platformChannelId: string): Promise<string[] | null> {
    if (!this.#userApi) return null;
    try {
      const response = await runCauseEffect(this.#userApi.call("conversations.info", { channel: platformChannelId }));
      const channel = isDynamicRecord(response.channel) ? response.channel : {};
      const owner = this.#ownerUserId ? [this.#ownerUserId] : [];
      if (channel.is_im === true) return isString(channel.user) ? [channel.user, ...owner] : null;
      if (channel.is_mpim !== true) return null;
      const members = await runCauseEffect(
        this.#userApi.call("conversations.members", { channel: platformChannelId, limit: "100" }),
      );
      const people = Array.isArray(members.members) ? members.members.filter(isString) : [];
      return people.length > 0 ? people : null;
    } catch {
      return null;
    }
  }

  async listConversations(cursor?: string): Promise<HistoryConversationPage> {
    const response = await runCauseEffect(
      this.#apiFor("user", "users.conversations").call(
        "users.conversations",
        {
          types: "public_channel,private_channel,im,mpim",
          exclude_archived: "true",
          limit: String(CHANNEL_PAGE_LIMIT),
          cursor,
        },
        QUEUED,
      ),
    );
    const channels = Array.isArray(response.channels) ? response.channels.filter(isDynamicRecord) : [];
    const conversations = channels.flatMap((channel): HistoryConversation[] => {
      if (!isString(channel.id)) return [];
      if (channel.is_im === true) {
        const people = [channel.user, this.#ownerUserId].filter(isString);
        return [{ channelId: channel.id, kind: "im", name: "", memberIds: people, isMember: true }];
      }
      return [
        {
          channelId: channel.id,
          kind: channel.is_mpim === true ? "mpim" : channel.is_private === true ? "private" : "channel",
          name: isString(channel.name) ? channel.name : "",
          memberIds: [],
          // `users.conversations` lists only the conversations the person is in.
          isMember: channel.is_member !== false,
        },
      ];
    });
    return { conversations, nextCursor: nextCursor(response) };
  }

  async historyPage(channel: string, options: { latest?: string; limit: number }): Promise<HistoryPage> {
    const response = await runCauseEffect(
      this.#apiFor("user", "conversations.history").call(
        "conversations.history",
        { channel, latest: options.latest, limit: String(options.limit), inclusive: "false" },
        QUEUED,
      ),
    );
    return { messages: this.#historyMessages(response.messages), hasMore: response.has_more === true };
  }

  /** One page of a thread. The caller runs each page as its own queued call, so a 429 repeats one page. */
  async threadReplies(channel: string, threadTs: string, cursor?: string): Promise<HistoryThreadPage> {
    const response = await runCauseEffect(
      this.#apiFor("user", "conversations.replies").call(
        "conversations.replies",
        { channel, ts: threadTs, limit: String(CHANNEL_PAGE_LIMIT), cursor },
        QUEUED,
      ),
    );
    return { messages: this.#historyMessages(response.messages), nextCursor: nextCursor(response) };
  }

  async conversationInfo(channel: string): Promise<HistoryConversationState> {
    const response = await runCauseEffect(
      this.#apiFor("user", "conversations.info").call("conversations.info", { channel }, QUEUED),
    );
    const info = isDynamicRecord(response.channel) ? response.channel : {};
    return {
      lastReadTs: isString(info.last_read) && info.last_read ? info.last_read : null,
      unreadCount: isNumber(info.unread_count_display) ? info.unread_count_display : null,
    };
  }

  async conversationMembers(channel: string): Promise<string[]> {
    const response = await runCauseEffect(
      this.#apiFor("user", "conversations.members").call("conversations.members", { channel, limit: "100" }, QUEUED),
    );
    return Array.isArray(response.members) ? response.members.filter(isString) : [];
  }

  /** `text` is client text (see `clientText`): user mentions stay, all other markup is escaped. */
  async updateAsUser(channel: string, ts: string, text: string): Promise<void> {
    await runCauseEffect(
      this.#apiFor("user", "chat.update").call("chat.update", { channel, ts, text: clientText(text) }),
    );
  }

  async deleteAsUser(channel: string, ts: string): Promise<void> {
    await runCauseEffect(this.#apiFor("user", "chat.delete").call("chat.delete", { channel, ts }));
  }

  async reactAsUser(channel: string, ts: string, name: string, on: boolean): Promise<void> {
    try {
      const method = on ? "reactions.add" : "reactions.remove";
      await runCauseEffect(this.#apiFor("user", method).call(method, { channel, timestamp: ts, name }));
    } catch (error) {
      if (!(error instanceof SlackApiError && ["already_reacted", "no_reaction"].includes(error.code))) throw error;
    }
  }

  /**
   * `files.getUploadURLExternal`, the bytes to that Slack address (without the token), then
   * `files.completeUploadExternal`, which shares the file in the conversation as the person.
   */
  async uploadFileAsUser(input: HistoryUpload): Promise<{ fileId: string }> {
    const api = this.#apiFor("user", "files.getUploadURLExternal");
    if (input.bytes.byteLength === 0) throw new SlackApiError("files.upload", "empty_file");
    if (input.bytes.byteLength > SLACK_CLIENT_LIMITS.uploadBytes) throw new SlackApiError("files.upload", "too_large");
    const ticket = await runCauseEffect(
      api.call("files.getUploadURLExternal", {
        filename: input.name,
        length: String(input.bytes.byteLength),
      }),
    );
    if (!isString(ticket.upload_url) || !isString(ticket.file_id))
      throw new SlackApiError("files.getUploadURLExternal", "no_upload_url");
    await runCauseEffect(api.uploadBytes(ticket.upload_url, input.bytes, input.mimeType ?? "application/octet-stream"));
    await runCauseEffect(
      api.call("files.completeUploadExternal", {
        files: [{ id: ticket.file_id, title: input.name }],
        channel_id: input.channel,
        thread_ts: input.threadTs,
        initial_comment: input.initialComment ? clientText(input.initialComment) : undefined,
      }),
    );
    return { fileId: ticket.file_id };
  }

  /**
   * Matches the start of any word of a name, without case. `users.list` is read once an hour. A failed
   * read is kept for `PEOPLE_RETRY_MS`, so each keystroke of the picker does not read it again.
   */
  async searchPeople(query: string): Promise<Array<{ id: string; name: string }>> {
    const needle = query.trim().toLowerCase();
    const people = await this.#peopleList();
    return people
      .filter((person) =>
        person.names.some(
          (name) => name.split(/[\s._-]+/u).some((word) => word.startsWith(needle)) || name.startsWith(needle),
        ),
      )
      .slice(0, PEOPLE_MATCHES)
      .map(({ id, name }) => ({ id, name }));
  }

  /**
   * The people of the workspace whose display, real, first or handle name is `name`, without case.
   * The list is read again when it is a few minutes old, and on a miss when it is older than a
   * minute, so a person who joined, or whom the person never wrote to, is found too.
   */
  async findPeople(name: string): Promise<Array<{ id: string; name: string; title: string }>> {
    const needle = name.trim().toLowerCase();
    const match = (people: SlackPerson[]) =>
      people.filter((person) => person.names.includes(needle)).map(({ id, name, title }) => ({ id, name, title }));
    const found = match(await this.#peopleList(PEOPLE_SEND_MAX_AGE_MS));
    if (found.length > 0 || Date.now() - (this.#people?.readAt ?? 0) < PEOPLE_MISS_MAX_AGE_MS) return found;
    return match(await this.#peopleList(0));
  }

  #peopleList(maxAgeMs = PEOPLE_CACHE_MS): Promise<SlackPerson[]> {
    const now = Date.now();
    if (this.#people && this.#people.until > now && now - this.#people.readAt < maxAgeMs) return this.#people.value;
    const value = this.#readPeople();
    this.#people = { value, until: now + PEOPLE_CACHE_MS, readAt: now };
    value.catch(() => {
      if (this.#people?.value === value)
        this.#people = { value, until: Date.now() + PEOPLE_RETRY_MS, readAt: Date.now() };
    });
    return value;
  }

  /**
   * Not queued: `users.list` is Tier 2. Each page waits Slack's `Retry-After` on a 429 and tries that page
   * again, so a 429 never reads the pages before it again.
   */
  async #readPeople(): Promise<SlackPerson[]> {
    const people: SlackPerson[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < PEOPLE_PAGES; page += 1) {
      const response = await runCauseEffect(
        this.#api.call("users.list", { limit: String(CHANNEL_PAGE_LIMIT), cursor }),
      );
      const members = Array.isArray(response.members) ? response.members.filter(isDynamicRecord) : [];
      for (const member of members) {
        if (!isString(member.id) || member.deleted === true || member.is_bot === true || member.id === "USLACKBOT")
          continue;
        const profile = isDynamicRecord(member.profile) ? member.profile : {};
        const names = [profile.display_name, profile.real_name, member.real_name, member.name]
          .filter(isString)
          .map((name) => name.trim())
          .filter(Boolean);
        const name = names[0] ?? member.id;
        if (!this.#names.has(member.id)) {
          const known = Deferred.makeUnsafe<string>();
          Deferred.doneUnsafe(known, Effect.succeed(name));
          this.#names.set(member.id, known);
        }
        const firstName = isString(profile.first_name) ? profile.first_name.trim() : "";
        people.push({
          id: member.id,
          name,
          names: [...names, ...(firstName ? [firstName] : [])].map((entry) => entry.toLowerCase()),
          title: isString(profile.title) ? profile.title.trim() : "",
        });
      }
      const next = nextCursor(response);
      if (!next) break;
      cursor = next;
    }
    return people;
  }

  #historyMessages(value: unknown): HistoryMessage[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter(isDynamicRecord)
      .flatMap((message) => {
        const mapped = historyMessage(message, this.#ownerUserId);
        return mapped ? [mapped] : [];
      })
      .sort(byTsAscending);
  }

  /**
   * The user token is only there when the install gave one; a call as the user without it fails, and
   * the error names `method`, the Slack method that the caller was about to call.
   */
  #apiFor(as: MessageSender, method: string): SlackWebApi {
    if (as === "bot") return this.#api;
    if (!this.#userApi) throw new SlackApiError(method, "no_user_token");
    return this.#userApi;
  }

  readonly authorName = Effect.fnUntraced(function* (this: SlackAdapter, userId: string) {
    const cached = this.#names.get(userId);
    if (cached) return yield* Deferred.await(cached);
    const name = Deferred.makeUnsafe<string>();
    this.#names.set(userId, name);
    yield* Effect.forkDetach(
      this.#api.call("users.info", { user: userId }).pipe(
        Effect.map((response) => {
          const user = isDynamicRecord(response.user) ? response.user : {};
          const profile = isDynamicRecord(user.profile) ? user.profile : {};
          for (const candidate of [profile.display_name, profile.real_name, user.real_name, user.name])
            if (isString(candidate) && candidate.trim()) return candidate.trim();
          return userId;
        }),
        Effect.catch((failure) =>
          Effect.sync(() => {
            if (isTemporaryLookupFailure(failure)) this.#names.delete(userId);
            return userId;
          }),
        ),
        Effect.flatMap((result) => Deferred.succeed(name, result)),
        Effect.uninterruptible,
      ),
    );
    return yield* Deferred.await(name);
  });

  readonly placeName = Effect.fnUntraced(function* (this: SlackAdapter, platformChannelId: string) {
    const cached = this.#places.get(platformChannelId);
    if (cached) return yield* Deferred.await(cached);
    const name = Deferred.makeUnsafe<string>();
    this.#places.set(platformChannelId, name);
    // The bot reads the channels it is in; the person's token reads the private ones the bot is not in.
    const read = (api: SlackWebApi) =>
      api
        .call("conversations.info", { channel: platformChannelId })
        .pipe(
          Effect.flatMap((response) =>
            isDynamicRecord(response.channel) && isString(response.channel.name)
              ? Effect.succeed(`#${response.channel.name}`)
              : Effect.fail(new MessagingAdapterError({ cause: new SlackApiError("conversations.info", "no_name") })),
          ),
        );
    const userApi = this.#userApi;
    yield* Effect.forkDetach(
      read(this.#api).pipe(
        Effect.catch((failure) => (userApi ? read(userApi) : Effect.fail(failure))),
        Effect.catch((failure) =>
          Effect.sync(() => {
            if (isTemporaryLookupFailure(failure)) this.#places.delete(platformChannelId);
            return platformChannelId;
          }),
        ),
        Effect.flatMap((result) => Deferred.succeed(name, result)),
        Effect.uninterruptible,
      ),
    );
    return yield* Deferred.await(name);
  });

  readonly places = Effect.fnUntraced(function* (
    this: SlackAdapter,
  ): Effect.fn.Return<MessagingPlaces, MessagingAdapterError> {
    const places: MessagingPlace[] = [];
    let cursor: string | undefined;
    do {
      const page = yield* this.#api.call("users.conversations", {
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: CHANNEL_PAGE_LIMIT,
        cursor,
      });
      const channels = Array.isArray(page.channels) ? page.channels.filter(isDynamicRecord) : [];
      for (const channel of channels)
        if (isString(channel.id) && isString(channel.name))
          places.push({ id: channel.id, name: `#${channel.name}`, kind: channel.is_private ? "private" : "channel" });
      const next = isDynamicRecord(page.response_metadata) ? page.response_metadata.next_cursor : undefined;
      cursor = isString(next) && next && places.length < PLACES_LIMIT ? next : undefined;
    } while (cursor);
    return { places: places.slice(0, PLACES_LIMIT) };
  });

  readonly joinPublicPlaces = Effect.fnUntraced(function* (
    this: SlackAdapter,
  ): Effect.fn.Return<void, MessagingAdapterError> {
    let cursor: string | undefined;
    do {
      const page = yield* this.#api.call("conversations.list", {
        types: "public_channel",
        exclude_archived: true,
        limit: CHANNEL_PAGE_LIMIT,
        cursor,
      });
      const channels = Array.isArray(page.channels) ? page.channels.filter(isDynamicRecord) : [];
      for (const channel of channels)
        if (isString(channel.id) && channel.is_member !== true) yield* this.joinPlace(channel.id);
      const next = isDynamicRecord(page.response_metadata) ? page.response_metadata.next_cursor : undefined;
      cursor = isString(next) && next ? next : undefined;
    } while (cursor);
  });

  readonly joinPlace = Effect.fnUntraced(function* (this: SlackAdapter, platformChannelId: string) {
    yield* this.#api
      .call("conversations.join", { channel: platformChannelId })
      .pipe(Effect.catch((failure) => (failure.cause instanceof SlackApiError ? Effect.void : Effect.fail(failure))));
  });

  mention(userId: string): string {
    return /^[A-Z0-9]+$/.test(userId) ? `\uE000@${userId}\uE000` : userId;
  }

  #statusText(text: string): string {
    return slackMrkdwn(text).replace(/\uE000@([A-Z0-9]+)\uE000/g, "<@$1>");
  }

  readonly #postText = Effect.fnUntraced(function* (
    this: SlackAdapter,
    target: MessageTarget,
    text: string,
  ): Effect.fn.Return<string, MessagingAdapterError> {
    const response = yield* this.#api.call("chat.postMessage", {
      channel: target.platformChannelId,
      thread_ts: target.replyThreadId ?? undefined,
      text,
      unfurl_links: false,
      unfurl_media: false,
    });
    if (!isString(response.ts))
      return yield* new MessagingAdapterError({ cause: new SlackApiError("chat.postMessage", "no_ts") });
    return response.ts;
  });

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

/** Escaped so the text cannot ping a workspace: the person's own text, as they typed it. */
function escapeText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** A user mention as Slack writes it: `<@U…>` or `<@W…>`, with no label. */
const USER_MENTION = /<@[UW][A-Z0-9]+>/g;

/**
 * Client text: what the Slack client's composer sends. It is plain text, plus user mention tokens
 * `<@U…>` that the mention picker inserted. Those stay; all other `&`, `<` and `>` are escaped, so
 * `<!here>`, `<!channel>`, `<!everyone>` and links cannot ping a workspace or change the text.
 */
export function clientText(text: string): string {
  let result = "";
  let last = 0;
  for (const match of text.matchAll(USER_MENTION)) {
    result += escapeText(text.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return result + escapeText(text.slice(last));
}

function nextCursor(response: DynamicRecord): string | null {
  const next = isDynamicRecord(response.response_metadata) ? response.response_metadata.next_cursor : undefined;
  return isString(next) && next ? next : null;
}

function byTsAscending(left: { ts: string }, right: { ts: string }): number {
  return Number(left.ts) - Number(right.ts) || left.ts.localeCompare(right.ts);
}

function slackTime(ts: string): string | null {
  const seconds = Number(ts);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

/** One raw Slack message as the client's cache keeps it, or null without a `ts`. */
function historyMessage(message: DynamicRecord, ownerUserId: string | null): HistoryMessage | null {
  const ts = message.ts;
  if (!isString(ts)) return null;
  const author = [message.user, message.bot_id].find(isString) ?? "";
  const edited = isDynamicRecord(message.edited) && isString(message.edited.ts) ? slackTime(message.edited.ts) : null;
  const subtype = isString(message.subtype) ? message.subtype : null;
  return {
    ts,
    threadTs: isString(message.thread_ts) && message.thread_ts !== ts ? message.thread_ts : null,
    replyCount: isNumber(message.reply_count) ? message.reply_count : 0,
    latestReplyTs: isString(message.latest_reply) ? message.latest_reply : null,
    authorId: author,
    text: isString(message.text) ? message.text : "",
    files: historyFiles(message.files),
    reactions: historyReactions(message.reactions, ownerUserId),
    editedAt: edited,
    deleted: subtype === "tombstone",
    subtype,
  };
}

function historyReactions(value: unknown, ownerUserId: string | null): HistoryReaction[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isDynamicRecord).flatMap((reaction): HistoryReaction[] => {
    if (!isString(reaction.name)) return [];
    const userIds = Array.isArray(reaction.users) ? reaction.users.filter(isString) : [];
    const count = isNumber(reaction.count) ? reaction.count : userIds.length;
    return [{ name: reaction.name, count, userIds, mine: ownerUserId !== null && userIds.includes(ownerUserId) }];
  });
}

/** The files of a history message. Slack's private addresses stay here, in the backend. */
function historyFiles(value: unknown): InboxFile[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isDynamicRecord).flatMap((file): InboxFile[] => {
    const url = [file.url_private_download, file.url_private].find(isString);
    if (!isString(file.id) || !url) return [];
    return [
      {
        id: file.id,
        name: [file.name, file.title].find(isString) ?? file.id,
        mimeType: isString(file.mimetype) ? file.mimetype : "application/octet-stream",
        size: isNumber(file.size) ? file.size : 0,
        url,
        thumbnailUrl: [file.thumb_480, file.thumb_360, file.thumb_720].find(isString) ?? null,
        permalink: isString(file.permalink) ? file.permalink : null,
      },
    ];
  });
}

export interface SlackDriverOptions {
  origin?: string;
  ingress?: MessagingIngress;
}

function responseMessages(response: DynamicRecord): DynamicRecord[] {
  return Array.isArray(response.messages) ? response.messages.filter(isDynamicRecord) : [];
}

/** Each workspace installed the OpenBot app, and its events come through the ingress relay. */
export function slackDriver(options: SlackDriverOptions = {}): MessagingDriver {
  return {
    platform: "slack",
    requiredCredential: "botToken",
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
