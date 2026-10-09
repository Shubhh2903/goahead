// @vitest-environment node

import { createServer, type Server } from "node:http";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { afterEach, describe, expect, it } from "vitest";
import { SlackAdapter } from "./slack-driver";
import { SlackRateLimitError } from "./slack-web-api";

const BOT_TOKEN = "xoxb-1111-2222-bottoken";
const USER_TOKEN = "xoxp-1111-2222-usertoken";
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

interface SlackCall {
  method: string;
  token: string;
  params: Record<string, string>;
}

interface FakeAnswer {
  status?: number;
  headers?: Record<string, string>;
  body: unknown;
}

type FakeRoute = (params: Record<string, string>, token: string) => FakeAnswer;

/**
 * A fake Slack Web API: `auth.test` knows both tokens, and every call is recorded. A route answers one
 * method; a path outside `/api/` is the upload address that `files.getUploadURLExternal` gives.
 */
async function fakeSlack(
  routes: Record<string, FakeRoute> = {},
): Promise<{ origin: string; calls: SlackCall[]; uploads: Array<{ path: string; bytes: number; auth: string }> }> {
  const calls: SlackCall[] = [];
  const uploads: Array<{ path: string; bytes: number; auth: string }> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      const raw = Buffer.concat(chunks);
      const url = request.url ?? "";
      if (!url.startsWith("/api/")) {
        uploads.push({ path: url, bytes: raw.byteLength, auth: request.headers.authorization ?? "" });
        response.end("OK");
        return;
      }
      const method = url.replace("/api/", "");
      const token = (request.headers.authorization ?? "").replace("Bearer ", "");
      const params = Object.fromEntries(new URLSearchParams(raw.toString()));
      calls.push({ method, token, params });
      response.setHeader("content-type", "application/json");
      const route = routes[method];
      if (route) {
        const answer = route(params, token);
        response.statusCode = answer.status ?? 200;
        for (const [name, value] of Object.entries(answer.headers ?? {})) response.setHeader(name, value);
        response.end(JSON.stringify(answer.body));
        return;
      }
      if (method === "auth.test") {
        response.end(
          JSON.stringify(
            token === USER_TOKEN
              ? { ok: true, team_id: "T1", user_id: "U1", user: "shubham" }
              : { ok: true, team_id: "T1", team: "Team", user_id: "UBOT", bot_id: "B1" },
          ),
        );
        return;
      }
      if (method === "bots.info") {
        response.end(JSON.stringify({ ok: true, bot: { app_id: "A1" } }));
        return;
      }
      if (method === "chat.postMessage") {
        response.end(JSON.stringify({ ok: true, ts: "1700000000.000100" }));
        return;
      }
      response.end(JSON.stringify({ ok: true }));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The test server has no port.");
  return { origin: `http://127.0.0.1:${address.port}`, calls, uploads };
}

async function connectedAdapter(
  origin: string,
  tokens: { botToken: string; userToken?: string },
  delay?: (milliseconds: number) => Promise<void>,
) {
  const adapter = new SlackAdapter(
    { botToken: tokens.botToken, userToken: tokens.userToken },
    { origin, rateLimited: () => undefined, delay },
  );
  await adapter.identify();
  return adapter;
}

const DRAFT = {
  text: "Send this?",
  buttons: [{ action: "accept" as const, label: "Send", token: "opaque-token", style: "primary" as const }],
};

function actionsBlock(call: SlackCall | undefined) {
  const blocks = JSON.parse(call?.params.blocks ?? "[]");
  const actions = Array.isArray(blocks)
    ? blocks.filter(isDynamicRecord).find((block) => block.type === "actions")
    : null;
  if (!actions) throw new Error("The post has no actions block.");
  const [button] = Array.isArray(actions.elements) ? actions.elements.filter(isDynamicRecord) : [];
  return { blockId: actions.block_id, buttonValue: button?.value };
}

