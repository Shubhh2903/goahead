// The main-process side of the backend `GoogleWorkspace` port: Gmail and Google Calendar calls for
// the mail agents' tools. The backend never sees a token, a URL or a Google response that was not shaped
// here.

import { createHash, randomUUID } from "node:crypto";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { GoogleConnectorStatus } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText, toLogValue } from "@openbot/logging";
import { localApprovalText } from "../backend/agent/attention-registry";
import {
  type CalendarFreeTimes,
  type GmailDraftReceipt,
  type GmailDraftRequest,
  type GmailMailSummary,
  type GmailMailText,
  type GmailNoticeRequest,
  type GmailSendRequest,
  type GoogleApprovalCard,
  GoogleApprovalFailedError,
  type GoogleToolOwner,
  type GoogleWorkspace,
  type MeetingProposalRequest,
} from "../backend/messaging/google-tools";
import { GmailApi, type GmailDraftView } from "./gmail-api";
import { GoogleApiError } from "./google-api";
import { freeSlots, GoogleCalendarApi } from "./google-calendar";
import type { GoogleConnectorService } from "./google-connector-service";
import { googleNoticeText } from "./google-mail-triage";
import { addressOf, buildRawMessage, isEmailAddress } from "./google-mime";
import type { GoogleNotices } from "./google-notices";
import type { GoogleApprovalRecord, GoogleWatcherStateStore } from "./google-watcher-state";

const logger = createOpenBotLogger("google-workspace");

export interface DesktopGoogleWorkspaceOptions {
  connector: Pick<GoogleConnectorService, "connected" | "mailAgentId" | "api" | "endpoints">;
  notices: Pick<GoogleNotices, "add">;
  /** False for an agent that was deleted after it was picked. */
  agentExists: (agentId: string) => boolean;
  /** Posts a note in an agent's chat (`AgentService.postGoogleInformation`). */
  postInformation: (agentId: string, text: string) => void;
  /** The open send and booking approvals: they survive a restart. */
  state: Pick<GoogleWatcherStateStore, "read" | "update" | "addApproval" | "takeApproval">;
  /** The system time zone, read at each call. */
  timeZone?: () => string;
  now?: () => number;
  newId?: () => string;
}

export class DesktopGoogleWorkspace implements GoogleWorkspace {
  readonly gmail: GmailApi;
  readonly calendar: GoogleCalendarApi;
  readonly #connector: DesktopGoogleWorkspaceOptions["connector"];
  readonly #timeZone: () => string;
  readonly #notices: DesktopGoogleWorkspaceOptions["notices"];
  readonly #agentExists: DesktopGoogleWorkspaceOptions["agentExists"];
  readonly #postInformation: DesktopGoogleWorkspaceOptions["postInformation"];
  readonly #state: DesktopGoogleWorkspaceOptions["state"];
  readonly #now: () => number;
  readonly #newId: () => string;
  /** The drafts that a proposal reads or a send sends now: no update reaches them. */
  readonly #busyDrafts = new Set<string>();

