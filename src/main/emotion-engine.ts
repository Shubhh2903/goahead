// Turns what the agents do into the one face that the Dynamic Island and the Dock show. The engine
// is pure: the caller injects the clock and the random source, sends it events, and calls `tick()`
// from a timer so that time-based rules (joy, strain, sleepy, idle changes, held changes) apply.
import type { AgentHandoffStatus, DynamicIslandPresentation, EmotionId } from "@openbot/contracts/ipc";

export type EmotionPresentationMode = DynamicIslandPresentation["mode"];

export interface EmotionEngineOptions {
  now: () => number;
  /** Returns a number in [0, 1), like `Math.random`. */
  random: () => number;
  /** Called with each new face, after the hold rule. */
  onChange: (emotion: EmotionId) => void;
}

export interface EmotionEngine {
  /** The face shown now. */
  current: () => EmotionId;
  /** The island presentation changed. */
  presentation: (mode: EmotionPresentationMode) => void;
  turnStarted: (agentId: string) => void;
  toolUse: (agentId: string) => void;
  /** `status` is the `turn-completed` status: "completed" is a success, "failed" is an error. */
  turnCompleted: (agentId: string, status: string) => void;
  handoff: (status: AgentHandoffStatus) => void;
  memorySaved: () => void;
  usageLimit: () => void;
  /** The user did something. It resets the sleepy timer. */
  activity: () => void;
  /** Applies the time-based rules. Call it about once per second. */
  tick: () => void;
}

/** The calm faces that idle picks from. */
export const IDLE_EMOTIONS = ["neutral", "happy", "wink", "cute"] as const satisfies readonly EmotionId[];

export const EMOTION_TIMING = {
  /** The shortest time that a face stays, except needs-you. */
  holdMs: 3_000,
  /** Joy after a turn is done; then happy. */
  joyMs: 3_000,
  /** How long a short event face (oops, dizzy, money, curious, learned) stays. */
  eventMs: 5_000,
  /** Continuous work longer than this shows strain. */
  strainAfterMs: 2 * 60_000,
  /** No activity for this long shows sleepy when idle. */
  sleepyAfterMs: 10 * 60_000,
  /** Idle picks a new calm face after a random time in this range. */
  idleMinMs: 20_000,
  idleMaxMs: 40_000,
  /** Failed turns in a row that show dizzy. */
  dizzyFailures: 3,
} as const;

interface ActiveTurn {
  startedAt: number;
  usesTools: boolean;
}

export function createEmotionEngine({ now, random, onChange }: EmotionEngineOptions): EmotionEngine {
  const turns = new Map<string, ActiveTurn>();
  let mode: EmotionPresentationMode = "idle";
  let failuresInRow = 0;
  let lastActivityAt = now();
  let joyUntil = Number.NEGATIVE_INFINITY;
  let oopsUntil = Number.NEGATIVE_INFINITY;
  let dizzyUntil = Number.NEGATIVE_INFINITY;
  let moneyUntil = Number.NEGATIVE_INFINITY;
  let curiousUntil = Number.NEGATIVE_INFINITY;
  let learnedUntil = Number.NEGATIVE_INFINITY;
  let idleEmotion: EmotionId = pickCalm(undefined);
  let nextIdleChangeAt = now() + idleInterval();
  let shown: EmotionId = idleEmotion;
  let shownAt = Number.NEGATIVE_INFINITY;

  function idleInterval(): number {
    return EMOTION_TIMING.idleMinMs + random() * (EMOTION_TIMING.idleMaxMs - EMOTION_TIMING.idleMinMs);
  }

  function pickCalm(previous: EmotionId | undefined): EmotionId {
    const choices = IDLE_EMOTIONS.filter((emotion) => emotion !== previous);
    return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))] ?? "neutral";
  }

  function desired(at: number): EmotionId {
    if (mode === "approval" || mode === "question") return "needs-you";
    if (at < dizzyUntil) return "dizzy";
    if (mode === "failed" || at < oopsUntil) return "oops";
    if (at < moneyUntil) return "money";
    const active = [...turns.values()];
    if (active.some((turn) => at - turn.startedAt >= EMOTION_TIMING.strainAfterMs)) return "strain";
    if (active.some((turn) => turn.usesTools)) return "focused";
    if (active.length > 0 || mode === "working") return "thinking";
    if (at < curiousUntil) return "curious";
    if (mode === "message") return "listening";
    if (at < learnedUntil) return "learned";
    if (at < joyUntil) return "joy";
    if (at - lastActivityAt >= EMOTION_TIMING.sleepyAfterMs) return "sleepy";
    return idleEmotion;
  }

  function update(): void {
    const at = now();
    if (at >= nextIdleChangeAt) {
      idleEmotion = pickCalm(idleEmotion);
      nextIdleChangeAt = at + idleInterval();
    }
    const next = desired(at);
    if (next === shown) return;
    if (next !== "needs-you" && at - shownAt < EMOTION_TIMING.holdMs) return;
    shown = next;
    shownAt = at;
    onChange(next);
  }

  function touch(): void {
    lastActivityAt = now();
  }

  return {
    current: () => shown,
    presentation(nextMode) {
      mode = nextMode;
      if (nextMode !== "idle") touch();
      update();
    },
    turnStarted(agentId) {
      touch();
      turns.set(agentId, { startedAt: now(), usesTools: false });
      update();
    },
    toolUse(agentId) {
      touch();
      const turn = turns.get(agentId);
      if (turn) turn.usesTools = true;
      else turns.set(agentId, { startedAt: now(), usesTools: true });
      update();
    },
    turnCompleted(agentId, status) {
      touch();
      turns.delete(agentId);
      const at = now();
      if (status === "failed") {
        failuresInRow += 1;
        if (failuresInRow >= EMOTION_TIMING.dizzyFailures) dizzyUntil = at + EMOTION_TIMING.eventMs;
        else oopsUntil = at + EMOTION_TIMING.eventMs;
      } else if (status === "completed") {
        failuresInRow = 0;
        dizzyUntil = Number.NEGATIVE_INFINITY;
        joyUntil = at + EMOTION_TIMING.joyMs;
        idleEmotion = "happy";
        nextIdleChangeAt = joyUntil + idleInterval();
      }
      update();
    },
    handoff(status) {
      touch();
      if (status === "queued" || status === "working") curiousUntil = now() + EMOTION_TIMING.eventMs;
      update();
    },
    memorySaved() {
      touch();
      learnedUntil = now() + EMOTION_TIMING.eventMs;
      update();
    },
    usageLimit() {
      touch();
      moneyUntil = now() + EMOTION_TIMING.eventMs;
      update();
    },
    activity() {
      touch();
      update();
    },
    tick: update,
  };
}
