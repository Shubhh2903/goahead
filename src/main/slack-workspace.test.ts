// @vitest-environment node

// End to end on the host half of the OpenBot Slack app: the real `SlackIngress` socket, the messaging
// core with its Events API transport, and `AgentService` with its SQLite database. Signal and Slack
// are local fakes: Signal is a WebSocket server that speaks the `ingress` frames, and Slack is one
// HTTP server. Signal's own route, with the signature check, is tested in
// `remote/api/test/app.test.ts`, and the Worker's install in `apps/auth-api/test/slack-app.test.ts`.
// Only the provider is faked, as in every agent service test. Writes
// .openbot-build/slack-workspace-e2e/report.json.

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join, resolve } from "node:path";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { SLACK_BOT_SCOPES, SLACK_USER_SCOPES } from "@openbot/contracts/slack-app";
import { type SlackUserGrant, sealSlackWorkspaceGrant } from "@openbot/contracts/slack-workspace-grant";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type WebSocket, WebSocketServer } from "ws";
import type { AgentService } from "../backend/agent-service";
import {
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  waitFor,
} from "../backend/agent-service-test-harness";
import { type MessagingCredentials, MessagingService } from "../backend/messaging/messaging-service";
import { slackDriver } from "../backend/messaging/slack/slack-driver";
import { SlackIngress } from "./slack-ingress";

const REPORT_DIR = resolve(import.meta.dirname, "../../.openbot-build/slack-workspace-e2e");
const BOT_TOKEN = "xoxb-9999-8888-openbotbottoken";
const USER_TOKEN = "xoxp-9999-8888-openbotusertoken";
/** A user token that Slack issued for another workspace. */
const OTHER_WORKSPACE_USER_TOKEN = "xoxp-7777-6666-otherworkspaceuser";
const USER: SlackUserGrant = { token: USER_TOKEN, id: "UME" };

interface Answer {
  status: number;
  contentType?: string;
  body?: string;
}

/** Signal's side of the `ingress` socket: it takes the host's hello and passes a workspace's requests on. */
class FakeSignal {
  readonly hellos: DynamicRecord[] = [];
  #server: WebSocketServer | null = null;
  #socket: WebSocket | null = null;
  readonly #answers = new Map<string, (answer: Answer) => void>();
  url = "";

