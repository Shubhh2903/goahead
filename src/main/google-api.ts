// The `fetch` client for Gmail v1 and Calendar v3. No `googleapis` dependency: GoAhead calls a few
// REST methods, and this file is all the client they need.
//
// - 429 and 5xx, and a network failure, are tried again with exponential backoff and jitter, at
//   most three tries in all.
// - 401 asks the token source for a new access token once. A second 401, or a refresh that Google
//   refuses, is `GoogleReauthRequiredError`: the sign-in must be made again, and every call stops.
// - No stored sign-in (disconnected, or another account signed in during the call) is
//   `GoogleNotConnectedError`: the call fails, and no one is asked to sign in again.

import { sourceText } from "@openbot/i18n/source";
import type { z } from "zod";
import { GOOGLE_REQUEST_TIMEOUT_MS, type GoogleFetch } from "./google-oauth";

export interface GoogleAccessSource {
  /**
   * A valid access token. Throws `GoogleReauthRequiredError` when the sign-in cannot refresh, and
   * `GoogleNotConnectedError` when there is no sign-in.
   */
  accessToken(): Promise<string>;
  /** Google refused `rejected`: refresh, unless another call already replaced it. */
  renewAccessToken(rejected: string): Promise<string>;
}

export class GoogleApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GoogleApiError";
    this.status = status;
  }
}

export class GoogleReauthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleReauthRequiredError";
  }
}

/**
 * No sign-in to use: Google was disconnected, or another account signed in while the call ran. It is
 * not `GoogleReauthRequiredError`, so it never asks the user to sign in again.
 */
export class GoogleNotConnectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleNotConnectedError";
  }
}

export interface GoogleRequestInit {
  method?: "GET" | "POST" | "PUT";
  body?: object;
}

export const GOOGLE_MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 500;

export interface GoogleApiClientOptions {
  tokens: GoogleAccessSource;
  /** Called before a `GoogleReauthRequiredError` leaves this client. */
  onReauthRequired: () => void;
  fetch?: GoogleFetch;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

export class GoogleApiClient {
  readonly #tokens: GoogleAccessSource;
  readonly #onReauthRequired: () => void;
  readonly #fetch: GoogleFetch;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #random: () => number;

  constructor(options: GoogleApiClientOptions) {
    this.#tokens = options.tokens;
    this.#onReauthRequired = options.onReauthRequired;
    this.#fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.#sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#random = options.random ?? Math.random;
  }

  async json<T>(url: string, schema: z.ZodType<T>, init: GoogleRequestInit = {}): Promise<T> {
    const response = await this.#send(url, init);
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new GoogleApiError(
        response.status,
        sourceText("error.connector.googleUnexpected", { detail: new URL(url).pathname }),
      );
    }
    return parsed.data;
  }

  async #send(url: string, init: GoogleRequestInit): Promise<Response> {
    let token = await this.#token(() => this.#tokens.accessToken());
    let renewed = false;
    // A request that changes data (send a draft, insert an event) may have worked even when its answer
    // is lost or is a 5xx. It is never sent again, except after a 429, where Google did not run it.
    const method = init.method ?? "GET";
    const mayRepeat = method === "GET";
    for (let attempt = 1; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.#fetch(url, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/json",
            ...(init.body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
          signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
        });
      } catch {
        if (!mayRepeat || attempt >= GOOGLE_MAX_ATTEMPTS)
          throw new GoogleApiError(0, sourceText("error.connector.googleUnreachable"));
        await this.#sleep(this.#delay(attempt));
        continue;
      }
      if (response.status === 401) {
        if (renewed) {
          this.#onReauthRequired();
          throw new GoogleReauthRequiredError(sourceText("error.connector.googleSignInExpired"));
        }
        renewed = true;
        const rejected = token;
        token = await this.#token(() => this.#tokens.renewAccessToken(rejected));
        // A renewal is not a try.
        attempt -= 1;
        continue;
      }
      if ((response.status === 429 || (mayRepeat && response.status >= 500)) && attempt < GOOGLE_MAX_ATTEMPTS) {
        await this.#sleep(this.#delay(attempt));
        continue;
      }
      if (!response.ok) {
        throw new GoogleApiError(
          response.status,
          sourceText("error.connector.googleRequestFailed", { status: String(response.status) }),
        );
      }
      return response;
    }
  }

  async #token(read: () => Promise<string>): Promise<string> {
    try {
      return await read();
    } catch (error) {
      if (error instanceof GoogleReauthRequiredError) this.#onReauthRequired();
      throw error;
    }
  }

  #delay(attempt: number): number {
    const base = BACKOFF_BASE_MS * 2 ** (attempt - 1);
    return base + Math.floor(this.#random() * base);
  }
}
