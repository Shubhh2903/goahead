import { describe, expect, it } from "vitest";
import { SlackRequestQueue } from "./request-queue";

function fakeClock() {
  let time = 0;
  const sleeps: number[] = [];
  return {
    now: () => time,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      time += ms;
    },
    sleeps,
  };
}

class RateLimited extends Error {
  readonly status = 429;
  constructor(readonly retryAfterSeconds: number) {
    super("rate limited");
  }
}

describe("SlackRequestQueue", () => {
  it("caps at 40 calls per minute", async () => {
    const clock = fakeClock();
    const queue = new SlackRequestQueue({ perMinute: 40, now: clock.now, sleep: clock.sleep });
    const starts: number[] = [];
    const calls = Array.from({ length: 81 }, (_, index) =>
      queue.run("background", async () => {
        starts.push(clock.now());
        return index;
      }),
    );

    await expect(Promise.all(calls)).resolves.toEqual(Array.from({ length: 81 }, (_, index) => index));
    expect(starts.filter((at) => at < 60_000)).toHaveLength(40);
    expect(starts.filter((at) => at >= 60_000 && at < 120_000)).toHaveLength(40);
    expect(starts[80]).toBe(120_000);
  });

  it("visible work runs before background", async () => {
    const clock = fakeClock();
    const queue = new SlackRequestQueue({ perMinute: 1, now: clock.now, sleep: clock.sleep });
    const order: string[] = [];
    const record = (name: string) => async () => {
      order.push(name);
    };

    await Promise.all([
      queue.run("background", record("background-1")),
      queue.run("background", record("background-2")),
      queue.run("visible", record("visible-1")),
      queue.run("visible", record("visible-2")),
    ]);

    expect(order).toEqual(["visible-1", "visible-2", "background-1", "background-2"]);
  });

  it("waits Retry-After then resumes", async () => {
    const clock = fakeClock();
    const queue = new SlackRequestQueue({ perMinute: 40, now: clock.now, sleep: clock.sleep });
    const attempts: number[] = [];
    const otherStarts: number[] = [];
    let failures = 2;

    const limited = queue.run("visible", async () => {
      attempts.push(clock.now());
      if (failures > 0) {
        failures -= 1;
        throw new RateLimited(5);
      }
      return "history";
    });
    const other = limited.then(() =>
      queue.run("background", async () => {
        otherStarts.push(clock.now());
        return "other";
      }),
    );

    await expect(limited).resolves.toBe("history");
    await expect(other).resolves.toBe("other");
    expect(attempts).toEqual([0, 5_000, 10_000]);
    expect(otherStarts[0]).toBeGreaterThanOrEqual(10_000);
  });

  it("pauses calls queued during Retry-After", async () => {
    const clock = fakeClock();
    const queue = new SlackRequestQueue({ perMinute: 40, now: clock.now, sleep: clock.sleep });
    let limitedOnce = false;
    const queuedStarts: number[] = [];

    const limited = queue.run("visible", async () => {
      if (!limitedOnce) {
        limitedOnce = true;
        queuedStarts.push(await queue.run("background", async () => clock.now()));
        throw new RateLimited(30);
      }
      return "ok";
    });

    await expect(limited).resolves.toBe("ok");
    expect(queuedStarts).toEqual([0]);
    await expect(queue.run("background", async () => clock.now())).resolves.toBeGreaterThanOrEqual(30_000);
  });

  it("rejects after 3 rate-limit retries", async () => {
    const clock = fakeClock();
    const queue = new SlackRequestQueue({ perMinute: 40, now: clock.now, sleep: clock.sleep });
    let attempts = 0;

    await expect(
      queue.run("visible", async () => {
        attempts += 1;
        throw new RateLimited(1);
      }),
    ).rejects.toBeInstanceOf(RateLimited);
    expect(attempts).toBe(4);
    await expect(queue.run("visible", async () => "next")).resolves.toBe("next");
  });

  it("rejects other errors without a retry", async () => {
    const clock = fakeClock();
    const queue = new SlackRequestQueue({ perMinute: 40, now: clock.now, sleep: clock.sleep });
    let attempts = 0;
    const failure = new Error("channel_not_found");

    await expect(
      queue.run("visible", async () => {
        attempts += 1;
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(attempts).toBe(1);
    expect(clock.sleeps).toEqual([]);
  });
});