describe("SlackAdapter draft buttons", () => {
  it("draft buttons carry the owner block id", async () => {
    const slack = await fakeSlack();
    const adapter = await connectedAdapter(slack.origin, { botToken: BOT_TOKEN, userToken: USER_TOKEN });

    await adapter.post({ platformChannelId: "D1", replyThreadId: null }, DRAFT);

    const actions = actionsBlock(slack.calls.find((call) => call.method === "chat.postMessage"));
    expect(actions).toEqual({ blockId: "goahead-owner:U1", buttonValue: "opaque-token" });
  });

  it("no owner, no block id", async () => {
    const slack = await fakeSlack();
    const adapter = await connectedAdapter(slack.origin, { botToken: BOT_TOKEN });

    await adapter.post({ platformChannelId: "D1", replyThreadId: null }, DRAFT);

    const actions = actionsBlock(slack.calls.find((call) => call.method === "chat.postMessage"));
    expect(actions).toEqual({ blockId: undefined, buttonValue: "opaque-token" });
  });
});

describe("SlackAdapter.postAsUser", () => {
  it("postAsUser posts with the user token in the thread", async () => {
    const slack = await fakeSlack();
    const adapter = await connectedAdapter(slack.origin, { botToken: BOT_TOKEN, userToken: USER_TOKEN });

    const result = await adapter.postAsUser({ channel: "D1", threadTs: "1700000000.000001", text: "On it <!channel>" });

    expect(result).toEqual({ ts: "1700000000.000100" });
    const post = slack.calls.find((call) => call.method === "chat.postMessage");
    expect(post?.token).toBe(USER_TOKEN);
    expect(post?.params).toMatchObject({
      channel: "D1",
      thread_ts: "1700000000.000001",
      text: "On it &lt;!channel&gt;",
    });
  });

  it("postAsUser without a user token refuses", async () => {
    const slack = await fakeSlack();
    const adapter = await connectedAdapter(slack.origin, { botToken: BOT_TOKEN });

    await expect(adapter.postAsUser({ channel: "D1", text: "Hello" })).rejects.toThrow("no_user_token");
    expect(slack.calls.some((call) => call.method === "chat.postMessage")).toBe(false);
  });
});

const ok =
  (body: DynamicRecord): FakeRoute =>
  () => ({ body: { ok: true, ...body } });

async function personAdapter(routes: Record<string, FakeRoute>, delay?: (milliseconds: number) => Promise<void>) {
  const slack = await fakeSlack(routes);
  const adapter = await connectedAdapter(slack.origin, { botToken: BOT_TOKEN, userToken: USER_TOKEN }, delay);
  return { slack, adapter, origin: slack.origin };
}

