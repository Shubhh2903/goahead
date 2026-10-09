// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SlackClientChanged } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenBotDatabase } from "../../openbot-database";
import type { HistoryConversationPage, HistoryMessage, HistoryPage } from "../messaging-types";
import { SlackCacheStore } from "./cache-store";
import { SlackRequestQueue } from "./request-queue";
import { type SlackClientAdapter, SlackClientSync } from "./sync-service";

const roots: string[] = [];
const databases: OpenBotDatabase[] = [];
const syncs: SlackClientSync[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const sync of syncs.splice(0)) sync.stop("c1");
  for (const database of databases.splice(0)) database.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SlackClientSync", () => {
  it("open returns the cache then merges the newest page", async () => {
    const historyPage = vi.fn(
      async (): Promise<HistoryPage> => ({
        messages: [
          message(2, {
            authorId: "U1",
            text: "hi <@U2> :party:",
            files: [
              {
                id: "F1",
                name: "a.png",
                mimeType: "image/png",
                size: 3,
                url: "https://files.slack.com/private/a.png",
                thumbnailUrl: "https://files.slack.com/private/a_360.png",
                permalink: "https://acme.slack.com/files/U1/F1/a.png",
              },
            ],
          }),
          message(3),
        ],
        hasMore: true,
      }),
    );
    const markReadAsUser = vi.fn(async () => undefined);
    const { sync, store, changed } = await setup({ historyPage, markReadAsUser });
    store.mergePage("c1", "C1", [message(1), message(2)], { hasMore: true });

    const first = await sync.open("c1", "C1");
    expect(first.messages.map((entry) => entry.ts)).toEqual([ts(1), ts(2)]);
    expect(first.messages[1]).toMatchObject({ mine: false, files: [] });
    expect(first).toMatchObject({ workspaceId: "T1", channelId: "C1", offline: false, hasOlder: true });

    await vi.waitFor(() => expect(changed).toContainEqual({ workspaceId: "T1", channelId: "C1" }));
    expect(historyPage).toHaveBeenCalledWith("C1", { limit: 100 });
    expect(markReadAsUser).toHaveBeenCalledWith("C1", ts(3));

    const second = await sync.open("c1", "C1");
    expect(second.messages.map((entry) => entry.ts)).toEqual([ts(1), ts(2), ts(3)]);
    expect(second.messages[1]).toMatchObject({ mine: true, authorId: "U1" });
    expect(second.messages[2]).toMatchObject({ mine: false });
    // No Slack file address reaches the renderer: an image is main's own cache address.
    expect(second.messages[1]?.files).toEqual([
      {
        id: "F1",
        name: "a.png",
        mimetype: "image/png",
        size: 3,
        previewUrl: "openbot-attachment://slack/T1/F1",
        permalink: "https://acme.slack.com/files/U1/F1/a.png",
      },
    ]);
    expect(JSON.stringify(second)).not.toContain("files.slack.com");
    expect(second.people).toMatchObject({ U1: "Ada", U2: "Bob" });
    expect(second.customEmoji).toEqual({ party: "https://emoji.slack-edge.com/party.png" });
    // A second open right after the first one reads the cache only, so a reload on change does not loop.
    expect(historyPage).toHaveBeenCalledTimes(1);
  });

  it("older skips Slack when the cache has the rows", async () => {
    const historyPage = vi.fn(
      async (_channel: string, options: { latest?: string; limit: number }): Promise<HistoryPage> =>
        options.latest === undefined
          ? { messages: range(201, 300), hasMore: true }
          : { messages: range(1, 100), hasMore: false },
    );
    const { sync, store, changed } = await setup({ historyPage });
    store.mergePage("c1", "C1", range(101, 300), { hasMore: true });
    await sync.open("c1", "C1");
    await vi.waitFor(() => expect(changed).toContainEqual({ workspaceId: "T1", channelId: "C1" }));
    historyPage.mockClear();

    const cached = await sync.older("c1", "C1", ts(201));
    expect(cached.messages.map((entry) => entry.ts)).toEqual(range(101, 200).map((entry) => entry.ts));
    expect(cached.hasOlder).toBe(true);
    expect(historyPage).not.toHaveBeenCalled();

    const fetched = await sync.older("c1", "C1", ts(101));
    expect(historyPage).toHaveBeenCalledWith("C1", { latest: ts(101), limit: 100 });
    expect(fetched.messages.map((entry) => entry.ts)).toEqual(range(1, 100).map((entry) => entry.ts));
    expect(fetched.hasOlder).toBe(false);
  });

  it("offline returns cached messages with the offline flag", async () => {
    const historyPage = vi.fn(async (): Promise<HistoryPage> => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("getaddrinfo"), { code: "ENOTFOUND" }) });
    });
    const { sync, store, changed } = await setup({ historyPage });
    store.mergePage("c1", "C1", [message(1), message(2)], { hasMore: true });

    await sync.open("c1", "C1");
    await vi.waitFor(() => expect(changed).toContainEqual({ workspaceId: "T1", channelId: "C1" }));
    const page = await sync.open("c1", "C1");
    expect(page.offline).toBe(true);
    expect(page.messages.map((entry) => entry.ts)).toEqual([ts(1), ts(2)]);

    const older = await sync.older("c1", "C1", ts(1));
    expect(older).toMatchObject({ offline: true, messages: [] });
  });

  it("a conversation evicted and reopened within a minute reads Slack again", async () => {
    const historyPage = vi.fn(async (): Promise<HistoryPage> => ({ messages: [message(1)], hasMore: false }));
    // A limit of one byte evicts every conversation that a read merges.
    const { sync, store } = await setup({ historyPage }, { cacheBytes: 1 });

    await sync.open("c1", "C1");
    await vi.waitFor(() => expect(historyPage).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(store.page("c1", "C1", { limit: 100 }).messages).toEqual([]));

    // The clock does not move: only the eviction makes the conversation stale.
    await vi.waitFor(async () => {
      await sync.open("c1", "C1");
      expect(historyPage).toHaveBeenCalledTimes(2);
    });
  });

  it("stop during a refresh leaves no timer", async () => {
    let release: (page: HistoryConversationPage) => void = () => undefined;
    let listed: () => void = () => undefined;
    const called = new Promise<void>((resolve) => {
      listed = resolve;
    });
    const listConversations = vi.fn(
      () =>
        new Promise<HistoryConversationPage>((resolve) => {
          release = resolve;
          listed();
        }),
    );
    const { sync } = await setup({ listConversations });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const refresh = sync.refreshConversations("c1");
    await called;
    sync.stop("c1");
    release({ conversations: [], nextCursor: null });
    await expect(refresh).rejects.toThrow();

    expect(vi.getTimerCount()).toBe(0);
  });
});

