import { slackOwnerBlockId } from "@openbot/contracts/signal-protocol/slack-route";
import { describe, expect, it } from "vitest";
import { slackRequestFacts, slackTargets } from "../src/slack-targets";

const BOT = "UBOT1";

// Slack bodies as Slack sends them, with some fields of a wrong shape to check the parser.
interface EventFixture {
  type: string;
  user?: string | number;
  channel?: string | { id: string };
  channel_type?: string;
  subtype?: string;
  bot_id?: string | null;
  tokens?: { oauth?: string[]; bot?: string[] };
}

interface ClickFixture {
  type?: string;
  user?: { id: string | number };
  actions?: { block_id: string }[] | string;
}

function event(inner: EventFixture) {
  return slackTargets(
    slackRequestFacts("event", {
      type: "event_callback",
      event_id: "Ev1",
      event_context: "4-ctx",
      authorizations: [{ team_id: "T1", user_id: BOT, is_bot: true }],
      event: inner,
    }),
  );
}

function click(payload: ClickFixture) {
  return slackTargets(slackRequestFacts("interactivity", payload));
}

describe("slackTargets", () => {
  it("sends a mention to its author, then to the default", () => {
    expect(event({ type: "app_mention", user: "U1", channel: "C1" })).toEqual([
      { kind: "person", userId: "U1" },
      { kind: "default" },
    ]);
  });

  it("private DM reaches only its members", () => {
    expect(event({ type: "message", channel_type: "im", user: "U1", channel: "D1" })).toEqual([
      { kind: "people", eventContext: "4-ctx", directAuthor: "U1" },
    ]);
    expect(event({ type: "message", channel_type: "mpim", user: "U1", channel: "G1" })).toEqual([
      { kind: "people", eventContext: "4-ctx" },
    ]);
  });

  it("a DM from a person carries directAuthor", () => {
    expect(event({ type: "message", channel_type: "im", user: "U2" })).toEqual([
      { kind: "people", eventContext: "4-ctx", directAuthor: "U2" },
    ]);
  });

  it("a bot's own DM message has no directAuthor", () => {
    const expected = [{ kind: "people", eventContext: "4-ctx" }];
    expect(event({ type: "message", channel_type: "im", user: BOT, bot_id: "B1" })).toEqual(expected);
    expect(event({ type: "message", channel_type: "im", subtype: "bot_message", bot_id: "B1" })).toEqual(expected);
    expect(event({ type: "message", channel_type: "im", user: BOT })).toEqual(expected);
  });

  it("sends a channel message to the people who may see it", () => {
    expect(event({ type: "message", channel_type: "channel", user: "U1" })).toEqual([
      { kind: "people", eventContext: "4-ctx" },
    ]);
  });

  it("delivers a message without event_context to nobody", () => {
    expect(
      slackTargets(
        slackRequestFacts("event", {
          type: "event_callback",
          event: { type: "message", channel_type: "im", user: "U1" },
        }),
      ),
    ).toEqual([]);
  });

  it("sends a click on an owned draft only to the owner", () => {
    expect(
      click({ type: "block_actions", user: { id: "U2" }, actions: [{ block_id: slackOwnerBlockId("U0OWNER1") }] }),
    ).toEqual([{ kind: "person", userId: "U0OWNER1" }]);
  });

  it("click without owner goes to clicker then default", () => {
    expect(click({ type: "block_actions", user: { id: "U2" }, actions: [{ block_id: "draft-actions" }] })).toEqual([
      { kind: "person", userId: "U2" },
      { kind: "default" },
    ]);
  });

  it("sends app_uninstalled to every host of the team", () => {
    expect(event({ type: "app_uninstalled" })).toEqual([{ kind: "all" }]);
  });

  it("tokens_revoked with only user tokens names those users", () => {
    expect(event({ type: "tokens_revoked", tokens: { oauth: ["U1", "U2"] } })).toEqual([
      { kind: "persons", userIds: ["U1", "U2"] },
    ]);
  });

  it("tokens_revoked with the bot token reaches every host", () => {
    expect(event({ type: "tokens_revoked", tokens: { oauth: ["U1"], bot: [BOT] } })).toEqual([
      { kind: "persons", userIds: ["U1"] },
      { kind: "all" },
    ]);
  });

  it("ignores fields of another shape", () => {
    expect(event({ type: "message", channel_type: "im", user: 42, bot_id: null })).toEqual([
      { kind: "people", eventContext: "4-ctx" },
    ]);
    expect(click({ actions: "none", user: { id: 7 } })).toEqual([{ kind: "default" }]);
  });

  it("sends other events to every host of the team", () => {
    expect(event({ type: "channel_created", channel: { id: "C2" } })).toEqual([{ kind: "all" }]);
  });
});
