// A fake Google on a loopback port, for tests and for `scripts/google-connector-smoke.ts`: the
// OAuth endpoints, Gmail v1 and Calendar v3, with only the fields GoAhead reads. It records each
// request, so a test counts sends and reads what was posted. No real Google account is used.

import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";

export const FAKE_GOOGLE_CLIENT = {
  clientId: "1234567890-fakeclient.apps.googleusercontent.com",
  clientSecret: "fake-client-secret-value",
} as const;
export const FAKE_GOOGLE_EMAIL = "owner@example.com";

/** A reversible stand-in for `safeStorage`. Every Google test imports this one stub. */
export const FAKE_GOOGLE_CIPHER = {
  encrypt: (value: string) => Buffer.from([...value].reverse().join(""), "utf8"),
  decrypt: (value: Buffer) => [...value.toString("utf8")].reverse().join(""),
};

const GRANTED_SCOPE = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

export interface FakeGmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  from: string;
  to: string;
  subject: string;
  /** RFC 2822 date, as the `Date` header. */
  date: string;
  snippet: string;
  text: string;
  /** The `Message-ID` header, such as `<abc@example.com>`. */
  messageIdHeader: string;
  /** Adds a `text/calendar` part named `invite.ics`. */
  invite?: boolean;
}

export interface FakeDraft {
  id: string;
  raw: string;
  threadId: string | null;
  attachments?: string[];
}

export interface FakeCalendarEvent {
  id: string;
  summary: string;
  /** ISO time. */
  start: string;
  end: string;
  transparency?: "transparent";
}

export interface FakeGoogleServer {
  origin: string;
  messages: FakeGmailMessage[];
  events: FakeCalendarEvent[];
  /** What `users.getProfile` reports. `addMessage` raises it. */
  historyId: number;
  /** `users.history.list` answers 404 for a start below this id. */
  oldestHistoryId: number;
  /** `attachments` are file names that the draft carries as parts. */
  drafts: Map<string, FakeDraft>;
  sentDraftIds: string[];
  insertedEvents: unknown[];
  revokedTokens: string[];
  /** The `grant_type` of each token request, in order. */
  tokenGrants: string[];
  /** False: a refresh answers `invalid_grant`. */
  refreshAllowed: boolean;
  requests: Array<{ method: string; path: string }>;
  /** The next requests to a path that starts with `pathPrefix` get these statuses, in order. */
  failNext: (pathPrefix: string, ...statuses: number[]) => void;
  /** The next requests to a path that starts with `pathPrefix` run, and then answer these statuses. */
  failAfterNext: (pathPrefix: string, ...statuses: number[]) => void;
  /** Makes every access token issued so far invalid, as an expiry does. */
  expireAccessTokens: () => void;
  /** A valid access token with no sign-in, for a test of one API client. */
  issueAccessToken: () => string;
  /** Adds a new INBOX message and its `messageAdded` history record. */
  addMessage: (message: FakeGmailMessage) => void;
  close: () => Promise<void>;
}

const labelChangeSchema = z.object({
  addLabelIds: z.array(z.string()).optional(),
  removeLabelIds: z.array(z.string()).optional(),
});
const draftBodySchema = z.object({
  id: z.string().optional(),
  message: z.object({ raw: z.string(), threadId: z.string().optional() }).optional(),
});
const eventBodySchema = z.object({
  id: z.string().optional(),
  start: z.unknown(),
  end: z.unknown(),
});