  constructor(options: DesktopGoogleWorkspaceOptions) {
    this.#connector = options.connector;
    this.#state = options.state;
    this.#now = options.now ?? Date.now;
    this.#newId = options.newId ?? randomUUID;
    this.#notices = options.notices;
    this.#agentExists = options.agentExists;
    this.#postInformation = options.postInformation;
    this.gmail = new GmailApi(options.connector.api, options.connector.endpoints.gmail);
    this.calendar = new GoogleCalendarApi(options.connector.api, options.connector.endpoints.calendar);
    this.#timeZone = options.timeZone ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  }

  connected(): boolean {
    return this.#connector.connected();
  }

  mailAgentId(): string | null {
    return this.#connector.mailAgentId();
  }

  search(input: { query: string; limit: number }): Promise<GmailMailSummary[]> {
    return this.gmail.search(input.query, input.limit);
  }

  async read(input: { messageId: string | null; threadId: string | null }): Promise<GmailMailText[]> {
    if (input.threadId) return this.gmail.thread(input.threadId);
    if (input.messageId) return [await this.gmail.message(input.messageId)];
    throw new Error(sourceText("error.connector.gmailNoMessage"));
  }

  organize(input: { messageId: string; add: string[]; remove: string[] }): Promise<{ id: string; labelIds: string[] }> {
    return this.gmail.modify(input.messageId, { add: input.add, remove: input.remove });
  }

  /** A reply goes to the sender (or `Reply-To`), keeps the thread, and carries `In-Reply-To` and `References`. */
  async draft(input: GmailDraftRequest): Promise<GmailDraftReceipt> {
    if (input.draftId) this.#refuseOpenDraft(input.draftId);
    const original = input.replyToMessageId ? await this.gmail.message(input.replyToMessageId) : null;
    const to = input.to.length > 0 ? input.to : original ? [addressOf(original.replyTo || original.from)] : [];
    const subject =
      input.subject ??
      (original ? (/^re:/iu.test(original.subject) ? original.subject : `Re: ${original.subject}`) : "");
    const references = original
      ? [original.references, original.messageIdHeader].filter(Boolean).join(" ") || null
      : null;
    const raw = buildRawMessage({
      to,
      cc: input.cc,
      subject,
      body: input.body,
      inReplyTo: original?.messageIdHeader || null,
      references,
    });
    return this.gmail.saveDraft({ draftId: input.draftId, threadId: original?.threadId ?? null, raw });
  }

  async findTimes(input: { from: number; to: number; durationMinutes: number }): Promise<CalendarFreeTimes> {
    const timeZone = this.#timeZone();
    const busy = await this.calendar.busy(input.from, input.to, timeZone);
    return { timeZone, slots: freeSlots({ ...input, busy, timeZone }) };
  }

  /**
   * `gmail_notify` in a mail agent's own turn (such as the Slack orchestrator's). The card opens, and
   * the note goes to, the agent picked in the Google panel; with no picked agent that exists, the
   * agent that called the tool.
   */
  async notify(input: GmailNoticeRequest): Promise<{ noticeId: string }> {
    // Sender and subject from Gmail: the model's own words are only the summary.
    const mail = await this.gmail.summary(input.messageId);
    const agentId = this.#noteAgent(input.agentId);
    const notice = this.#notices.add({
      agentId,
      kind: input.kind,
      from: mail.from,
      subject: mail.subject,
      summary: input.summary,
      gmailMessageId: mail.id,
    });
    try {
      this.#postInformation(agentId, googleNoticeText(notice));
    } catch (error) {
      // The card and the notification still show the mail.
      logger.warn("A mail note could not be posted.", { cause: toLogValue(error) });
    }
    return { noticeId: notice.noticeId };
  }

  /**
   * `gmail_send`: the card shows the draft as Gmail stores it (recipients, Bcc, subject, text,
   * attachment names), not the model's description of it. A mail with no draft id is first saved as
   * a draft. The record keeps a hash of what the card shows: the send waits when the draft changes.
   */
  async proposeSend(input: GmailSendRequest, owner: GoogleToolOwner): Promise<GoogleApprovalCard> {
    let draftId = input.draftId;
    if (draftId) this.#refuseOpenDraft(draftId);
    else {
      if (!input.body) throw new Error(sourceText("error.connector.gmailSendNeedsBody"));
      draftId = (await this.draft({ ...input, draftId: null, body: input.body })).draftId;
    }
    this.#busyDrafts.add(draftId);
    try {
      const draft = await this.gmail.draft(draftId);
      if (draft.to.length === 0) throw new Error(sourceText("error.connector.gmailNoRecipient"));
      const record = sendRecord({ kind: "send", ...this.#newOwner(owner), draftId }, draft);
      const card = sendCard(record, draft);
      if (!card.complete) throw new Error(sourceText("error.connector.googleApprovalTooLong"));
      // Stored before it is shown, so a restart shows it again.
      await this.#state.addApproval(record);
      return card;
    } finally {
      this.#busyDrafts.delete(draftId);
    }
  }

  /** `calendar_propose_meeting`: the card shows the event that an approval creates. */
  async proposeMeeting(input: MeetingProposalRequest, owner: GoogleToolOwner): Promise<GoogleApprovalCard> {
    const start = Date.parse(input.start);
    const end = Date.parse(input.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error(sourceText("error.connector.calendarBadRange"));
    }
    for (const guest of input.guests) {
      if (!isEmailAddress(guest)) throw new Error(sourceText("error.connector.gmailBadAddress", { address: guest }));
    }
    const recordOwner = this.#newOwner(owner);
    const record: GoogleApprovalRecord = {
      kind: "meeting",
      ...recordOwner,
      title: input.title,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      timeZone: this.#timeZone(),
      guests: input.guests,
      description: input.description,
      replyToMessageId: input.replyToMessageId,
      originId: recordOwner.approvalId,
    };
    const card = meetingCard(record);
    if (!card.complete) throw new Error(sourceText("error.connector.googleApprovalTooLong"));
    await this.#state.addApproval(record);
    return card;
  }

  /**
   * The person's answer. The approval leaves the state file before the call to Google, so a double
   * click or a restart cannot send twice, and a failed call is not tried again here.
   */
  async answerApproval(approvalId: string, decision: "accept" | "decline"): Promise<void> {
    const record = await this.#state.takeApproval(approvalId);
    if (!record) throw new Error(sourceText("error.backend.approvalInactive"));
    if (decision === "decline") {
      this.#tell(
        record,
        record.kind === "send"
          ? sourceText("status.messaging.googleSendDeclined", { subject: record.subject })
          : sourceText("status.messaging.googleBookDeclined", { title: record.title }),
      );
      return;
    }
    if (record.kind === "send") await this.#send(record);
    else await this.#book(record);
  }

  /**
   * The open approvals of the state file, for the start of the app. An approval of an agent that no
   * longer exists can never be answered, so it is removed first.
   */
  async openApprovals(): Promise<GoogleApprovalCard[]> {
    if (this.#state.read().approvals.some((record) => !this.#agentExists(record.agentId))) {
      await this.#state.update((current) => ({
        ...current,
        approvals: current.approvals.filter((record) => this.#agentExists(record.agentId)),
      }));
    }
    return Promise.all(this.#state.read().approvals.map((record) => this.#card(record)));
  }

  async clearApprovals(): Promise<void> {
    await this.#state.update((current) => (current.approvals.length === 0 ? current : { ...current, approvals: [] }));
  }

  /**
   * Sends only the draft that the card showed. The draft is read again first: a draft that changed
   * is not sent, and comes back as a new card with its new content.
   */
  async #send(record: SendRecord): Promise<void> {
    this.#busyDrafts.add(record.draftId);
    try {
      let current: GmailDraftView;
      try {
        current = await this.gmail.draft(record.draftId);
      } catch (error) {
        // A draft that is gone gets no new card: there is nothing to send.
        const retry = isNotFound(error) ? null : await this.#storeAgain(record);
        this.#tell(record, sourceText("status.messaging.googleSendUnreadable", { subject: record.subject }));
        throw new GoogleApprovalFailedError(sourceText("error.connector.gmailDraftUnreadable"), retry);
      }
      if (draftDigest(current) !== record.digest) {
        const retry = await this.#storeAgain(record, current);
        this.#tell(
          record,
          sourceText(retry ? "status.messaging.googleSendChanged" : "status.messaging.googleSendChangedNoRetry", {
            subject: current.subject,
          }),
        );
        throw new GoogleApprovalFailedError(
          sourceText(retry ? "error.connector.gmailDraftChanged" : "error.connector.gmailDraftChangedNoRetry"),
          retry,
        );
      }
      try {
        await this.gmail.sendDraft(record.draftId);
      } catch (error) {
        const detail = errorDetail(error);
        // Gmail deletes a draft that it sent. A draft that is gone (or that GoAhead cannot see) may
        // have been sent, so no new card is offered: a second send could send the mail twice.
        const stillThere = await this.gmail.draft(record.draftId).then(
          (draft) => draft,
          () => null,
        );
        if (!stillThere) {
          this.#tell(record, sourceText("status.messaging.googleSendUncertain", { subject: record.subject, detail }));
          throw new GoogleApprovalFailedError(sourceText("error.connector.gmailSendUncertain", { detail }), null);
        }
        const retry = await this.#storeAgain(record, stillThere);
        this.#tell(
          record,
          sourceText(retry ? "status.messaging.googleSendError" : "status.messaging.googleSendFailedNoRetry", {
            subject: record.subject,
            detail,
          }),
        );
        throw new GoogleApprovalFailedError(sourceText("error.connector.gmailSendFailed", { detail }), retry);
      }
      this.#tell(record, sourceText("status.messaging.googleSent", { subject: record.subject }));
    } finally {
      this.#busyDrafts.delete(record.draftId);
    }
  }

  /**
   * Each try of one booking sends the same event id and Meet request id. When an earlier try created
   * the event and its answer was lost, Google answers 409 and the event is read: one event, one set
   * of invitations.
   */
  async #book(record: MeetingRecord): Promise<void> {
    const originId = record.originId ?? record.approvalId;
    try {
      const event = await this.calendar.insertMeet({
        title: record.title,
        start: record.start,
        end: record.end,
        timeZone: record.timeZone,
        guests: record.guests,
        description: record.description,
        requestId: originId,
        eventId: calendarEventId(originId),
      });
      this.#tell(
        record,
        sourceText("status.messaging.googleBooked", {
          title: record.title,
          link: event.meetLink ?? sourceText("status.messaging.googleNone"),
        }),
      );
    } catch (error) {
      const detail = errorDetail(error);
      const retry = await this.#storeAgain(record);
      this.#tell(
        record,
        sourceText(retry ? "status.messaging.googleBookError" : "status.messaging.googleBookFailedNoRetry", {
          title: record.title,
          detail,
        }),
      );
      throw new GoogleApprovalFailedError(sourceText("error.connector.calendarBookFailed", { detail }), retry);
    }
  }

  /** The draft text is read from Gmail again: the state file holds no mail body. */
  async #card(record: GoogleApprovalRecord): Promise<GoogleApprovalCard> {
    if (record.kind === "meeting") return meetingCard(record);
    const draft = await this.gmail.draft(record.draftId).then(
      (view) => view,
      () => null,
    );
    return sendCard(record, draft);
  }

  /**
   * The same send or booking as a new approval. A send takes the content of `draft` (read again), so
   * the new card and its hash show the draft as it is now. Null when it cannot be stored.
   */
  async #storeAgain(record: GoogleApprovalRecord, draft?: GmailDraftView): Promise<GoogleApprovalCard | null> {
    const owner = this.#newOwner(record);
    const again: GoogleApprovalRecord =
      record.kind === "meeting"
        ? { ...record, ...owner, originId: record.originId ?? record.approvalId }
        : draft
          ? sendRecord({ kind: "send", ...owner, draftId: record.draftId }, draft)
          : { ...record, ...owner };
    try {
      await this.#state.addApproval(again);
      return again.kind === "send" && draft ? sendCard(again, draft) : await this.#card(again);
    } catch (error) {
      logger.warn("A Google approval could not be stored again.", { cause: toLogValue(error) });
      return null;
    }
  }

  /** A draft that a card shows, or that is being sent, does not change: the person approves what they saw. */
  #refuseOpenDraft(draftId: string): void {
    const open =
      this.#busyDrafts.has(draftId) ||
      this.#state.read().approvals.some((record) => record.kind === "send" && record.draftId === draftId);
    if (open) throw new Error(sourceText("error.connector.gmailDraftAwaitsApproval"));
  }

  #newOwner(owner: GoogleToolOwner) {
    return {
      approvalId: this.#newId(),
      agentId: owner.agentId,
      threadId: owner.threadId,
      turnId: owner.turnId,
      createdAt: new Date(this.#now()).toISOString(),
    };
  }

  /** The agent picked in the Google panel; with no picked agent that exists, `fallback`. */
  #noteAgent(fallback: string): string {
    const picked = this.#connector.mailAgentId();
    return picked && this.#agentExists(picked) ? picked : fallback;
  }

  /** The result as a note in a chat. It starts no turn. A failure here never undoes a send. */
  #tell(record: GoogleApprovalRecord, text: string): void {
    try {
      this.#postInformation(this.#noteAgent(record.agentId), text);
    } catch (error) {
      logger.warn("The Google result could not be posted in the chat.", { cause: toLogValue(error) });
    }
  }
}