describe("SlackAdapter client reads", () => {
  it("listConversations reads one page of every kind as the person", async () => {
    const { slack, adapter } = await personAdapter({
      "users.conversations": ok({
        channels: [
          { id: "C1", name: "general", is_member: true },
          { id: "G1", name: "secret", is_private: true, is_member: true },
          { id: "D1", is_im: true, user: "U2" },
          { id: "M1", name: "mpdm-a--b-1", is_mpim: true, is_private: true },
          { name: "no id" },
        ],
        response_metadata: { next_cursor: "next-1" },
      }),
    });

    const page = await adapter.listConversations("cursor-0");

    expect(page).toEqual({
      conversations: [
        { channelId: "C1", kind: "channel", name: "general", memberIds: [], isMember: true },
        { channelId: "G1", kind: "private", name: "secret", memberIds: [], isMember: true },
        { channelId: "D1", kind: "im", name: "", memberIds: ["U2", "U1"], isMember: true },
        { channelId: "M1", kind: "mpim", name: "mpdm-a--b-1", memberIds: [], isMember: true },
      ],
      nextCursor: "next-1",
    });
    const call = slack.calls.find((entry) => entry.method === "users.conversations");
    expect(call?.token).toBe(USER_TOKEN);
    expect(call?.params).toMatchObject({
      types: "public_channel,private_channel,im,mpim",
      limit: "200",
      exclude_archived: "true",
      cursor: "cursor-0",
    });
  });

  it("historyPage maps messages, files, reactions and edits, oldest first", async () => {
    const { slack, adapter } = await personAdapter({
      "conversations.history": ok({
        has_more: true,
        messages: [
          {
            ts: "1700000002.000200",
            user: "U1",
            text: "edited <@U2>",
            edited: { user: "U1", ts: "1700000003.000000" },
            reactions: [{ name: "eyes", count: 2, users: ["U2", "U1"] }],
          },
          {
            ts: "1700000001.000100",
            user: "U2",
            text: "a file",
            subtype: "file_share",
            thread_ts: "1700000001.000100",
            reply_count: 3,
            latest_reply: "1700000005.000000",
            files: [
              {
                id: "F1",
                name: "plan.png",
                mimetype: "image/png",
                size: 10,
                url_private: "https://files.slack.com/plan.png",
                thumb_360: "https://files.slack.com/plan_360.png",
                permalink: "https://team.slack.com/files/U2/F1/plan.png",
              },
            ],
          },
          { text: "no ts" },
        ],
      }),
    });

    const page = await adapter.historyPage("C1", { latest: "1700000009.000000", limit: 100 });

    expect(page.hasMore).toBe(true);
    expect(page.messages).toEqual([
      {
        ts: "1700000001.000100",
        threadTs: null,
        replyCount: 3,
        latestReplyTs: "1700000005.000000",
        authorId: "U2",
        text: "a file",
        files: [
          {
            id: "F1",
            name: "plan.png",
            mimeType: "image/png",
            size: 10,
            url: "https://files.slack.com/plan.png",
            thumbnailUrl: "https://files.slack.com/plan_360.png",
            permalink: "https://team.slack.com/files/U2/F1/plan.png",
          },
        ],
        reactions: [],
        editedAt: null,
        deleted: false,
        subtype: "file_share",
      },
      {
        ts: "1700000002.000200",
        threadTs: null,
        replyCount: 0,
        latestReplyTs: null,
        authorId: "U1",
        text: "edited <@U2>",
        files: [],
        reactions: [{ name: "eyes", count: 2, userIds: ["U2", "U1"], mine: true }],
        editedAt: new Date(1700000003000).toISOString(),
        deleted: false,
        subtype: null,
      },
    ]);
    const call = slack.calls.find((entry) => entry.method === "conversations.history");
    expect(call?.token).toBe(USER_TOKEN);
    expect(call?.params).toMatchObject({
      channel: "C1",
      latest: "1700000009.000000",
      limit: "100",
      inclusive: "false",
    });
  });

  it("threadReplies reads one page per call, and the cursor gives the next", async () => {
    const { slack, adapter } = await personAdapter({
      "conversations.replies": (params) =>
        params.cursor
          ? { body: { ok: true, messages: [{ ts: "1700000003.000000", user: "U2", thread_ts: "1700000001.000000" }] } }
          : {
              body: {
                ok: true,
                messages: [
                  { ts: "1700000001.000000", user: "U1", thread_ts: "1700000001.000000", reply_count: 2 },
                  { ts: "1700000002.000000", user: "U2", thread_ts: "1700000001.000000", subtype: "tombstone" },
                ],
                response_metadata: { next_cursor: "page-2" },
              },
            },
    });

    const first = await adapter.threadReplies("C1", "1700000001.000000");
    const second = await adapter.threadReplies("C1", "1700000001.000000", first.nextCursor ?? undefined);

    expect(first.nextCursor).toBe("page-2");
    expect(second.nextCursor).toBeNull();
    expect(
      [...first.messages, ...second.messages].map((message) => [message.ts, message.threadTs, message.deleted]),
    ).toEqual([
      ["1700000001.000000", null, false],
      ["1700000002.000000", "1700000001.000000", true],
      ["1700000003.000000", "1700000001.000000", false],
    ]);
    expect(
      slack.calls.filter((entry) => entry.method === "conversations.replies").map((entry) => entry.params.cursor),
    ).toEqual([undefined, "page-2"]);
  });

  it("conversationInfo gives the read mark and unread count when Slack has them", async () => {
    const { adapter } = await personAdapter({
      "conversations.info": (params) => ({
        body:
          params.channel === "C1"
            ? { ok: true, channel: { id: "C1", last_read: "1700000001.000000", unread_count_display: 4 } }
            : { ok: true, channel: { id: "C2" } },
      }),
    });

    await expect(adapter.conversationInfo("C1")).resolves.toEqual({ lastReadTs: "1700000001.000000", unreadCount: 4 });
    await expect(adapter.conversationInfo("C2")).resolves.toEqual({ lastReadTs: null, unreadCount: null });
  });

  it("searchPeople reads users.list once and matches names", async () => {
    const { slack, adapter } = await personAdapter({
      "users.list": ok({
        members: [
          { id: "U2", name: "ada", profile: { display_name: "Ada L", real_name: "Ada Lovelace" } },
          { id: "U3", name: "alan", real_name: "Alan Turing" },
          { id: "U4", name: "gone", deleted: true },
          { id: "B9", name: "adabot", is_bot: true },
        ],
      }),
    });

    await expect(adapter.searchPeople("ada")).resolves.toEqual([{ id: "U2", name: "Ada L" }]);
    await expect(adapter.searchPeople("TURING")).resolves.toEqual([{ id: "U3", name: "Alan Turing" }]);
    expect(slack.calls.filter((entry) => entry.method === "users.list")).toHaveLength(1);
  });

  it("a 429 on users.list page 2 waits Retry-After and does not read page 1 again", async () => {
    let limited = false;
    const waits: number[] = [];
    const { slack, adapter } = await personAdapter(
      {
        "users.list": (params) => {
          if (!params.cursor)
            return {
              body: { ok: true, members: [{ id: "U2", name: "ada" }], response_metadata: { next_cursor: "p2" } },
            };
          if (!limited) {
            limited = true;
            return { status: 429, headers: { "retry-after": "3" }, body: { ok: false } };
          }
          return { body: { ok: true, members: [{ id: "U3", name: "adam" }] } };
        },
      },
      async (milliseconds) => {
        waits.push(milliseconds);
      },
    );

    await expect(adapter.searchPeople("ada")).resolves.toEqual([
      { id: "U2", name: "ada" },
      { id: "U3", name: "adam" },
    ]);
    expect(waits).toEqual([3000]);
    expect(slack.calls.filter((entry) => entry.method === "users.list").map((entry) => entry.params.cursor)).toEqual([
      undefined,
      "p2",
      "p2",
    ]);
  });
});

