// The Google OAuth authorization code flow with PKCE (S256) and a one-time `state`, for a "Desktop
// app" client. Google sends the code back to the shared loopback listener
// (`mcp-oauth-redirect-server.ts`). Each credential is registered for redaction before it is used.
// https://developers.google.com/identity/protocols/oauth2/native-app

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { z } from "zod";
import type { GoogleEndpoints, GoogleOAuthClient } from "./google-connector-config";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

/** Google lets the user untick a scope on the consent page. Without these two, nothing works. */
export const GOOGLE_REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

export const GOOGLE_SIGN_IN_TIMEOUT_MS = 10 * 60_000;
/** A Google request with no answer in this time fails, so nothing waits forever. */
export const GOOGLE_REQUEST_TIMEOUT_MS = 30_000;

export type GoogleFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface GoogleTokenSet {
  accessToken: string;
  /** Null on a refresh answer that kept the stored refresh token. */
  refreshToken: string | null;
  /** Epoch milliseconds. */
  expiresAt: number;
  scopes: string[];
}

export class GoogleOAuthError extends Error {
  readonly code: "invalid_grant" | "refused" | "unexpected";

  constructor(code: "invalid_grant" | "refused" | "unexpected", message: string) {
    super(message);
    this.name = "GoogleOAuthError";
    this.code = code;
  }
}

const tokenAnswerSchema = z.object({
  access_token: z.string().min(1).optional(),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().optional(),
  scope: z.string().optional(),
  error: z.string().optional(),
});

export interface GoogleSignInOptions {
  client: GoogleOAuthClient;
  endpoints: GoogleEndpoints;
  redirectUrl: string;
  timeoutMs?: number;
}

/**
 * One sign-in attempt. `code` settles once: with the first code that names this `state`, or with
 * an error on cancel or after 10 minutes. A second code for the same state is refused, so a
 * replayed redirect cannot replace the grant.
 */
export class GoogleSignIn {
  readonly state = randomUUID();
  readonly verifier = randomBytes(32).toString("base64url");
  readonly authorizationUrl: string;
  readonly code: Promise<string>;
  #settle: { resolve: (code: string) => void; reject: (error: Error) => void } | null = null;
  #cancelled = false;
  readonly #timer: ReturnType<typeof setTimeout>;

  constructor(options: GoogleSignInOptions) {
    registerSecretValue(this.verifier);
    const challenge = createHash("sha256").update(this.verifier).digest("base64url");
    const url = new URL(options.endpoints.authorize);
    url.searchParams.set("client_id", options.client.clientId);
    url.searchParams.set("redirect_uri", options.redirectUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
    url.searchParams.set("state", this.state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    // Google gives a refresh token only for offline access on a consent page.
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    this.authorizationUrl = url.toString();
    this.code = new Promise<string>((resolve, reject) => {
      this.#settle = { resolve, reject };
    });
    // An attempt that nobody waits for must not raise an unhandled rejection.
    this.code.catch(() => undefined);
    this.#timer = setTimeout(
      () => this.#end(new Error(sourceText("error.connector.googleSignInTimedOut"))),
      options.timeoutMs ?? GOOGLE_SIGN_IN_TIMEOUT_MS,
    );
    this.#timer.unref?.();
  }

  get cancelled(): boolean {
    return this.#cancelled;
  }

  /** The loopback listener calls this. True only for the first code of this attempt's `state`. */
  deliver(state: string, code: string): boolean {
    const settle = this.#settle;
    if (state !== this.state || !settle) return false;
    registerSecretValue(code);
    this.#settle = null;
    clearTimeout(this.#timer);
    settle.resolve(code);
    return true;
  }

  cancel(): void {
    this.#cancelled = true;
    this.#end(new Error(sourceText("error.connector.googleSignInCancelled")));
  }

  #end(error: Error): void {
    const settle = this.#settle;
    if (!settle) return;
    this.#settle = null;
    clearTimeout(this.#timer);
    settle.reject(error);
  }
}

export function exchangeGoogleCode(options: {
  client: GoogleOAuthClient;
  endpoints: GoogleEndpoints;
  redirectUrl: string;
  code: string;
  verifier: string;
  fetch: GoogleFetch;
  now: () => number;
}): Promise<GoogleTokenSet> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: options.code,
    code_verifier: options.verifier,
    redirect_uri: options.redirectUrl,
    client_id: options.client.clientId,
    client_secret: options.client.clientSecret,
  });
  return tokenRequest(options.endpoints.token, body, options.fetch, options.now);
}

export function refreshGoogleToken(options: {
  client: GoogleOAuthClient;
  endpoints: GoogleEndpoints;
  refreshToken: string;
  fetch: GoogleFetch;
  now: () => number;
}): Promise<GoogleTokenSet> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: options.refreshToken,
    client_id: options.client.clientId,
    client_secret: options.client.clientSecret,
  });
  return tokenRequest(options.endpoints.token, body, options.fetch, options.now);
}

/** True when Google confirmed the revoke. A network failure answers false; it never throws. */
export async function revokeGoogleToken(options: {
  endpoints: GoogleEndpoints;
  token: string;
  fetch: GoogleFetch;
}): Promise<boolean> {
  try {
    const response = await options.fetch(options.endpoints.revoke, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: options.token }),
      signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function tokenRequest(
  url: string,
  body: URLSearchParams,
  fetchToken: GoogleFetch,
  now: () => number,
): Promise<GoogleTokenSet> {
  let response: Response;
  try {
    response = await fetchToken(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
      signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new GoogleOAuthError("unexpected", sourceText("error.connector.googleUnreachable"));
  }
  const parsed = tokenAnswerSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new GoogleOAuthError(
      "unexpected",
      sourceText("error.connector.googleUnexpected", { detail: String(response.status) }),
    );
  }
  const answer = parsed.data;
  if (answer.error === "invalid_grant") {
    throw new GoogleOAuthError("invalid_grant", sourceText("error.connector.googleSignInExpired"));
  }
  if (answer.error || !response.ok || !answer.access_token) {
    throw new GoogleOAuthError(
      "refused",
      sourceText("error.connector.googleRefused", { detail: answer.error ?? String(response.status) }),
    );
  }
  registerSecretValue(answer.access_token);
  if (answer.refresh_token) registerSecretValue(answer.refresh_token);
  return {
    accessToken: answer.access_token,
    refreshToken: answer.refresh_token ?? null,
    expiresAt: now() + (answer.expires_in ?? 3600) * 1000,
    scopes: (answer.scope ?? "").split(" ").filter(Boolean),
  };
}
