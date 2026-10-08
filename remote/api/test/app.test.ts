import { createHmac, generateKeyPairSync } from "node:crypto";
import type { SlackRouteTeam } from "@openbot/contracts/signal-protocol/slack-route";
import { exportJWK, SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import { createRemoteApiApp, signalClientIp } from "../src/app";
import { readRemoteApiConfig } from "../src/config";
import type { RemoteTicketClaims } from "../src/protocol";
import { type RemoteTokenProvider, SignalService, type SlackAudienceLookup } from "../src/signal-service";
import type { SlackTarget } from "../src/slack-targets";
import { RemoteTokenService, signServiceRequest } from "../src/tokens";

describe("Remote API proxy addresses", () => {
  it("uses the first forwarded address only when the proxy is trusted", () => {
    expect(signalClientIp("127.0.0.1", "198.51.100.20, 127.0.0.1", true)).toBe("198.51.100.20");
    expect(signalClientIp("203.0.113.8", "198.51.100.20", false)).toBe("203.0.113.8");
  });
});

describe("Remote API development configuration", () => {
  it("uses the Auth API public JWKS binding for a local Signal service", () => {
    expect(
      readRemoteApiConfig({
        REMOTE_TICKET_PUBLIC_JWKS: '{"keys":[]}',
        REMOTE_TLS_DISABLED: "true",
        REMOTE_CONTROL_PLANE_URL: "http://127.0.0.1:3100",
        REMOTE_SESSION_SECRET: "s".repeat(32),
        REMOTE_AUTH_WEBHOOK_SECRET: "w".repeat(32),
        TURN_SHARED_SECRET: "t".repeat(32),
        TURN_HOST: "192.168.1.143",
      }).ticketJwks,
    ).toBe('{"keys":[]}');
  });
});

describe("signed account notifications", () => {
  it("verifies the exact HTTP body before delivering profile invalidation", async () => {
    const config = readRemoteApiConfig({
      REMOTE_TICKET_JWKS_URL: "https://api.example.test/.well-known/jwks.json",
      REMOTE_TLS_DISABLED: "true",
      REMOTE_CONTROL_PLANE_URL: "http://127.0.0.1:3100",
      REMOTE_SESSION_SECRET: "s".repeat(32),
      REMOTE_AUTH_WEBHOOK_SECRET: "w".repeat(32),
      TURN_SHARED_SECRET: "t".repeat(32),
      TURN_HOST: "localhost",
    });
    const signal = new SignalService(new RemoteTokenService(config), 8);
    const changed = vi.spyOn(signal, "profileChanged");
    const app = createRemoteApiApp(config, signal);
    const body = '{ "type": "account-profile-changed", "userId": "user-1" }';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signServiceRequest(body, timestamp, config.authWebhookSecret);
    const send = (payload: string, signed: string) =>
      app.handle(
        new Request("http://localhost/internal/auth-events", {
          method: "POST",
          headers: { "Content-Type": "application/json", "OpenBot-Timestamp": timestamp, "OpenBot-Signature": signed },
          body: payload,
        }),
      );
    const response = await send(body, signature);
    expect(response.status, await response.text()).toBe(204);
    expect(changed).toHaveBeenCalledWith("user-1");
    changed.mockClear();
    expect((await send(body.replace("user-1", "user-2"), signature)).status).toBe(401);
    expect((await send(body, "")).status).toBe(401);
    expect(changed).not.toHaveBeenCalled();
  });

  it("forwards a changed server list to the account that joined or lost one", async () => {
    const config = readRemoteApiConfig({
      REMOTE_TICKET_JWKS_URL: "https://api.example.test/.well-known/jwks.json",
      REMOTE_TLS_DISABLED: "true",
      REMOTE_CONTROL_PLANE_URL: "http://127.0.0.1:3100",
      REMOTE_SESSION_SECRET: "s".repeat(32),
      REMOTE_AUTH_WEBHOOK_SECRET: "w".repeat(32),
      TURN_SHARED_SECRET: "t".repeat(32),
      TURN_HOST: "localhost",
    });
    const signal = new SignalService(new RemoteTokenService(config), 8);
    const changed = vi.spyOn(signal, "serversChanged");
    const app = createRemoteApiApp(config, signal);
    const body = '{ "type": "account-servers-changed", "userId": "user-1" }';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await app.handle(
      new Request("http://localhost/internal/auth-events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "OpenBot-Timestamp": timestamp,
          "OpenBot-Signature": signServiceRequest(body, timestamp, config.authWebhookSecret),
        },
        body,
      }),
    );
    expect(response.status, await response.text()).toBe(204);
    expect(changed).toHaveBeenCalledWith("user-1");
  });
});

