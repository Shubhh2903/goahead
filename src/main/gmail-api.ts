// Gmail v1 REST calls, through `GoogleApiClient` (token, backoff, 401).
// https://developers.google.com/gmail/api/reference/rest

import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { z } from "zod";
import type { GmailDraftReceipt, GmailMailText } from "../backend/messaging/google-tools";
import { type GoogleApiClient, GoogleApiError } from "./google-api";
import { gmailPartSchema, hasCalendarInvite, headerValue, messageText, splitAddresses } from "./google-mime";

/** The most text of one mail that a tool result carries. */
export const GMAIL_TEXT_LIMIT = 20_000;
const HISTORY_PAGE_LIMIT = 5;
const logger = createOpenBotLogger("gmail-api");
/** Labels that `modify` never adds: GoAhead does not delete, trash or mark mail as spam. */
const FORBIDDEN_LABELS = new Set(["TRASH", "SPAM"]);
const METADATA_HEADERS = ["From", "To", "Cc", "Subject", "Date", "Message-ID", "References", "Reply-To"];

const messageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).optional(),
  snippet: z.string().optional(),
  payload: gmailPartSchema.optional(),
});
const listSchema = z.object({ messages: z.array(z.object({ id: z.string(), threadId: z.string() })).optional() });
const threadSchema = z.object({ id: z.string(), messages: z.array(messageSchema).optional() });
const modifySchema = z.object({ id: z.string(), labelIds: z.array(z.string()).optional() });
const draftSchema = z.object({ id: z.string(), message: messageSchema });
const sentSchema = z.object({ id: z.string(), threadId: z.string() });
const profileSchema = z.object({ emailAddress: z.string(), historyId: z.string() });
const historySchema = z.object({
  historyId: z.string(),
  nextPageToken: z.string().optional(),
  history: z
    .array(
      z.object({
        messagesAdded: z
          .array(
            z.object({
              message: z.object({ id: z.string(), threadId: z.string(), labelIds: z.array(z.string()).optional() }),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

export interface GmailMessageView extends GmailMailText {
  messageIdHeader: string;
  references: string;
  replyTo: string;
  /** A `text/calendar` part or an `.ics` file. False for a metadata read, which has no parts. */
  invite: boolean;
}

export interface GmailDraftView {
  draftId: string;
  messageId: string;
  threadId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  /** The file names of the attachments. */
  attachments: string[];
}

export type GmailHistoryPage =
  | { status: "expired" }
  | { status: "ok"; historyId: string; added: Array<{ id: string; threadId: string; labelIds: string[] }> };

export class GmailApi {
  readonly #api: GoogleApiClient;
  readonly #base: string;

  constructor(api: GoogleApiClient, baseUrl: string) {
    this.#api = api;
    this.#base = `${baseUrl}/users/me`;
  }

  async profile(): Promise<{ email: string; historyId: string }> {
    const answer = await this.#api.json(`${this.#base}/profile`, profileSchema);
    return { email: answer.emailAddress, historyId: answer.historyId };
  }

  async search(query: string, limit: number): Promise<GmailMessageView[]> {
    const params = new URLSearchParams({ q: query, maxResults: String(limit) });
    const list = await this.#api.json(`${this.#base}/messages?${params}`, listSchema);
    return Promise.all((list.messages ?? []).map((hit) => this.summary(hit.id)));
  }

  /** Headers, labels and snippet only. */
  async summary(id: string): Promise<GmailMessageView> {
    const params = new URLSearchParams({ format: "metadata" });
    for (const header of METADATA_HEADERS) params.append("metadataHeaders", header);
    return view(
      await this.#api.json(`${this.#base}/messages/${encodeURIComponent(id)}?${params}`, messageSchema),
      false,
    );
  }

  async message(id: string): Promise<GmailMessageView> {
    return view(
      await this.#api.json(`${this.#base}/messages/${encodeURIComponent(id)}?format=full`, messageSchema),
      true,
    );
  }

  async thread(id: string): Promise<GmailMessageView[]> {
    const thread = await this.#api.json(`${this.#base}/threads/${encodeURIComponent(id)}?format=full`, threadSchema);
    return (thread.messages ?? []).map((message) => view(message, true));
  }

  /** Every caller reaches Gmail here, so the trash refusal is here too, not only in the tool. */
  async modify(id: string, change: { add: string[]; remove: string[] }): Promise<{ id: string; labelIds: string[] }> {
    if (change.add.some((label) => FORBIDDEN_LABELS.has(label.toUpperCase())))
      throw new Error(sourceText("error.connector.gmailNoTrash"));
    const answer = await this.#api.json(`${this.#base}/messages/${encodeURIComponent(id)}/modify`, modifySchema, {
      method: "POST",
      body: { addLabelIds: change.add, removeLabelIds: change.remove },
    });
    return { id: answer.id, labelIds: answer.labelIds ?? [] };
  }

  async saveDraft(input: { draftId: string | null; threadId: string | null; raw: string }): Promise<GmailDraftReceipt> {
    const body = {
      ...(input.draftId ? { id: input.draftId } : {}),
      message: { raw: input.raw, ...(input.threadId ? { threadId: input.threadId } : {}) },
    };
    const answer = input.draftId
      ? await this.#api.json(`${this.#base}/drafts/${encodeURIComponent(input.draftId)}`, draftSchema, {
          method: "PUT",
          body,
        })
      : await this.#api.json(`${this.#base}/drafts`, draftSchema, { method: "POST", body });
    return { draftId: answer.id, messageId: answer.message.id, threadId: answer.message.threadId };
  }

  /** The draft as Gmail stores it: what the approval card shows (Task 6). */
  async draft(draftId: string): Promise<GmailDraftView> {
    const answer = await this.#api.json(`${this.#base}/drafts/${encodeURIComponent(draftId)}?format=full`, draftSchema);
    const payload = answer.message.payload ?? {};
    const content = messageText(payload);
    return {
      draftId: answer.id,
      messageId: answer.message.id,
      threadId: answer.message.threadId,
      to: splitAddresses(headerValue(payload, "To")),
      cc: splitAddresses(headerValue(payload, "Cc")),
      bcc: splitAddresses(headerValue(payload, "Bcc")),
      subject: headerValue(payload, "Subject"),
      body: content.text,
      attachments: content.attachments,
    };
  }

  /** Sends a stored draft (Task 6, after approval). */
  sendDraft(draftId: string): Promise<{ id: string; threadId: string }> {
    return this.#api.json(`${this.#base}/drafts/send`, sentSchema, { method: "POST", body: { id: draftId } });
  }

  /** New INBOX messages since `startHistoryId`. `expired` when Google no longer has that history (404). */
  async history(startHistoryId: string): Promise<GmailHistoryPage> {
    const added: Array<{ id: string; threadId: string; labelIds: string[] }> = [];
    let historyId = startHistoryId;
    let pageToken: string | undefined;
    for (let page = 0; page < HISTORY_PAGE_LIMIT; page += 1) {
      const params = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded", labelId: "INBOX" });
      if (pageToken) params.set("pageToken", pageToken);
      let answer: z.infer<typeof historySchema>;
      try {
        answer = await this.#api.json(`${this.#base}/history?${params}`, historySchema);
      } catch (error) {
        if (error instanceof GoogleApiError && error.status === 404) return { status: "expired" };
        throw error;
      }
      historyId = answer.historyId;
      for (const record of answer.history ?? []) {
        for (const item of record.messagesAdded ?? []) {
          added.push({ id: item.message.id, threadId: item.message.threadId, labelIds: item.message.labelIds ?? [] });
        }
      }
      pageToken = answer.nextPageToken;
      if (!pageToken) break;
    }
    if (pageToken) {
      // The history position moves past the pages that were not read: their new mail is not triaged.
      logger.warn("The Gmail history has more pages than one poll reads. The mail on the other pages is not triaged.", {
        pagesRead: HISTORY_PAGE_LIMIT,
      });
    }
    return { status: "ok", historyId, added };
  }
}

function view(message: z.infer<typeof messageSchema>, withText: boolean): GmailMessageView {
  const payload = message.payload ?? {};
  const body = withText ? messageText(payload) : { text: "", attachments: [] };
  return {
    id: message.id,
    threadId: message.threadId,
    from: headerValue(payload, "From"),
    to: headerValue(payload, "To"),
    cc: headerValue(payload, "Cc"),
    subject: headerValue(payload, "Subject"),
    date: headerValue(payload, "Date"),
    snippet: message.snippet ?? "",
    labelIds: message.labelIds ?? [],
    text: body.text.slice(0, GMAIL_TEXT_LIMIT),
    attachments: body.attachments,
    messageIdHeader: headerValue(payload, "Message-ID"),
    references: headerValue(payload, "References"),
    replyTo: headerValue(payload, "Reply-To"),
    invite: hasCalendarInvite(payload),
  };
}
