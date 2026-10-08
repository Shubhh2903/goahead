// Which hosts of a Slack workspace receive one Slack request. Pure: Signal parses the facts from the
// signed body and resolves the targets to sockets. See
// docs/superpowers/specs/2026-10-08-multi-user-slack-design.md, section 2.
import { slackOwnerFromBlockId } from "@openbot/contracts/signal-protocol/slack-route";
import { z } from "zod";

export type SlackTarget =
  // The workspace's default host.
  | { kind: "default" }
  // That person's host.
  | { kind: "person"; userId: string }
  // Ask Slack who may see it. `directAuthor` is set for a DM message from a person: when Slack's
  // list includes the bot, the DM is with @GoAhead and rule 1 applies to that author.
  | { kind: "people"; eventContext: string; directAuthor?: string }
  // Every host of the team.
  | { kind: "all" }
  // The listed people only.
  | { kind: "persons"; userIds: string[] };

// Each field falls back to absent when Slack sends another shape, so one odd field cannot hide the
// rest. The schemas keep only the fields that routing reads: message text is not kept.
const optionalText = z.string().min(1).optional().catch(undefined);
const optionalTexts = z.array(z.string()).optional().catch(undefined);

const slackEventBodySchema = z.object({
  event_context: optionalText,
  event: z
    .object({
      type: optionalText,
      user: optionalText,
      channel_type: optionalText,
      subtype: optionalText,
      bot_id: optionalText,
      tokens: z.object({ oauth: optionalTexts, bot: optionalTexts }).optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
  authorizations: z
    .array(z.object({ user_id: optionalText, is_bot: z.boolean().optional().catch(undefined) }))
    .optional()
    .catch(undefined),
});

const slackInteractivityBodySchema = z.object({
  user: z.object({ id: optionalText }).optional().catch(undefined),
  actions: z
    .array(z.object({ block_id: optionalText }))
    .optional()
    .catch(undefined),
});

export type SlackEventBody = z.infer<typeof slackEventBodySchema>;
export type SlackInteractivityBody = z.infer<typeof slackInteractivityBodySchema>;

export type SlackRequestFacts =
  | { kind: "event"; body: SlackEventBody; botUserId: string | null }
  | { kind: "interactivity"; body: SlackInteractivityBody; botUserId: string | null };

// Parses the JSON body of an event, or the `payload` of a button press. `botUserId` comes from
// `authorizations[].user_id` where `is_bot`, if present.
export function slackRequestFacts(kind: SlackRequestFacts["kind"], value: unknown): SlackRequestFacts {
  if (kind === "interactivity") {
    const parsed = slackInteractivityBodySchema.safeParse(value);
    return { kind, body: parsed.success ? parsed.data : {}, botUserId: null };
  }
  const parsed = slackEventBodySchema.safeParse(value);
  const body: SlackEventBody = parsed.success ? parsed.data : {};
  const bot = body.authorizations?.find((authorization) => authorization.is_bot === true);
  return { kind, body, botUserId: bot?.user_id ?? null };
}

// Rules 1-4 of the spec. Returns the targets in priority order: for rules 1 and 2 the first target
// that has a host wins; rule 3 and 4 targets are used whole. An empty list delivers to nobody.
export function slackTargets(facts: SlackRequestFacts): SlackTarget[] {
  if (facts.kind === "interactivity") return interactivityTargets(facts.body);
  const event = facts.body.event;
  if (!event) return [{ kind: "all" }];

  // Rule 1: a request to the bot goes to its author's host, else to the default.
  if (event.type === "app_mention") {
    return event.user ? [{ kind: "person", userId: event.user }, { kind: "default" }] : [{ kind: "default" }];
  }

  // Rule 3: a DM with the bot and a DM between two people look the same here, so every message
  // asks Slack who may see it. A message without `event_context` goes nowhere: it could be private.
  if (event.type === "message") {
    const eventContext = facts.body.event_context;
    if (!eventContext) return [];
    const author = event.channel_type === "im" ? personAuthor(event, facts.botUserId) : null;
    return [author ? { kind: "people", eventContext, directAuthor: author } : { kind: "people", eventContext }];
  }

  // Rule 4.
  if (event.type === "tokens_revoked") {
    const targets: SlackTarget[] = [{ kind: "persons", userIds: nonEmpty(event.tokens?.oauth) }];
    if (nonEmpty(event.tokens?.bot).length > 0) targets.push({ kind: "all" });
    return targets;
  }
  return [{ kind: "all" }];
}

// Rule 2: a button press goes to the draft owner's host. Without an owner block ID (older drafts),
// it goes to the presser's host, else to the default.
function interactivityTargets(body: SlackInteractivityBody): SlackTarget[] {
  const owner = slackOwnerFromBlockId(body.actions?.[0]?.block_id);
  if (owner) return [{ kind: "person", userId: owner }];
  const presser = body.user?.id;
  return presser ? [{ kind: "person", userId: presser }, { kind: "default" }] : [{ kind: "default" }];
}

// The person who wrote the message, or null when a bot wrote it.
function personAuthor(event: NonNullable<SlackEventBody["event"]>, botUserId: string | null): string | null {
  if (event.bot_id !== undefined || event.subtype === "bot_message") return null;
  return event.user && event.user !== botUserId ? event.user : null;
}

function nonEmpty(values: string[] | undefined): string[] {
  return values?.filter((value) => value !== "") ?? [];
}
