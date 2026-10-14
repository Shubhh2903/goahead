// The built-in Gmail and Google Calendar connection of this computer: one Google account, used only
// by the mail agents and the triage session. The tokens never leave the main process except to Google.

import type { GoogleConnectorState, GoogleConnectorStatus } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText, registerSecretValue, toLogValue } from "@openbot/logging";
import { z } from "zod";
import {
  type GoogleAccessSource,
  GoogleApiClient,
  GoogleNotConnectedError,
  GoogleReauthRequiredError,
} from "./google-api";
import type { GoogleEndpoints, GoogleOAuthClient } from "./google-connector-config";
import type { GoogleConnectorRecord, GoogleConnectorStore } from "./google-connector-store";
import type { GoogleMailAgentStore } from "./google-mail-agent-store";
import {
  exchangeGoogleCode,
  GOOGLE_REQUEST_TIMEOUT_MS,
  GOOGLE_REQUIRED_SCOPES,
  type GoogleFetch,
  GoogleOAuthError,
  GoogleSignIn,
  refreshGoogleToken,
  revokeGoogleToken,
} from "./google-oauth";

const logger = createOpenBotLogger("google-connector");

/** An access token with less time left than this is refreshed before use. */
const REFRESH_MARGIN_MS = 5 * 60_000;
const profileSchema = z.object({ emailAddress: z.string().min(3).max(320) });

export interface GoogleConnectorServiceOptions {
  /** Null when this build has no Google OAuth client. The connection is then not offered. */
  client: GoogleOAuthClient | null;
  endpoints: GoogleEndpoints;
  store: GoogleConnectorStore;
  /** The "Agent that handles mail" setting. */
  mailAgent: GoogleMailAgentStore;
  /** The loopback redirect address, or null when that listener did not start. */
  redirectUrl: string | null;
  openExternal: (url: string) => Promise<void>;
  /** False when the operating system cannot encrypt: connect is refused, as for the other connectors. */
  canPersist: () => boolean;
  fetch?: GoogleFetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  signInTimeoutMs?: number;
}

/**
 * Owns the Google sign-in: the consent page, the stored tokens, their refresh (one at a time), and
 * the revoke. It never imports the agent service. Each token is registered for redaction before it
 * is used.
 */
export class GoogleConnectorService implements GoogleAccessSource {
  readonly api: GoogleApiClient;
  readonly endpoints: GoogleEndpoints;
  readonly #client: GoogleOAuthClient | null;
  readonly #store: GoogleConnectorStore;
  readonly #mailAgent: GoogleMailAgentStore;
  readonly #redirectUrl: string | null;
  readonly #openExternal: (url: string) => Promise<void>;
  readonly #canPersist: () => boolean;
  readonly #fetch: GoogleFetch;
  readonly #now: () => number;
  readonly #signInTimeoutMs: number | undefined;
  readonly #listeners = new Set<(status: GoogleConnectorStatus) => void>();
  #signIn: GoogleSignIn | null = null;
  /** Google refused the stored sign-in, or the file cannot be read. The record stays for the email. */
  #reauth = false;
  #error: string | null = null;
  #refreshing: Promise<string> | null = null;
  /** Changes on each sign-in and disconnect, so a refresh that started before does not write back. */
  #generation = 0;

  constructor(options: GoogleConnectorServiceOptions) {
    this.#client = options.client;
    this.endpoints = options.endpoints;
    this.#store = options.store;
    this.#mailAgent = options.mailAgent;
    this.#redirectUrl = options.redirectUrl;
    this.#openExternal = options.openExternal;
    this.#canPersist = options.canPersist;
    this.#fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.#now = options.now ?? Date.now;
    this.#signInTimeoutMs = options.signInTimeoutMs;
    this.api = new GoogleApiClient({
      tokens: this,
      onReauthRequired: () => this.markReauthRequired(),
      fetch: this.#fetch,
      ...(options.sleep ? { sleep: options.sleep } : {}),
    });
  }

  /** Reads the stored sign-in. A file that cannot be read stays on disk; the panel then asks to sign in again. */
  async load(): Promise<void> {
    const error = await this.#store.load();
    if (error) {
      logger.warn("The Google connection file could not be read.", { cause: toLogValue(error) });
      this.#reauth = true;
    }
    const mailAgentError = await this.#mailAgent.load();
    if (mailAgentError)
      logger.warn("The Google mail agent setting could not be read.", { cause: toLogValue(mailAgentError) });
    const record = this.#store.read();
    if (record) registerRecordSecrets(record);
  }

