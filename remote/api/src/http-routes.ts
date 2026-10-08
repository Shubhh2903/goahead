// The HTTP routes of Signal that do not need the server framework: the account service's auth events
// and the Slack app's request URL. `app.ts` mounts them on Elysia; tests in other projects call them
// with a plain `Request`, so they do not load Elysia's Bun types.

import type { RemoteAuthEvent } from "@openbot/contracts/signal-protocol/auth-events";
import { z } from "zod";
import type { RemoteApiConfig } from "./config";
import { SLACK_DELIVERY_BODY_BYTES_LIMIT, type SlackDeliveryKind } from "./protocol";
import type { SignalService, SlackAudienceLookup, SlackDeliveryResponse } from "./signal-service";
import { slackRequestFacts, slackTargets } from "./slack-targets";
import { verifySlackSignature, verifyWebhookSignature } from "./tokens";

const SLACK_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const SLACK_RETRY_REASON_PATTERN = /^[a-z0-9_]{1,64}$/u;

const slackRequestSchema = z.object({
  type: z.string().optional(),
  api_app_id: z.string().optional(),
  challenge: z.string().max(1_024).optional(),
  team_id: z.string().optional(),
  event_id: z.string().optional(),
  team: z.object({ id: z.string() }).nullish(),
  authorizations: z.array(z.object({ team_id: z.string() })).optional(),
});

const authEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("account-profile-changed"), userId: z.string().min(1) }),
  z.object({ type: z.literal("account-servers-changed"), userId: z.string().min(1) }),
  z.object({
    type: z.literal("remote-auth-changed"),
    hostId: z.string().min(1),
    authEpoch: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("remote-session-ended"),
    hostId: z.string().min(1),
    sessionId: z.string().min(1),
  }),
  z.object({
    type: z.literal("slack-route-revoked"),
    appId: z.string().min(1),
    teamId: z.string().min(1),
    through: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("slack-person-route-revoked"),
    appId: z.string().min(1),
    teamId: z.string().min(1),
    userId: z.string().min(1),
    through: z.number().int().nonnegative(),
  }),
]) satisfies z.ZodType<RemoteAuthEvent>;
const AUTH_EVENT_TYPES = new Set<string>(authEventSchema.options.map((option) => option.shape.type.value));
// Any event: a known one, or one of a type that a later account service sends.
const authEventEnvelopeSchema = z.union([authEventSchema, z.object({ type: z.string().min(1).max(128) })]);

/** One event from the account service, signed with the shared webhook secret. */
export async function handleAuthEvent(
  request: Request,
  config: RemoteApiConfig,
  signal: SignalService,
): Promise<Response> {
  const timestamp = request.headers.get("OpenBot-Timestamp") ?? "";
  const signature = request.headers.get("OpenBot-Signature") ?? "";
  const body = await request.text();
  if (!verifyWebhookSignature(body, timestamp, signature, config.authWebhookSecret)) {
    return jsonError(401, "invalid_signature", "The auth event signature is invalid.");
  }
  const event = decodeAuthEvent(body);
  // A later account service can send an event type that this Signal does not know yet. It is
  // skipped, so the account service does not retry it or stop sending the events that follow.
  if (event === "unknown") return new Response(null, { status: 204 });
  if (!event) {
    return jsonError(400, "invalid_event", "The auth event is invalid.");
  }
  if (event.type === "remote-auth-changed") signal.revoke(event.hostId, event.authEpoch);
  else if (event.type === "account-profile-changed") signal.profileChanged(event.userId);
  else if (event.type === "account-servers-changed") signal.serversChanged(event.userId);
  else if (event.type === "slack-route-revoked") signal.revokeSlackRoute(event.appId, event.teamId, event.through);
  else if (event.type === "slack-person-route-revoked") {
    signal.revokeSlackPersonRoute(event.appId, event.teamId, event.userId, event.through);
  } else signal.revokeSession(event.sessionId);
  return new Response(null, { status: 204 });
}

/**
 * The OpenBot Slack app's one request URL, for the events and button presses of every workspace.
 * Signal checks Slack's signature, reads the IDs that pick the hosts (see `slack-targets.ts`), and
 * passes the exact body to the ingress sockets of those hosts. Nothing here stores or logs the body.
 * `clientAddress` is read only for a request with a wrong signature, for its rate limit.
 */
