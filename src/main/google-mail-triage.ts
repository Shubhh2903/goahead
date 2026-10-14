// One batch of new mail. The restricted triage session decides what the user must see; when it
// cannot run, Gmail's own signals decide (sender and subject, no summary). Each notice shows the
// island card and the macOS notification (`GoogleNotices`), and a note in the chat of the agent that
// handles mail. The note is a system message: it starts no turn and reaches no provider.

import type { GoogleMailNotice } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import type { ClaudeCliInfo } from "../backend/cli";
import type { GmailMailText } from "../backend/messaging/google-tools";
import {
  type GoogleTriageMail,
  type GoogleTriageOutcome,
  type GoogleTriageRun,
  runGoogleTriage,
} from "../backend/messaging/google-triage";
import type { GoogleNotices } from "./google-notices";

const logger = createOpenBotLogger("google-mail-triage");

export interface GoogleMailTriageOptions {
  /** The agent picked in the Google panel. With none, the batch is not triaged and not kept. */
  mailAgentId: () => string | null;
  /** False for an agent that was deleted after it was picked: then no agent handles mail. */
  agentExists: (agentId: string) => boolean;
  notices: Pick<GoogleNotices, "add">;
  postInformation: (agentId: string, text: string) => void;
  gmail: {
    read(messageId: string): Promise<GmailMailText>;
    organize(input: {
      messageId: string;
      add: string[];
      remove: string[];
    }): Promise<{ id: string; labelIds: string[] }>;
  };
  /** The Claude CLI of this computer, with the bundled one as a candidate. */
  resolveCli?: () => Promise<ClaudeCliInfo>;
  runTriage?: (input: GoogleTriageRun) => Promise<GoogleTriageOutcome>;
}

/** The chat note of one notice. */
export function googleNoticeText(notice: GoogleMailNotice): string {
  const line =
    notice.kind === "meeting"
      ? sourceText("status.messaging.googleMeetingRequest", { from: notice.from, subject: notice.subject })
      : sourceText("status.messaging.googleImportantMail", { from: notice.from, subject: notice.subject });
  return notice.summary ? `${line}\n${notice.summary}` : line;
}

export function createGoogleMailTriage(
  options: GoogleMailTriageOptions,
): (mails: GoogleTriageMail[], signal?: AbortSignal) => Promise<boolean> {
  const runTriage = options.runTriage ?? runGoogleTriage;
  return async (mails, signal) => {
    const agentId = options.mailAgentId();
    if (!agentId || !options.agentExists(agentId)) return false;
    const byId = new Map(mails.map((mail) => [mail.id, mail]));
    const show = (mail: GoogleTriageMail, kind: "important" | "meeting", summary: string) => {
      // The watcher stopped (GoAhead quits, or Google was disconnected): no late card or note.
      if (signal?.aborted) throw new Error("The mail triage stopped.");
      const notice = options.notices.add({
        agentId,
        kind,
        from: mail.from,
        subject: mail.subject,
        summary,
        gmailMessageId: mail.id,
      });
      try {
        options.postInformation(agentId, googleNoticeText(notice));
      } catch {
        // The agent may be gone; the card and the notification still show the mail.
      }
      return { noticeId: notice.noticeId };
    };
    const outcome = await runTriage({
      mails,
      ...(options.resolveCli ? { resolveCli: options.resolveCli } : {}),
      ...(signal ? { signal } : {}),
      port: {
        read: (messageId) => options.gmail.read(messageId),
        organize: (input) => options.gmail.organize(input),
        notify: async ({ messageId, kind, summary }) => {
          const mail = byId.get(messageId);
          if (!mail) throw new Error("This mail is not in the batch.");
          return show(mail, kind, summary);
        },
      },
    });
    if (signal?.aborted) return true;
    if (outcome.status === "unavailable") {
      // The reason is already redacted. It holds no mail text.
      logger.info("The mail triage used Gmail's signals only.", {
        reason: outcome.reason,
        notified: outcome.notified.length,
        mails: mails.length,
      });
      const done = new Set(outcome.notified);
      for (const mail of mails) {
        if (!done.has(mail.id)) show(mail, mail.signals.includes("invite") ? "meeting" : "important", "");
      }
    }
    return true;
  };
}