  status(): GoogleConnectorStatus {
    return {
      available: this.#client !== null && this.#redirectUrl !== null,
      state: this.#state(),
      email: this.#store.read()?.email ?? null,
      mailAgentId: this.#mailAgent.read(),
      error: this.#error,
    };
  }

  /** The agent picked in the panel, or null. */
  mailAgentId(): string | null {
    return this.#mailAgent.read();
  }

  /** `knownAgentIds` are the local agents now: the renderer cannot name an agent that does not exist. */
  async setMailAgent(agentId: string, knownAgentIds: readonly string[]): Promise<GoogleConnectorStatus> {
    if (!knownAgentIds.includes(agentId)) throw new Error(sourceText("error.connector.googleMailAgentUnknown"));
    await this.#mailAgent.write(agentId);
    this.#emit();
    return this.status();
  }

  onChanged(listener: (status: GoogleConnectorStatus) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** True while a stored sign-in can make calls. A new sign-in in progress does not end the old one. */
  connected(): boolean {
    return this.#store.read() !== null && !this.#reauth;
  }

  /** Opens Google's consent page. Returns at once; the wait for the browser reports through `onChanged`. */
  async connect(): Promise<GoogleConnectorStatus> {
    const client = this.#client;
    const redirectUrl = this.#redirectUrl;
    if (!client || !redirectUrl) throw new Error(sourceText("error.connector.googleUnavailable"));
    if (!this.#canPersist()) throw new Error(sourceText("error.app.secretStorageUnavailable"));
    this.#signIn?.cancel();
    const signIn = new GoogleSignIn({
      client,
      endpoints: this.endpoints,
      redirectUrl,
      ...(this.#signInTimeoutMs === undefined ? {} : { timeoutMs: this.#signInTimeoutMs }),
    });
    this.#signIn = signIn;
    this.#error = null;
    this.#emit();
    void this.#finishSignIn(client, redirectUrl, signIn);
    try {
      await this.#openExternal(signIn.authorizationUrl);
    } catch (error) {
      signIn.cancel();
      throw error;
    }
    return this.status();
  }

  cancel(): GoogleConnectorStatus {
    this.#signIn?.cancel();
    this.#signIn = null;
    this.#error = null;
    this.#emit();
    return this.status();
  }

  /** The loopback listener hands the browser's return here. True only for the attempt that waits for `state`. */
  receiveAuthorizationCode(state: string, code: string): boolean {
    return this.#signIn?.deliver(state, code) ?? false;
  }

  /**
   * Revokes the refresh token at Google, then deletes the file. The file is deleted also when the
   * revoke fails, and the status then says so.
   */
  async disconnect(): Promise<GoogleConnectorStatus> {
    this.#signIn?.cancel();
    this.#signIn = null;
    this.#generation += 1;
    const record = this.#store.read();
    const revoked = record
      ? await revokeGoogleToken({ endpoints: this.endpoints, token: record.refreshToken, fetch: this.#fetch })
      : true;
    await this.#store.clear();
    this.#reauth = false;
    this.#error = revoked ? null : sourceText("error.connector.googleRevokeFailed");
    this.#emit();
    return this.status();
  }

  async accessToken(): Promise<string> {
    const record = this.#store.read();
    if (!record) throw new GoogleNotConnectedError(sourceText("error.connector.googleNotConnected"));
    if (this.#reauth) throw new GoogleReauthRequiredError(sourceText("error.connector.googleNotConnected"));
    if (record.accessTokenExpiresAt - this.#now() > REFRESH_MARGIN_MS) return record.accessToken;
    return this.#refresh();
  }

  async renewAccessToken(rejected: string): Promise<string> {
    if (this.#reauth) throw new GoogleReauthRequiredError(sourceText("error.connector.googleNotConnected"));
    const record = this.#store.read();
    if (record && record.accessToken !== rejected) return record.accessToken;
    return this.#refresh();
  }

  /**
   * Every call stops until the user signs in again. The record stays, so the panel names the account.
   * With no record (a call that ran during disconnect), there is nothing to sign in again to.
   */
  markReauthRequired(): void {
    if (this.#reauth || !this.#store.read()) return;
    this.#reauth = true;
    this.#emit();
  }

  /** Stops a sign-in in progress. The encrypted sign-in stays. */
  dispose(): Promise<void> {
    this.#generation += 1;
    this.#signIn?.cancel();
    this.#signIn = null;
    this.#listeners.clear();
    return Promise.resolve();
  }

  #state(): GoogleConnectorState {
    if (this.#signIn) return "pending";
    if (this.#reauth) return "reauth-required";
    return this.#store.read() ? "connected" : "disconnected";
  }

  async #finishSignIn(client: GoogleOAuthClient, redirectUrl: string, signIn: GoogleSignIn): Promise<void> {
    try {
      const code = await signIn.code;
      const tokens = await exchangeGoogleCode({
        client,
        endpoints: this.endpoints,
        redirectUrl,
        code,
        verifier: signIn.verifier,
        fetch: this.#fetch,
        now: this.#now,
      });
      if (!tokens.refreshToken)
        throw new GoogleOAuthError("refused", sourceText("error.connector.googleNoRefreshToken"));
      if (GOOGLE_REQUIRED_SCOPES.some((scope) => !tokens.scopes.includes(scope))) {
        throw new GoogleOAuthError("refused", sourceText("error.connector.googleScopesMissing"));
      }
      const email = await this.#profileEmail(tokens.accessToken);
      if (this.#signIn !== signIn) return;
      this.#generation += 1;
      await this.#store.write({
        accessToken: tokens.accessToken,
        accessTokenExpiresAt: tokens.expiresAt,
        refreshToken: tokens.refreshToken,
        email,
        scopes: tokens.scopes,
      });
      this.#reauth = false;
    } catch (error) {
      if (this.#signIn === signIn && !signIn.cancelled) {
        this.#error = redactText(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (this.#signIn === signIn) {
        this.#signIn = null;
        this.#emit();
      }
    }
  }

  async #profileEmail(accessToken: string): Promise<string> {
    const response = await this.#fetch(`${this.endpoints.gmail}/users/me/profile`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
    });
    const parsed = profileSchema.safeParse(await response.json().catch(() => null));
    if (!response.ok || !parsed.success) {
      throw new GoogleOAuthError(
        "unexpected",
        sourceText("error.connector.googleUnexpected", { detail: String(response.status) }),
      );
    }
    return parsed.data.emailAddress;
  }

  #refresh(): Promise<string> {
    this.#refreshing ??= this.#runRefresh().finally(() => {
      this.#refreshing = null;
    });
    return this.#refreshing;
  }

  async #runRefresh(): Promise<string> {
    if (this.#reauth) throw new GoogleReauthRequiredError(sourceText("error.connector.googleNotConnected"));
    const record = this.#store.read();
    const client = this.#client;
    if (!record || !client) throw new GoogleNotConnectedError(sourceText("error.connector.googleNotConnected"));
    const generation = this.#generation;
    try {
      const tokens = await refreshGoogleToken({
        client,
        endpoints: this.endpoints,
        refreshToken: record.refreshToken,
        fetch: this.#fetch,
        now: this.#now,
      });
      if (generation !== this.#generation)
        throw new GoogleNotConnectedError(sourceText("error.connector.googleNotConnected"));
      await this.#store.write({
        ...record,
        accessToken: tokens.accessToken,
        accessTokenExpiresAt: tokens.expiresAt,
        refreshToken: tokens.refreshToken ?? record.refreshToken,
      });
      return tokens.accessToken;
    } catch (error) {
      // Disconnected, or another sign-in, while the refresh ran: the revoke can be the reason Google refused.
      if (generation !== this.#generation)
        throw new GoogleNotConnectedError(sourceText("error.connector.googleNotConnected"));
      if (error instanceof GoogleOAuthError && error.code === "invalid_grant") {
        this.markReauthRequired();
        throw new GoogleReauthRequiredError(error.message);
      }
      throw error;
    }
  }

  #emit(): void {
    const status = this.status();
    for (const listener of this.#listeners) listener(status);
  }
}

function registerRecordSecrets(record: GoogleConnectorRecord): void {
  registerSecretValue(record.accessToken);
  registerSecretValue(record.refreshToken);
}
