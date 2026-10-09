import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";

/** The most hidden marks the file keeps. The oldest goes first; its conversation shows again. */
export const HIDDEN_THREAD_LIMIT = 5_000;

/**
 * The external conversations the person hid from the sidebar, in a small JSON file next to the other
 * settings of this computer. Nothing is deleted: a mark only hides the conversation until a message
 * newer than the mark arrives. A change applies in memory at once, before the file is written. A file
 * that cannot be read gives no marks: every conversation shows.
 */
export class MessagingHiddenThreadStore {
  readonly #path: string | null;
  /** Thread id to the time it was hidden, oldest first. */
  readonly #hidden = new Map<string, string>();
  #writes: Promise<void> = Promise.resolve();

  /** Without a path, the marks live in memory only. */
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
    if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isDynamicRecord(parsed.threads)) return;
    for (const [threadId, hiddenAt] of Object.entries(parsed.threads))
      if (isString(hiddenAt) && Number.isFinite(Date.parse(hiddenAt))) this.#hidden.set(threadId, hiddenAt);
  }

  /** True while the conversation has no activity after the person hid it. */
  isHidden(threadId: string, updatedAt: string): boolean {
    const hiddenAt = this.#hidden.get(threadId);
    return hiddenAt !== undefined && Date.parse(updatedAt) <= Date.parse(hiddenAt);
  }

  /**
   * Hides the conversations now, and saves the marks in the order the changes came. The result
   * rejects when the file was not written; the marks still hold until GoAhead stops.
   */
  hide(threadIds: readonly string[], now: Date = new Date()): Promise<void> {
    const hiddenAt = now.toISOString();
    for (const threadId of threadIds) {
      this.#hidden.delete(threadId);
      this.#hidden.set(threadId, hiddenAt);
    }
    for (const threadId of this.#hidden.keys()) {
      if (this.#hidden.size <= HIDDEN_THREAD_LIMIT) break;
      this.#hidden.delete(threadId);
    }
    const snapshot = Object.fromEntries(this.#hidden);
    const write = this.#writes.then(() => this.#write(snapshot));
    this.#writes = write.catch(() => undefined);
    return write;
  }

  async #write(threads: Record<string, string>): Promise<void> {
    if (!this.#path) return;
    await mkdir(dirname(this.#path), { recursive: true });
    const temporary = `${this.#path}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ version: 1, threads }, null, 2)}\n`, "utf8");
    await rename(temporary, this.#path);
  }
}
