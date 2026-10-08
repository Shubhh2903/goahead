// @vitest-environment node

import { createServer, type Server } from "node:http";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { afterEach, describe, expect, it } from "vitest";
import { SlackAdapter } from "./slack-driver";

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

/** A fake Slack Web API: `auth.test` knows both tokens, and every call is recorded. */
async function fakeSlack(): Promise<{ origin: string; calls: SlackCall[] }> {
  const calls: SlackCall[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const method = (request.url ?? "").replace("/api/", "");
      const token = (request.headers.authorization ?? "").replace("Bearer ", "");
      calls.push({ method, token, params: Object.fromEntries(new URLSearchParams(body)) });
      response.setHeader("content-type", "application/json");
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
  return { origin: `http://127.0.0.1:${address.port}`, calls };
}

async function connectedAdapter(origin: string, tokens: { botToken: string; userToken?: string }) {
  const adapter = new SlackAdapter(
    { botToken: tokens.botToken, userToken: tokens.userToken },
    { origin, rateLimited: () => undefined },
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
