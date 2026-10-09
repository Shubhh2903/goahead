// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OpenBotDatabase } from "../../openbot-database";
import type { HistoryMessage } from "../messaging-types";
import { SlackCacheStore } from "./cache-store";

const roots: string[] = [];
const databases: OpenBotDatabase[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SlackCacheStore", () => {
  it("pages merge by ts without gaps or duplicates", async () => {
    const { store } = await setup();
    const all = Array.from({ length: 300 }, (_, index) => message(index + 1));
    // Slack's `latest` is exclusive. The second page overlaps the first, as a retry after an edit can.
    store.mergePage("c1", "C1", all.slice(200), { hasMore: true, oldestTs: ts(201) });
    store.mergePage("c1", "C1", all.slice(120, 220), { hasMore: true, oldestTs: ts(121), latestTs: ts(201) });
    store.mergePage("c1", "C1", all.slice(0, 120), { hasMore: false, oldestTs: ts(1), latestTs: ts(121) });

    const seen: string[] = [];
    let beforeTs: string | undefined;
    for (;;) {
      const page = store.page("c1", "C1", { beforeTs, limit: 70 });
      seen.unshift(...page.messages.map((entry) => entry.ts));
      if (!page.hasOlder) break;
      expect(page.complete).toBe(true);
      beforeTs = page.messages[0]?.ts;
    }
    expect(seen).toEqual(all.map((entry) => entry.ts));
    expect(store.conversations("c1")[0]).toMatchObject({ oldestLoadedTs: ts(1), hasMoreHistory: false });
  });

  it("does not claim a gap as loaded history", async () => {
    const { store } = await setup();
    // A message from an event, long before the newest page, with no page in between.
    store.upsertMessage("c1", "C1", message(5));
    let page = store.page("c1", "C1", { limit: 100 });
    expect(page).toMatchObject({ hasOlder: true, complete: false });
    expect(page.messages.map((entry) => entry.ts)).toEqual([ts(5)]);

    store.mergePage("c1", "C1", [message(500), message(501)], { hasMore: true, oldestTs: ts(500) });
    page = store.page("c1", "C1", { limit: 100 });
    expect(page.messages.map((entry) => entry.ts)).toEqual([ts(500), ts(501)]);
    expect(page).toMatchObject({ hasOlder: true, complete: false });
    // The cache alone cannot answer the older page: Slack must fill the gap.
    expect(store.page("c1", "C1", { beforeTs: ts(500), limit: 100 })).toMatchObject({
      messages: [],
      complete: false,
    });

    // A newest page after a long time offline does not touch the old range: it starts a new one.
    store.mergePage("c1", "C1", [message(900)], { hasMore: true, oldestTs: ts(900) });
    expect(store.page("c1", "C1", { limit: 100 }).messages.map((entry) => entry.ts)).toEqual([ts(900)]);
    // The older page that closes the gap joins the ranges again.
    store.mergePage("c1", "C1", [message(501), message(502)], { hasMore: true, oldestTs: ts(501), latestTs: ts(900) });
    expect(store.page("c1", "C1", { limit: 100 }).messages.map((entry) => entry.ts)).toEqual([
      ts(501),
      ts(502),
      ts(900),
    ]);
  });

  it("an event past a gap does not close the gap", async () => {
    const { store } = await setup();
    const range = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, index) => message(from + index));
    store.mergePage("c1", "C1", range(100, 200), { hasMore: true, oldestTs: ts(100) });
    // Offline while messages 201..599 arrived. Then a live event writes 600.
    store.upsertMessage("c1", "C1", message(600));
    const shown = store.page("c1", "C1", { limit: 50 });
    expect(shown.messages.at(-1)?.ts).toBe(ts(600));
    expect(shown.complete).toBe(false);

    store.mergePage("c1", "C1", range(500, 600), { hasMore: true, oldestTs: ts(500) });
    expect(store.conversations("c1")[0]).toMatchObject({ oldestLoadedTs: ts(500), hasMoreHistory: true });
    // The range starts at 500: 200 and older are not shown as next to it.
    const older = store.page("c1", "C1", { beforeTs: ts(500), limit: 50 });
    expect(older).toMatchObject({ messages: [], hasOlder: true, complete: false });

    // Older paging from 500 continues and joins the old rows.
    store.mergePage("c1", "C1", range(200, 499), { hasMore: true, oldestTs: ts(200), latestTs: ts(500) });
    const joined = store.page("c1", "C1", { beforeTs: ts(250), limit: 50 });
    expect(joined.complete).toBe(true);
    expect(joined.messages.map((entry) => entry.ts)).toEqual(range(200, 249).map((entry) => entry.ts));
  });

  it("copied inbox rows (NULL range) are shown and the first open fetches the newest page", async () => {
    const { database, store } = await setup();
    const now = "2026-10-09T00:00:00.000Z";
    // As migration 29 writes them: sparse rows with no loaded range.
    for (const index of [3, 40])
      database.connection
        .prepare(
          `INSERT INTO slack_messages
             (connection_id, channel_id, ts, author_id, text, files_json, reactions_json, deleted, reply_count, cached_at)
           VALUES ('c1', 'C1', ?, 'U2', 'copied', '[]', '[]', 0, 0, ?)`,
        )
        .run(ts(index), now);
    database.connection
      .prepare(
        `INSERT INTO slack_conversations
           (connection_id, channel_id, kind, name, member_ids_json, is_member, unread_count, last_activity_ts,
            oldest_loaded_ts, newest_loaded_ts, has_more_history, updated_at)
         VALUES ('c1', 'C1', 'channel', '', '[]', 1, 0, ?, NULL, NULL, 1, ?)`,
      )
      .run(ts(40), now);

    const first = store.page("c1", "C1", { limit: 2 });
    expect(first.messages.map((entry) => entry.ts)).toEqual([ts(3), ts(40)]);
    expect(first).toMatchObject({ hasOlder: true, complete: false });

    store.mergePage("c1", "C1", [message(39), message(40), message(41)], { hasMore: true, oldestTs: ts(39) });
    const opened = store.page("c1", "C1", { limit: 3 });
    expect(opened.messages.map((entry) => entry.ts)).toEqual([ts(39), ts(40), ts(41)]);
    expect(opened.complete).toBe(true);
    expect(store.page("c1", "C1", { beforeTs: ts(39), limit: 3 })).toMatchObject({ messages: [], complete: false });
  });

  it("edit, delete and reactions update a cached message", async () => {
    const { store } = await setup();
    store.mergePage("c1", "C1", [message(1), message(2, { replyCount: 1, latestReplyTs: ts(3) }), message(4)], {
      hasMore: false,
      oldestTs: ts(1),
    });
    store.mergeThread("c1", "C1", ts(2), [message(2, { replyCount: 1 }), message(3, { threadTs: ts(2) })]);

    store.markEdited("c1", "C1", ts(1), "changed", "2026-10-09T10:00:00.000Z");
    store.markDeleted("c1", "C1", ts(4));
    store.markDeleted("c1", "C1", ts(2));
    store.setReactions("c1", "C1", ts(1), [{ name: "wave", count: 1, userIds: ["U2"], mine: false }]);
    store.adjustReaction("c1", "C1", ts(1), "wave", "U1", true, "U1");
    store.adjustReaction("c1", "C1", ts(1), "tada", "U2", true, "U1");
    store.adjustReaction("c1", "C1", ts(1), "tada", "U2", false, "U1");
    // The same event twice does not count twice.
    store.adjustReaction("c1", "C1", ts(1), "wave", "U1", true, "U1");

    const messages = store.page("c1", "C1", { limit: 10 }).messages;
    expect(messages.map((entry) => entry.ts)).toEqual([ts(1), ts(2)]);
    expect(messages[0]).toMatchObject({
      text: "changed",
      editedAt: "2026-10-09T10:00:00.000Z",
      reactions: [{ name: "wave", count: 2, userIds: ["U2", "U1"], mine: true }],
    });
    // A thread parent stays as a placeholder, so its replies keep a parent.
    expect(messages[1]).toMatchObject({ deleted: true, text: "", files: [], reactions: [] });
    expect(store.thread("c1", "C1", ts(2))).toMatchObject({
      parent: { ts: ts(2), deleted: true },
      replies: [{ ts: ts(3), threadTs: ts(2) }],
    });

    store.adjustReaction("c1", "C1", ts(1), "wave", "U1", false, "U1");
    expect(store.page("c1", "C1", { limit: 10 }).messages[0]?.reactions).toEqual([
      { name: "wave", count: 1, userIds: ["U2"], mine: false },
    ]);

    // A new reply from an event counts on its parent.
    store.upsertMessage("c1", "C1", message(5, { threadTs: ts(2) }));
    expect(store.thread("c1", "C1", ts(2)).parent).toMatchObject({ replyCount: 2, latestReplyTs: ts(5) });
  });

  it("keeps the conversation state across a list refresh", async () => {
    const { store } = await setup();
    store.upsertConversations("c1", [
      { channelId: "C1", kind: "channel", name: "general", memberIds: [], isMember: true },
      { channelId: "D1", kind: "im", name: "", memberIds: ["U2", "U1"], isMember: true },
    ]);
    store.setUnread("c1", "C1", 3, ts(7));
    store.markOpened("c1", "C1", "2026-10-09T09:00:00.000Z");
    store.mergePage("c1", "C1", [message(8)], { hasMore: true, oldestTs: ts(8) });
    store.upsertConversations("c1", [
      { channelId: "C1", kind: "private", name: "renamed", memberIds: [], isMember: true },
    ]);

    expect(store.conversations("c1")).toEqual([
      {
        channelId: "C1",
        kind: "private",
        name: "renamed",
        memberIds: [],
        isMember: true,
        lastReadTs: ts(7),
        unreadCount: 3,
        lastActivityTs: ts(8),
        lastOpenedAt: "2026-10-09T09:00:00.000Z",
        oldestLoadedTs: ts(8),
        hasMoreHistory: true,
      },
      {
        channelId: "D1",
        kind: "im",
        name: "",
        memberIds: ["U2", "U1"],
        isMember: true,
        lastReadTs: null,
        unreadCount: 0,
        lastActivityTs: null,
        lastOpenedAt: null,
        oldestLoadedTs: null,
        hasMoreHistory: true,
      },
    ]);
  });

  it("eviction drops least recently opened conversations", async () => {
    const { store } = await setup();
    for (const [channelId, openedAt] of [
      ["C1", "2026-10-09T01:00:00.000Z"],
      ["C2", "2026-10-09T03:00:00.000Z"],
      ["C3", "2026-10-09T02:00:00.000Z"],
    ] as const) {
      store.mergePage("c1", channelId, [message(1), message(2)], { hasMore: false, oldestTs: ts(1) });
      store.markOpened("c1", channelId, openedAt);
    }
    store.mergePage("c2", "C9", [message(1)], { hasMore: false, oldestTs: ts(1) });
    const total = store.sizeBytes("c1");
    const other = store.sizeBytes("c2");

    expect(store.evictTo("c1", total)).toEqual([]);
    // One conversation's worth less than the total: the least recently opened one goes.
    expect(store.evictTo("c1", total - 1)).toEqual(["C1"]);
    expect(store.page("c1", "C1", { limit: 10 })).toMatchObject({ messages: [], hasOlder: true, complete: false });
    expect(store.evictTo("c1", 1)).toEqual(["C3", "C2"]);
    expect(store.sizeBytes("c1")).toBe(0);
    // The list stays: scrolling loads the messages again.
    expect(store.conversations("c1").map((entry) => entry.channelId)).toEqual(["C1", "C2", "C3"]);
    expect(store.sizeBytes("c2")).toBe(other);
  });

  it("clear removes a workspace", async () => {
    const { store } = await setup();
    store.upsertConversations("c1", [{ channelId: "C1", kind: "channel", name: "a", memberIds: [], isMember: true }]);
    store.mergePage("c1", "C1", [message(1)], { hasMore: false, oldestTs: ts(1) });
    store.mergePage("c2", "C1", [message(1)], { hasMore: false, oldestTs: ts(1) });

    store.clearConnection("c1");

    expect(store.conversations("c1")).toEqual([]);
    expect(store.page("c1", "C1", { limit: 10 }).messages).toEqual([]);
    expect(store.sizeBytes("c1")).toBe(0);
    expect(store.page("c2", "C1", { limit: 10 }).messages.map((entry) => entry.ts)).toEqual([ts(1)]);
  });
});

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

async function setup(): Promise<{ database: OpenBotDatabase; store: SlackCacheStore }> {
  const root = await mkdtemp(join(tmpdir(), "openbot-slack-cache-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await database.initialize();
  databases.push(database);
  const now = "2026-10-09T00:00:00.000Z";
  const addConnection = database.connection.prepare(
    `INSERT INTO projection_messaging_connections
       (connection_id, platform, workspace_id, workspace_name, enabled, created_at, updated_at)
     VALUES (?, 'slack', ?, 'Acme', 1, ?, ?)`,
  );
  addConnection.run("c1", "T1", now, now);
  addConnection.run("c2", "T2", now, now);
  return { database, store: new SlackCacheStore(database, () => now) };
}
