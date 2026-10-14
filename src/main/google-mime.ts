// Gmail messages as GoAhead reads and writes them: the plain text of a message (HTML converted),
// the attachment names, calendar invites, and a new plain-text message for a draft.

import { sourceText } from "@openbot/i18n/source";
import { z } from "zod";

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  mimeType?: string | undefined;
  filename?: string | undefined;
  headers?: GmailHeader[] | undefined;
  body?: { data?: string | undefined; attachmentId?: string | undefined; size?: number | undefined } | undefined;
  parts?: GmailPart[] | undefined;
}

export const gmailPartSchema: z.ZodType<GmailPart> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
    body: z
      .object({ data: z.string().optional(), attachmentId: z.string().optional(), size: z.number().optional() })
      .optional(),
    parts: z.array(gmailPartSchema).optional(),
  }),
);

export function headerValue(part: GmailPart, name: string): string {
  const wanted = name.toLowerCase();
  return part.headers?.find((header) => header.name.toLowerCase() === wanted)?.value ?? "";
}

function decode(data: string | undefined): string {
  return data ? Buffer.from(data, "base64url").toString("utf8") : "";
}

function walk(part: GmailPart, visit: (part: GmailPart) => void): void {
  visit(part);
  for (const child of part.parts ?? []) walk(child, visit);
}

/** The readable text of a message: the first plain part, else the first HTML part as text. */
export function messageText(payload: GmailPart): { text: string; attachments: string[] } {
  let plain = "";
  let html = "";
  const attachments: string[] = [];
  walk(payload, (part) => {
    if (part.filename) {
      attachments.push(part.filename);
      return;
    }
    if (part.mimeType === "text/plain" && !plain) plain = decode(part.body?.data);
    if (part.mimeType === "text/html" && !html) html = decode(part.body?.data);
  });
  return { text: (plain || htmlToText(html)).trim(), attachments };
}

export function hasCalendarInvite(payload: GmailPart): boolean {
  let found = false;
  walk(payload, (part) => {
    if (part.mimeType === "text/calendar" || part.filename?.toLowerCase().endsWith(".ics")) found = true;
  });
  return found;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

/** Enough HTML to text for a model to read a mail. Scripts and styles are dropped. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/giu, "")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/giu, "\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/gu, (_match, name: string) => ENTITIES[name] ?? "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/** `Alice <alice@example.com>` is `alice@example.com`. */
export function addressOf(value: string): string {
  return (/<([^>]+)>/u.exec(value)?.[1] ?? value).trim();
}

export function splitAddresses(value: string): string[] {
  return value
    .split(",")
    .map((part) => addressOf(part))
    .filter(Boolean);
}

export interface RawMessageInput {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  /** The `Message-ID` of the mail this one answers. */
  inReplyTo: string | null;
  references: string | null;
}

/** One address only, with no space, comma or angle bracket: nothing can start a second header. */
const ADDRESS_PATTERN = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/u;

export function isEmailAddress(value: string): boolean {
  return ADDRESS_PATTERN.test(value);
}

/**
 * A plain-text RFC 2822 message, base64url, as Gmail's `drafts.create` takes it. The text comes
 * from a model that reads other people's mail, so a value that could add a header is refused.
 */
export function buildRawMessage(input: RawMessageInput): string {
  if (input.to.length === 0) throw new Error(sourceText("error.connector.gmailNoRecipient"));
  for (const address of [...input.to, ...input.cc]) {
    if (!isEmailAddress(address)) throw new Error(sourceText("error.connector.gmailBadAddress", { address }));
  }
  for (const value of [input.subject, input.inReplyTo ?? "", input.references ?? ""]) {
    if (/[\r\n]/u.test(value)) throw new Error(sourceText("error.connector.gmailBadHeader"));
  }
  const headers = [
    `To: ${input.to.join(", ")}`,
    ...(input.cc.length > 0 ? [`Cc: ${input.cc.join(", ")}`] : []),
    `Subject: ${encodeHeader(input.subject)}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${input.inReplyTo}`] : []),
    ...(input.references ? [`References: ${input.references}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  const body = Buffer.from(input.body, "utf8").toString("base64").replace(/.{76}/gu, "$&\r\n");
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${body}`, "utf8").toString("base64url");
}

/** RFC 2047 for a subject with characters outside printable ASCII. */
function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/u.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}
