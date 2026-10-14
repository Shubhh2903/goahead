// The Gmail watcher: while Google is connected and GoAhead runs, it reads the new INBOX messages
// every 2 minutes and gives the selected ones to the triage (`google-mail-triage.ts`), never to an
// agent turn. Selected: label IMPORTANT, label CATEGORY_PERSONAL (Primary), or a calendar invite.
// The triage gets sender, subject, date, Gmail id and Gmail's snippet, never the full body.
// A poll examines at most 50 new messages and triages at most 10. The messages that it did not examine
// wait in the state file (`pending`) and the next poll examines them first, so no mail is lost.

import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import type { GoogleTriageMail } from "../backend/messaging/google-triage";
import type { GmailApi } from "./gmail-api";
import { GoogleApiError } from "./google-api";
import { type GoogleWatcherState, type GoogleWatcherStateStore, SEEN_LIMIT } from "./google-watcher-state";

const logger = createOpenBotLogger("gmail-watcher");

export const GMAIL_WATCH_INTERVAL_MS = 2 * 60_000;
export const GMAIL_TRIAGE_LIMIT = 10;
/** New messages read per poll at most, so a flood of promotions does not cost hundreds of calls. */
export const GMAIL_CANDIDATE_LIMIT = 50;

type Candidate = GoogleWatcherState["pending"][number];

export type GmailPollResult =
  | "inactive"
  | "started"
  | "restarted"
  | "nothing-new"
  | "triaged"
  | "no-mail-agent"
  | "skipped"
  | "stopped";

export interface GmailWatcherOptions {
  gmail: Pick<GmailApi, "profile" | "history" | "summary" | "message">;
  state: Pick<GoogleWatcherStateStore, "read" | "update">;
  /** True while the connection can make calls. A sign-in that expired stops the polls. */
  active: () => boolean;
  /** The connected account. Another account starts the history again. */
  account: () => string | null;
  /**
   * Triages one batch. False when no agent handles mail: the batch is not kept for later. `stop()`
   * aborts the signal: the triage then shows no notice and posts no note.
   */
  triage: (mails: GoogleTriageMail[], signal: AbortSignal) => Promise<boolean>;
  intervalMs?: number;
}

export class GmailWatcher {
  readonly #options: GmailWatcherOptions;
  #timer: ReturnType<typeof setInterval> | null = null;
  #polling: Promise<GmailPollResult> | null = null;
  /** Aborted by `stop()`; `start()` makes a new one. */
  #lifetime = new AbortController();

  constructor(options: GmailWatcherOptions) {
    this.#options = options;
  }

