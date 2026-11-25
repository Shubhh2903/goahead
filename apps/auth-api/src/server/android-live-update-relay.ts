import {
  ANDROID_LIVE_UPDATE_SEALED_LIMIT,
  ANDROID_LIVE_UPDATE_TOKEN_PATTERN,
  type AndroidLiveUpdateRelayPush,
} from "@openbot/contracts/android-live-update-relay";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { importPKCS8, SignJWT } from "jose";
import type { ApnsRelayResult as LiveActivityRelayResult } from "./live-activity-relay";

/**
 * Forwards a sealed Android live update from a host to Firebase Cloud Messaging. The host sealed the
 * content with keys that only the phone has, so this service cannot read it. It stores nothing and
 * logs nothing: the token, the host and the bytes live only for the request.
 *
 * This service builds the FCM message itself, and only as a data message. A host gives the sealed
 * props only, never a notification title or body, so a host credential cannot make Android show an
 * ordinary notification. The phone opens the seal and shows its own ongoing notification.
 */

export interface FcmConfig {
  /** The Firebase project ID. */
  projectId: string;
  /** The `client_email` of the Firebase service account. */
  clientEmail: string;
  /** The `private_key` of the Firebase service account, as PEM text. */
  privateKey: string;
}

/** The `kind` field of the data message, so the phone knows the message is a live update. */
export const ANDROID_LIVE_UPDATE_MESSAGE_KIND = "goahead-live-update";
const OAUTH_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
/** Google access tokens last one hour. A new one is made a little before that. */
const ACCESS_TOKEN_MARGIN_SECONDS = 5 * 60;
const REQUEST_TIMEOUT_MS = 5_000;
/** One collapse key: a newer update replaces an older one that Android has not shown yet. */
const COLLAPSE_KEY = "goahead-live-update";
/** An `end` that waits longer than this has no use: the phone shows the out-of-date view by then. */
const END_TTL_SECONDS = 60 * 60;
/** FCM answers these for a token that no longer reaches the app. */
const GONE_CODES = new Set(["UNREGISTERED", "SENDER_ID_MISMATCH"]);

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export class FcmLiveUpdateSender {
  readonly #config: FcmConfig;
  readonly #fetch: Fetch;
  readonly #now: () => number;
  #key: Awaited<ReturnType<typeof importPKCS8>> | null = null;
  #token: { value: string; expiresAt: number } | null = null;

  constructor(config: FcmConfig, fetch: Fetch, now: () => number = Date.now) {
    this.#config = config;
    this.#fetch = fetch;
    this.#now = now;
  }

  async send(push: AndroidLiveUpdateRelayPush): Promise<LiveActivityRelayResult> {
    const accessToken = await this.#accessToken().catch(() => null);
    // Google did not give a token now. The host tries again on the next change.
    if (!accessToken) return "unavailable";
    const response = await this.#fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.#config.projectId)}/messages:send`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ message: fcmMessage(push) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    ).catch(() => null);
    // A timeout or a network fault. The host tries again on the next change.
    if (!response) return "unavailable";
    if (response.ok) return "sent";
    if (response.status === 401) {
      this.#token = null;
      return "unavailable";
    }
    if (response.status === 429 || response.status >= 500) return "unavailable";
    const code = await response
      .json()
      .then(fcmErrorCode)
      .catch(() => "");
    if (response.status === 404 || GONE_CODES.has(code)) return "gone";
    return "rejected";
  }

  /**
   * Every request in the isolate shares this sender, so only resolved values are kept: the runtime
   * refuses a promise that another request made.
   */
  async #accessToken(): Promise<string> {
    const now = Math.floor(this.#now() / 1000);
    if (this.#token && now < this.#token.expiresAt - ACCESS_TOKEN_MARGIN_SECONDS) return this.#token.value;
    this.#key ??= await importPKCS8(this.#config.privateKey, "RS256");
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(this.#config.clientEmail)
      .setAudience(OAUTH_URL)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(this.#key);
    const response = await this.#fetch(OAUTH_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error("Google refused the service account.");
    const token = accessTokenOf(await response.json());
    if (!token) throw new Error("Google sent no access token.");
    this.#token = { value: token.value, expiresAt: now + token.expiresIn };
    return token.value;
  }
}

/** A data message only: FCM shows nothing by itself, and every value is a string, as FCM requires. */
function fcmMessage(push: AndroidLiveUpdateRelayPush) {
  const ttl = push.event === "end" ? END_TTL_SECONDS : Math.max(0, (push.staleAt ?? push.timestamp) - push.timestamp);
  return {
    token: push.token,
    data: {
      kind: ANDROID_LIVE_UPDATE_MESSAGE_KIND,
      event: push.event,
      sealed: push.sealed ?? "",
      timestamp: String(push.timestamp),
      staleAt: push.staleAt === null ? "" : String(push.staleAt),
    },
    android: { priority: push.priority === "high" ? "HIGH" : "NORMAL", ttl: `${ttl}s`, collapse_key: COLLAPSE_KEY },
  };
}

/** The access token and its lifetime in seconds from a Google OAuth answer. */
function accessTokenOf(value: unknown): { value: string; expiresIn: number } | null {
  if (!isDynamicRecord(value) || !isString(value.access_token) || typeof value.expires_in !== "number") return null;
  return { value: value.access_token, expiresIn: value.expires_in };
}

/** The `errorCode` of an FCM error answer, such as `UNREGISTERED`. */
function fcmErrorCode(value: unknown): string {
  if (!isDynamicRecord(value) || !isDynamicRecord(value.error)) return "";
  const details = Array.isArray(value.error.details) ? value.error.details : [];
  for (const detail of details) {
    if (isDynamicRecord(detail) && isString(detail.errorCode)) return detail.errorCode;
  }
  return isString(value.error.status) ? value.error.status : "";
}

/** Reads one update from a host request body, or returns `null` when it is not valid. */
export function readAndroidLiveUpdateRelayPush(body: DynamicRecord): AndroidLiveUpdateRelayPush | null {
  const { token, event, sealed, timestamp, staleAt, priority } = body;
  if (!isString(token) || !ANDROID_LIVE_UPDATE_TOKEN_PATTERN.test(token)) return null;
  if (event !== "update" && event !== "end") return null;
  if (event === "update") {
    if (!isString(sealed) || sealed.length > ANDROID_LIVE_UPDATE_SEALED_LIMIT || !/^[A-Za-z0-9_-]+$/u.test(sealed)) {
      return null;
    }
  } else if (sealed !== null) return null;
  if (!isSeconds(timestamp) || (staleAt !== null && !isSeconds(staleAt))) return null;
  if (priority !== "high" && priority !== "normal") return null;
  return {
    token,
    event,
    sealed: event === "update" && isString(sealed) ? sealed : null,
    timestamp,
    staleAt,
    priority,
  };
}

function isSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

let shared: { config: FcmConfig; sender: FcmLiveUpdateSender } | null = null;

/** One sender for each service account, so the key import and the access token are reused. */
export function sharedFcmSender(config: FcmConfig): FcmLiveUpdateSender {
  if (
    shared &&
    shared.config.projectId === config.projectId &&
    shared.config.clientEmail === config.clientEmail &&
    shared.config.privateKey === config.privateKey
  ) {
    return shared.sender;
  }
  const sender = new FcmLiveUpdateSender(config, (input, init) => fetch(input, init));
  shared = { config, sender };
  return sender;
}
