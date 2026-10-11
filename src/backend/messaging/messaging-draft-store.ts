import { type DynamicRecord, isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { databaseRows, optionalStringColumn, requiredStringColumn } from "../database/database-rows";
import type { OpenBotDatabase } from "../openbot-database";
import type { SlackSendTarget } from "./messaging-send-tool";
import type { MessageSender, MessageTarget } from "./messaging-types";

/** A message an agent drafted. It is sent once the connected person approves it. */
export interface SendDraft {
  draftId: string;
  linkId: string;
  agentId: string;
  to: SlackSendTarget;
  text: string;
  threadKey: string | null;
  sender: MessageSender;
  /** For the desktop card: who gets it, by name, and who asked. */
  recipient: string;
  requestedBy: string | null;
  /**
   * Someone other than the connected person asked for it: it goes out as the GoAhead app, and its
   * first line names them, so nobody reads it as the person's own words.
   */
  onBehalfOf: string | null;
  createdAt: string;
}

/** A waiting draft with its Slack post: where it is, its button tokens, and who may press. */
export interface StoredDraft {
  connectionId: string;
  acceptToken: string;
  declineToken: string;
  target: MessageTarget;
  messageId: string | null;
  allowedUserId: string;
  postText: string;
  draft: SendDraft;
}

const SEND_TARGET_KINDS = ["user", "channel", "group"] as const;
const SENDERS = ["user", "bot"] as const;

/**
 * Owns `projection_messaging_drafts`: the drafts that wait for approval, so that they survive a
 * restart. Rows hold external text, so they are written directly and never go to the event log.
 * It never imports the database facade's callers.
 */
export class MessagingDraftStore {
  readonly #database: OpenBotDatabase;

  constructor(database: OpenBotDatabase) {
    this.#database = database;
  }

  add(stored: StoredDraft): void {
    this.#database.connection
      .prepare(
        `INSERT INTO projection_messaging_drafts
           (draft_id, connection_id, link_id, accept_token, decline_token, target_json, message_id,
            allowed_user_id, post_text, draft_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        stored.draft.draftId,
        stored.connectionId,
        stored.draft.linkId,
        stored.acceptToken,
        stored.declineToken,
        JSON.stringify(stored.target),
        stored.messageId,
        stored.allowedUserId,
        stored.postText,
        JSON.stringify(stored.draft),
        stored.draft.createdAt,
      );
  }

  /** Slack answered the post: a draft loaded after a restart edits this message. */
  setMessageId(draftId: string, messageId: string): void {
    this.#database.connection
      .prepare("UPDATE projection_messaging_drafts SET message_id = ? WHERE draft_id = ?")
      .run(messageId, draftId);
  }

  /**
   * Takes the draft for one answer. Only the first call gets true: the row is gone after it, so an
   * approval after a restart, or a second press, cannot send the draft again.
   */
  claim(draftId: string): boolean {
    const result = this.#database.connection
      .prepare("DELETE FROM projection_messaging_drafts WHERE draft_id = ?")
      .run(draftId);
    return Number(result.changes) > 0;
  }

  /** Every waiting draft, oldest first. A row this build cannot read is skipped, not an error. */
  all(): StoredDraft[] {
    return databaseRows(
      this.#database.connection
        .prepare("SELECT * FROM projection_messaging_drafts ORDER BY created_at, draft_id")
        .all(),
    ).flatMap(decodeStoredDraft);
  }
}

function decodeStoredDraft(row: DynamicRecord): StoredDraft[] {
  // Both columns hold valid JSON: the table checks it.
  const target = decodeMessageTarget(JSON.parse(requiredStringColumn(row, "target_json")));
  const draft = decodeSendDraft(JSON.parse(requiredStringColumn(row, "draft_json")));
  if (!target || !draft) return [];
  return [
    {
      connectionId: requiredStringColumn(row, "connection_id"),
      acceptToken: requiredStringColumn(row, "accept_token"),
      declineToken: requiredStringColumn(row, "decline_token"),
      target,
      messageId: optionalStringColumn(row, "message_id"),
      allowedUserId: requiredStringColumn(row, "allowed_user_id"),
      postText: requiredStringColumn(row, "post_text"),
      draft,
    },
  ];
}

function decodeMessageTarget(value: unknown): MessageTarget | null {
  if (!isDynamicRecord(value) || !isString(value.platformChannelId) || !isNullableString(value.replyThreadId))
    return null;
  return { platformChannelId: value.platformChannelId, replyThreadId: value.replyThreadId };
}

function decodeSendDraft(value: unknown): SendDraft | null {
  if (
    !isDynamicRecord(value) ||
    !isString(value.draftId) ||
    !isString(value.linkId) ||
    !isString(value.agentId) ||
    !isDynamicRecord(value.to) ||
    !isOneOf(SEND_TARGET_KINDS, value.to.kind) ||
    !isString(value.to.id) ||
    !isString(value.text) ||
    !isNullableString(value.threadKey) ||
    !isOneOf(SENDERS, value.sender) ||
    !isString(value.recipient) ||
    !isNullableString(value.requestedBy) ||
    !isNullableString(value.onBehalfOf) ||
    !isString(value.createdAt)
  )
    return null;
  return {
    draftId: value.draftId,
    linkId: value.linkId,
    agentId: value.agentId,
    to: { kind: value.to.kind, id: value.to.id },
    text: value.text,
    threadKey: value.threadKey,
    sender: value.sender,
    recipient: value.recipient,
    requestedBy: value.requestedBy,
    onBehalfOf: value.onBehalfOf,
    createdAt: value.createdAt,
  };
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}
