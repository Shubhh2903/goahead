import type { DynamicIslandGaze } from "@openbot/contracts/ipc";
import { describe, expect, it, vi } from "vitest";
import {
  createEmotionGaze,
  EMOTION_GAZE_INTERVAL_MS,
  EMOTION_GAZE_RECHECK_MS,
  type EmotionGazeTarget,
  emotionGazeDirection,
} from "./emotion-gaze";

const FACE = { x: 690, y: 6, width: 20, height: 20 };

describe("emotionGazeDirection", () => {
  it("points from the face to the pointer inside the unit circle, with no screen position", () => {
    expect(emotionGazeDirection({ x: 700, y: 16 }, FACE)).toEqual({ x: 0, y: 0, near: true });
    expect(emotionGazeDirection({ x: 860, y: 16 }, FACE)).toEqual({ x: 0.5, y: 0, near: false });
    const far = emotionGazeDirection({ x: -5000, y: 5016 }, FACE);
    expect(Math.hypot(far.x, far.y)).toBeLessThanOrEqual(1.05);
    expect(far.x).toBeLessThan(0);
    expect(far.y).toBeGreaterThan(0);
    expect(far.near).toBe(false);
  });
});

describe("createEmotionGaze", () => {
  function setup(initial: { targets: boolean; reducedMotion: boolean }) {
    const state = { ...initial, cursor: { x: 700, y: 400 } };
    const timers: { run: () => void; intervalMs: number; cancel: ReturnType<typeof vi.fn> }[] = [];
    const sent: DynamicIslandGaze[] = [];
    const target: EmotionGazeTarget = {
      id: 1,
      face: FACE,
      send: (gaze) => {
        sent.push(gaze);
        return true;
      },
    };
    const gaze = createEmotionGaze({
      getCursorScreenPoint: () => state.cursor,
      prefersReducedMotion: () => state.reducedMotion,
      targets: () => (state.targets ? [target] : []),
      every: (run, intervalMs) => {
        const timer = { run, intervalMs, cancel: vi.fn() };
        timers.push(timer);
        return timer;
      },
    });
    return { state, timers, sent, gaze };
  }

  it("does not poll while no visible island shows a face, and stops when the face goes", () => {
    const { state, timers, gaze } = setup({ targets: false, reducedMotion: false });
    gaze.refresh();
    expect(timers).toEqual([]);

    state.targets = true;
    gaze.refresh();
    expect(timers.map((timer) => timer.intervalMs)).toEqual([EMOTION_GAZE_INTERVAL_MS]);

    state.targets = false;
    gaze.refresh();
    expect(timers[0]?.cancel).toHaveBeenCalledOnce();
    expect(timers).toHaveLength(1);
  });

  it("only rechecks slowly while Reduce Motion is on, and sends nothing", () => {
    const { timers, sent, gaze } = setup({ targets: true, reducedMotion: true });
    gaze.refresh();
    expect(timers.map((timer) => timer.intervalMs)).toEqual([EMOTION_GAZE_RECHECK_MS]);
    timers[0]?.run();
    expect(sent).toEqual([]);
  });

  it("sends a direction only when it changes", () => {
    const { state, timers, sent, gaze } = setup({ targets: true, reducedMotion: false });
    gaze.refresh();
    timers[0]?.run();
    expect(sent).toHaveLength(1);
    state.cursor = { x: 1200, y: 400 };
    timers[0]?.run();
    expect(sent).toHaveLength(2);
    gaze.dispose();
    expect(timers[0]?.cancel).toHaveBeenCalledOnce();
  });
});
