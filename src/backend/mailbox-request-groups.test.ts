// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MailboxStore, REQUEST_GROUP_HOLD_MS } from "./mailbox-store";
import { OpenBotDatabase } from "./openbot-database";

let root: string;
let database: OpenBotDatabase;
let store: MailboxStore;
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-mailbox-groups-"));
  database = new OpenBotDatabase(join(root, "user-data"));
  store = new MailboxStore(join(root, "user-data"), join(root, "Shared"), database);
  await run(store.initialize());
});

afterEach(async () => {
  vi.useRealTimers();
  database.close();
  await rm(root, { recursive: true, force: true });
});

const ask = (agentId: string, key: string) =>
  run(
    store.enqueue({
      sender: { kind: "agent", agentId: "chief" },
      recipientAgentIds: [agentId],
      text: `Task for ${agentId}.`,
      idempotencyKey: key,
    }),
  );
const answer = (agentId: string, requestId: string) =>
  run(
    store.enqueue({
      sender: { kind: "agent", agentId },
      recipientAgentIds: ["chief"],
      text: `${agentId} done.`,
      replyToMessageId: requestId,
      expectsReply: false,
    }),
  );
/** Runs one delivery and ends it, as a turn does. */
const finish = async (deliveryId: string, status: "completed" | "failed") => {
  await run(store.markStarting(deliveryId));
  await run(store.markRunning(deliveryId, `turn-${deliveryId}`));
  await run(store.markTerminal(deliveryId, status));
};
const deliveryOf = (receipt: { deliveries: readonly { id: string }[] }) => {
  const delivery = receipt.deliveries[0];
  if (!delivery) throw new Error("No delivery.");
  return delivery.id;
};
/** research answers; builder's request of the same turn is still queued. */
const heldAnswer = async () => {
  const research = await ask("research", "thread-chief:turn-1:call-1");
  const builder = await ask("builder", "thread-chief:turn-1:call-2");
  await finish(deliveryOf(research), "completed");
  return { research, builder, answer: await answer("research", research.messageId) };
};

describe("request groups", () => {
  it("holds the answers to every request of one turn, so they start one turn together", async () => {
    const { research, builder, answer: first } = await heldAnswer();
    const later = await ask("launch", "thread-chief:turn-2:call-1");
    expect(store.requestGroupIds(research.messageId)).toEqual([research.messageId, builder.messageId]);
    expect(store.requestGroupIds(later.messageId)).toEqual([later.messageId]);
    expect(store.nextQueued("chief")).toBeNull();

    await finish(deliveryOf(builder), "completed");
    const second = await answer("builder", builder.messageId);
    const head = store.nextQueued("chief");
    if (!head) throw new Error("No answer starts.");
    expect([head, ...store.repliesToStartWith(head.delivery.id)].map((context) => context.delivery.messageId)).toEqual([
      first.messageId,
      second.messageId,
    ]);
  });

  it("keeps two turns with the same turn id in different threads apart", async () => {
    const first = await ask("research", "thread-chief:turn-1:call-1");
    const other = await ask("builder", "thread-other:turn-1:call-1");
    expect(store.requestGroupIds(first.messageId)).toEqual([first.messageId]);
    expect(store.requestGroupIds(other.messageId)).toEqual([other.messageId]);
  });

  it("does not hold answers for a request whose recipient cannot work", async () => {
    const { answer: held } = await heldAnswer();
    expect(store.nextQueued("chief")).toBeNull();
    store.setRecipientMayWork((agentId) => agentId !== "builder");
    expect(store.nextQueued("chief")?.delivery.messageId).toBe(held.messageId);
  });

  it("releases a held answer after the hold cap", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-24T10:00:00.000Z") });
    const { answer: held } = await heldAnswer();
    expect(store.nextQueued("chief")).toBeNull();
    expect(store.groupHoldReleaseAt("chief")).toBe(Date.now() + REQUEST_GROUP_HOLD_MS);

    vi.setSystemTime(Date.now() + REQUEST_GROUP_HOLD_MS);
    expect(store.nextQueued("chief")?.delivery.messageId).toBe(held.messageId);
    expect(store.groupHoldReleaseAt("chief")).toBeNull();
  });
});
