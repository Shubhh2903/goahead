// `google-watcher-state.json` in user data: the Gmail history position, the last seen message ids,
// the new mails that wait for the next triage, and the open Google approvals. It holds no token and no mail body, so it is not encrypted; it does
// hold Gmail ids, subjects and recipients, so it is written readable only by the user (0o600).

import { readFile } from "node:fs/promises";
import { sourceText } from "@openbot/i18n/source";
import { z } from "zod";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";

/** The most message ids the state file keeps in `seen`, and in `pending`. */
export const SEEN_LIMIT = 500;
const APPROVAL_LIMIT = 100;
/** The most To addresses, and Cc addresses, that a stored send keeps. */
const RECIPIENT_LIMIT = 40;
const SUBJECT_LIMIT = 1000;

const owner = {
  approvalId: z.string().min(1).max(64),
  agentId: z.string().min(1).max(128),
  threadId: z.string().min(1).max(128),
  turnId: z.string().min(1).max(128),
  createdAt: z.string().min(1).max(40),
};

export const googleApprovalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("send"),
    ...owner,
    draftId: z.string().min(1).max(128),
    to: z.array(z.string().max(320)).max(RECIPIENT_LIMIT),
    cc: z.array(z.string().max(320)).max(RECIPIENT_LIMIT),
    subject: z.string().max(SUBJECT_LIMIT),
    /**
     * A hash of the draft as the card showed it (recipients, subject, text, attachment names). The
     * send waits when the draft is different at approval time. Missing: the draft counts as changed.
     */
    digest: z.string().max(128).optional(),
  }),
  z.object({
    kind: z.literal("meeting"),
    ...owner,
    title: z.string().min(1).max(500),
    start: z.string().min(1).max(40),
    end: z.string().min(1).max(40),
    timeZone: z.string().min(1).max(64),
    guests: z.array(z.string().max(320)).max(50),
    description: z.string().max(8000),
    replyToMessageId: z.string().max(128).nullable(),
    /** The same for each try of one booking: the Calendar event id and the Meet request come from it. */
    originId: z.string().min(1).max(64).optional(),
  }),
]);

export type GoogleApprovalRecord = z.infer<typeof googleApprovalSchema>;

const stateSchema = z.object({
  version: z.literal(1),
  /** The account that `historyId` belongs to. Another account starts the history again. */
  account: z.string().nullable(),
  historyId: z.string().nullable(),
  seen: z.array(z.string()).max(SEEN_LIMIT),
  /**
   * New INBOX messages that the history returned but no poll examined yet, because a batch was full.
   * The next poll examines them first. `historyId` already moved past them.
   */
  pending: z
    .array(z.object({ id: z.string().min(1).max(128), labelIds: z.array(z.string().max(128)).max(100) }))
    .max(SEEN_LIMIT),
  approvals: z.array(googleApprovalSchema).max(APPROVAL_LIMIT),
});

export type GoogleWatcherState = z.infer<typeof stateSchema>;

const EMPTY_STATE: GoogleWatcherState = {
  version: 1,
  account: null,
  historyId: null,
  seen: [],
  pending: [],
  approvals: [],
};

/** Changes run one at a time, and memory changes only after the file is written. */
export class GoogleWatcherStateStore {
  readonly #path: string;
  #state: GoogleWatcherState = EMPTY_STATE;
  #queue: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.#path = path;
  }

  /** A file that cannot be read starts empty; the error is returned for the log. */
  async load(): Promise<Error | null> {
    try {
      this.#state = stateSchema.parse(JSON.parse(await readFile(this.#path, "utf8")));
      return null;
    } catch (error) {
      this.#state = EMPTY_STATE;
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      return error instanceof Error ? error : new Error(String(error));
    }
  }

  read(): GoogleWatcherState {
    return this.#state;
  }

  update(change: (current: GoogleWatcherState) => GoogleWatcherState): Promise<void> {
    return this.#enqueue(async () => {
      const next = stateSchema.parse(change(this.#state));
      await writeJsonFileAtomically(this.#path, next, { createDirectory: true });
      this.#state = next;
    });
  }

  /** Refuses, with a message for the agent, an approval that the file cannot keep. */
  addApproval(record: GoogleApprovalRecord): Promise<void> {
    return this.update((current) => {
      if (current.approvals.length >= APPROVAL_LIMIT) {
        throw new Error(sourceText("error.connector.googleTooManyApprovals", { limit: String(APPROVAL_LIMIT) }));
      }
      if (record.kind === "send") {
        if (record.to.length > RECIPIENT_LIMIT || record.cc.length > RECIPIENT_LIMIT) {
          throw new Error(sourceText("error.connector.gmailTooManyRecipients", { limit: String(RECIPIENT_LIMIT) }));
        }
        if (record.subject.length > SUBJECT_LIMIT) {
          throw new Error(sourceText("error.connector.gmailSubjectTooLong", { limit: String(SUBJECT_LIMIT) }));
        }
      }
      return { ...current, approvals: [...current.approvals, record] };
    });
  }

  /**
   * Removes the approval and writes the file before it answers, so the caller sends at most once: a
   * second answer, a double click, or a restart after this point finds nothing.
   */
  takeApproval(approvalId: string): Promise<GoogleApprovalRecord | null> {
    let taken: GoogleApprovalRecord | null = null;
    return this.#enqueue(async () => {
      const record = this.#state.approvals.find((approval) => approval.approvalId === approvalId) ?? null;
      if (!record) return;
      const next = { ...this.#state, approvals: this.#state.approvals.filter((approval) => approval !== record) };
      await writeJsonFileAtomically(this.#path, next, { createDirectory: true });
      this.#state = next;
      taken = record;
    }).then(() => taken);
  }

  #enqueue(change: () => Promise<void>): Promise<void> {
    const result = this.#queue.then(change, change);
    this.#queue = result.catch(() => undefined);
    return result;
  }
}