async function setup(
  adapter: Partial<SlackClientAdapter>,
  options: { cacheBytes?: number } = {},
): Promise<{
  sync: SlackClientSync;
  store: SlackCacheStore;
  changed: SlackClientChanged[];
}> {
  const root = await mkdtemp(join(tmpdir(), "openbot-slack-sync-"));
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
  const queue = new SlackRequestQueue({ perMinute: 40 });
  const names: Record<string, string> = { U1: "Ada", U2: "Bob" };
  const full: SlackClientAdapter = {
    authorName: async (id) => names[id] ?? id,
    placeName: async (id) => `#${id.toLowerCase()}`,
    customEmoji: async () => ({ party: "https://emoji.slack-edge.com/party.png", other: "alias:party" }),
    ...adapter,
  };
  const changed: SlackClientChanged[] = [];
  const sync = new SlackClientSync({
    store,
    queueFor: () => queue,
    adapterFor: (connectionId) => (connectionId === "c1" ? full : null),
    names: {
      workspaceId: (connectionId) => (connectionId === "c1" ? "T1" : null),
      ownerUserId: () => "U1",
    },
    onChanged: (change) => changed.push(change),
    now: () => new Date(now),
    ...options,
  });
  syncs.push(sync);
  return { sync, store, changed };
}

function ts(index: number): string {
  return `${1_700_000_000 + index}.000100`;
}

function range(from: number, to: number): HistoryMessage[] {
  return Array.from({ length: to - from + 1 }, (_, index) => message(from + index));
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
