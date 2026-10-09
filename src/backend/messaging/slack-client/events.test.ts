// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OpenBotDatabase } from "../../openbot-database";
import type {
  HistoryEvent,
  HistoryMessage,
  InboundMessage,
  InboxCandidate,
  MessagingIngress,
  TransportSink,
} from "../messaging-types";
import { SlackEventsTransport } from "../slack/slack-events-transport";
import { SlackCacheStore } from "./cache-store";
import { applySlackClientEvent } from "./events";

const roots: string[] = [];
const databases: OpenBotDatabase[] = [];
const OWNER = "U1";

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Slack client live events", () => {
  it("a new message and a thread reply go into the cache", async () => {
    const { store, deliver } = await setup();
    store.mergePage("c1", "C1", [message(1)], { hasMore: false, oldestTs: ts(1) });

    const first = await deliver({
      type: "message",
      channel: "C1",
      channel_type: "channel",
      user: "U2",
      ts: ts(2),
      text: "hi",
    });
    const reply = await deliver({
      type: "message",
      channel: "C1",
      channel_type: "channel",
      user: "U2",
      ts: ts(3),
      thread_ts: ts(1),
      text: "reply",
    });

    expect(first.applied).toEqual([true]);
    expect(reply.applied).toEqual([true]);
    expect(store.page("c1", "C1", { limit: 10 }).messages).toMatchObject([
      { ts: ts(1), replyCount: 1, latestReplyTs: ts(3) },
      { ts: ts(2), authorId: "U2", text: "hi", threadTs: null },
    ]);
    expect(store.thread("c1", "C1", ts(1)).replies).toMatchObject([{ ts: ts(3), text: "reply" }]);
  });

  it("a message in a conversation the person is not in adds nothing", async () => {
    const { store, deliver } = await setup();
    store.upsertConversations("c1", [
      { channelId: "C2", kind: "channel", name: "random", memberIds: [], isMember: false },
    ]);

    const unknown = await deliver({
      type: "message",
      channel: "C9",
      channel_type: "channel",
      user: "U2",
      ts: ts(2),
      text: "hi",
    });
    const notMember = await deliver({
      type: "message",
      channel: "C2",
      channel_type: "channel",
      user: "U2",
      ts: ts(3),
      text: "hi",
    });

    expect(unknown.applied).toEqual([false]);
    expect(notMember.applied).toEqual([false]);
    expect(store.conversations("c1")).toMatchObject([{ channelId: "C2", isMember: false }]);
    expect(store.page("c1", "C2", { limit: 10 }).messages).toEqual([]);
  });

  it("a message event for a cached ts keeps its reactions and reply count", async () => {
    const { store, deliver } = await setup();
    const reactions = [{ name: "tada", count: 1, userIds: ["U3"], mine: false }];
    store.mergePage("c1", "C1", [message(1, { reactions, replyCount: 2, latestReplyTs: ts(5) })], {
      hasMore: false,
      oldestTs: ts(1),
    });

    const result = await deliver({
      type: "message",
      channel: "C1",
      channel_type: "channel",
      user: "U2",
      ts: ts(1),
      text: "message 1",
    });

    expect(result.applied).toEqual([false]);
    expect(store.page("c1", "C1", { limit: 10 }).messages[0]).toMatchObject({ reactions, replyCount: 2 });
  });

  it("message_changed edits a cached message and starts no agent turn", async () => {
    const { store, deliver } = await setup();
    store.mergePage("c1", "C1", [message(1)], { hasMore: false, oldestTs: ts(1) });

    const result = await deliver({
      type: "message",
      subtype: "message_changed",
      hidden: true,
      channel: "C1",
      channel_type: "im",
      ts: ts(9),
      message: { type: "message", user: "U2", ts: ts(1), text: "changed", edited: { user: "U2", ts: ts(9) } },
      previous_message: { type: "message", user: "U2", ts: ts(1), text: "message 1" },
    });

    expect(result.applied).toEqual([true]);
    expect(result.messages).toEqual([]);
    expect(result.inbox).toEqual([]);
    expect(store.page("c1", "C1", { limit: 10 }).messages[0]).toMatchObject({
      text: "changed",
      editedAt: new Date((1_700_000_000 + 9) * 1000).toISOString(),
    });
  });

  it("message_deleted removes a cached message", async () => {
    const { store, deliver } = await setup();
    store.mergePage("c1", "C1", [message(1), message(2)], { hasMore: false, oldestTs: ts(1) });

    const result = await deliver({
      type: "message",
      subtype: "message_deleted",
      hidden: true,
      channel: "C1",
      channel_type: "channel",
      ts: ts(9),
      deleted_ts: ts(2),
      previous_message: { type: "message", user: "U2", ts: ts(2), text: "message 2" },
    });

    expect(result.applied).toEqual([true]);
    expect(result.messages).toEqual([]);
    expect(store.page("c1", "C1", { limit: 10 }).messages.map((entry) => entry.ts)).toEqual([ts(1)]);
  });

  it("reaction_added and reaction_removed keep mine for the owner", async () => {
    const { store, deliver } = await setup();
    store.mergePage("c1", "C1", [message(1)], { hasMore: false, oldestTs: ts(1) });
    const reaction = (type: string, user: string) => ({
      type,
      user,
      reaction: "tada",
      item: { type: "message", channel: "C1", ts: ts(1) },
      item_user: "U2",
      event_ts: ts(9),
    });

    await deliver(reaction("reaction_added", "U3"));
    const added = await deliver(reaction("reaction_added", OWNER));
    expect(added.applied).toEqual([true]);
    expect(added.messages).toEqual([]);
    expect(store.page("c1", "C1", { limit: 10 }).messages[0]?.reactions).toEqual([
      { name: "tada", count: 2, userIds: ["U3", OWNER], mine: true },
    ]);

    await deliver(reaction("reaction_removed", "U3"));
    expect(store.page("c1", "C1", { limit: 10 }).messages[0]?.reactions).toEqual([
      { name: "tada", count: 1, userIds: [OWNER], mine: true },
    ]);
    await deliver(reaction("reaction_removed", OWNER));
    expect(store.page("c1", "C1", { limit: 10 }).messages[0]?.reactions).toEqual([]);
  });

  it("member_joined_channel, channel_left and group_left change the person's membership", async () => {
    const { store, deliver } = await setup();
    store.upsertConversations("c1", [
      { channelId: "C1", kind: "channel", name: "general", memberIds: [], isMember: false },
    ]);

    // Another person joining changes nothing for the person.
    const other = await deliver({ type: "member_joined_channel", user: "U2", channel: "C1", channel_type: "C" });
    expect(other.events).toEqual([]);

    await deliver({ type: "member_joined_channel", user: OWNER, channel: "C1", channel_type: "C" });
    await deliver({ type: "member_joined_channel", user: OWNER, channel: "G1", channel_type: "G" });
    expect(store.conversations("c1")).toMatchObject([
      { channelId: "C1", kind: "channel", name: "general", isMember: true },
      { channelId: "G1", kind: "private", isMember: true },
    ]);

    const left = await deliver({ type: "channel_left", channel: "C1", actor_id: OWNER, event_ts: ts(9) });
    expect(left.applied).toEqual([true]);
    expect(store.conversations("c1")[0]).toMatchObject({ channelId: "C1", name: "general", isMember: false });

    await deliver({ type: "group_left", channel: "G1", actor_id: OWNER, event_ts: ts(10) });
    expect(store.conversations("c1")[1]).toMatchObject({ channelId: "G1", kind: "private", isMember: false });
  });
});

