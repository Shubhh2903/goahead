import { sourceText } from "@openbot/i18n/source";
import { describe, expect, it, vi } from "vitest";
import type { GoogleTriageMail, GoogleTriageOutcome, GoogleTriageRun } from "../backend/messaging/google-triage";
import { createGoogleMailTriage } from "./google-mail-triage";
import { GoogleNotices } from "./google-notices";

const MAILS: GoogleTriageMail[] = [
  {
    id: "m1",
    threadId: "t1",
    from: "Alice <alice@example.com>",
    subject: "Contract",
    date: "",
    snippet: "",
    signals: ["important"],
  },
  {
    id: "m2",
    threadId: "t2",
    from: "Bob <bob@example.com>",
    subject: "Sync on Friday?",
    date: "",
    snippet: "",
    signals: ["invite"],
  },
];

function triageWith(
  runTriage: (input: GoogleTriageRun) => Promise<GoogleTriageOutcome>,
  mailAgentId: string | null = "assistant",
  agentIds: readonly string[] = ["assistant"],
) {
  const notices = new GoogleNotices();
  const postInformation = vi.fn((_agentId: string, _text: string) => undefined);
  const triage = createGoogleMailTriage({
    mailAgentId: () => mailAgentId,
    agentExists: (agentId) => agentIds.includes(agentId),
    notices,
    postInformation,
    gmail: {
      read: async () => {
        throw new Error("not used");
      },
      organize: async ({ messageId }) => ({ id: messageId, labelIds: [] }),
    },
    runTriage,
  });
  return { triage, notices, postInformation };
}

describe("createGoogleMailTriage", () => {
  it("falls back to Gmail's signals when the triage session is not available", async () => {
    const { triage, notices, postInformation } = triageWith(async () => ({
      status: "unavailable",
      reason: "no Claude",
      notified: [],
    }));

    expect(await triage(MAILS)).toBe(true);

    expect(notices.list().map((notice) => [notice.gmailMessageId, notice.kind, notice.summary])).toEqual([
      ["m2", "meeting", ""],
      ["m1", "important", ""],
    ]);
    expect(postInformation).toHaveBeenCalledWith(
      "assistant",
      sourceText("status.messaging.googleImportantMail", { from: "Alice <alice@example.com>", subject: "Contract" }),
    );
  });

  it("uses the session's notices, adds no fallback for a mail it already notified, and runs nothing without a mail agent", async () => {
    const { triage, notices } = triageWith(async ({ port }) => {
      await port.notify({ messageId: "m1", kind: "important", summary: "Alice sent the signed contract." });
      return { status: "unavailable", reason: "error_max_turns", notified: ["m1"] };
    });
    await triage(MAILS);
    // The session's notice goes to the agent picked in the panel, which the card opens.
    expect(notices.list().map((notice) => [notice.gmailMessageId, notice.summary, notice.agentId])).toEqual([
      ["m2", "", "assistant"],
      ["m1", "Alice sent the signed contract.", "assistant"],
    ]);

    const run = vi.fn(async (): Promise<GoogleTriageOutcome> => ({ status: "done", notified: [] }));
    const none = triageWith(run, null);
    expect(await none.triage(MAILS)).toBe(false);
    expect(run).not.toHaveBeenCalled();

    // An agent that was deleted after it was picked handles no mail.
    const deleted = triageWith(run, "assistant", ["builder"]);
    expect(await deleted.triage(MAILS)).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(deleted.notices.list()).toEqual([]);
  });

  it("a triage that the watcher stops shows no notice and posts no note, also not the fallback", async () => {
    const stop = new AbortController();
    const seen: { signal: AbortSignal | undefined } = { signal: undefined };
    const { triage, notices, postInformation } = triageWith(async ({ port, signal }) => {
      seen.signal = signal;
      stop.abort();
      await expect(port.notify({ messageId: "m1", kind: "important", summary: "Late." })).rejects.toThrow();
      return { status: "unavailable", reason: "aborted", notified: [] };
    });

    await triage(MAILS, stop.signal);

    expect(seen.signal).toBe(stop.signal);
    expect(notices.list()).toEqual([]);
    expect(postInformation).not.toHaveBeenCalled();
  });
});
