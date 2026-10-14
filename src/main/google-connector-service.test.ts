import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GoogleConnectorState } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { sourceText } from "@openbot/i18n/source";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { GoogleReauthRequiredError } from "./google-api";
import { googleEndpoints } from "./google-connector-config";
import { GoogleConnectorService } from "./google-connector-service";
import { GoogleConnectorStore } from "./google-connector-store";
import { GoogleMailAgentStore } from "./google-mail-agent-store";
import {
  FAKE_GOOGLE_CIPHER,
  FAKE_GOOGLE_CLIENT,
  FAKE_GOOGLE_EMAIL,
  type FakeGoogleServer,
  startFakeGoogleServer,
} from "./google-test-server";
import { type McpOAuthRedirectServer, startMcpOAuthRedirectServer } from "./mcp-oauth-redirect-server";

const HOUR = 60 * 60_000;

let google: FakeGoogleServer | null = null;
let listener: McpOAuthRedirectServer | null = null;
let service: GoogleConnectorService | null = null;

afterEach(async () => {
  await service?.dispose();
  await listener?.close();
  await google?.close();
  service = null;
  listener = null;
  google = null;
});

function waitForState(target: GoogleConnectorService, state: GoogleConnectorState): Promise<void> {
  if (target.status().state === state) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = target.onChanged((status) => {
      if (status.state !== state) return;
      stop();
      resolve();
    });
  });
}

/** A service signed in through the fake consent page, with a clock the test moves. */
async function connected() {
  const fake = await startFakeGoogleServer();
  google = fake;
  const clock = { now: 0 };
  const path = join(await mkdtemp(join(tmpdir(), "goahead-google-service-")), "google.json");
  listener = await startMcpOAuthRedirectServer({
    language: { locale: "en", translate: translateFor("en") },
    deliver: (state, code) => service?.receiveAuthorizationCode(state, code) ?? false,
  });
  const created = new GoogleConnectorService({
    client: FAKE_GOOGLE_CLIENT,
    endpoints: googleEndpoints(fake.origin),
    store: new GoogleConnectorStore(path, FAKE_GOOGLE_CIPHER),
    mailAgent: new GoogleMailAgentStore(join(path, "..", "google-mail-agent.json")),
    redirectUrl: listener.redirectUrl,
    // The fake consent page redirects at once, like a person who presses Allow.
    openExternal: async (url) => void (await fetch(url)),
    canPersist: () => true,
    now: () => clock.now,
    sleep: async () => undefined,
  });
  service = created;
  await created.load();
  const signedIn = waitForState(created, "connected");
  await created.connect();
  await signedIn;
  return { fake, clock, path, service: created };
}

describe("GoogleConnectorService", () => {
  it("connects through the browser and refreshes once for two callers", async () => {
    const { fake, clock, service: connector } = await connected();
    expect(connector.status()).toMatchObject({ state: "connected", email: FAKE_GOOGLE_EMAIL, error: null });

    clock.now = 2 * HOUR;
    const [first, second] = await Promise.all([connector.accessToken(), connector.accessToken()]);

    expect(first).toBe(second);
    expect(fake.tokenGrants.filter((grant) => grant === "refresh_token")).toHaveLength(1);
  });

  it("a refused refresh asks the user to sign in again and stops every call", async () => {
    const { fake, clock, service: connector } = await connected();
    fake.refreshAllowed = false;
    clock.now = 2 * HOUR;

    await expect(
      connector.api.json(`${connector.endpoints.gmail}/users/me/profile`, z.object({ emailAddress: z.string() })),
    ).rejects.toBeInstanceOf(GoogleReauthRequiredError);
    expect(connector.status()).toMatchObject({ state: "reauth-required", email: FAKE_GOOGLE_EMAIL });
    await expect(connector.accessToken()).rejects.toBeInstanceOf(GoogleReauthRequiredError);
  });

  it("keeps the mail agent only when it names an agent of this computer", async () => {
    const { service: connector } = await connected();

    await expect(connector.setMailAgent("unknown-agent", ["chief"])).rejects.toThrow(
      sourceText("error.connector.googleMailAgentUnknown"),
    );
    expect((await connector.setMailAgent("chief", ["chief"])).mailAgentId).toBe("chief");
    expect(connector.mailAgentId()).toBe("chief");
  });

  it("disconnect removes the sign-in even when Google cannot revoke it", async () => {
    const { fake, path, service: connector } = await connected();
    fake.failNext("/revoke", 500);

    const status = await connector.disconnect();

    expect(status).toMatchObject({ state: "disconnected", email: null });
    expect(status.error).toBe(sourceText("error.connector.googleRevokeFailed"));
    await expect(access(path)).rejects.toThrow();
  });

  it("a call that runs during disconnect fails without a request to sign in again", async () => {
    const { clock, service: connector } = await connected();
    const states: GoogleConnectorState[] = [];
    connector.onChanged((status) => states.push(status.state));
    clock.now = 2 * HOUR;
    const profile = z.object({ emailAddress: z.string() });

    const running = connector.api.json(`${connector.endpoints.gmail}/users/me/profile`, profile).then(
      () => null,
      (error: unknown) => error,
    );
    await connector.disconnect();

    expect(await running).toBeInstanceOf(Error);
    await expect(connector.api.json(`${connector.endpoints.gmail}/users/me/profile`, profile)).rejects.toThrow(
      sourceText("error.connector.googleNotConnected"),
    );
    expect(connector.status().state).toBe("disconnected");
    expect(states).not.toContain("reauth-required");
  });

  it("sends nothing to Google after the sign-in needs to be made again", async () => {
    const { fake, service: connector } = await connected();
    connector.markReauthRequired();
    const grants = fake.tokenGrants.length;

    await expect(connector.renewAccessToken("any-rejected-token")).rejects.toBeInstanceOf(GoogleReauthRequiredError);
    expect(fake.tokenGrants).toHaveLength(grants);
  });
});
