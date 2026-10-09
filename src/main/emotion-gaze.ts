// Lets the island face look at the pointer. Main reads the pointer, because the island windows
// ignore the mouse almost all the time, and sends each island window only a direction: never a
// screen position. The timer runs only while a visible island shows a face and Reduce Motion is off.
import type { DynamicIslandGaze } from "@openbot/contracts/ipc";

/** About 30 reads a second: enough for smooth eyes, with CSS transitions between the steps. */
export const EMOTION_GAZE_INTERVAL_MS = 33;
/** While Reduce Motion is on, the timer only checks, slowly, whether it was turned off. */
export const EMOTION_GAZE_RECHECK_MS = 2_000;
// Reduce Motion is a native call, so the fast timer reads it about once a second.
const REDUCED_MOTION_CHECK_TICKS = 30;
// The pointer this far from the face, or farther, turns the eyes all the way.
const FULL_LOOK_DISTANCE = 320;
// The pointer this close to the face counts as "near": it wakes a sleepy face.
const NEAR_DISTANCE = 140;
// Steps of the direction. Smaller pointer moves send nothing.
const DIRECTION_STEPS = 20;

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ScreenRect extends ScreenPoint {
  width: number;
  height: number;
}

/** The direction from the centre of `face` to `cursor`, inside the unit circle, in steps. */
export function emotionGazeDirection(cursor: ScreenPoint, face: ScreenRect): DynamicIslandGaze {
  const dx = cursor.x - (face.x + face.width / 2);
  const dy = cursor.y - (face.y + face.height / 2);
  const distance = Math.hypot(dx, dy);
  const scale = 1 / Math.max(distance, FULL_LOOK_DISTANCE);
  return { x: step(dx * scale), y: step(dy * scale), near: distance <= NEAR_DISTANCE };
}

function step(value: number): number {
  const stepped = Math.round(value * DIRECTION_STEPS) / DIRECTION_STEPS;
  // `+ 0` turns -0 into 0, so the same direction always has the same key.
  return Math.min(1, Math.max(-1, stepped)) + 0;
}

export interface EmotionGazeTarget {
  /** A stable id of the window, such as its `webContents.id`. */
  id: number;
  /** About where the face is on the screen. */
  face: ScreenRect;
  /** Returns false when the window could not take the message, so it is sent again. */
  send: (gaze: DynamicIslandGaze) => boolean;
}

export interface EmotionGazeOptions {
  getCursorScreenPoint: () => ScreenPoint;
  prefersReducedMotion: () => boolean;
  /** The visible island windows that show a face now. Empty when there is none. */
  targets: () => readonly EmotionGazeTarget[];
  /** Starts a repeating timer. The caller makes it unref'd, so it does not keep the app alive. */
  every: (run: () => void, intervalMs: number) => { cancel: () => void };
}

export interface EmotionGaze {
  /** Call after a change to the windows, their visibility, the face, or the preference. */
  refresh: () => void;
  dispose: () => void;
}

export function createEmotionGaze(options: EmotionGazeOptions): EmotionGaze {
  let timer: { cancel: () => void } | undefined;
  let timerInterval: number | undefined;
  let ticks = 0;
  let disposed = false;
  const sent = new Map<number, string>();

  function run(intervalMs: number | undefined, tick: () => void): void {
    if (timerInterval === intervalMs) return;
    timer?.cancel();
    timer = undefined;
    timerInterval = intervalMs;
    if (intervalMs !== undefined) timer = options.every(tick, intervalMs);
  }

  function refresh(): void {
    if (disposed || options.targets().length === 0) {
      sent.clear();
      run(undefined, track);
      return;
    }
    if (options.prefersReducedMotion()) {
      sent.clear();
      run(EMOTION_GAZE_RECHECK_MS, refresh);
      return;
    }
    run(EMOTION_GAZE_INTERVAL_MS, track);
    track();
  }

  function track(): void {
    ticks += 1;
    if (ticks % REDUCED_MOTION_CHECK_TICKS === 0 && options.prefersReducedMotion()) {
      refresh();
      return;
    }
    const targets = options.targets();
    if (targets.length === 0) {
      refresh();
      return;
    }
    const cursor = options.getCursorScreenPoint();
    for (const target of targets) {
      const gaze = emotionGazeDirection(cursor, target.face);
      const key = `${gaze.x},${gaze.y},${gaze.near}`;
      if (sent.get(target.id) === key) continue;
      if (target.send(gaze)) sent.set(target.id, key);
    }
  }

  return {
    refresh,
    dispose() {
      disposed = true;
      refresh();
    },
  };
}
