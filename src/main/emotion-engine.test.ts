// @vitest-environment node

import type { EmotionId } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { createEmotionEngine, EMOTION_TIMING, IDLE_EMOTIONS } from "./emotion-engine";

/** A small seeded random source (mulberry32), so idle picks repeat between runs. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function setup(seed = 1) {
  let time = 0;
  const changes: { at: number; emotion: EmotionId }[] = [];
  const engine = createEmotionEngine({
    now: () => time,
    random: seededRandom(seed),
    onChange: (emotion) => changes.push({ at: time, emotion }),
  });
  /** Moves the clock forward and ticks once per second, like the real timer. */
  const advance = (ms: number) => {
    const end = time + ms;
    while (time < end) {
      time = Math.min(end, time + 1_000);
      engine.tick();
    }
  };
  /** Moves the clock past the hold so that the next change can show. */
  const passHold = () => advance(EMOTION_TIMING.holdMs);
  return { engine, changes, advance, passHold, at: () => time };
}

describe("emotion engine presentation modes", () => {
  it.each([
    ["approval", "needs-you"],
    ["question", "needs-you"],
    ["failed", "oops"],
    ["working", "thinking"],
    ["message", "listening"],
  ] as const)("shows %s as %s", (mode, emotion) => {
    const { engine } = setup();
    engine.presentation(mode);
    expect(engine.current()).toBe(emotion);
  });
});

describe("emotion engine agent events", () => {
  it("shows focused when an agent uses a tool", () => {
    const { engine } = setup();
    engine.toolUse("agent-1");
    expect(engine.current()).toBe("focused");
  });

  it("shows strain when work continues for more than 2 minutes", () => {
    const { engine, advance } = setup();
    engine.toolUse("agent-1");
    advance(EMOTION_TIMING.strainAfterMs - 1_000);
    expect(engine.current()).toBe("focused");
    advance(1_000);
    expect(engine.current()).toBe("strain");
  });

  it("shows curious for a handoff", () => {
    const { engine } = setup();
    engine.handoff("queued");
    expect(engine.current()).toBe("curious");
  });

  it("shows joy when a turn completes, then happy after 3 s", () => {
    const { engine, advance, passHold } = setup();
    engine.turnStarted("agent-1");
    passHold();
    engine.turnCompleted("agent-1", "completed");
    expect(engine.current()).toBe("joy");
    advance(EMOTION_TIMING.joyMs);
    expect(engine.current()).toBe("happy");
  });

  it("shows learned when a memory is saved", () => {
    const { engine } = setup();
    engine.memorySaved();
    expect(engine.current()).toBe("learned");
  });

  it("shows money at a usage limit", () => {
    const { engine } = setup();
    engine.usageLimit();
    expect(engine.current()).toBe("money");
  });

  it("shows dizzy after 3 failed turns in a row, and a success resets the count", () => {
    const { engine, advance } = setup();
    /** Runs one turn. Each step waits past the hold and the event face, so the result shows. */
    const turn = (status: "completed" | "failed") => {
      advance(EMOTION_TIMING.eventMs + EMOTION_TIMING.holdMs);
      engine.turnStarted("agent-1");
      advance(EMOTION_TIMING.holdMs);
      engine.turnCompleted("agent-1", status);
    };
    turn("failed");
    turn("failed");
    turn("completed");
    turn("failed");
    turn("failed");
    expect(engine.current()).toBe("oops");
    turn("failed");
    expect(engine.current()).toBe("dizzy");
  });
});

describe("emotion engine priority and hold", () => {
  it("shows needs-you over every other rule", () => {
    const { engine, advance } = setup();
    engine.toolUse("agent-1");
    engine.usageLimit();
    engine.memorySaved();
    engine.handoff("working");
    engine.turnCompleted("agent-2", "failed");
    engine.presentation("approval");
    expect(engine.current()).toBe("needs-you");
    advance(EMOTION_TIMING.strainAfterMs);
    expect(engine.current()).toBe("needs-you");
  });

  it("holds a face for 3 s before the next change, but shows needs-you at once", () => {
    const { engine, changes, advance } = setup();
    engine.turnStarted("agent-1");
    expect(engine.current()).toBe("thinking");
    advance(1_000);
    engine.toolUse("agent-1");
    expect(engine.current()).toBe("thinking");
    advance(2_000);
    expect(engine.current()).toBe("focused");
    advance(1_000);
    engine.presentation("question");
    expect(engine.current()).toBe("needs-you");
    expect(changes).toEqual([
      { at: 0, emotion: "thinking" },
      { at: 3_000, emotion: "focused" },
      { at: 4_000, emotion: "needs-you" },
    ]);
  });
});

describe("emotion engine idle", () => {
  it("changes to a different calm face every 20-40 s with a seeded random", () => {
    const run = () => {
      const { engine, changes, advance } = setup(42);
      const first = engine.current();
      advance(5 * 60_000);
      return { first, changes };
    };
    const { first, changes } = run();
    expect(IDLE_EMOTIONS).toContain(first);
    expect(changes.length).toBeGreaterThanOrEqual(7);
    let previous = { at: 0, emotion: first };
    for (const change of changes) {
      expect(IDLE_EMOTIONS).toContain(change.emotion);
      expect(change.emotion).not.toBe(previous.emotion);
      const gap = change.at - previous.at;
      expect(gap).toBeGreaterThanOrEqual(EMOTION_TIMING.idleMinMs);
      expect(gap).toBeLessThanOrEqual(EMOTION_TIMING.idleMaxMs + 1_000);
      previous = change;
    }
    expect(run()).toEqual({ first, changes });
  });

  it("shows sleepy after 10 min without activity, and activity wakes it", () => {
    const { engine, advance, passHold } = setup();
    advance(EMOTION_TIMING.sleepyAfterMs - 1_000);
    expect(engine.current()).not.toBe("sleepy");
    advance(1_000);
    expect(engine.current()).toBe("sleepy");
    passHold();
    engine.activity();
    expect(IDLE_EMOTIONS).toContain(engine.current());
  });
});