/**
 * True when the open send and booking approvals no longer belong to the connected account: Google
 * was disconnected, or another account signed in. `previousEmail` is the account before the change.
 */
export function googleApprovalsEnd(
  previousEmail: string | null,
  status: Pick<GoogleConnectorStatus, "state" | "email">,
): boolean {
  if (status.state === "disconnected") return true;
  return previousEmail !== null && status.email !== null && status.email !== previousEmail;
}

type SendRecord = Extract<GoogleApprovalRecord, { kind: "send" }>;
type MeetingRecord = Extract<GoogleApprovalRecord, { kind: "meeting" }>;

function sendRecord(base: Omit<SendRecord, "to" | "cc" | "subject" | "digest">, draft: GmailDraftView): SendRecord {
  return { ...base, to: draft.to, cc: draft.cc, subject: draft.subject, digest: draftDigest(draft) };
}

/** A hash of everything that the send card shows of a draft. */
function draftDigest(draft: GmailDraftView): string {
  const shown = [draft.to, draft.cc, draft.bcc, draft.subject, draft.body, draft.attachments];
  return createHash("sha256").update(JSON.stringify(shown)).digest("hex");
}

/** A Calendar event id from the origin of a booking: hex digits are valid base32hex. */
export function calendarEventId(originId: string): string {
  return createHash("sha256").update(`goahead-meeting:${originId}`).digest("hex");
}

