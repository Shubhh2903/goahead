import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isSlackQuietHours, type SlackQuietHours } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";

/** Settings show how many messages agents sent in this window. Sends have no limit. */
export const SEND_COUNT_WINDOW_MS = 60 * 60_000;

/** A daily time range in this computer's time zone, as `HH:MM`. It can cross midnight. */
export type QuietHours = SlackQuietHours;

/** The person's guards of one workspace's sends. */
export interface SendGuardSettings {
  /** Nothing is sent while it is set: no direct send, no approved draft. */
  paused: boolean;
  /** Null when the person set none. */
  quietHours: QuietHours | null;
}

const DEFAULT_SETTINGS: SendGuardSettings = { paused: false, quietHours: null };

function minutes(time: string): number {
  const [hours = "0", rest = "0"] = time.split(":");
  return Number(hours) * 60 + Number(rest);
}

/** Whether the local time falls in the quiet hours. A range such as 22:00–08:00 crosses midnight. */
export function inQuietHours(quietHours: QuietHours | null, now: Date): boolean {
  if (!quietHours) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  const start = minutes(quietHours.start);
  const end = minutes(quietHours.end);
  return start < end ? current >= start && current < end : current >= start || current < end;
}

/**
 * Keeps each workspace's send guards in a small JSON file next to the other settings of this computer.
 * A change applies in memory at once, before the file is written, so a pause stops the next send
 * without waiting for the disk. A file that cannot be read gives the defaults: nothing paused.
 */
export class MessagingSendGuardStore {
  readonly #path: string | null;
  readonly #settings = new Map<string, SendGuardSettings>();
  #writes: Promise<void> = Promise.resolve();

  /** Without a path, the settings live in memory only. */
  constructor(path: string | null) {
    this.#path = path;
  }

  async load(): Promise<void> {
    if (!this.#path) return;
    const text = await readFile(this.#path, "utf8").catch(() => null);
    if (!text) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    if (!isDynamicRecord(parsed) || !isDynamicRecord(parsed.workspaces)) return;
    for (const [workspaceId, value] of Object.entries(parsed.workspaces)) {
      if (!isDynamicRecord(value)) continue;
      this.#settings.set(workspaceId, {
        paused: isBoolean(value.paused) ? value.paused : false,
        quietHours: isSlackQuietHours(value.quietHours) ? value.quietHours : null,
      });
    }
  }

  get(workspaceId: string): SendGuardSettings {
    return this.#settings.get(workspaceId) ?? DEFAULT_SETTINGS;
  }

  /**
   * Changes the guards now, and saves them in the order the changes came. The result rejects when
   * the file was not written; the change still holds until GoAhead stops.
   */
  set(workspaceId: string, change: Partial<SendGuardSettings>): Promise<void> {
    this.#settings.set(workspaceId, { ...this.get(workspaceId), ...change });
    const snapshot = Object.fromEntries(this.#settings);
    const write = this.#writes.then(() => this.#write(snapshot));
    this.#writes = write.catch(() => undefined);
    return write;
  }

  async #write(workspaces: Record<string, SendGuardSettings>): Promise<void> {
    if (!this.#path) return;
    await mkdir(dirname(this.#path), { recursive: true });
    const temporary = `${this.#path}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ version: 1, workspaces }, null, 2)}\n`, "utf8");
    await rename(temporary, this.#path);
  }
}