  start(): void {
    if (this.#timer) return;
    if (this.#lifetime.signal.aborted) this.#lifetime = new AbortController();
    this.#timer = setInterval(() => void this.poll(), this.#options.intervalMs ?? GMAIL_WATCH_INTERVAL_MS);
    this.#timer.unref?.();
    void this.poll();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#lifetime.abort();
  }

  /**
   * Aborts the poll that runs now (and its triage), so it writes no state and shows no notice. A
   * watcher that was started polls again at once. Used when the connection ends or the account changes.
   */
  restart(): void {
    const started = this.#timer !== null;
    this.stop();
    this.#lifetime = new AbortController();
    if (started) this.start();
  }

  /**
   * After a disconnect: aborts the running poll and forgets the history position, the seen ids and
   * the waiting mails. A later connection starts at the current history, so the mail that came while
   * Google was disconnected is not triaged.
   */
  async forget(): Promise<void> {
    const started = this.#timer !== null;
    this.stop();
    try {
      await this.#options.state.update((current) => ({
        ...current,
        account: null,
        historyId: null,
        seen: [],
        pending: [],
      }));
    } finally {
      this.#lifetime = new AbortController();
      if (started) this.start();
    }
  }

  /** One poll at a time: a poll that is still running is the answer to a second call. */
  poll(): Promise<GmailPollResult> {
    this.#polling ??= this.#poll().finally(() => {
      this.#polling = null;
    });
    return this.#polling;
  }

  async #poll(): Promise<GmailPollResult> {
    const signal = this.#lifetime.signal;
    if (signal.aborted || !this.#options.active()) return "inactive";
    try {
      const state = this.#options.state.read();
      if (!state.historyId || state.account !== this.#options.account()) {
        await this.#restart(false, signal);
        return "started";
      }
      const page = await this.#options.gmail.history(state.historyId);
      if (page.status === "expired") {
        // The same account: the mails that already wait are still triaged.
        await this.#restart(true, signal);
        return "restarted";
      }
      const queue = this.#queue(state, page.added);
      const mails: GoogleTriageMail[] = [];
      let examined = 0;
      for (const candidate of queue) {
        if (examined >= GMAIL_CANDIDATE_LIMIT || mails.length >= GMAIL_TRIAGE_LIMIT) break;
        const selected = await this.#select(candidate);
        examined += 1;
        if (selected) mails.push(selected);
      }
      const done = queue.slice(0, examined);
      const waiting = queue.slice(examined);
      if (waiting.length > SEEN_LIMIT) {
        logger.warn("Too many new Gmail messages wait for triage. The newest are not triaged.", {
          dropped: waiting.length - SEEN_LIMIT,
        });
      }
      let result: GmailPollResult = "nothing-new";
      if (mails.length > 0) result = (await this.#options.triage(mails, signal)) ? "triaged" : "no-mail-agent";
      // Stopped while it ran: no late write. The next start reads the same history again.
      if (signal.aborted) return "stopped";
      // After the triage: a crash before this line triages the same batch again (a second card), and
      // never loses a mail.
      await this.#options.state.update((current) => ({
        ...current,
        historyId: page.historyId,
        seen: [...current.seen, ...done.map((candidate) => candidate.id)].slice(-SEEN_LIMIT),
        pending: waiting.slice(0, SEEN_LIMIT),
      }));
      return result;
    } catch (error) {
      // Network down, 429 or 5xx after three tries, or a sign-in that expired: skip this poll.
      logger.info("A Gmail poll was skipped.", { cause: toLogValue(error) });
      return "skipped";
    }
  }

  async #restart(keepPending: boolean, signal: AbortSignal): Promise<void> {
    const profile = await this.#options.gmail.profile();
    // Stopped while the profile was read: `forget()` may have reset the state.
    if (signal.aborted) return;
    await this.#options.state.update((current) => ({
      ...current,
      account: profile.email,
      historyId: profile.historyId,
      seen: [],
      pending: keepPending ? current.pending : [],
    }));
  }

  /** The waiting messages first, then the new ones; each message once, and none that a poll examined. */
  #queue(state: GoogleWatcherState, added: Array<{ id: string; labelIds: string[] }>): Candidate[] {
    const seen = new Set(state.seen);
    const queued = new Set<string>();
    const queue: Candidate[] = [];
    for (const candidate of [...state.pending, ...added]) {
      if (seen.has(candidate.id) || queued.has(candidate.id)) continue;
      queued.add(candidate.id);
      queue.push({ id: candidate.id, labelIds: candidate.labelIds });
    }
    return queue;
  }

  async #select(candidate: Candidate): Promise<GoogleTriageMail | null> {
    const signals: GoogleTriageMail["signals"] = [];
    if (candidate.labelIds.includes("IMPORTANT")) signals.push("important");
    if (candidate.labelIds.includes("CATEGORY_PERSONAL")) signals.push("primary");
    // A label decides from metadata. Otherwise only the parts show an invite.
    let mail: Awaited<ReturnType<GmailApi["message"]>>;
    try {
      mail =
        signals.length > 0
          ? await this.#options.gmail.summary(candidate.id)
          : await this.#options.gmail.message(candidate.id);
    } catch (error) {
      // A mail deleted since the history read: nothing to triage. Another error skips the poll.
      if (error instanceof GoogleApiError && error.status === 404) return null;
      throw error;
    }
    if (mail.invite) signals.push("invite");
    if (signals.length === 0) return null;
    return {
      id: mail.id,
      threadId: mail.threadId,
      from: mail.from,
      subject: mail.subject,
      date: mail.date,
      snippet: mail.snippet,
      signals,
    };
  }
}