export async function handleSlackEvents(
  request: Request,
  config: RemoteApiConfig,
  signal: SignalService,
  slackAudience: SlackAudienceLookup,
  clientAddress: () => string,
): Promise<Response> {
  if (config.slackSigningSecrets.length === 0) return slackResponse({ status: 503 });
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > SLACK_DELIVERY_BODY_BYTES_LIMIT) {
    return slackResponse({ status: 413 });
  }
  const kind = slackDeliveryKind(request.headers.get("content-type"));
  if (!kind) return slackResponse({ status: 415 });
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > SLACK_DELIVERY_BODY_BYTES_LIMIT) return slackResponse({ status: 413 });
  const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
  const signature = request.headers.get("x-slack-signature") ?? "";
  const signer = config.slackSigningSecrets.find(({ secret }) =>
    verifySlackSignature(body, timestamp, signature, secret),
  );
  if (!signer) {
    return slackResponse({ status: signal.acceptSlackRequest(`address:${clientAddress()}`) ? 401 : 429 });
  }
  const slack = slackRequest(kind, body);
  if (!slack) return slackResponse({ status: 400 });
  if ("challenge" in slack) {
    return slackResponse({ status: 200, contentType: "text/plain", body: slack.challenge });
  }
  // The secret binds the app: a request signed by one app cannot reach another app's route.
  if (slack.appId !== signer.appId) return slackResponse({ status: 401 });
  if (!signal.acceptSlackRequest(`team:${slack.teamId}`)) return slackResponse({ status: 429 });
  const retryNum = Number(request.headers.get("x-slack-retry-num") ?? "");
  const retryReason = request.headers.get("x-slack-retry-reason");
  const targets = slackTargets(slackRequestFacts(kind === "events" ? "event" : "interactivity", slack.value));
  return slackResponse(
    await signal.deliverSlack(
      slack.appId,
      slack.teamId,
      targets,
      {
        kind,
        retryNum: Number.isInteger(retryNum) && retryNum >= 0 && retryNum < 100 ? retryNum : null,
        retryReason: retryReason && SLACK_RETRY_REASON_PATTERN.test(retryReason) ? retryReason : null,
        body,
        eventId: slack.eventId,
      },
      slackAudience,
    ),
  );
}

function jsonError(status: 400 | 401, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function slackDeliveryKind(contentType: string | null): SlackDeliveryKind | null {
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType === "application/json") return "events";
  if (mediaType === "application/x-www-form-urlencoded") return "interactivity";
  return null;
}

/**
 * The `url_verification` challenge, which Signal answers itself, or the app and workspace IDs, the
 * event ID and the parsed value from which `slack-targets.ts` reads the routing facts. Events carry
 * the workspace as `team_id`, and button presses as `payload.team.id`.
 */
function slackRequest(
  kind: SlackDeliveryKind,
  body: Uint8Array,
): { challenge: string } | { appId: string; teamId: string; eventId: string | null; value: unknown } | null {
  let value: unknown;
  try {
    const text = new TextDecoder().decode(body);
    value = kind === "events" ? JSON.parse(text) : JSON.parse(new URLSearchParams(text).get("payload") ?? "null");
  } catch {
    return null;
  }
  const parsed = slackRequestSchema.safeParse(value);
  if (!parsed.success) return null;
  if (kind === "events" && parsed.data.type === "url_verification" && parsed.data.challenge) {
    return { challenge: parsed.data.challenge };
  }
  const teamId = parsed.data.team_id ?? parsed.data.team?.id ?? parsed.data.authorizations?.[0]?.team_id;
  const appId = parsed.data.api_app_id;
  if (!teamId || !appId || !SLACK_ID_PATTERN.test(teamId) || !SLACK_ID_PATTERN.test(appId)) return null;
  const eventId = parsed.data.event_id;
  return { appId, teamId, eventId: eventId && SLACK_ID_PATTERN.test(eventId) ? eventId : null, value };
}

function slackResponse(response: SlackDeliveryResponse | { status: 413 | 415 | 429 | 401 | 400 | 503 }): Response {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if ("contentType" in response && response.contentType && response.body !== undefined) {
    headers["Content-Type"] = response.contentType;
    return new Response(response.body, { status: response.status, headers });
  }
  return new Response(null, { status: response.status, headers });
}

/** The event, `unknown` for a well-formed event of a type this Signal does not know, or null. */
function decodeAuthEvent(body: string): RemoteAuthEvent | "unknown" | null {
  try {
    const result = authEventEnvelopeSchema.safeParse(JSON.parse(body));
    if (!result.success) return null;
    const known = authEventSchema.safeParse(result.data);
    if (known.success) return known.data;
    return AUTH_EVENT_TYPES.has(result.data.type) ? null : "unknown";
  } catch {
    return null;
  }
}
