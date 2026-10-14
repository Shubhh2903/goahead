import { isBoolean, isDynamicRecord, isString } from "./runtime-values";

/**
 * The built-in Gmail and Google Calendar connection of this computer. One Google account. The
 * tokens never cross to the renderer.
 *
 * - `disconnected`: no sign-in is stored.
 * - `pending`: the browser shows Google's consent page.
 * - `connected`: the mail agents can use Gmail and Google Calendar.
 * - `reauth-required`: Google refused the stored sign-in, or the file cannot be read. Every call stops.
 */
export type GoogleConnectorState = "disconnected" | "pending" | "connected" | "reauth-required";

function isGoogleConnectorState(value: unknown): value is GoogleConnectorState {
  return value === "disconnected" || value === "pending" || value === "connected" || value === "reauth-required";
}

export interface GoogleConnectorStatus {
  /** False when this build has no Google OAuth client, or no loopback listener. */
  available: boolean;
  state: GoogleConnectorState;
  email: string | null;
  /**
   * The agent picked in the panel ("Agent that handles mail"). It gets the mail notices and is one of
   * the mail agents. It stays when Google is disconnected.
   */
  mailAgentId: string | null;
  /** The last failure, as a sentence. Null after a success or a cancel. */
  error: string | null;
}

export const DISCONNECTED_GOOGLE_CONNECTOR: GoogleConnectorStatus = {
  available: false,
  state: "disconnected",
  email: null,
  mailAgentId: null,
  error: null,
};

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

/** Returns null for a value that is not a connector status in the desktop shape. */
export function parseGoogleConnectorStatus(value: unknown): GoogleConnectorStatus | null {
  if (
    !isDynamicRecord(value) ||
    !isBoolean(value.available) ||
    !isGoogleConnectorState(value.state) ||
    !isNullableString(value.email) ||
    !isNullableString(value.mailAgentId) ||
    !isNullableString(value.error)
  ) {
    return null;
  }
  return {
    available: value.available,
    state: value.state,
    email: value.email,
    mailAgentId: value.mailAgentId,
    error: value.error,
  };
}

export type GoogleMailNoticeKind = "important" | "meeting";

/**
 * One mail that the user must see. `from` and `subject` come from Gmail, not from a model.
 * `summary` is empty for a notice from Gmail's signals only. Local only: never on the Team API.
 */
export interface GoogleMailNotice {
  noticeId: string;
  /** The agent that handles mail. */
  agentId: string;
  kind: GoogleMailNoticeKind;
  from: string;
  subject: string;
  summary: string;
  gmailMessageId: string;
  createdAt: string;
}

/** The item type of a mail note from GoAhead in an agent's chat. It starts no turn. */
export const GOOGLE_MAIL_NOTICE_ITEM_TYPE = "google-mail-notice";

function isGoogleMailNotice(value: unknown): value is GoogleMailNotice {
  return (
    isDynamicRecord(value) &&
    isString(value.noticeId) &&
    isString(value.agentId) &&
    (value.kind === "important" || value.kind === "meeting") &&
    isString(value.from) &&
    isString(value.subject) &&
    isString(value.summary) &&
    isString(value.gmailMessageId) &&
    isString(value.createdAt)
  );
}

/** Returns null for a value that is not a notice list in the desktop shape. */
export function parseGoogleMailNotices(value: unknown): GoogleMailNotice[] | null {
  if (!Array.isArray(value) || value.length > 50 || !value.every(isGoogleMailNotice)) return null;
  return value.map((notice) => ({ ...notice }));
}
