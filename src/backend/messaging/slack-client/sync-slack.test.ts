// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SlackClientChanged } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenBotDatabase } from "../../openbot-database";
import { SlackAdapter } from "../slack/slack-driver";
import { slackHistoryEvent } from "../slack/slack-events";
import { SlackCacheStore } from "./cache-store";
import { applySlackClientEvent } from "./events";
import { SlackRequestQueue } from "./request-queue";
import { SlackClientSync } from "./sync-service";

// The real Slack adapter, cache, queue and sync against a fake Slack Web API.

const BOT_TOKEN = "xoxb-1111-2222-bottoken";
const USER_TOKEN = "xoxp-1111-2222-usertoken";
const OWNER = "U1";
const servers: Server[] = [];
const roots: string[] = [];
const databases: OpenBotDatabase[] = [];
const syncs: SlackClientSync[] = [];

afterEach(async () => {
  for (const sync of syncs.splice(0)) sync.stop("c1");
  for (const database of databases.splice(0)) database.close();
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface SlackCall {
  method: string;
  token: string;
  params: Record<string, string>;
}

type Route = (params: Record<string, string>) => unknown;

const NAMES: Record<string, string> = { U1: "Me", U2: "Ana", U3: "Bob" };

const CONVERSATIONS = {
  ok: true,
  channels: [
    { id: "D1", is_im: true, user: "U2" },
    { id: "G1", is_mpim: true, is_private: true, name: "mpdm-me--ana--bob-1" },
  ],
  response_metadata: { next_cursor: "" },
};

function slackMessage(ts: string, user: string, text: string) {
  return { type: "message", ts, user, text };
}

async function fakeSlack(routes: Record<string, Route>): Promise<{ origin: string; calls: SlackCall[] }> {
  const calls: SlackCall[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      const method = (request.url ?? "").replace("/api/", "");
      const token = (request.headers.authorization ?? "").replace("Bearer ", "");
      const params = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()));
      calls.push({ method, token, params });
      response.setHeader("content-type", "application/json");
      const route = routes[method];
      const body = route
        ? route(params)
        : method === "auth.test"
          ? token === USER_TOKEN
            ? { ok: true, team_id: "T1", user_id: OWNER, user: "me" }
            : { ok: true, team_id: "T1", team: "Acme", user_id: "UBOT", bot_id: "B1" }
          : method === "users.info"
            ? { ok: true, user: { id: params.user, profile: { display_name: NAMES[params.user ?? ""] ?? "" } } }
            : { ok: true };
      response.end(JSON.stringify(body));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The test server has no port.");
  return { origin: `http://127.0.0.1:${address.port}`, calls };
}

async function setup(routes: Record<string, Route>) {
  const slack = await fakeSlack({ "users.conversations": () => CONVERSATIONS, ...routes });
  const adapter = new SlackAdapter(
    { botToken: BOT_TOKEN, userToken: USER_TOKEN },
    { origin: slack.origin, rateLimited: () => undefined },
  );
  await adapter.identify();
  const root = await mkdtemp(join(tmpdir(), "openbot-slack-sync-real-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await database.initialize();
  databases.push(database);
  const now = "2026-10-09T00:00:00.000Z";
  database.connection
    .prepare(
      `INSERT INTO projection_messaging_connections
         (connection_id, platform, workspace_id, workspace_name, enabled, created_at, updated_at)
       VALUES ('c1', 'slack', 'T1', 'Acme', 1, ?, ?)`,
    )
    .run(now, now);
  const store = new SlackCacheStore(database);
  const queue = new SlackRequestQueue({ perMinute: 40 });
  const changed: SlackClientChanged[] = [];
  const warn = vi.fn();
  const sync = new SlackClientSync({
    store,
    queueFor: () => queue,
    adapterFor: () => adapter,
    names: { workspaceId: () => "T1", ownerUserId: () => OWNER },
    onChanged: (change) => changed.push(change),
    warn,
  });
  syncs.push(sync);
  return { sync, store, changed, warn, calls: slack.calls };
}

describe("SlackClientSync with the Slack adapter", () => {
  it("opening a group DM and a DM stores their newest page as the person", async () => {
    const history: Record<string, unknown[]> = {
      G1: [slackMessage("1760000002.000200", "U3", "group two"), slackMessage("1760000001.000100", "U2", "group one")],
      D1: [slackMessage("1760000003.000300", "U2", "direct one")],
    };
    const { sync, changed, warn, calls } = await setup({
      "conversations.history": (params) => ({
        ok: true,
        messages: history[params.channel ?? ""] ?? [],
        has_more: false,
      }),
    });
    await sync.refreshConversations("c1", "visible");

    for (const [channelId, texts] of [
      ["G1", ["group one", "group two"]],
      ["D1", ["direct one"]],
    ] as const) {
      const first = await sync.open("c1", channelId);
      expect(first.messages).toEqual([]);
      await vi.waitFor(() => expect(changed).toContainEqual({ workspaceId: "T1", channelId }));
      const second = await sync.open("c1", channelId);
      expect(second.messages.map((message) => message.text)).toEqual(texts);
      expect(second.loadError).toBeUndefined();
    }

    const reads = calls.filter((call) => call.method === "conversations.history");
    expect(reads.map((call) => [call.token, call.params.channel, call.params.limit, call.params.latest])).toEqual([
      [USER_TOKEN, "G1", "100", undefined],
      [USER_TOKEN, "D1", "100", undefined],
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("a refused read shows a load error and the next open reads Slack again", async () => {
    let refuse = true;
    const { sync, changed, warn, calls } = await setup({
      "conversations.history": () =>
        refuse
          ? { ok: false, error: "missing_scope" }
          : { ok: true, messages: [slackMessage("1760000001.000100", "U2", "hello")], has_more: false },
    });

    await sync.open("c1", "D1");
    await vi.waitFor(() => expect(changed).toContainEqual({ workspaceId: "T1", channelId: "D1" }));
    const failed = await sync.open("c1", "D1");
    expect(failed.loadError).toBe(true);
    // Only the error's name and Slack's code reach the log.
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ code: "missing_scope" }));

    refuse = false;
    await vi.waitFor(async () => {
      const page = await sync.open("c1", "D1");
      expect(page.messages.map((message) => message.text)).toEqual(["hello"]);
      expect(page.loadError).toBeUndefined();
    });
    // Within the same minute: the failed read did not mark the conversation fresh.
    expect(calls.filter((call) => call.method === "conversations.history").length).toBeGreaterThanOrEqual(2);
  });

  it("a group DM is named after its other members", async () => {
    let membersRead: () => void = () => undefined;
    const read = new Promise<void>((resolve) => {
      membersRead = resolve;
    });
    const { sync, calls } = await setup({
      "conversations.members": () => {
        membersRead();
        return { ok: true, members: [OWNER, "U2", "U3"] };
      },
    });

    await sync.refreshConversations("c1", "visible");
    await read;
    await vi.waitFor(async () => {
      const list = await sync.listConversations("c1");
      expect(list.find((item) => item.channelId === "G1")).toMatchObject({ name: "Ana, Bob", kind: "mpim" });
    });
    expect(calls.find((call) => call.method === "conversations.members")?.token).toBe(USER_TOKEN);

    // The next list refresh keeps the people it read.
    await sync.refreshConversations("c1", "visible");
    const list = await sync.listConversations("c1");
    expect(list.find((item) => item.channelId === "G1")?.name).toBe("Ana, Bob");
    expect(calls.filter((call) => call.method === "conversations.members")).toHaveLength(1);
  });

  it("a live message in a DM is stored and the open page shows it", async () => {
    const { sync, store } = await setup({
      "conversations.history": () => ({
        ok: true,
        messages: [slackMessage("1760000001.000100", "U2", "earlier")],
        has_more: false,
      }),
    });
    await sync.refreshConversations("c1", "visible");
    await sync.open("c1", "D1");
    await vi.waitFor(async () => expect((await sync.open("c1", "D1")).messages).toHaveLength(1));

    for (const [ts, user, text] of [
      ["1760000005.000100", "U2", "new from Ana"],
      ["1760000006.000100", OWNER, "my answer"],
    ] as const) {
      const event = slackHistoryEvent(
        { team_id: "T1", event: { type: "message", channel: "D1", channel_type: "im", ts, user, text } },
        "T1",
        OWNER,
      );
      if (!event) throw new Error("The event was not read.");
      expect(applySlackClientEvent(store, "c1", event)).toBe(true);
    }

    const page = await sync.open("c1", "D1");
    expect(page.messages.map((message) => [message.text, message.mine])).toEqual([
      ["earlier", false],
      ["new from Ana", false],
      ["my answer", true],
    ]);
  });
});