  async start(): Promise<void> {
    this.#server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    this.#server.on("connection", (socket) => {
      socket.on("message", (data) => {
        const frame = JSON.parse(data.toString());
        if (!isDynamicRecord(frame)) return;
        if (frame.type === "hello") {
          this.hellos.push(frame);
          this.#socket = socket;
          socket.send(
            JSON.stringify({ type: "ready", version: 1, connectionId: null, resumeToken: "r", iceServers: [] }),
          );
        } else if (frame.type === "slack-delivery-result" && isString(frame.requestId)) {
          this.#answers.get(frame.requestId)?.({
            status: Number(frame.status),
            ...(isString(frame.contentType) ? { contentType: frame.contentType } : {}),
            ...(isString(frame.body) ? { body: frame.body } : {}),
          });
        }
      });
    });
    await new Promise<void>((resolve) => this.#server?.once("listening", resolve));
    const address = this.#server.address();
    if (!address || typeof address === "string") throw new Error("The fake Signal has no port.");
    this.url = `ws://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    for (const client of this.#server?.clients ?? []) client.terminate();
    await new Promise<void>((resolve) => this.#server?.close(() => resolve()));
  }

  /** One Slack request that Signal checked, as it passes it to the host, and the host's answer. */
  deliver(teamId: string, payload: DynamicRecord): Promise<Answer> {
    return this.#send(
      teamId,
      "events",
      JSON.stringify({ type: "event_callback", team_id: teamId, api_app_id: "A1", ...payload }),
    );
  }

  /** One button press on an OpenBot message, as Slack's interactivity request. */
  press(teamId: string, press: { userId: string; channel: string; actionId: string; value: string }): Promise<Answer> {
    const payload = {
      type: "block_actions",
      api_app_id: "A1",
      team: { id: teamId },
      user: { id: press.userId },
      channel: { id: press.channel },
      message: { ts: "draft.000" },
      actions: [{ action_id: press.actionId, value: press.value }],
    };
    return this.#send(teamId, "interactivity", `payload=${encodeURIComponent(JSON.stringify(payload))}`);
  }

  #send(teamId: string, kind: "events" | "interactivity", body: string): Promise<Answer> {
    const socket = this.#socket;
    if (!socket) throw new Error("The host has no ingress socket.");
    const requestId = randomUUID().replaceAll("-", "");
    return new Promise((resolve) => {
      this.#answers.set(requestId, resolve);
      socket.send(
        JSON.stringify({
          type: "slack-delivery",
          version: 1,
          requestId,
          teamId,
          kind,
          retryNum: null,
          retryReason: null,
          bodyBase64: Buffer.from(body).toString("base64"),
        }),
      );
    });
  }
}

/** Slack's Web API for the bot of the OpenBot app in one workspace, and for the person who installed it. */
class FakeSlack {
  readonly calls: Array<{ method: string; token: string | undefined; params: Record<string, string> }> = [];
  /** Tokens that Slack no longer accepts, such as after an uninstall. */
  readonly revoked = new Set<string>();
  #server: Server | null = null;
  #ts = 1000;
  origin = "";

  async start(): Promise<void> {
    this.#server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const params = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()));
      const method = (request.url ?? "").replace("/api/", "");
      const token = request.headers.authorization?.replace("Bearer ", "");
      this.calls.push({ method, token, params });
      const reply = (value: DynamicRecord, headers: Record<string, string> = {}) => {
        for (const [name, header] of Object.entries(headers)) response.setHeader(name, header);
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ ok: true, ...value }));
      };
      if (![BOT_TOKEN, USER_TOKEN, OTHER_WORKSPACE_USER_TOKEN].includes(token ?? "") || this.revoked.has(token ?? ""))
        return response.end(JSON.stringify({ ok: false, error: "invalid_auth" }));
      switch (method) {
        case "auth.test":
          if (token === BOT_TOKEN)
            return reply(
              { team_id: "T1", team: "Test workspace", user_id: "UBOT", bot_id: "B1" },
              { "x-oauth-scopes": SLACK_BOT_SCOPES.join(",") },
            );
          return reply(
            { team_id: token === USER_TOKEN ? "T1" : "T2", team: "Test workspace", user_id: "UME", user: "alice" },
            { "x-oauth-scopes": SLACK_USER_SCOPES.join(",") },
          );
        case "bots.info":
          return reply({ bot: { app_id: "A1" } });
        case "users.info":
          return reply({ user: { name: "alice", profile: { display_name: "Alice" } } });
        // The bot is not in the direct messages between the user and other people.
        case "conversations.info":
          if (token === BOT_TOKEN && params.channel?.startsWith("D-"))
            return response.end(JSON.stringify({ ok: false, error: "channel_not_found" }));
          return reply({ channel: { name: "general" } });
        // Two pages of public channels; OpenBot is already in C2.
        case "conversations.list":
          return params.cursor
            ? reply({ channels: [{ id: "C3", is_member: false }], response_metadata: { next_cursor: "" } })
            : reply({
                channels: [
                  { id: "C1", is_member: false },
                  { id: "C2", is_member: true },
                ],
                response_metadata: { next_cursor: "page-2" },
              });
        case "conversations.replies":
          return reply({ messages: [] });
        case "conversations.open":
          return reply({ channel: { id: `D-${params.users}` } });
        // A revoked token stops working, as in Slack.
        case "auth.revoke":
          if (token) this.revoked.add(token);
          return reply({ revoked: true });
        case "chat.getPermalink":
          return reply({ permalink: `https://slack.test/archives/${params.channel}/p${params.message_ts}` });
        case "chat.postMessage":
          this.#ts += 1;
          return reply({ ts: `${this.#ts}.000` });
        default:
          return reply({});
      }
    });
    await new Promise<void>((resolve) => this.#server?.listen(0, "127.0.0.1", resolve));
    const address = this.#server.address();
    if (!address || typeof address === "string") throw new Error("The fake Slack has no port.");
    this.origin = `http://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.#server?.close(() => resolve()));
  }

  of(method: string) {
    return this.calls.filter((call) => call.method === method);
  }
}

class MemoryCredentials implements MessagingCredentials {
  readonly values = new Map<string, Record<string, string>>();
  keys() {
    return [...this.values.keys()];
  }
  status(key: string) {
    return this.values.has(key) ? ("saved" as const) : ("missing" as const);
  }
  get(key: string) {
    return this.values.get(key) ?? null;
  }
  async set(key: string, values: Record<string, string>) {
    this.values.set(key, values);
  }
  async clear(key: string) {
    this.values.delete(key);
  }
  async retain(keys: ReadonlySet<string>) {
    for (const key of [...this.values.keys()]) if (!keys.has(key)) this.values.delete(key);
  }
}

function mention(eventId: string, ts: string): DynamicRecord {
  return {
    event_id: eventId,
    event: { type: "app_mention", user: "UALICE", text: "<@UBOT> hello", ts, channel: "C1" },
  };
}

let root = "";
let service: AgentService | null = null;
let messaging: MessagingService | null = null;
let ingress: SlackIngress | null = null;
let signal: FakeSignal;
let slack: FakeSlack;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
  signal = new FakeSignal();
  await signal.start();
  slack = new FakeSlack();
  await slack.start();
});

afterEach(async () => {
  await messaging?.stop();
  messaging = null;
  ingress?.dispose();
  ingress = null;
  await slack.stop();
  await signal.stop();
  await stopAgentTestFixture(root, service);
  service = null;
});

describe.sequential("OpenBot Slack app end to end", () => {
  it("connects a workspace, receives its events through Signal, and disconnects it", async () => {
    const started = await startService(root, { provider: "codex", autoComplete: true });
    service = started.service;
    await started.store.getOrCreate("slack-agent");
    const credentials = new MemoryCredentials();
    const authorizations: Array<{ hostNonce: string; hostPublicKey: string }> = [];
    const unlinked: string[] = [];
    let routeTickets = 0;
    ingress = new SlackIngress({
      hostId: () => "host-1",
      signedIn: () => true,
      issueTicket: async () => ({ ticket: "ticket-1", signalUrl: signal.url }),
      issueSlackRoute: async () => `route-${++routeTickets}`,
    });
    messaging = new MessagingService({
      threads: started.service.messaging,
      agents: {
        listAgents: () => started.service.listAgents(),
        respondToApproval: (input) => started.service.respondToApproval(input),
        onEvent: (listener) => {
          started.service.on("event", listener);
          return () => started.service.off("event", listener);
        },
        createAgentProfile: (input) => started.service.createAgentProfile(input),
        createMemory: (input) => started.service.createMemory(input),
      },
      credentials,
      drivers: [slackDriver({ origin: slack.origin, ingress })],
      downloadsRoot: join(root, "messaging-downloads"),
      ingress,
      slackApp: {
        authorize: async (input) => {
          authorizations.push(input);
          return "https://slack.com/oauth/v2/authorize?client_id=openbot";
        },
        unlink: async (workspaceId) => {
          unlinked.push(workspaceId);
        },
        openExternal: async () => undefined,
      },
      slackOrigin: slack.origin,
    });
    await messaging.start();

    // The install: the tokens come back sealed to this connect's key, and only this run opens them.
    const connect = async (user: SlackUserGrant | null) => {
      await messaging?.connectSlackWorkspace();
      const authorization = authorizations.at(-1);
      if (!authorization) throw new Error("The connect did not start.");
      const grant = await sealSlackWorkspaceGrant(authorization.hostPublicKey, authorization.hostNonce, {
        botToken: BOT_TOKEN,
        botUserId: "UBOT",
        appId: "A1",
        workspaceId: "T1",
        workspaceName: "Test workspace",
        user,
      });
      expect(await messaging?.completeSlackWorkspace("another-nonce", grant)).toBe(false);
      expect(await messaging?.completeSlackWorkspace(authorization.hostNonce, grant)).toBe(true);
    };
    // A bot-only grant, as a Worker from before the user token wrote it, connects the bot alone.
    await connect(null);
    const connection = () => messaging?.slackOverview().connections[0];
    const stored = () => [...credentials.values.values()][0] ?? {};
    const { agentId: orchestratorId } = await messaging.addOrchestrator({ workspaceId: "T1" });
    await waitFor(() => connection()?.state === "connected");
    expect(connection()).toMatchObject({
      workspaceId: "T1",
      workspaceName: "Test workspace",
      credentials: "saved",
      userId: null,
      userName: null,
    });
    expect(stored().userToken).toBeUndefined();
    // The socket told Signal its workspaces with a new route ticket after the connect.
    await waitFor(() => signal.hellos.some((hello) => hello.slackRoute === "route-2"));
    expect(signal.hellos.every((hello) => hello.peer === "ingress" && hello.token === "ticket-1")).toBe(true);

    // A mention runs the agent once, however often Slack sends it. An unknown workspace is refused.
    expect(await signal.deliver("T1", mention("Ev1", "100.000"))).toEqual({ status: 200 });
    expect(await signal.deliver("T1", mention("Ev1", "100.000"))).toEqual({ status: 200 });
    await waitFor(() => slack.of("chat.update").length > 0);
    const turns = started.client.requests.filter((request) => request.method === "turn/start");
    expect(turns).toHaveLength(1);
    expect((await signal.deliver("T9", mention("Ev2", "101.000"))).status).toBe(404);
    const [link] = started.service.messaging.store.links(orchestratorId);
    if (!link) throw new Error("The mention has no conversation.");

    // The sidebar lists the conversation under the orchestrator and reads it, read-only. Only an
    // external conversation can be read this way: the agent's own chat is refused.
    const reader = "local-user:reader";
    expect(messaging.threadSummaries()).toEqual([
      expect.objectContaining({ threadId: link.threadId, agentId: orchestratorId, workspaceId: "T1", isDirect: false }),
    ]);
    expect(messaging.threadAgent(link.threadId)).toBe(orchestratorId);
    const orchestratorChat = await started.store.ensureThreadId(orchestratorId);
    expect(() => messaging?.threadAgent(orchestratorChat)).toThrow("This Slack conversation is not available.");
    const page = started.service.readThreadPageFor(orchestratorId, link.threadId, reader);
    expect(page.readState?.unreadCount).toBeGreaterThan(0);
    started.service.markThreadRead(orchestratorId, link.threadId, reader, page.messages.at(-1)?.id ?? null);
    expect(started.service.threadReadState(reader, link.threadId).unreadCount).toBe(0);

    // An agent's request to message a person. Connected as the bot alone, nobody can approve a send
    // in Slack, so there is no draft: a stranger's word must never make OpenBot message people.
    const requestSend = (to: string, text: string) =>
      started.service.messaging.requestSend({
        agentId: orchestratorId,
        threadId: link.threadId,
        to,
        text,
        threadKey: null,
      });
    await expect(requestSend("<@UPREET>", "The GoAhead bot works with Slack now.")).rejects.toThrow();
    // The user reads the conversation itself; a message to them is refused.

    // OpenBot is in every public channel without an invitation, and in each new one.
    const joined = () => slack.of("conversations.join").map((call) => call.params.channel);
    await waitFor(() => joined().includes("C3"));
    expect(joined()).toEqual(expect.arrayContaining(["C1", "C3"]));
    expect(joined()).not.toContain("C2");
    expect(
      await signal.deliver("T1", { event_id: "Ev4", event: { type: "channel_created", channel: { id: "C4" } } }),
    ).toEqual({ status: 200 });
    await waitFor(() => joined().includes("C4"));

    // A late uninstall event while the tokens still work, as after a disconnect and a new install,
    // changes nothing: the workspace stays connected and linked.
    expect(await signal.deliver("T1", { event_id: "Ev5", event: { type: "tokens_revoked" } })).toEqual({ status: 200 });
    await waitFor(() => slack.of("auth.test").length >= 2);
    expect(connection()?.state).toBe("connected");
    expect(unlinked).toEqual([]);

    // Slack uninstalled OpenBot and refuses its token: the connection stops, and Signal stops
    // routing the workspace here.
    slack.revoked.add(BOT_TOKEN);
    expect(await signal.deliver("T1", { event_id: "Ev3", event: { type: "app_uninstalled" } })).toEqual({
      status: 200,
    });
    await waitFor(() => connection()?.state === "invalid_token");
    expect(unlinked).toEqual(["T1"]);
    // A new install gives working tokens again.
    slack.revoked.clear();

    // A user token for another workspace does not connect: the host only acts as a person in the
    // workspace that the bot is in.
    await connect({ token: OTHER_WORKSPACE_USER_TOKEN, id: "UME" });
    await waitFor(() => connection()?.state === "invalid_token");
    expect(unlinked).toEqual(["T1", "T1"]);

    // Connected again, as the person too, the workspace keeps its conversation and its agent.
    await connect(USER);
    await waitFor(() => connection()?.state === "connected");
    expect(connection()).toMatchObject({ userId: "UME", userName: "alice", missingScopes: [] });
    expect(stored().userToken).toBe(USER_TOKEN);
    expect(slack.of("auth.test").map((call) => call.token)).toContain(USER_TOKEN);
    expect(started.service.messaging.store.links(orchestratorId).map((item) => item.linkId)).toEqual([link.linkId]);
    expect(connection()?.orchestratorAgentId).toBe(orchestratorId);

    // Connected as the person, the request becomes a draft with buttons in the thread. Only the
    // connected person may approve; an approved draft is sent once, as the person; a denied one never.
    const userPosts = () => slack.of("chat.postMessage").filter((call) => call.token === USER_TOKEN);
    const buttons = () => {
      const post = slack.of("chat.postMessage").at(-1);
      const blocks = JSON.parse(post?.params.blocks ?? "[]");
      const actions = Array.isArray(blocks)
        ? blocks.filter(isDynamicRecord).find((block) => block.type === "actions")
        : undefined;
      const elements = Array.isArray(actions?.elements) ? actions.elements.filter(isDynamicRecord) : [];
      const value = (actionId: string) => String(elements.find((element) => element.action_id === actionId)?.value);
      return {
        channel: String(post?.params.channel),
        accept: value("openbot_accept"),
        decline: value("openbot_decline"),
      };
    };
    await expect(requestSend("<@UME>", "Preet replied.")).rejects.toThrow("Answer here instead");
    const receipt = await requestSend("<@UPREET>", "The GoAhead bot works with Slack now.");
    expect(receipt).toMatchObject({ status: "waiting_for_approval", sender: "user", approverId: "UME" });
    const draft = buttons();
    expect(
      await signal.press("T1", {
        userId: "UALICE",
        channel: draft.channel,
        actionId: "openbot_accept",
        value: draft.accept,
      }),
    ).toEqual({ status: 200 });
    await waitFor(() => slack.of("chat.postEphemeral").length > 0);
    expect(userPosts()).toHaveLength(0);
    expect(
      await signal.press("T1", {
        userId: "UME",
        channel: draft.channel,
        actionId: "openbot_accept",
        value: draft.accept,
      }),
    ).toEqual({ status: 200 });
    await waitFor(() => userPosts().length === 1);
    expect(slack.of("conversations.open").map((call) => [call.token, call.params.users])).toEqual([
      [USER_TOKEN, "UPREET"],
    ]);
    expect(userPosts()[0]?.params).toMatchObject({
      channel: "D-UPREET",
      text: "The GoAhead bot works with Slack now.",
    });
    await waitFor(() => started.service.messaging.store.sends().length === 1);

    // Preet's answer in that direct message comes back to the thread where the user asked, as a new
    // turn of the same agent. The user's own words there, and a direct message from someone OpenBot
    // never wrote to, start nothing: the user's private messages never reach an agent.
    const turnCount = () => started.client.requests.filter((request) => request.method === "turn/start").length;
    const before = turnCount();
    const dm = (eventId: string, channel: string, user: string, text: string, ts: string) =>
      signal.deliver("T1", {
        event_id: eventId,
        event: { type: "message", channel_type: "im", channel, user, text, ts },
      });
    expect(await dm("Ev10", "D-UPREET", "UME", "my own words", "300.000")).toEqual({ status: 200 });
    expect(await dm("Ev11", "D-UCAROL", "UCAROL", "a private message", "301.000")).toEqual({ status: 200 });
    expect(await dm("Ev12", "D-UPREET", "UPREET", "I am working on it", "302.000")).toEqual({ status: 200 });
    await waitFor(() => turnCount() === before + 1);
    const replyTurn = JSON.stringify(
      started.client.requests.filter((request) => request.method === "turn/start").at(-1),
    );
    expect(replyTurn).toContain("I am working on it");
    expect(replyTurn).toContain("replied to a message that was sent for the GoAhead user");
    expect(replyTurn).not.toContain("a private message");
    expect(started.service.messaging.store.links(orchestratorId).map((item) => item.linkId)).toEqual([link.linkId]);
    expect(started.service.messaging.store.sends()[0]).toMatchObject({
      approvedBy: "UME",
      sender: "user",
      to: "user:UPREET",
      platformChannelId: "D-UPREET",
      link: expect.stringContaining("https://slack.test/"),
    });
    // The same button again sends nothing more.
    expect(
      await signal.press("T1", {
        userId: "UME",
        channel: draft.channel,
        actionId: "openbot_accept",
        value: draft.accept,
      }),
    ).toEqual({ status: 200 });
    await waitFor(() => slack.of("chat.update").length >= 2);
    expect(userPosts()).toHaveLength(1);
    // A denied draft sends nothing.
    await requestSend("C1", "Hello channel");
    const second = buttons();
    expect(
      await signal.press("T1", {
        userId: "UME",
        channel: second.channel,
        actionId: "openbot_decline",
        value: second.decline,
      }),
    ).toEqual({ status: 200 });
    await waitFor(() => slack.of("chat.update").length >= 3);
    expect(userPosts()).toHaveLength(1);
    expect(started.service.messaging.store.sends()).toHaveLength(1);

    // Disconnect revokes both tokens, forgets them, and unlinks the workspace.
    await messaging.disconnectSlackWorkspace("T1");
    expect(slack.of("auth.revoke").map((call) => call.token)).toEqual([USER_TOKEN, BOT_TOKEN]);
    // After the disconnect, Slack refuses both tokens.
    for (const revokedToken of [USER_TOKEN, BOT_TOKEN]) {
      const check = await fetch(`${slack.origin}/api/auth.test`, {
        method: "POST",
        headers: { authorization: `Bearer ${revokedToken}` },
      });
      expect(await check.json()).toMatchObject({ ok: false, error: "invalid_auth" });
    }
    expect(credentials.values.size).toBe(0);
    expect(unlinked).toEqual(["T1", "T1", "T1"]);
    expect(messaging.slackOverview().connections).toEqual([]);

    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(
      join(REPORT_DIR, "report.json"),
      `${JSON.stringify(
        {
          connected: true,
          routeTickets,
          turns: turns.length,
          unknownWorkspace: 404,
          uninstalledUnlinked: true,
          otherWorkspaceUserTokenRefused: true,
          connectedAsUser: true,
          sendDraft: { botOnlyRefused: true, strangerCannotApprove: true, sentOnce: true, deniedNotSent: true },
          replies: { backToAskingThread: true, ownWordsIgnored: true, unrelatedDirectMessageIgnored: true },
          conversationKept: true,
          revoked: slack.of("auth.revoke").length,
        },
        null,
        2,
      )}\n`,
    );
  });
});