export async function startFakeGoogleServer(): Promise<FakeGoogleServer> {
  const challenges = new Map<string, string>();
  const accessTokens = new Set<string>();
  const failures = new Map<string, number[]>();
  const lateFailures = new Map<string, number[]>();
  const history: Array<{ id: number; messageId: string }> = [];
  let counter = 0;
  const insertedById = new Map<string, object>();
  const next = (prefix: string) => `${prefix}-${++counter}`;
  const issueAccessToken = () => {
    const token = next("fake-access-token-value");
    accessTokens.add(token);
    return token;
  };

  const fake: FakeGoogleServer = {
    origin: "",
    messages: [],
    events: [],
    historyId: 1000,
    oldestHistoryId: 0,
    drafts: new Map(),
    sentDraftIds: [],
    insertedEvents: [],
    revokedTokens: [],
    tokenGrants: [],
    refreshAllowed: true,
    requests: [],
    failNext: (pathPrefix, ...statuses) => {
      failures.set(pathPrefix, [...(failures.get(pathPrefix) ?? []), ...statuses]);
    },
    failAfterNext: (pathPrefix, ...statuses) => {
      lateFailures.set(pathPrefix, [...(lateFailures.get(pathPrefix) ?? []), ...statuses]);
    },
    expireAccessTokens: () => accessTokens.clear(),
    issueAccessToken,
    addMessage: (message) => {
      fake.messages.push(message);
      fake.historyId += 1;
      history.push({ id: fake.historyId, messageId: message.id });
    },
    close: async () => undefined,
  };

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const method = request.method ?? "GET";
    fake.requests.push({ method, path: url.pathname });
    for (const [prefix, statuses] of failures) {
      const status = url.pathname.startsWith(prefix) ? statuses.shift() : undefined;
      if (status !== undefined) {
        send(response, status, { error: { code: status } });
        return;
      }
    }
    for (const [prefix, statuses] of lateFailures) {
      const status = url.pathname.startsWith(prefix) ? statuses.shift() : undefined;
      // Answered first: the request still runs below, and its own answer is dropped (`send`).
      if (status !== undefined) send(response, status, { error: { code: status } });
    }
    if (url.pathname === "/o/oauth2/v2/auth") {
      const code = next("fake-authorization-code");
      challenges.set(code, url.searchParams.get("code_challenge") ?? "");
      const back = new URL(url.searchParams.get("redirect_uri") ?? "http://127.0.0.1/");
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      response.writeHead(302, { location: back.toString() }).end();
      return;
    }
    if (url.pathname === "/token" && method === "POST") {
      const form = new URLSearchParams(await readBody(request));
      const grant = form.get("grant_type") ?? "";
      fake.tokenGrants.push(grant);
      if (
        form.get("client_id") !== FAKE_GOOGLE_CLIENT.clientId ||
        form.get("client_secret") !== FAKE_GOOGLE_CLIENT.clientSecret
      ) {
        send(response, 401, { error: "invalid_client" });
        return;
      }
      if (grant === "authorization_code") {
        const code = form.get("code") ?? "";
        const challenge = challenges.get(code);
        challenges.delete(code);
        const verifier = form.get("code_verifier") ?? "";
        if (!challenge || createHash("sha256").update(verifier).digest("base64url") !== challenge) {
          send(response, 400, { error: "invalid_grant" });
          return;
        }
        send(response, 200, {
          access_token: issueAccessToken(),
          refresh_token: next("fake-refresh-token-value"),
          expires_in: 3600,
          token_type: "Bearer",
          scope: GRANTED_SCOPE,
        });
        return;
      }
      if (grant === "refresh_token") {
        if (!fake.refreshAllowed) {
          send(response, 400, { error: "invalid_grant" });
          return;
        }
        send(response, 200, {
          access_token: issueAccessToken(),
          expires_in: 3600,
          token_type: "Bearer",
          scope: GRANTED_SCOPE,
        });
        return;
      }
      send(response, 400, { error: "unsupported_grant_type" });
      return;
    }
    if (url.pathname === "/revoke" && method === "POST") {
      fake.revokedTokens.push(new URLSearchParams(await readBody(request)).get("token") ?? "");
      send(response, 200, {});
      return;
    }
    const bearer = (request.headers.authorization ?? "").replace(/^Bearer /u, "");
    if (!accessTokens.has(bearer)) {
      send(response, 401, { error: { code: 401, status: "UNAUTHENTICATED" } });
      return;
    }
    if (url.pathname.startsWith("/gmail/v1/users/me/")) {
      await gmail(method, url, request, response);
      return;
    }
    if (url.pathname.startsWith("/calendar/v3/calendars/primary/events")) {
      await calendar(method, url, request, response);
      return;
    }
    send(response, 404, { error: { code: 404 } });
  }

  async function gmail(method: string, url: URL, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = url.pathname.slice("/gmail/v1/users/me/".length);
    if (path === "profile") {
      send(response, 200, { emailAddress: FAKE_GOOGLE_EMAIL, historyId: String(fake.historyId) });
      return;
    }
    if (path === "history") {
      const start = Number(url.searchParams.get("startHistoryId"));
      if (!Number.isFinite(start) || start < fake.oldestHistoryId) {
        send(response, 404, { error: { code: 404 } });
        return;
      }
      const added = history.filter((entry) => entry.id > start);
      send(response, 200, {
        historyId: String(fake.historyId),
        history: added.map((entry) => {
          const message = fake.messages.find((candidate) => candidate.id === entry.messageId);
          return {
            id: String(entry.id),
            messagesAdded: message
              ? [{ message: { id: message.id, threadId: message.threadId, labelIds: message.labelIds } }]
              : [],
          };
        }),
      });
      return;
    }
    if (path === "messages" && method === "GET") {
      const query = (url.searchParams.get("q") ?? "").toLowerCase();
      const limit = Number(url.searchParams.get("maxResults") ?? 25);
      const hits = fake.messages
        .filter(
          (message) => !query || `${message.from} ${message.subject} ${message.text}`.toLowerCase().includes(query),
        )
        .slice(0, limit);
      send(response, 200, { messages: hits.map((message) => ({ id: message.id, threadId: message.threadId })) });
      return;
    }
    const messageMatch = /^messages\/([^/]+)(\/modify)?$/u.exec(path);
    if (messageMatch) {
      const message = fake.messages.find((candidate) => candidate.id === messageMatch[1]);
      if (!message) {
        send(response, 404, { error: { code: 404 } });
        return;
      }
      if (messageMatch[2] && method === "POST") {
        const change = labelChangeSchema.parse(JSON.parse(await readBody(request)));
        const removed = new Set(change.removeLabelIds ?? []);
        message.labelIds = [
          ...new Set([...message.labelIds.filter((id) => !removed.has(id)), ...(change.addLabelIds ?? [])]),
        ];
        send(response, 200, { id: message.id, threadId: message.threadId, labelIds: message.labelIds });
        return;
      }
      send(response, 200, messageResource(message));
      return;
    }
    const threadMatch = /^threads\/([^/]+)$/u.exec(path);
    if (threadMatch) {
      const messages = fake.messages.filter((message) => message.threadId === threadMatch[1]);
      if (messages.length === 0) {
        send(response, 404, { error: { code: 404 } });
        return;
      }
      send(response, 200, { id: threadMatch[1], messages: messages.map(messageResource) });
      return;
    }
    if (path === "drafts" && method === "POST") {
      const body = draftBodySchema.parse(JSON.parse(await readBody(request)));
      const draft = { id: next("draft"), raw: body.message?.raw ?? "", threadId: body.message?.threadId ?? null };
      fake.drafts.set(draft.id, draft);
      send(response, 200, draftResource(draft));
      return;
    }
    if (path === "drafts/send" && method === "POST") {
      const body = draftBodySchema.parse(JSON.parse(await readBody(request)));
      const draft = fake.drafts.get(body.id ?? "");
      if (!draft) {
        send(response, 404, { error: { code: 404 } });
        return;
      }
      fake.drafts.delete(draft.id);
      fake.sentDraftIds.push(draft.id);
      send(response, 200, { id: next("sent"), threadId: draft.threadId ?? next("thread"), labelIds: ["SENT"] });
      return;
    }
    const draftMatch = /^drafts\/([^/]+)$/u.exec(path);
    if (draftMatch) {
      const draft = fake.drafts.get(draftMatch[1] ?? "");
      if (!draft) {
        send(response, 404, { error: { code: 404 } });
        return;
      }
      if (method === "PUT") {
        const body = draftBodySchema.parse(JSON.parse(await readBody(request)));
        draft.raw = body.message?.raw ?? draft.raw;
        draft.threadId = body.message?.threadId ?? draft.threadId;
      }
      send(response, 200, draftResource(draft));
      return;
    }
    send(response, 404, { error: { code: 404 } });
  }

  async function calendar(method: string, url: URL, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const eventPath = url.pathname.slice("/calendar/v3/calendars/primary/events".length);
    if (eventPath.startsWith("/")) {
      const inserted = insertedById.get(decodeURIComponent(eventPath.slice(1)));
      if (method !== "GET" || !inserted) {
        send(response, 404, { error: { code: 404 } });
        return;
      }
      send(response, 200, inserted);
      return;
    }
    if (method === "GET") {
      const from = Date.parse(url.searchParams.get("timeMin") ?? "");
      const to = Date.parse(url.searchParams.get("timeMax") ?? "");
      const items = fake.events
        .filter((event) => Date.parse(event.end) > from && Date.parse(event.start) < to)
        .map((event) => ({
          id: event.id,
          status: "confirmed",
          summary: event.summary,
          start: { dateTime: event.start },
          end: { dateTime: event.end },
          ...(event.transparency ? { transparency: event.transparency } : {}),
        }));
      send(response, 200, { items });
      return;
    }
    if (method === "POST") {
      if (url.searchParams.get("conferenceDataVersion") !== "1" || url.searchParams.get("sendUpdates") !== "all") {
        send(response, 400, { error: { code: 400 } });
        return;
      }
      const body = eventBodySchema.loose().parse(JSON.parse(await readBody(request)));
      // Google refuses a second event with the same id.
      if (body.id && insertedById.has(body.id)) {
        send(response, 409, { error: { code: 409, message: "The requested identifier already exists." } });
        return;
      }
      fake.insertedEvents.push(body);
      const id = body.id ?? next("event");
      const resource = {
        id,
        htmlLink: `https://calendar.example.com/${id}`,
        hangoutLink: `https://meet.google.com/fak-${counter}`,
        start: body.start,
        end: body.end,
      };
      insertedById.set(id, resource);
      send(response, 200, resource);
      return;
    }
    send(response, 404, { error: { code: 404 } });
  }

  const server = createServer((request, response) => {
    route(request, response).catch((error: unknown) => send(response, 500, { error: String(error) }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The fake Google server has no port.");
  fake.origin = `http://127.0.0.1:${address.port}`;
  fake.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return fake;
}

function send(response: ServerResponse, status: number, body: object): void {
  if (response.headersSent) return;
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function base64Url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function messageResource(message: FakeGmailMessage) {
  return {
    id: message.id,
    threadId: message.threadId,
    labelIds: message.labelIds,
    snippet: message.snippet,
    internalDate: String(Date.parse(message.date)),
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "From", value: message.from },
        { name: "To", value: message.to },
        { name: "Subject", value: message.subject },
        { name: "Date", value: message.date },
        { name: "Message-ID", value: message.messageIdHeader },
      ],
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/plain", body: { data: base64Url(message.text) } },
            { mimeType: "text/html", body: { data: base64Url(`<p>${message.text}</p>`) } },
          ],
        },
        ...(message.invite
          ? [{ mimeType: "text/calendar", filename: "invite.ics", body: { attachmentId: "invite-1", size: 120 } }]
          : []),
      ],
    },
  };
}

