import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { MOBILE_QA_RESERVATION_TTL_MS, MobileQaReservation } from "./mobile-qa-reservation";

async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "goahead-qa-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

it("preserves the shared device owner's app state during simultaneous requests, restarts and late releases", async () => {
  await withDirectory(async (directory) => {
    const now = () => 1_000;
    const host = new MobileQaReservation(directory, { now });
    const exists = () => true;
    const [first, other] = await Promise.all([
      host.update({ action: "acquire" }, "dev", exists),
      host.update({ action: "acquire" }, "qa", exists),
    ]);
    expect(first.status).toBe("acquired");
    expect(other).toMatchObject({ status: "busy", agentId: "dev" });
    const resumed = new MobileQaReservation(directory, { now });
    expect(await resumed.update({ action: "acquire" }, "dev", exists)).toEqual(first);
    const release = { action: "release" as const, reservationId: first.reservationId };
    expect(await resumed.update(release, "qa", exists)).toEqual({ status: "not_owner" });
    expect(await resumed.update(release, "dev", exists)).toEqual({ status: "released" });
    const next = await resumed.update({ action: "acquire" }, "dev", exists);
    expect(next.reservationId).not.toBe(first.reservationId);
    expect(await resumed.update(release, "dev", exists)).toEqual({ status: "not_owner" });
    expect(await resumed.update({ action: "acquire" }, "qa", () => false)).toMatchObject({ status: "acquired" });
  });
});

it("frees the device when the holder neither releases nor extends the reservation", async () => {
  await withDirectory(async (directory) => {
    let time = 1_000;
    const host = new MobileQaReservation(directory, { now: () => time });
    const exists = () => true;
    const first = await host.update({ action: "acquire" }, "dev", exists);
    time += MOBILE_QA_RESERVATION_TTL_MS - 1;
    // Acquiring again extends the holder's reservation and keeps its id.
    expect(await host.update({ action: "acquire" }, "dev", exists)).toMatchObject({
      status: "acquired",
      reservationId: first.reservationId,
    });
    time += MOBILE_QA_RESERVATION_TTL_MS - 1;
    expect(await host.update({ action: "acquire" }, "qa", exists)).toMatchObject({ status: "busy", agentId: "dev" });
    time += 1;
    const taken = await host.update({ action: "acquire" }, "qa", exists);
    expect(taken).toMatchObject({ status: "acquired" });
    expect(taken.reservationId).not.toBe(first.reservationId);
    // The expired holder's late release does not free the new holder's device.
    expect(await host.update({ action: "release", reservationId: first.reservationId }, "dev", exists)).toEqual({
      status: "not_owner",
    });
    expect(await host.update({ action: "acquire" }, "dev", exists)).toMatchObject({ status: "busy", agentId: "qa" });
  });
});
