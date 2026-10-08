// Asks Slack who may see one event (`apps.event.authorizations.list`), so Signal sends a private
// message only to the hosts of the people in it. It uses the app-level token (`SLACK_APP_TOKEN`)
// with `authorizations:read`. Never put that token in an error or a log.
import { z } from "zod";

const AUTHORIZATIONS_URL = "https://slack.com/api/apps.event.authorizations.list";
const DEFAULT_CACHE_SECONDS = 600;
const DEFAULT_TIMEOUT_MS = 2_000;
// Bounds for one lookup and for the cache, so a bad answer or a burst cannot grow without limit.
const PAGES_LIMIT = 20;
const CACHE_ENTRIES_LIMIT = 10_000;
const SLACK_ERROR_CODE = /^[a-z0-9_]{1,64}$/;

const authorizationsAnswerSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional().catch(undefined),
  authorizations: z
    .array(
      z.object({ user_id: z.string().optional().catch(undefined), is_bot: z.boolean().optional().catch(undefined) }),
    )
    .optional()
    .catch(undefined),
  response_metadata: z
    .object({ next_cursor: z.string().optional().catch(undefined) })
    .optional()
    .catch(undefined),
});

// The part of `fetch` that the client uses, so a test can pass a plain function.
export type SlackAuthorizationsFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface SlackAuthorizationsOptions {
  // The app-level token of each Slack app, or null when Signal has none for it.
  appToken: (appId: string) => string | null;
  fetch?: SlackAuthorizationsFetch;
  cacheSeconds?: number;
  timeoutMs?: number;
}

export interface SlackEventAudience {
  // Slack user IDs of the people who may see the event.
  users: string[];
  // True when the app's bot user is among them.
  includesBot: boolean;
}

interface CacheEntry {
  expiresAt: number;
  audience: Promise<SlackEventAudience>;
}

export class SlackAuthorizations {
  readonly #appToken: (appId: string) => string | null;
  readonly #fetch: SlackAuthorizationsFetch;
  readonly #cacheMs: number;
  readonly #timeoutMs: number;
  readonly #cache = new Map<string, CacheEntry>();

  constructor(options: SlackAuthorizationsOptions) {
    this.#appToken = options.appToken;
    this.#fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.#cacheMs = (options.cacheSeconds ?? DEFAULT_CACHE_SECONDS) * 1000;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // Who may see the event: person user IDs, and whether the bot is among them. Slack retries an
  // event with the same `event_id`, so the answer is cached per event. Throws on a Slack error; the
  // caller answers 503.
  usersFor(appId: string, eventId: string, eventContext: string): Promise<SlackEventAudience> {
    const now = Date.now();
    this.#prune(now);
    const key = `${appId}:${eventId}`;
    const cached = this.#cache.get(key);
    if (cached && cached.expiresAt > now) return cached.audience;
    const audience = this.#lookup(appId, eventContext);
    this.#cache.set(key, { expiresAt: now + this.#cacheMs, audience });
    // A failed lookup is not kept: Slack's retry asks again.
    audience.catch(() => {
      if (this.#cache.get(key)?.audience === audience) this.#cache.delete(key);
    });
    return audience;
  }

  async #lookup(appId: string, eventContext: string): Promise<SlackEventAudience> {
    const token = this.#appToken(appId);
    if (!token) throw new Error("Slack authorizations: no app token for this app");
    const users = new Set<string>();
    let includesBot = false;
    let cursor = "";
    for (let page = 0; page < PAGES_LIMIT; page += 1) {
      const form = new URLSearchParams({ event_context: eventContext });
      if (cursor) form.set("cursor", cursor);
      const response = await this.#fetch(AUTHORIZATIONS_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (!response.ok) throw new Error(`Slack authorizations: HTTP ${response.status}`);
      const parsed = authorizationsAnswerSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("Slack authorizations: unexpected answer");
      const answer = parsed.data;
      if (!answer.ok) throw new Error(`Slack authorizations: ${slackErrorCode(answer.error)}`);
      for (const authorization of answer.authorizations ?? []) {
        if (authorization.is_bot === true) includesBot = true;
        else if (authorization.user_id) users.add(authorization.user_id);
      }
      const next = answer.response_metadata?.next_cursor;
      if (!next) return { users: [...users], includesBot };
      cursor = next;
    }
    throw new Error("Slack authorizations: too many pages");
  }

  #prune(now: number): void {
    for (const [key, entry] of this.#cache) {
      if (entry.expiresAt <= now) this.#cache.delete(key);
    }
    // Map keeps insertion order, so the first entries are the oldest.
    for (const key of this.#cache.keys()) {
      if (this.#cache.size < CACHE_ENTRIES_LIMIT) break;
      this.#cache.delete(key);
    }
  }
}

function slackErrorCode(value: string | undefined): string {
  return typeof value === "string" && SLACK_ERROR_CODE.test(value) ? value : "unknown_error";
}
