import { request as httpRequest } from "node:http";
import { translateFor } from "@openbot/i18n";
import { redactText } from "@openbot/logging";
import { describe, expect, it } from "vitest";
import { googleEndpoints, googleOAuthClient } from "./google-connector-config";
import { exchangeGoogleCode, GoogleSignIn } from "./google-oauth";
import { FAKE_GOOGLE_CLIENT, startFakeGoogleServer } from "./google-test-server";
import { startMcpOAuthRedirectServer } from "./mcp-oauth-redirect-server";

const REDIRECT_URL = "http://127.0.0.1:9/mcp-auth";

function statusFor(port: string, path: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port: Number(port), path, headers: { host } }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.on("error", reject);
    request.end();
  });
}

describe("Google sign-in", () => {
  it("accepts one code, for its own state only", async () => {
    const signIn = new GoogleSignIn({
      client: FAKE_GOOGLE_CLIENT,
      endpoints: googleEndpoints("http://127.0.0.1:1"),
      redirectUrl: REDIRECT_URL,
    });

    expect(signIn.deliver("another-state", "first-code-value")).toBe(false);
    expect(signIn.deliver(signIn.state, "first-code-value")).toBe(true);
    expect(signIn.deliver(signIn.state, "second-code-value")).toBe(false);
    await expect(signIn.code).resolves.toBe("first-code-value");
  });

  it("refuses a return that reached the listener under another host name", async () => {
    const signIn = new GoogleSignIn({
      client: FAKE_GOOGLE_CLIENT,
      endpoints: googleEndpoints("http://127.0.0.1:1"),
      redirectUrl: REDIRECT_URL,
    });
    const listener = await startMcpOAuthRedirectServer({
      language: { locale: "en", translate: translateFor("en") },
      deliver: (state, code) => signIn.deliver(state, code),
    });
    try {
      const port = new URL(listener.redirectUrl).port;
      const status = await statusFor(
        port,
        `/mcp-auth?code=forged-code-value&state=${signIn.state}`,
        `attacker.example.com:${port}`,
      );

      expect(status).toBe(403);
      // The attempt still waits for the real return.
      expect(signIn.deliver(signIn.state, "real-code-value")).toBe(true);
    } finally {
      signIn.cancel();
      await listener.close();
    }
  });

  it("trades the code with the PKCE verifier and keeps every credential out of the logs", async () => {
    const google = await startFakeGoogleServer();
    try {
      const endpoints = googleEndpoints(google.origin);
      const signIn = new GoogleSignIn({ client: FAKE_GOOGLE_CLIENT, endpoints, redirectUrl: REDIRECT_URL });
      // The fake consent page answers at once with the redirect that carries the code.
      const consent = await fetch(signIn.authorizationUrl, { redirect: "manual" });
      const back = new URL(consent.headers.get("location") ?? "");
      const code = back.searchParams.get("code") ?? "";
      expect(signIn.deliver(back.searchParams.get("state") ?? "", code)).toBe(true);

      const tokens = await exchangeGoogleCode({
        client: FAKE_GOOGLE_CLIENT,
        endpoints,
        redirectUrl: REDIRECT_URL,
        code: await signIn.code,
        verifier: signIn.verifier,
        fetch: (url, init) => fetch(url, init),
        now: () => 0,
      });

      expect(tokens.refreshToken).not.toBeNull();
      expect(googleOAuthClient(FAKE_GOOGLE_CLIENT)).not.toBeNull();
      const secrets = [
        FAKE_GOOGLE_CLIENT.clientSecret,
        code,
        signIn.verifier,
        tokens.accessToken,
        tokens.refreshToken ?? "",
      ];
      const line = redactText(`failed: ${secrets.join(" ")}`);
      for (const secret of secrets) expect(line).not.toContain(secret);
    } finally {
      await google.close();
    }
  });

  it("reports a Google that cannot be reached as an unexpected sign-in error", async () => {
    const google = await startFakeGoogleServer();
    const endpoints = googleEndpoints(google.origin);
    await google.close();

    await expect(
      exchangeGoogleCode({
        client: FAKE_GOOGLE_CLIENT,
        endpoints,
        redirectUrl: REDIRECT_URL,
        code: "some-code-value",
        verifier: "some-verifier-value",
        fetch: (url, init) => fetch(url, init),
        now: () => 0,
      }),
    ).rejects.toMatchObject({ code: "unexpected" });
  });
});