/** Gmail answers a draft with the parsed message. This parser reads only what `buildRawMessage` writes. */
function draftResource(draft: FakeDraft) {
  const source = Buffer.from(draft.raw, "base64url").toString("utf8");
  const split = source.indexOf("\r\n\r\n");
  const headerLines = (split < 0 ? source : source.slice(0, split)).split("\r\n");
  const headers = headerLines.flatMap((line) => {
    const colon = line.indexOf(":");
    return colon < 0 ? [] : [{ name: line.slice(0, colon), value: line.slice(colon + 1).trim() }];
  });
  const encoded = split < 0 ? "" : source.slice(split + 4).replace(/\s/gu, "");
  const text = Buffer.from(encoded, "base64").toString("utf8");
  return {
    id: draft.id,
    message: {
      id: `${draft.id}-message`,
      threadId: draft.threadId ?? `${draft.id}-thread`,
      labelIds: ["DRAFT"],
      payload: draft.attachments?.length
        ? {
            mimeType: "multipart/mixed",
            headers,
            parts: [
              { mimeType: "text/plain", body: { data: base64Url(text) } },
              ...draft.attachments.map((filename, index) => ({
                mimeType: "application/pdf",
                filename,
                body: { attachmentId: `attachment-${index}`, size: 100 },
              })),
            ],
          }
        : { mimeType: "text/plain", headers, body: { data: base64Url(text) } },
    },
  };
}
