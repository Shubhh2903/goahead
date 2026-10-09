import { isDynamicRecord } from "@openbot/contracts/runtime-values";

export type SlackRequestPriority = "visible" | "background";

export interface SlackRequestQueueOptions {
  perMinute: number;
  /** Only tests replace the clock. */
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface Job {
  priority: SlackRequestPriority;
  /** Runs the call once and resolves the caller's promise with its value. */
  attempt: () => Promise<void>;
  reject: (reason: unknown) => void;
  retries: number;
}

const WINDOW_MS = 60_000;
const MAX_RATE_LIMIT_RETRIES = 3;
/** Bound on one Retry-After pause, so a bad header cannot stop loading for a long time. */
const MAX_RETRY_AFTER_MS = 10 * 60_000;

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Retry-After in milliseconds when `error` is a Slack 429, else null. */
function retryAfterMs(error: unknown): number | null {
  if (!isDynamicRecord(error) || error.status !== 429) return null;
  const seconds = error.retryAfterSeconds;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

/**
 * One queue per Slack workspace for history-type calls. It starts at most `perMinute` calls in
 * any 60-second window, starts visible work before background work, and on a 429 pauses the whole
 * queue for Retry-After before it retries the same call (at most 3 retries).
 */
export class SlackRequestQueue {
  readonly #perMinute: number;
  readonly #now: () => number;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #visible: Job[] = [];
  readonly #background: Job[] = [];
  readonly #starts: number[] = [];
  #pausedUntil = 0;
  #pumpScheduled = false;
  #pumping = false;

  constructor(options: SlackRequestQueueOptions) {
    this.#perMinute = Math.max(1, Math.floor(options.perMinute));
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? defaultSleep;
  }

  run<T>(priority: SlackRequestPriority, call: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.#lane(priority).push({
        priority,
        attempt: async () => resolve(await call()),
        reject,
        retries: 0,
      });
      this.#schedulePump();
    });
  }

  #lane(priority: SlackRequestPriority): Job[] {
    return priority === "visible" ? this.#visible : this.#background;
  }

  /** Waits one microtask so calls queued in the same tick are ordered by priority. */
  #schedulePump(): void {
    if (this.#pumpScheduled || this.#pumping) return;
    this.#pumpScheduled = true;
    queueMicrotask(() => {
      this.#pumpScheduled = false;
      void this.#pump();
    });
  }

  #waitMs(): number {
    const now = this.#now();
    while (this.#starts.length > 0 && (this.#starts[0] ?? 0) <= now - WINDOW_MS) this.#starts.shift();
    const windowWait = this.#starts.length >= this.#perMinute ? (this.#starts[0] ?? now) + WINDOW_MS - now : 0;
    return Math.max(windowWait, this.#pausedUntil - now, 0);
  }

  async #pump(): Promise<void> {
    this.#pumping = true;
    try {
      while (this.#visible.length > 0 || this.#background.length > 0) {
        const wait = this.#waitMs();
        if (wait > 0) {
          await this.#sleep(wait);
          continue;
        }
        const job = this.#visible.shift() ?? this.#background.shift();
        if (!job) break;
        this.#starts.push(this.#now());
        void this.#execute(job);
      }
    } finally {
      this.#pumping = false;
    }
  }

  async #execute(job: Job): Promise<void> {
    try {
      await job.attempt();
    } catch (error) {
      const pause = retryAfterMs(error);
      if (pause === null || job.retries >= MAX_RATE_LIMIT_RETRIES) {
        job.reject(error);
        return;
      }
      job.retries += 1;
      this.#pausedUntil = Math.max(this.#pausedUntil, this.#now() + pause);
      this.#lane(job.priority).unshift(job);
      this.#schedulePump();
    }
  }
}
