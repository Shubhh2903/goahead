// @vitest-environment node

import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SLACK_CLIENT_LIMITS } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenBotDatabase } from "../../openbot-database";
import type { HistoryMessage } from "../messaging-types";
import { SlackApiError } from "../slack/slack-web-api";
import { type SlackClientActionAdapter, SlackClientActions } from "./actions";
import { SlackCacheStore } from "./cache-store";

const roots: string[] = [];
const databases: OpenBotDatabase[] = [];
const OWNER = "U1";
const NOW = "2026-10-09T00:00:00.000Z";

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SlackClientActions", () => {
  it("edit of another person's message is refused", async () => {
    const { store, actions, adapter } = await setup();
    store.mergePage("c1", "C1", [message(1, { authorId: "U2" })], { hasMore: false });

    const notYours = sourceText("error.messaging.clientNotYours");
    await expect(actions.edit({ channelId: "C1", ts: ts(1), text: "changed" })).rejects.toThrow(notYours);
    await expect(actions.delete({ channelId: "C1", ts: ts(1) })).rejects.toThrow(notYours);
    // A message the cache does not hold is refused too: its author is not known.
    await expect(actions.edit({ channelId: "C1", ts: ts(9), text: "changed" })).rejects.toThrow(notYours);

    expect(adapter.updateAsUser).not.toHaveBeenCalled();
    expect(adapter.deleteAsUser).not.toHaveBeenCalled();
    expect(store.page("c1", "C1", { limit: 10 }).messages).toEqual([message(1, { authorId: "U2" })]);
  });

  it("send updates the cache then confirms", async () => {
    const { store, actions, adapter, changed } = await setup();
    store.mergePage("c1", "C1", [message(1, { authorId: "U2" })], { hasMore: false });

    await actions.send({ channelId: "C1", text: "hi <@U2> & <!here>" });
    await actions.send({ channelId: "C1", text: "in thread", threadTs: ts(1), broadcast: true });

    expect(adapter.postAsUser).toHaveBeenNthCalledWith(1, {
      channel: "C1",
      text: "hi <@U2> & <!here>",
      keepMentions: true,
    });
    expect(adapter.postAsUser).toHaveBeenNthCalledWith(2, {
      channel: "C1",
      threadTs: ts(1),
      text: "in thread",
      keepMentions: true,
      broadcast: true,
    });
    const page = store.page("c1", "C1", { limit: 10 }).messages;
    expect(page.map((entry) => [entry.ts, entry.authorId, entry.text, entry.subtype])).toEqual([
      [ts(1), "U2", "message 1", null],
      [ts(2), OWNER, "hi <@U2> &amp; &lt;!here&gt;", null],
      [ts(3), OWNER, "in thread", "thread_broadcast"],
    ]);
    expect(store.thread("c1", "C1", ts(1)).parent?.replyCount).toBe(1);
    expect(changed).toEqual(["C1", "C1"]);
  });

  it("edit and delete of an own message change the cache, and a refused one reverts", async () => {
    const { store, actions, adapter } = await setup();
    store.mergePage("c1", "C1", [message(1, { authorId: OWNER })], { hasMore: false });

    await actions.edit({ channelId: "C1", ts: ts(1), text: "fixed" });
    expect(adapter.updateAsUser).toHaveBeenCalledWith("C1", ts(1), "fixed");
    expect(store.thread("c1", "C1", ts(1)).parent).toMatchObject({ text: "fixed", editedAt: NOW });

    adapter.deleteAsUser.mockRejectedValueOnce(new SlackApiError("chat.delete", "cant_delete_message"));
    await expect(actions.delete({ channelId: "C1", ts: ts(1) })).rejects.toThrow("cant_delete_message");
    expect(store.thread("c1", "C1", ts(1)).parent).toMatchObject({ text: "fixed", deleted: false });

    await actions.delete({ channelId: "C1", ts: ts(1) });
    expect(store.thread("c1", "C1", ts(1)).parent).toBeNull();
  });

  it("a refused reaction reverts the cache", async () => {
    const { store, actions, adapter, changed } = await setup();
    const reacted = message(1, { reactions: [{ name: "wave", count: 1, userIds: ["U2"], mine: false }] });
    store.mergePage("c1", "C1", [reacted], { hasMore: false });
    let during: unknown;
    adapter.reactAsUser.mockImplementationOnce(async () => {
      during = store.thread("c1", "C1", ts(1)).parent?.reactions;
      throw new SlackApiError("reactions.add", "too_many_reactions");
    });

    await expect(actions.react({ channelId: "C1", ts: ts(1), name: "wave", on: true })).rejects.toThrow(
      "too_many_reactions",
    );

    expect(during).toEqual([{ name: "wave", count: 2, userIds: ["U2", OWNER], mine: true }]);
    expect(store.thread("c1", "C1", ts(1)).parent?.reactions).toEqual(reacted.reactions);
    expect(changed).toEqual(["C1", "C1"]);
  });

  it("upload over 50 MB is refused", async () => {
    const { actions, adapter, root } = await setup();
    const path = join(root, "big.bin");
    await writeFile(path, "");
    await truncate(path, SLACK_CLIENT_LIMITS.uploadBytes + 1);

    const tooLarge = sourceText("error.messaging.clientFileTooLarge", { limit: 50 });
    await expect(actions.upload({ channelId: "C1", source: { path } })).rejects.toThrow(tooLarge);
    await expect(
      actions.upload({
        channelId: "C1",
        source: { name: "big.bin", bytes: new Uint8Array(SLACK_CLIENT_LIMITS.uploadBytes + 1) },
      }),
    ).rejects.toThrow(tooLarge);
    expect(adapter.uploadFileAsUser).not.toHaveBeenCalled();

    const small = join(root, "notes.txt");
    await writeFile(small, "hello");
    await expect(
      actions.upload({ channelId: "C1", threadTs: ts(1), source: { path: small }, text: "see" }),
    ).resolves.toEqual({ fileId: "F1", name: "notes.txt", size: 5 });
    expect(adapter.uploadFileAsUser).toHaveBeenCalledWith({
      channel: "C1",
      threadTs: ts(1),
      name: "notes.txt",
      bytes: new Uint8Array(Buffer.from("hello")),
      mimeType: "text/plain",
      initialComment: "see",
    });
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

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "openbot-slack-actions-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await database.initialize();
  databases.push(database);
  database.connection
    .prepare(
      `INSERT INTO projection_messaging_connections
         (connection_id, platform, workspace_id, workspace_name, enabled, created_at, updated_at)
       VALUES ('c1', 'slack', 'T1', 'Acme', 1, ?, ?)`,
    )
    .run(NOW, NOW);
  const store = new SlackCacheStore(database, () => NOW);
  let posted = 1;
  const adapter = {
    postAsUser: vi.fn(async () => {
      posted += 1;
      return { ts: ts(posted) };
    }),
    updateAsUser: vi.fn(async () => {}),
    deleteAsUser: vi.fn(async () => {}),
    reactAsUser: vi.fn(async () => {}),
    uploadFileAsUser: vi.fn(async () => ({ fileId: "F1" })),
  } satisfies SlackClientActionAdapter;
  const changed: Array<string | null> = [];
  const actions = new SlackClientActions({
    connectionId: "c1",
    store,
    adapter: () => adapter,
    ownerUserId: () => OWNER,
    onChanged: (channelId) => changed.push(channelId),
    now: () => NOW,
  });
  return { store, actions, adapter, changed, root };
}
