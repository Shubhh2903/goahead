// The mail notices of `gmail_notify`, in memory: the Dynamic Island shows them (Task 5) and each new
// one raises a macOS notification. A restart forgets them; the note stays in the chat of the agent that handles mail.

import { randomUUID } from "node:crypto";
import type { GoogleMailNotice } from "@openbot/contracts/ipc";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";

const logger = createOpenBotLogger("google-notices");

const NOTICE_LIMIT = 20;

export class GoogleNotices {
  #notices: GoogleMailNotice[] = [];
  readonly #added = new Set<(notice: GoogleMailNotice) => void>();
  readonly #changed = new Set<(notices: GoogleMailNotice[]) => void>();

  add(input: Omit<GoogleMailNotice, "noticeId" | "createdAt">): GoogleMailNotice {
    const notice: GoogleMailNotice = { ...input, noticeId: randomUUID(), createdAt: new Date().toISOString() };
    this.#notices = [notice, ...this.#notices].slice(0, NOTICE_LIMIT);
    for (const listener of this.#added) callSafely(() => listener(notice));
    this.#emit();
    return notice;
  }

  list(): GoogleMailNotice[] {
    return [...this.#notices];
  }

  /** Removes and returns one notice. Null for an id this process never made. */
  take(noticeId: string): GoogleMailNotice | null {
    const notice = this.#notices.find((candidate) => candidate.noticeId === noticeId) ?? null;
    if (!notice) return null;
    this.#notices = this.#notices.filter((candidate) => candidate !== notice);
    this.#emit();
    return notice;
  }

  clear(): void {
    if (this.#notices.length === 0) return;
    this.#notices = [];
    this.#emit();
  }

  onAdded(listener: (notice: GoogleMailNotice) => void): () => void {
    this.#added.add(listener);
    return () => this.#added.delete(listener);
  }

  onChanged(listener: (notices: GoogleMailNotice[]) => void): () => void {
    this.#changed.add(listener);
    return () => this.#changed.delete(listener);
  }

  #emit(): void {
    const notices = this.list();
    for (const listener of this.#changed) callSafely(() => listener(notices));
  }
}

/** A listener that throws (a notification, a closed window) must not fail the triage that added the notice. */
function callSafely(call: () => void): void {
  try {
    call();
  } catch (error) {
    logger.warn("A mail notice listener failed.", { cause: toLogValue(error) });
  }
}