function isNotFound(error: unknown): boolean {
  return error instanceof GoogleApiError && error.status === 404;
}

function errorDetail(error: unknown): string {
  return redactText(error instanceof Error ? error.message : String(error));
}

function cardOwner(record: GoogleApprovalRecord): GoogleToolOwner & Pick<GoogleApprovalCard, "approvalId" | "kind"> {
  return {
    approvalId: record.approvalId,
    kind: record.kind,
    agentId: record.agentId,
    threadId: record.threadId,
    turnId: record.turnId,
  };
}

/** A card can be allowed only when it shows the whole request. */
function completeCard(card: Omit<GoogleApprovalCard, "complete">, readable: boolean): GoogleApprovalCard {
  return { ...card, complete: readable && localApprovalText(card).length <= INPUT_LIMITS.messageText };
}

/** The send card. With no draft (unreadable), it shows what the record holds and cannot be allowed. */
function sendCard(record: SendRecord, draft: GmailDraftView | null): GoogleApprovalCard {
  const none = sourceText("status.messaging.googleNone");
  const unknown = sourceText("status.messaging.googleUnknown");
  const list = (values: string[]) => values.join(", ") || none;
  return completeCard(
    {
      ...cardOwner(record),
      detail: sourceText("status.messaging.googleSendDetail", {
        to: list(draft?.to ?? record.to),
        cc: list(draft?.cc ?? record.cc),
        bcc: draft ? list(draft.bcc) : unknown,
        attachments: draft ? list(draft.attachments) : unknown,
        subject: draft?.subject ?? record.subject,
        body: draft?.body ?? sourceText("status.messaging.googleDraftUnreadable"),
      }),
    },
    draft !== null,
  );
}

function meetingCard(record: MeetingRecord): GoogleApprovalCard {
  return completeCard(
    {
      ...cardOwner(record),
      detail: sourceText("status.messaging.googleMeetingDetail", {
        title: record.title,
        start: localTime(record.start, record.timeZone),
        end: localTime(record.end, record.timeZone),
        timeZone: record.timeZone,
        guests: record.guests.join(", "),
        description: record.description,
      }),
    },
    true,
  );
}

/** An ISO time as the person reads it in `timeZone`, such as "Tue, 20 Oct 2026, 11:00". */
function localTime(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