// Slack posts to Signal from the internet, so each refusal here is a security check: nothing reaches
// a host unless Slack signed it with the app's signing secret, and a host receives only the
// workspaces that a route ticket from the account service links to it.
describe("Slack request route", () => {
  const signingSecret = "8f742231b10e8888abcd99yyyzzz85a5";
  const developmentSecret = "d".repeat(32);

  it("checks Slack's signature and passes the request to the workspace's host", async () => {
    const { app, signal, route } = await slackRoute(signingSecret);
    const body =
      '{"type":"event_callback","api_app_id":"APROD","team_id":"T1","event_id":"Ev1","event":{"type":"app_mention"}}';

    // Nothing unsigned passes, and a challenge is answered with no host.
    expect((await post(app, body, { signature: `v0=${"a".repeat(64)}` })).status).toBe(401);
    expect((await post(app, body, { timestamp: "1" })).status).toBe(401);
    expect((await post(app, body.replace("T1", "T2"), { signedBody: body })).status).toBe(401);
    expect((await post(app, body, { contentType: "text/plain" })).status).toBe(415);
    expect((await post(app, "x".repeat(64 * 1024 + 1))).status).toBe(413);
    expect((await post(app, '{"type":"event_callback"}')).status).toBe(400);
    const challenge = await post(app, '{"type":"url_verification","challenge":"abc"}');
    expect(challenge.status).toBe(200);
    expect(await challenge.text()).toBe("abc");
    expect((await post(app, body)).status).toBe(503);

    // An ingress socket needs a route ticket for its own host, and it is not expired.
    const refused = async (slackRoute: string | undefined) => {
      const socket = testSocket(crypto.randomUUID());
      signal.connect(socket);
      await signal.receive(
        socket,
        JSON.stringify({ type: "hello", version: 1, peer: "ingress", token: "t", slackRoute }),
      );
      return socket.messages.at(-1) ?? "";
    };
    expect(await refused(undefined)).toContain('"code":"authentication_required"');
    expect(await refused(await route({ hid: "host-2", teams: ["T1"] }))).toContain('"code":"authentication_required"');
    expect(await refused(await route({ hid: "host-1", teams: ["T1"] }, -60))).toContain(
      '"code":"authentication_required"',
    );

    const ingress = testSocket("ingress");
    signal.connect(ingress);
    await signal.receive(
      ingress,
      JSON.stringify({
        type: "hello",
        version: 1,
        peer: "ingress",
        token: "host-ticket",
        slackRoute: await route({ hid: "host-1", teams: ["T1"] }),
      }),
    );
    expect(ingress.messages.at(-1)).toContain('"type":"ready"');
    ingress.messages.length = 0;

    // A workspace that the ticket does not name still has no host.
    expect((await post(app, body.replace("T1", "T9"))).status).toBe(503);

    const pending = post(app, body);
    await vi.waitFor(() => expect(ingress.messages).toHaveLength(1));
    const delivery = JSON.parse(ingress.messages[0] ?? "{}");
    expect(delivery).toMatchObject({ type: "slack-delivery", teamId: "T1", kind: "events" });
    expect(Buffer.from(delivery.bodyBase64, "base64").toString()).toBe(body);

    // Another socket cannot answer a request that Signal did not send it.
    const other = testSocket("other");
    signal.connect(other);
    await signal.receive(
      other,
      JSON.stringify({
        type: "hello",
        version: 1,
        peer: "ingress",
        token: "host-ticket",
        slackRoute: await route({ hid: "host-1", teams: [] }),
      }),
    );
    const answer = { type: "slack-delivery-result", version: 1, requestId: delivery.requestId, status: 200 };
    await signal.receive(other, JSON.stringify(answer));
    expect(other.messages.at(-1)).toContain('"code":"permission_denied"');

    await signal.receive(ingress, JSON.stringify(answer));
    expect((await pending).status).toBe(200);

    // A button press carries the workspace inside the form's `payload`.
    const press = `payload=${encodeURIComponent('{"type":"block_actions","api_app_id":"APROD","team":{"id":"T1"}}')}`;
    const pressed = post(app, press, { contentType: "application/x-www-form-urlencoded" });
    await vi.waitFor(() => expect(ingress.messages).toHaveLength(2));
    expect(JSON.parse(ingress.messages[1] ?? "{}")).toMatchObject({ teamId: "T1", kind: "interactivity" });
    signal.disconnect(ingress);
    expect((await pressed).status).toBe(503);
  });

  it("keeps a workspace with its newest link, and drops a revoked one", async () => {
    const { app, signal, route, revoke } = await slackRoute(signingSecret);
    const connect = async (id: string, linkedAt: number) => {
      const socket = testSocket(id);
      signal.connect(socket);
      await signal.receive(
        socket,
        JSON.stringify({
          type: "hello",
          version: 1,
          peer: "ingress",
          token: "host-ticket",
          slackRoute: await route({ hid: "host-1", teams: ["T1"] }, 3_600, linkedAt),
        }),
      );
      expect(socket.messages.at(-1)).toContain('"type":"ready"');
      socket.messages.length = 0;
      return socket;
    };
    const body =
      '{"type":"event_callback","api_app_id":"APROD","team_id":"T1","event_id":"Ev2","event":{"type":"app_mention"}}';
    const delivered = async (socket: TestSocket) => {
      const pending = post(app, body);
      await vi.waitFor(() => expect(socket.messages).toHaveLength(1));
      const { requestId } = JSON.parse(socket.messages.pop() ?? "{}");
      await signal.receive(
        socket,
        JSON.stringify({ type: "slack-delivery-result", version: 1, requestId, status: 200 }),
      );
      expect((await pending).status).toBe(200);
    };

    // The workspace moved to a new host. The host that lost it still holds an unexpired ticket with
    // the older link, and connects after the new one.
    const current = await connect("current", 2_000);
    const stale = await connect("stale", 1_000);
    await delivered(current);
    expect(stale.messages).toHaveLength(0);

    // Unlinked: the route goes at once, and the last ticket cannot bring it back.
    await revoke("T1", 2_500);
    expect((await post(app, body)).status).toBe(503);
    await connect("replay", 2_000);
    expect((await post(app, body)).status).toBe(503);

    // A later link answers again. A revocation older than the current link changes nothing.
    const relinked = await connect("relinked", 3_000);
    await revoke("T1", 2_999);
    await delivered(relinked);
  });

  it("after a start, takes only the links that the account service confirms", async () => {
    // Signal restarted, so it lost the revocations it held. D1 links T1 to this host with the
    // newer link only.
    let available = true;
    // The answer of an account service from before multi-user Slack: workspace IDs only.
    const { app, signal, route } = await slackRoute(signingSecret, async (_hostId, teams) => {
      if (!available) throw new Error("offline");
      return { teams: teams.filter((team) => team.linkedAt === 2_000).map((team) => team.id) };
    });
    const hello = async (linkedAt: number) => {
      const socket = testSocket(crypto.randomUUID());
      signal.connect(socket);
      await signal.receive(
        socket,
        JSON.stringify({
          type: "hello",
          version: 1,
          peer: "ingress",
          token: "host-ticket",
          slackRoute: await route({ hid: "host-1", teams: ["T1"] }, 3_600, linkedAt),
        }),
      );
      return socket;
    };
    const body =
      '{"type":"event_callback","api_app_id":"APROD","team_id":"T1","event_id":"Ev3","event":{"type":"app_mention"}}';

    // The ticket of a host that lost the workspace before the restart.
    expect((await hello(1_000)).messages.at(-1)).toContain('"type":"ready"');
    expect((await post(app, body)).status).toBe(503);

    // Without an answer from the account service, the socket does not connect, and tries again.
    available = false;
    expect((await hello(2_000)).messages.at(-1)).toContain('"code":"authentication_required"');
    expect((await post(app, body)).status).toBe(503);

    available = true;
    const current = await hello(2_000);
    const pending = post(app, body);
    await vi.waitFor(() => expect(current.messages).toHaveLength(2));
    const { requestId } = JSON.parse(current.messages[1] ?? "{}");
    await signal.receive(
      current,
      JSON.stringify({ type: "slack-delivery-result", version: 1, requestId, status: 200 }),
    );
    expect((await pending).status).toBe(200);
  });

  it("keeps each app's route of a workspace apart, and binds each secret to its app", async () => {
    // The production and development apps are both installed in T1, each linked to its own host.
    const { app, signal, route } = await slackRoute(signingSecret);
    const connect = async (id: string, appId: string) => {
      const socket = testSocket(id);
      signal.connect(socket);
      await signal.receive(
        socket,
        JSON.stringify({
          type: "hello",
          version: 1,
          peer: "ingress",
          token: "host-ticket",
          slackRoute: await route({ hid: "host-1", teams: ["T1"] }, 3_600, 1_000, appId),
        }),
      );
      socket.messages.length = 0;
      return socket;
    };
    const production = await connect("production", "APROD");
    const development = await connect("development", "ADEV");
    const event = (appId: string) =>
      `{"type":"event_callback","api_app_id":"${appId}","team_id":"T1","event_id":"Ev4","event":{"type":"app_mention"}}`;

    // The development app's secret cannot send a request in the production app's name.
    expect((await post(app, event("APROD"), { secret: developmentSecret })).status).toBe(401);
    expect(production.messages).toHaveLength(0);

    const answer = async (socket: TestSocket, pending: Promise<Response>) => {
      await vi.waitFor(() => expect(socket.messages).toHaveLength(1));
      const { requestId } = JSON.parse(socket.messages.pop() ?? "{}");
      await signal.receive(
        socket,
        JSON.stringify({ type: "slack-delivery-result", version: 1, requestId, status: 200 }),
      );
      expect((await pending).status).toBe(200);
    };
    await answer(development, post(app, event("ADEV"), { secret: developmentSecret }));
    expect(production.messages).toHaveLength(0);
    await answer(production, post(app, event("APROD")));
    expect(development.messages).toHaveLength(0);
  });

  // Multi-user Slack: a host holds the workspace's default route, person routes, or both. Signal
  // keeps the two kinds apart, so a person's host never takes the workspace from the default.
  describe("default and person routes", () => {
    const ingress = async (
      signal: SignalService,
      route: Awaited<ReturnType<typeof slackRoute>>["route"],
      id: string,
      teams: (string | SlackRouteTeam)[],
    ) => {
      const socket = testSocket(id);
      signal.connect(socket);
      await signal.receive(
        socket,
        JSON.stringify({
          type: "hello",
          version: 1,
          peer: "ingress",
          token: "host-ticket",
          slackRoute: await route({ hid: "host-1", teams }),
        }),
      );
      expect(socket.messages.at(-1)).toContain('"type":"ready"');
      socket.messages.length = 0;
      return socket;
    };
    const person = (userId: string): SlackTarget => ({ kind: "person", userId });
    const team = (users: { id: string; linkedAt: number }[], isDefault = false, linkedAt = 1_000) => ({
      id: "T1",
      appId: "APROD",
      linkedAt,
      isDefault,
      users,
    });

    it("old ticket keeps workspace route", async () => {
      const { app, signal, route } = await slackRoute(signingSecret);
      const old = await ingress(signal, route, "old", ["T1"]);
      expect(signal.slackSockets("APROD", "T1", { kind: "default" })).toEqual([old.id]);
      const body =
        '{"type":"event_callback","api_app_id":"APROD","team_id":"T1","event_id":"Ev5","event":{"type":"app_mention"}}';
      const pending = post(app, body);
      await vi.waitFor(() => expect(old.messages).toHaveLength(1));
      const { requestId } = JSON.parse(old.messages.pop() ?? "{}");
      await signal.receive(old, JSON.stringify({ type: "slack-delivery-result", version: 1, requestId, status: 200 }));
      expect((await pending).status).toBe(200);
    });

    it("person-only ticket does not take the workspace", async () => {
      const { signal, route } = await slackRoute(signingSecret);
      const shubham = await ingress(signal, route, "shubham", [team([{ id: "U1", linkedAt: 1_000 }], true)]);
      const preet = await ingress(signal, route, "preet", [team([{ id: "U2", linkedAt: 2_000 }], false, 2_000)]);
      expect(signal.slackSockets("APROD", "T1", { kind: "default" })).toEqual([shubham.id]);
      expect(signal.slackSockets("APROD", "T1", person("U1"))).toEqual([shubham.id]);
      expect(signal.slackSockets("APROD", "T1", person("U2"))).toEqual([preet.id]);
      expect(signal.slackSockets("APROD", "T1", { kind: "all" }).sort()).toEqual([preet.id, shubham.id].sort());
      // Preet's host goes offline: Shubham's routes stay.
      signal.disconnect(preet);
      expect(signal.slackSockets("APROD", "T1", person("U2"))).toEqual([]);
      expect(signal.slackSockets("APROD", "T1", { kind: "default" })).toEqual([shubham.id]);
    });

    it("person revocation drops only that person", async () => {
      const { signal, route, revokePerson } = await slackRoute(signingSecret);
      const shubham = await ingress(signal, route, "shubham", [team([{ id: "U1", linkedAt: 1_000 }], true)]);
      const preet = await ingress(signal, route, "preet", [team([{ id: "U2", linkedAt: 2_000 }], false, 2_000)]);
      await revokePerson("T1", "U2", 2_500);
      expect(signal.slackSockets("APROD", "T1", person("U2"))).toEqual([]);
      expect(signal.slackSockets("APROD", "T1", person("U1"))).toEqual([shubham.id]);
      expect(signal.slackSockets("APROD", "T1", { kind: "default" })).toEqual([shubham.id]);
      // The revoked ticket cannot bring the person back.
      await ingress(signal, route, "preet-replay", [team([{ id: "U2", linkedAt: 2_000 }], false, 2_000)]);
      expect(signal.slackSockets("APROD", "T1", person("U2"))).toEqual([]);
      expect(preet.messages).toHaveLength(0);
    });

    it("newer person link wins over an older ticket", async () => {
      const { signal, route } = await slackRoute(signingSecret);
      // Preet moved to a new computer. The old computer still holds a ticket with the older link,
      // and it connects after the new one.
      const current = await ingress(signal, route, "current", [team([{ id: "U2", linkedAt: 2_000 }], false, 2_000)]);
      await ingress(signal, route, "stale", [team([{ id: "U2", linkedAt: 1_000 }], false, 1_000)]);
      expect(signal.slackSockets("APROD", "T1", person("U2"))).toEqual([current.id]);
      expect(signal.slackSockets("APROD", "T1", { kind: "persons", userIds: ["U2", "U3"] })).toEqual([current.id]);
    });

    // A person with an own route is answered only by their own host. When it is offline, Slack
    // retries; the default never sees the request.
    const mention = (author: string) =>
      JSON.stringify({
        type: "event_callback",
        api_app_id: "APROD",
        team_id: "T1",
        event_id: `Ev-${crypto.randomUUID()}`,
        event: { type: "app_mention", user: author, text: "hi" },
      });
    const directMessage = (author: string) =>
      JSON.stringify({
        type: "event_callback",
        api_app_id: "APROD",
        team_id: "T1",
        event_id: `Ev-${crypto.randomUUID()}`,
        event_context: "EC-1",
        event: { type: "message", channel_type: "im", user: author, text: "hi" },
        authorizations: [{ team_id: "T1", user_id: "UBOT", is_bot: true }],
      });
    const answered = async (signal: SignalService, socket: TestSocket, pending: Promise<Response>) => {
      await vi.waitFor(() => expect(socket.messages).toHaveLength(1));
      const { requestId } = JSON.parse(socket.messages.pop() ?? "{}");
      await signal.receive(
        socket,
        JSON.stringify({ type: "slack-delivery-result", version: 1, requestId, status: 200 }),
      );
      expect((await pending).status).toBe(200);
    };

    it("an offline person's DM to the bot does not reach the default", async () => {
      const { app, signal, route } = await slackRoute(signingSecret, undefined, async () => ({
        users: ["U2"],
        includesBot: true,
      }));
      const fallback = await ingress(signal, route, "default", [team([{ id: "U1", linkedAt: 1_000 }], true)]);
      const preet = await ingress(signal, route, "preet", [team([{ id: "U2", linkedAt: 2_000 }], false, 2_000)]);
      signal.disconnect(preet);
      expect((await post(app, directMessage("U2"))).status).toBe(503);
      expect(fallback.messages).toHaveLength(0);
    });

    it("a person who disconnected is answered by the default again", async () => {
      const { app, signal, route, revokePerson } = await slackRoute(signingSecret);
      const fallback = await ingress(signal, route, "default", [
        { ...team([{ id: "U1", linkedAt: 1_000 }], true), routedUsers: ["U1", "U2"] },
      ]);
      const preet = await ingress(signal, route, "preet", [team([{ id: "U2", linkedAt: 2_000 }], false, 2_000)]);
      signal.disconnect(preet);
      expect((await post(app, mention("U2"))).status).toBe(503);
      // Preet unlinked her host: the account service revoked her route.
      await revokePerson("T1", "U2", 3_000);
      await answered(signal, fallback, post(app, mention("U2")));
    });

    it("an offline person's mention does not reach the default", async () => {
      const { app, signal, route } = await slackRoute(signingSecret);
      const fallback = await ingress(signal, route, "default", [team([{ id: "U1", linkedAt: 1_000 }], true)]);
      const preet = await ingress(signal, route, "preet", [team([{ id: "U2", linkedAt: 2_000 }], false, 2_000)]);
      signal.disconnect(preet);
      expect((await post(app, mention("U2"))).status).toBe(503);
      expect(fallback.messages).toHaveLength(0);
      // A person without an own route still gets the default.
      await answered(signal, fallback, post(app, mention("U9")));
    });

    it("after a Signal restart the default ticket's routedUsers still blocks the fallback", async () => {
      // A new Signal: Preet's host has not connected since, so Signal has no route floor for Preet.
      const { app, signal, route } = await slackRoute(signingSecret);
      const fallback = await ingress(signal, route, "default", [
        { ...team([{ id: "U1", linkedAt: 1_000 }], true), routedUsers: ["U1", "U2"] },
      ]);
      expect((await post(app, mention("U2"))).status).toBe(503);
      expect(fallback.messages).toHaveLength(0);
      await answered(signal, fallback, post(app, mention("U9")));
    });

    it("a legacy entry from the Worker still gets rule-3 messages of people without an own route", async () => {
      let users = ["U9"];
      const { app, signal, route } = await slackRoute(signingSecret, undefined, async () => ({
        users,
        includesBot: false,
      }));
      // A default host that connected before multi-user Slack: no `isDefault`, no person row.
      const legacy = await ingress(signal, route, "legacy", [
        { id: "T1", appId: "APROD", linkedAt: 1_000, users: [], routedUsers: ["U2"] },
      ]);
      await answered(signal, legacy, post(app, directMessage("U9")));
      // Preet has an own route (offline): the legacy host does not get Preet's messages.
      users = ["U2"];
      expect((await post(app, directMessage("U2"))).status).toBe(200);
      expect(legacy.messages).toHaveLength(0);
    });

    it("unknown auth event type is ignored", async () => {
      const { authEvent } = await slackRoute(signingSecret);
      await authEvent({ type: "slack-route-moved-in-a-later-release", teamId: "T1" });
    });
  });

  // Multi-user Slack delivery: Signal sends each request to the hosts that the routing rules name,
  // and a private message only to the hosts of the people in it.
  describe("delivery to targets", () => {
    const hello = async (
      signal: SignalService,
      route: Awaited<ReturnType<typeof slackRoute>>["route"],
      id: string,
      users: string[],
      isDefault = false,
    ) => {
      const socket = testSocket(id);
      signal.connect(socket);
      const linkedAt = 1_000;
      const team = {
        id: "T1",
        appId: "APROD",
        linkedAt,
        isDefault,
        users: users.map((user) => ({ id: user, linkedAt })),
      };
      await signal.receive(
        socket,
        JSON.stringify({
          type: "hello",
          version: 1,
          peer: "ingress",
          token: "host-ticket",
          slackRoute: await route({ hid: "host-1", teams: [team] }),
        }),
      );
      expect(socket.messages.at(-1)).toContain('"type":"ready"');
      socket.messages.length = 0;
      return socket;
    };
    const answer = async (
      signal: SignalService,
      socket: TestSocket,
      status: 200 | 503 = 200,
      response: { contentType?: "application/json"; body?: string } = {},
    ) => {
      await vi.waitFor(() => expect(socket.messages).toHaveLength(1));
      const { requestId } = JSON.parse(socket.messages.pop() ?? "{}");
      await signal.receive(
        socket,
        JSON.stringify({ type: "slack-delivery-result", version: 1, requestId, status, ...response }),
      );
    };
    const message = (author: string, channelType = "im") =>
      JSON.stringify({
        type: "event_callback",
        api_app_id: "APROD",
        team_id: "T1",
        event_id: `Ev-${crypto.randomUUID()}`,
        event_context: "EC-1",
        event: { type: "message", channel_type: channelType, user: author, text: "hi" },
        authorizations: [{ team_id: "T1", user_id: "UBOT", is_bot: true }],
      });
    const audience = (users: string[], includesBot: boolean) => async () => ({ users, includesBot });

    it("DM to the bot from Preet goes to Preet's host", async () => {
      const { app, signal, route } = await slackRoute(signingSecret, undefined, audience(["U2"], true));
      const shubham = await hello(signal, route, "shubham", ["U1"], true);
      const preet = await hello(signal, route, "preet", ["U2"]);
      const pending = post(app, message("U2"));
      await answer(signal, preet);
      expect((await pending).status).toBe(200);
      expect(shubham.messages).toHaveLength(0);
    });

    it("DM between two people does not go to the default", async () => {
      const { app, signal, route } = await slackRoute(signingSecret, undefined, audience(["U1", "U2"], false));
      const fallback = await hello(signal, route, "default", [], true);
      const shubham = await hello(signal, route, "shubham", ["U1"]);
      const preet = await hello(signal, route, "preet", ["U2"]);
      const pending = post(app, message("U2"));
      await Promise.all([answer(signal, shubham), answer(signal, preet)]);
      expect((await pending).status).toBe(200);
      expect(fallback.messages).toHaveLength(0);
    });

    it("DM from a person without GoAhead goes to the default", async () => {
      const { app, signal, route } = await slackRoute(signingSecret, undefined, audience(["U9"], true));
      const fallback = await hello(signal, route, "default", ["U1"], true);
      const preet = await hello(signal, route, "preet", ["U2"]);
      const pending = post(app, message("U9"));
      await answer(signal, fallback);
      expect((await pending).status).toBe(200);
      expect(preet.messages).toHaveLength(0);
    });

    it("private DM reaches only its members", async () => {
      const { app, signal, route } = await slackRoute(signingSecret, undefined, audience(["U1", "U2"], false));
      const shubham = await hello(signal, route, "shubham", ["U1"], true);
      const preet = await hello(signal, route, "preet", ["U2"]);
      const third = await hello(signal, route, "third", ["U3"]);
      const pending = post(app, message("U1"));
      await Promise.all([answer(signal, shubham), answer(signal, preet)]);
      expect((await pending).status).toBe(200);
      expect(third.messages).toHaveLength(0);
      // Nobody with GoAhead may see it: nothing is delivered, and Slack does not retry.
      const {
        app: other,
        signal: otherSignal,
        route: otherRoute,
      } = await slackRoute(signingSecret, undefined, audience(["U7", "U8"], false));
      const outsider = await hello(otherSignal, otherRoute, "outsider", ["U3"], true);
      expect((await post(other, message("U7"))).status).toBe(200);
      expect(outsider.messages).toHaveLength(0);
    });

    it("old host's ticket still gets the DMs of people without an own route", async () => {
      let users = ["U2"];
      const { app, signal, route } = await slackRoute(signingSecret, undefined, async () => ({
        users,
        includesBot: false,
      }));
      const legacy = testSocket("legacy");
      signal.connect(legacy);
      await signal.receive(
        legacy,
        JSON.stringify({
          type: "hello",
          version: 1,
          peer: "ingress",
          token: "host-ticket",
          slackRoute: await route({ hid: "host-1", teams: ["T1"] }),
        }),
      );
      expect(legacy.messages.at(-1)).toContain('"type":"ready"');
      legacy.messages.length = 0;
      const shubham = await hello(signal, route, "shubham", ["U1"]);
      const toLegacy = post(app, message("U2"));
      await answer(signal, legacy);
      expect((await toLegacy).status).toBe(200);
      expect(shubham.messages).toHaveLength(0);
      users = ["U1"];
      const toPerson = post(app, message("U1"));
      await answer(signal, shubham);
      expect((await toPerson).status).toBe(200);
      expect(legacy.messages).toHaveLength(0);
    });

    it("one offline member makes Slack retry", async () => {
      const { app, signal, route } = await slackRoute(signingSecret, undefined, audience(["U1", "U2"], false));
      const shubham = await hello(signal, route, "shubham", ["U1"], true);
      const preet = await hello(signal, route, "preet", ["U2"]);
      const pending = post(app, message("U1"));
      await Promise.all([answer(signal, shubham), answer(signal, preet, 503)]);
      expect((await pending).status).toBe(503);
    });

    it("click on Shubham's draft by Preet goes to Shubham's host", async () => {
      const { app, signal, route } = await slackRoute(signingSecret);
      const shubham = await hello(signal, route, "shubham", ["U0SHUBHAM"], true);
      const preet = await hello(signal, route, "preet", ["U0PREET"]);
      const payload = {
        type: "block_actions",
        api_app_id: "APROD",
        team: { id: "T1" },
        user: { id: "U0PREET" },
        actions: [{ block_id: "goahead-owner:U0SHUBHAM", value: "opaque" }],
      };
      const pending = post(app, `payload=${encodeURIComponent(JSON.stringify(payload))}`, {
        contentType: "application/x-www-form-urlencoded",
      });
      await answer(signal, shubham, 200, { contentType: "application/json", body: '{"ok":true}' });
      const response = await pending;
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('{"ok":true}');
      expect(preet.messages).toHaveLength(0);
    });

    it("authorizations failure answers 503", async () => {
      const { app, signal, route } = await slackRoute(signingSecret, undefined, async () => {
        throw new Error("Slack authorizations: ratelimited");
      });
      const shubham = await hello(signal, route, "shubham", ["U1"], true);
      expect((await post(app, message("U1"))).status).toBe(503);
      expect(shubham.messages).toHaveLength(0);
    });

    it("SLACK_APP_TOKEN is parsed per app and never logged", () => {
      const environment = {
        REMOTE_TICKET_PUBLIC_JWKS: '{"keys":[]}',
        REMOTE_TLS_DISABLED: "true",
        REMOTE_CONTROL_PLANE_URL: "http://127.0.0.1:3100",
        REMOTE_SESSION_SECRET: "s".repeat(32),
        REMOTE_AUTH_WEBHOOK_SECRET: "w".repeat(32),
        TURN_SHARED_SECRET: "t".repeat(32),
        TURN_HOST: "localhost",
      };
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      expect(
        readRemoteApiConfig({
          ...environment,
          SLACK_APP_TOKEN: "APROD:xapp-1-APROD-1-secret, ADEV:xapp-1-ADEV-2-other",
        }).slackAppTokens,
      ).toEqual([
        { appId: "APROD", token: "xapp-1-APROD-1-secret" },
        { appId: "ADEV", token: "xapp-1-ADEV-2-other" },
      ]);
      expect(readRemoteApiConfig(environment).slackAppTokens).toEqual([]);
      // A malformed value turns off only the lookup; the token is not in any message.
      expect(readRemoteApiConfig({ ...environment, SLACK_APP_TOKEN: "xapp-1-leaked-secret" }).slackAppTokens).toEqual(
        [],
      );
      expect(error).toHaveBeenCalled();
      const logged = JSON.stringify([...error.mock.calls, ...log.mock.calls, ...warn.mock.calls]);
      expect(logged).not.toContain("secret");
      expect(logged).not.toContain("xapp");
      error.mockRestore();
      log.mockRestore();
      warn.mockRestore();
    });
  });

  it("turns the Slack route off for a signing secret without its app", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(
      readRemoteApiConfig({
        REMOTE_TICKET_PUBLIC_JWKS: '{"keys":[]}',
        REMOTE_TLS_DISABLED: "true",
        REMOTE_CONTROL_PLANE_URL: "http://127.0.0.1:3100",
        REMOTE_SESSION_SECRET: "s".repeat(32),
        REMOTE_AUTH_WEBHOOK_SECRET: "w".repeat(32),
        TURN_SHARED_SECRET: "t".repeat(32),
        TURN_HOST: "localhost",
        SLACK_SIGNING_SECRET: signingSecret,
      }).slackSigningSecrets,
    ).toEqual([]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("answers 503 when the signing secret is not configured", async () => {
    const { app } = await slackRoute(null);
    expect((await post(app, '{"type":"url_verification","challenge":"abc"}')).status).toBe(503);
  });

  function post(
    app: ReturnType<typeof createRemoteApiApp>,
    body: string,
    options: {
      contentType?: string;
      timestamp?: string;
      signature?: string;
      signedBody?: string;
      secret?: string;
    } = {},
  ) {
    const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1_000));
    const signature =
      options.signature ??
      `v0=${createHmac("sha256", options.secret ?? signingSecret)
        .update(`v0:${timestamp}:${options.signedBody ?? body}`)
        .digest("hex")}`;
    return app.handle(
      new Request("http://localhost/v1/slack/events", {
        method: "POST",
        headers: {
          "Content-Type": options.contentType ?? "application/json",
          "X-Slack-Request-Timestamp": timestamp,
          "X-Slack-Signature": signature,
        },
        body,
      }),
    );
  }
});

