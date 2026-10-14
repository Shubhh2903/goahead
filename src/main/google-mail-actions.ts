// The buttons of the Dynamic Island mail card. "Draft reply" and "Book meeting" send the agent that handles mail a
// local-owner message, as if the person typed it, because the person pressed the button on this
// computer. The text names only the Gmail id: the sender and subject are other people's words, and
// a local-owner turn has the full tool set.

import type { DynamicIslandMailAction } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { GoogleNotices } from "./google-notices";

export interface GoogleMailActionTarget {
  notices: Pick<GoogleNotices, "take">;
  sendLocalOwnerMessage: (input: { agentId: string; text: string }) => Promise<unknown>;
}

/**
 * Throws for a notice this process did not make, or one that was already used: nothing is sent, and
 * the island shows the error instead of opening the agent. A second dismissal of a gone card is no error.
 */
export async function performGoogleMailAction(
  action: DynamicIslandMailAction,
  target: GoogleMailActionTarget,
): Promise<void> {
  const notice = target.notices.take(action.noticeId);
  if (!notice && action.action === "dismiss") return;
  if (!notice || notice.agentId !== action.agentId) throw new Error(sourceText("error.connector.googleMailNoticeGone"));
  if (action.action === "draft-reply") {
    await target.sendLocalOwnerMessage({
      agentId: notice.agentId,
      text: `Draft a reply to the Gmail message ${notice.gmailMessageId}. Read it with gmail_read first, then save the reply with gmail_draft. Do not send it.`,
    });
  }
  if (action.action === "book-meeting") {
    await target.sendLocalOwnerMessage({
      agentId: notice.agentId,
      text: `Book a meeting for the Gmail message ${notice.gmailMessageId}. Read it with gmail_read, find a free time with calendar_find_times, then propose the meeting with calendar_propose_meeting. I approve it in GoAhead before anything is created.`,
    });
  }
}