describe("SlackAdapter client actions", () => {
  it("updateAsUser and deleteAsUser act with the user token", async () => {
    const { slack, adapter } = await personAdapter({});

    await adapter.updateAsUser("C1", "1700000001.000000", "Fixed <@U2> <!here> <@U3|x>");
    await adapter.deleteAsUser("C1", "1700000001.000000");

    const update = slack.calls.find((entry) => entry.method === "chat.update");
    const remove = slack.calls.find((entry) => entry.method === "chat.delete");
    expect(update?.token).toBe(USER_TOKEN);
    expect(update?.params).toMatchObject({
      channel: "C1",
      ts: "1700000001.000000",
      text: "Fixed <@U2> &lt;!here&gt; &lt;@U3|x&gt;",
    });
    expect(remove?.token).toBe(USER_TOKEN);
    expect(remove?.params).toMatchObject({ channel: "C1", ts: "1700000001.000000" });
  });

  it("reactAsUser adds and removes, and an existing state is not an error", async () => {
    const { slack, adapter } = await personAdapter({
      "reactions.add": () => ({ body: { ok: false, error: "already_reacted" } }),
    });

    await adapter.reactAsUser("C1", "1700000001.000000", "tada", true);
    await adapter.reactAsUser("C1", "1700000001.000000", "tada", false);

    const add = slack.calls.find((entry) => entry.method === "reactions.add");
    const remove = slack.calls.find((entry) => entry.method === "reactions.remove");
    expect(add?.token).toBe(USER_TOKEN);
    expect(add?.params).toMatchObject({ channel: "C1", timestamp: "1700000001.000000", name: "tada" });
    expect(remove?.params).toMatchObject({ channel: "C1", timestamp: "1700000001.000000", name: "tada" });
  });

  it("uploadFileAsUser gets an address, sends the bytes there without a token, and completes", async () => {
    let origin = "";
    const {
      slack,
      adapter,
      origin: slackOrigin,
    } = await personAdapter({
      "files.getUploadURLExternal": () => ({
        body: { ok: true, upload_url: `${origin}/upload/F7`, file_id: "F7" },
      }),
    });
    origin = slackOrigin;

    const result = await adapter.uploadFileAsUser({
      channel: "C1",
      threadTs: "1700000001.000000",
      name: "notes.txt",
      bytes: new TextEncoder().encode("hello"),
      initialComment: "see <!channel> <@W9>",
    });

    expect(result).toEqual({ fileId: "F7" });
    expect(slack.uploads).toEqual([{ path: "/upload/F7", bytes: 5, auth: "" }]);
    const ticket = slack.calls.find((entry) => entry.method === "files.getUploadURLExternal");
    expect(ticket?.token).toBe(USER_TOKEN);
    expect(ticket?.params).toMatchObject({ filename: "notes.txt", length: "5" });
    const complete = slack.calls.find((entry) => entry.method === "files.completeUploadExternal");
    expect(complete?.token).toBe(USER_TOKEN);
    expect(complete?.params).toMatchObject({
      channel_id: "C1",
      thread_ts: "1700000001.000000",
      initial_comment: "see &lt;!channel&gt; <@W9>",
    });
    expect(JSON.parse(complete?.params.files ?? "[]")).toEqual([{ id: "F7", title: "notes.txt" }]);
  });

  it("uploadFileAsUser refuses a file over 50 MB before any Slack call", async () => {
    const { slack, adapter } = await personAdapter({});
    const before = slack.calls.length;

    await expect(
      adapter.uploadFileAsUser({ channel: "C1", name: "big.bin", bytes: new Uint8Array(50 * 1024 * 1024 + 1) }),
    ).rejects.toThrow("too_large");
    expect(slack.calls.length).toBe(before);
  });
});