async function slackRoute(
  signingSecret: string | null,
  // What D1 answers while Signal starts: by default, every link is current.
  validateSlackRoute: RemoteTokenProvider["validateSlackRoute"] = async (_hostId, teams) => ({
    teams: teams.filter((team) => team.isDefault !== false).map((team) => team.id),
    routes: teams,
  }),
  // Who Slack says may see an event; by default, the lookup is not reachable.
  usersFor: SlackAudienceLookup["usersFor"] = async () => {
    throw new Error("Slack authorizations: not configured in this test");
  },
) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = await exportJWK(publicKey);
  jwk.kid = "slack-route-1";
  jwk.alg = "ES256";
  const config = readRemoteApiConfig({
    REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [jwk] }),
    REMOTE_TLS_DISABLED: "true",
    REMOTE_CONTROL_PLANE_URL: "http://127.0.0.1:3100",
    REMOTE_SESSION_SECRET: "s".repeat(32),
    REMOTE_AUTH_WEBHOOK_SECRET: "w".repeat(32),
    TURN_SHARED_SECRET: "t".repeat(32),
    TURN_HOST: "localhost",
    // The development app's secret is listed too: one Signal serves both apps.
    ...(signingSecret ? { SLACK_SIGNING_SECRET: `ADEV:${"d".repeat(32)}, APROD:${signingSecret}` } : {}),
  });
  const routes = new RemoteTokenService(config);
  const signal = new SignalService(
    {
      ...hostTickets(),
      verifySlackRoute: (token, hostId) => routes.verifySlackRoute(token, hostId),
      validateSlackRoute,
    },
    8,
  );
  const now = Math.floor(Date.now() / 1_000);
  const route = (
    // A workspace ID makes an entry as an old host's ticket has it: no `isDefault`, no `users`.
    claims: { hid: string; teams: (string | SlackRouteTeam)[] },
    lifetimeSeconds = 3_600,
    linkedAt = 1_000,
    appId = "APROD",
  ) =>
    new SignJWT({
      hid: claims.hid,
      teams: claims.teams.map((team) => (typeof team === "string" ? { id: team, appId, linkedAt } : team)),
    })
      .setProtectedHeader({ alg: "ES256", kid: "slack-route-1" })
      .setAudience("openbot-slack-route")
      .setIssuedAt(now - 120)
      .setExpirationTime(now + lifetimeSeconds)
      .sign(privateKey);
  const app = createRemoteApiApp(config, signal, { usersFor });
  // What the account service sends when it unlinks or moves a workspace.
  const revoke = (teamId: string, through: number) =>
    authEvent({ type: "slack-route-revoked", appId: "APROD", teamId, through });
  const revokePerson = (teamId: string, userId: string, through: number) =>
    authEvent({ type: "slack-person-route-revoked", appId: "APROD", teamId, userId, through });
  const authEvent = async (event: Record<string, string | number>) => {
    const body = JSON.stringify(event);
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const response = await app.handle(
      new Request("http://localhost/internal/auth-events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "OpenBot-Timestamp": timestamp,
          "OpenBot-Signature": signServiceRequest(body, timestamp, config.authWebhookSecret),
        },
        body,
      }),
    );
    expect(response.status).toBe(204);
  };
  return { app, signal, route, revoke, revokePerson, authEvent };
}

interface TestSocket {
  id: string;
  ip: string;
  messages: string[];
  send(message: string): void;
  close(): void;
}

function testSocket(id: string): TestSocket {
  const messages: string[] = [];
  return { id, ip: "192.0.2.1", messages, send: (message) => messages.push(message), close: () => {} };
}

function hostTickets(): RemoteTokenProvider {
  const now = Math.floor(Date.now() / 1_000);
  const claims: RemoteTicketClaims = {
    aud: "openbot-remote",
    jti: "host-jti",
    sessionId: "host-session",
    hostId: "host-1",
    userId: "owner-1",
    membershipId: "host-1:host",
    role: "host",
    authEpoch: 1,
    protocolMinimum: 2,
    protocolMaximum: 2,
    sessionExpiresAt: now + 86_400,
    iat: now,
    exp: now + 300,
  };
  return {
    verifyTicket: async () => ({ ...claims, jti: crypto.randomUUID() }),
    verifyResumeToken: async () => claims,
    validateClaims: async () => true,
    issueResumeToken: async () => "resume-host",
    iceServers: () => [],
  };
}
