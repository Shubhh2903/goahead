/** Fast auto-replies in a row that pause auto-reply in one conversation. */
export const AUTO_REPLY_LOOP_REPLIES = 10;
/** The other side answered our last auto-reply within this time: the exchange is fast. */
export const AUTO_REPLY_LOOP_GAP_MS = 2 * 60_000;

interface LoopState {
  /** Fast auto-replies in a row. */
  count: number;
  lastReplyAt: number | null;
  /** The other side wrote since the last auto-reply. */
  heard: boolean;
  /** A message from the other side came later than the gap after the last auto-reply. */
  slow: boolean;
  paused: boolean;
}

/**
 * Finds two auto-replying sides that answer each other with no end, for example two GoAheads. Per
 * conversation (`key`), it counts the auto-replies in a row that answer a message which came within
 * `AUTO_REPLY_LOOP_GAP_MS` of the auto-reply before. At `AUTO_REPLY_LOOP_REPLIES`, the conversation is
 * paused until the person writes in it or tells the orchestrator to continue. The state is in memory
 * only: a restart starts each count again, and auto-reply is not paused after it. It owns no timers.
 */
export class MessagingAutoReplyLoop {
  readonly #states = new Map<string, LoopState>();

  /** A message from the other side of the conversation. */
  heard(key: string, at: number): void {
    const state = this.#state(key);
    state.heard = true;
    if (state.lastReplyAt !== null && at - state.lastReplyAt > AUTO_REPLY_LOOP_GAP_MS) state.slow = true;
  }

  /** An auto-reply went out. True when it is the one that pauses the conversation. */
  replied(key: string, at: number): boolean {
    const state = this.#state(key);
    if (state.paused) return false;
    // A second message of the same turn answers nothing new: the count stays.
    if (state.lastReplyAt === null || state.slow) state.count = 1;
    else if (state.heard) state.count += 1;
    state.lastReplyAt = at;
    state.heard = false;
    state.slow = false;
    if (state.count < AUTO_REPLY_LOOP_REPLIES) return false;
    state.paused = true;
    return true;
  }

  isPaused(key: string): boolean {
    return this.#states.get(key)?.paused ?? false;
  }

  /** The keys that are paused now. */
  pausedKeys(): string[] {
    return [...this.#states].filter(([, state]) => state.paused).map(([key]) => key);
  }

  /** The person wrote, or told GoAhead to continue: the count starts again. True when it ends a pause. */
  reset(key: string): boolean {
    const paused = this.isPaused(key);
    this.#states.delete(key);
    return paused;
  }

  /** Forgets every conversation that `match` names, such as those of a removed connection. */
  forget(match: (key: string) => boolean): void {
    for (const key of [...this.#states.keys()]) if (match(key)) this.#states.delete(key);
  }

  #state(key: string): LoopState {
    let state = this.#states.get(key);
    if (!state) {
      state = { count: 0, lastReplyAt: null, heard: false, slow: false, paused: false };
      this.#states.set(key, state);
    }
    return state;
  }
}