/** The fields of a Slack Events API `event` that these tests send. */
interface SlackEventFixture {
  type: string;
  subtype?: string;
  hidden?: boolean;
  channel?: string;
  channel_type?: string;
  user?: string;
  actor_id?: string;
  ts?: string;
  thread_ts?: string;
  text?: string;
  deleted_ts?: string;
  event_ts?: string;
  reaction?: string;
  item_user?: string;
  item?: { type: string; channel: string; ts: string };
  message?: { type: string; user: string; ts: string; text: string; edited?: { user: string; ts: string } };
  previous_message?: { type: string; user: string; ts: string; text: string };
}

interface Delivered {
  events: HistoryEvent[];
  applied: boolean[];
  messages: InboundMessage[];
  inbox: InboxCandidate[];
}

function ts(index: number): string {
  return `${1_700_000_000 + index}.000100`;
}

function message(index: number, overrides: Partial<HistoryMessage> = {}): HistoryMessage {
  return {
    ts: ts(index),
    threadTs: null,
    replyCount: 0,
    latestReplyTs: null,
    authorId: "U2",
    text: `message ${index}`,
    files: [],
    reactions: [],
    editedAt: null,
    deleted: false,
    subtype: null,
    ...overrides,
  };
}

const ingress: MessagingIngress = {
  acquire: () => () => {},
  state: () => "online",
  onState: () => () => {},
  handle: () => {},
  reconnect: () => {},
};

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "openbot-slack-events-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await database.initialize();
  databases.push(database);
  const now = "2026-10-09T00:00:00.000Z";
  database.connection
    .prepare(
      `INSERT INTO projection_messaging_connections
         (connection_id, platform, workspace_id, workspace_name, enabled, created_at, updated_at)
       VALUES ('c1', 'slack', 'T1', 'Acme', 1, ?, ?)`,
    )
    .run(now, now);
  const store = new SlackCacheStore(database, () => now);
  const transport = new SlackEventsTransport({
    identity: {
      workspaceId: "T1",
      workspaceName: "Acme",
      botUserId: "B1",
      appId: "A1",
      missingScopes: [],
      user: { id: OWNER, name: "owner" },
    },
    ingress,
  });
  let delivered: Delivered = { events: [], applied: [], messages: [], inbox: [] };
  const sink: TransportSink = {
    state: () => {},
    action: () => {},
    message: (inbound) => delivered.messages.push(inbound),
    inbox: (candidate) => delivered.inbox.push(candidate),
    history: (event) => {
      delivered.events.push(event);
      delivered.applied.push(applySlackClientEvent(store, "c1", event));
    },
  };
  transport.start(sink);
  let eventId = 0;
  const deliver = async (event: SlackEventFixture): Promise<Delivered> => {
    delivered = { events: [], applied: [], messages: [], inbox: [] };
    eventId += 1;
    const body = { type: "event_callback", api_app_id: "A1", team_id: "T1", event_id: `Ev${eventId}`, event };
    const answer = await transport.deliver({
      kind: "events",
      retryNum: null,
      body: new TextEncoder().encode(JSON.stringify(body)),
    });
    expect(answer.status).toBe(200);
    return delivered;
  };
  return { store, deliver };
}