describe("SlackAdapter client failures", () => {
  it("a 429 becomes a typed error with the Retry-After seconds, at once", async () => {
    const { slack, adapter } = await personAdapter({
      "conversations.history": () => ({ status: 429, headers: { "retry-after": "7" }, body: { ok: false } }),
    });

    const failure = await adapter.historyPage("C1", { limit: 100 }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SlackRateLimitError);
    expect(failure).toMatchObject({ status: 429, retryAfterSeconds: 7, code: "ratelimited" });
    expect(slack.calls.filter((entry) => entry.method === "conversations.history")).toHaveLength(1);
  });

  it("a failure never names a token", async () => {
    const { adapter } = await personAdapter({
      "chat.update": () => ({ body: { ok: false, error: "cant_update_message" } }),
      "users.conversations": () => ({ status: 429, headers: { "retry-after": "2" }, body: { ok: false } }),
    });

    const failures = await Promise.all([
      adapter.updateAsUser("C1", "1700000001.000000", "x").catch((error: unknown) => error),
      adapter.listConversations().catch((error: unknown) => error),
    ]);

    for (const failure of failures) {
      expect(failure).toBeInstanceOf(Error);
      const text =
        failure instanceof Error ? `${failure.message} ${failure.stack ?? ""} ${JSON.stringify(failure)}` : "";
      expect(text).not.toContain(USER_TOKEN);
      expect(text).not.toContain(BOT_TOKEN);
    }
  });

  it("client actions without a user token refuse before any call", async () => {
    const slack = await fakeSlack();
    const adapter = await connectedAdapter(slack.origin, { botToken: BOT_TOKEN });
    const before = slack.calls.length;

    await expect(adapter.historyPage("C1", { limit: 100 })).rejects.toThrow("no_user_token");
    await expect(adapter.deleteAsUser("C1", "1700000001.000000")).rejects.toThrow("no_user_token");
    expect(slack.calls.length).toBe(before);
  });
});
