import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { sourceText } from "@openbot/i18n/source";
import { afterEach, describe, expect, it } from "vitest";
import { GoogleApprovalFailedError } from "../backend/messaging/google-tools";
import { GmailApi } from "./gmail-api";
import { GoogleApiClient } from "./google-api";
import { freeSlots, GoogleCalendarApi } from "./google-calendar";
import { googleEndpoints } from "./google-connector-config";
import { googleNoticeText } from "./google-mail-triage";
import { buildRawMessage } from "./google-mime";
import { GoogleNotices } from "./google-notices";
import { type FakeGoogleServer, startFakeGoogleServer } from "./google-test-server";
import { GoogleWatcherStateStore } from "./google-watcher-state";
import { DesktopGoogleWorkspace, googleApprovalsEnd } from "./google-workspace";

/** An API client whose fetch answers every request with `body`, and counts the requests. */
function clientAnswering(body: unknown) {
  const urls: string[] = [];
  const api = new GoogleApiClient({
    tokens: { accessToken: async () => "token", renewAccessToken: async () => "token" },
    onReauthRequired: () => undefined,
    fetch: async (url) => {
      urls.push(url);
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  return { api, urls };
}

describe("GoogleCalendarApi.busy", () => {
  it("an all-day event blocks the whole local day in the user's time zone, and not the day before", async () => {
    const timeZone = "Asia/Kolkata";
    const { api } = clientAnswering({
      items: [{ start: { date: "2026-10-15" }, end: { date: "2026-10-16" } }],
    });
    const calendar = new GoogleCalendarApi(api, "https://calendar.test");
    // 14 October 00:00 to 16 October 00:00, India time.
    const from = Date.parse("2026-10-13T18:30:00Z");
    const to = Date.parse("2026-10-15T18:30:00Z");

    const busy = await calendar.busy(from, to, timeZone);
    const slots = freeSlots({ from, to, durationMinutes: 30, busy, timeZone });

    expect(busy).toEqual([{ start: Date.parse("2026-10-14T18:30:00Z"), end: Date.parse("2026-10-15T18:30:00Z") }]);
    // 14 October 09:00 to 18:00 India time is free; 15 October has no slot.
    expect(slots).toEqual([{ start: "2026-10-14T03:30:00.000Z", end: "2026-10-14T12:30:00.000Z" }]);
  });
});

describe("freeSlots", () => {
  it("offers working hours from Monday to Friday only", () => {
    // Friday 16 October to Tuesday 20 October 2026, UTC: the weekend has no slot.
    const slots = freeSlots({
      from: Date.parse("2026-10-16T00:00:00Z"),
      to: Date.parse("2026-10-20T00:00:00Z"),
      durationMinutes: 30,
      busy: [],
      timeZone: "UTC",
    });

    expect(slots).toEqual([
      { start: "2026-10-16T09:00:00.000Z", end: "2026-10-16T18:00:00.000Z" },
      { start: "2026-10-19T09:00:00.000Z", end: "2026-10-19T18:00:00.000Z" },
    ]);
  });
});

describe("GmailApi.modify", () => {
  it("never trashes or marks spam, in any letter case, and sends no request", async () => {
    const { api, urls } = clientAnswering({ id: "m1", labelIds: [] });
    const gmail = new GmailApi(api, "https://gmail.test");

    for (const label of ["TRASH", "Spam"]) {
      await expect(gmail.modify("m1", { add: [label], remove: [] })).rejects.toThrow(
        sourceText("error.connector.gmailNoTrash"),
      );
    }
    expect(urls).toEqual([]);
  });
});

describe("DesktopGoogleWorkspace.notify", () => {
  const MAIL = {
    id: "m1",
    threadId: "t1",
    payload: {
      headers: [
        { name: "From", value: "Alice <alice@example.com>" },
        { name: "Subject", value: "Contract" },
      ],
    },
  };

  function workspaceFor(picked: string | null, agentIds: readonly string[]) {
    const { api } = clientAnswering(MAIL);
    const notices = new GoogleNotices();
    const notes: Array<{ agentId: string; text: string }> = [];
    const workspace = new DesktopGoogleWorkspace({
      connector: { connected: () => true, mailAgentId: () => picked, api, endpoints: googleEndpoints(null) },
      notices,
      agentExists: (agentId) => agentIds.includes(agentId),
      postInformation: (agentId, text) => notes.push({ agentId, text }),
      state: new GoogleWatcherStateStore(join(tmpdir(), "goahead-unused-google-state.json")),
    });
    return { workspace, notices, notes };
  }

  it("a notice from the Slack orchestrator's turn opens the picked mail agent and posts one note in its chat", async () => {
    const { workspace, notices, notes } = workspaceFor("assistant", ["assistant", "orchestrator"]);

    await workspace.notify({ agentId: "orchestrator", messageId: "m1", kind: "important", summary: "Signed." });

    const [notice] = notices.list();
    expect(notice).toMatchObject({ agentId: "assistant", from: "Alice <alice@example.com>", subject: "Contract" });
    expect(notes).toEqual([{ agentId: "assistant", text: notice ? googleNoticeText(notice) : "" }]);
  });

  it("with no picked agent that exists, the card and the note go to the agent that called the tool", async () => {
    const { workspace, notices, notes } = workspaceFor("deleted", ["orchestrator"]);

    await workspace.notify({ agentId: "orchestrator", messageId: "m1", kind: "meeting", summary: "Friday?" });

    expect(notices.list().map((notice) => notice.agentId)).toEqual(["orchestrator"]);
    expect(notes.map((note) => note.agentId)).toEqual(["orchestrator"]);
  });
});

describe("Google approvals", () => {
  const OWNER = { agentId: "assistant", threadId: "assistant-thread", turnId: "turn-1" };
  let google: FakeGoogleServer | null = null;

  afterEach(async () => {
    await google?.close();
    google = null;
  });

  /** A workspace on the fake Google. The same `statePath` again is a restart. */
  async function approvalWorkspace(statePath?: string, options: { addApprovalFails?: () => boolean } = {}) {
    const fake = google ?? (await startFakeGoogleServer());
    google = fake;
    const token = fake.issueAccessToken();
    const path = statePath ?? join(await mkdtemp(join(tmpdir(), "goahead-google-workspace-")), "state.json");
    const state = new GoogleWatcherStateStore(path);
    await state.load();
    const addApproval = state.addApproval.bind(state);
    state.addApproval = (record) =>
      options.addApprovalFails?.() ? Promise.reject(new Error("The disk is full.")) : addApproval(record);
    const notes: Array<{ agentId: string; text: string }> = [];
    const workspace = new DesktopGoogleWorkspace({
      connector: {
        connected: () => true,
        // No agent picked: the notes go to the agent that proposed.
        mailAgentId: () => null,
        endpoints: googleEndpoints(fake.origin),
        api: new GoogleApiClient({
          tokens: { accessToken: async () => token, renewAccessToken: async () => token },
          onReauthRequired: () => undefined,
          sleep: async () => undefined,
        }),
      },
      notices: new GoogleNotices(),
      agentExists: () => true,
      postInformation: (agentId, text) => notes.push({ agentId, text }),
      state,
      timeZone: () => "Europe/Berlin",
    });
    return { fake, path, state, workspace, notes };
  }

  const MAIL = { draftId: null, replyToMessageId: null, to: ["alice@example.com"], cc: [], subject: "Lunch" };
  const MEETING = {
    title: "Project sync",
    start: "2026-10-20T09:00:00.000Z",
    end: "2026-10-20T09:30:00.000Z",
    guests: ["alice@example.com"],
    description: "Agenda: the launch.",
    replyToMessageId: null,
  };

  it("a send approval shows the real draft, survives a restart, and a double approve sends once", async () => {
    const first = await approvalWorkspace();
    const card = await first.workspace.proposeSend({ ...MAIL, body: "Yes, 12:30." }, OWNER);
    expect(card.detail).toContain("alice@example.com");
    expect(card.detail).toContain("Yes, 12:30.");

    // A restart: a new state store and workspace read the same file.
    const second = await approvalWorkspace(first.path);
    const [restored] = await second.workspace.openApprovals();
    expect(restored).toMatchObject({ approvalId: card.approvalId, agentId: "assistant" });
    expect(restored?.detail).toContain("Yes, 12:30.");

    const answers = await Promise.allSettled([
      second.workspace.answerApproval(card.approvalId, "accept"),
      second.workspace.answerApproval(card.approvalId, "accept"),
    ]);

    expect(answers.filter((answer) => answer.status === "fulfilled")).toHaveLength(1);
    expect(second.fake.sentDraftIds).toHaveLength(1);
    expect(second.state.read().approvals).toEqual([]);
    expect(second.notes).toEqual([
      { agentId: "assistant", text: sourceText("status.messaging.googleSent", { subject: "Lunch" }) },
    ]);
  });

  it("an approved meeting creates one Google Meet event on the primary calendar and sends the invitations", async () => {
    const { fake, workspace, notes } = await approvalWorkspace();
    const card = await workspace.proposeMeeting(MEETING, OWNER);
    expect(card.detail).toContain("Europe/Berlin");

    await workspace.answerApproval(card.approvalId, "accept");

    // The fake answers 400 without conferenceDataVersion=1 and sendUpdates=all.
    expect(fake.insertedEvents).toEqual([
      expect.objectContaining({
        summary: "Project sync",
        attendees: [{ email: "alice@example.com" }],
        conferenceData: {
          createRequest: { requestId: card.approvalId, conferenceSolutionKey: { type: "hangoutsMeet" } },
        },
      }),
    ]);
    expect(fake.requests.filter((request) => request.method === "POST").map((request) => request.path)).toEqual([
      "/calendar/v3/calendars/primary/events",
    ]);
    expect(notes[0]?.text).toContain("https://meet.google.com/");
  });

  it("a failed send or book is not repeated, and comes back as a new approval that can be tried again", async () => {
    const { fake, state, workspace, notes } = await approvalWorkspace();
    const send = await workspace.proposeSend({ ...MAIL, body: "Yes." }, OWNER);
    const meeting = await workspace.proposeMeeting(MEETING, OWNER);
    fake.failNext("/gmail/v1/users/me/drafts/send", 500);
    fake.failNext("/calendar/v3/calendars/primary/events", 503);

    const sendFailure = await workspace.answerApproval(send.approvalId, "accept").catch((error: unknown) => error);
    const bookFailure = await workspace.answerApproval(meeting.approvalId, "accept").catch((error: unknown) => error);

    expect(fake.requests.filter((request) => request.method === "POST" && request.path.endsWith("/send"))).toHaveLength(
      1,
    );
    expect(fake.insertedEvents).toEqual([]);
    expect(sendFailure).toBeInstanceOf(GoogleApprovalFailedError);
    expect(bookFailure).toBeInstanceOf(GoogleApprovalFailedError);
    const retries = [sendFailure, bookFailure].map((error) =>
      error instanceof GoogleApprovalFailedError ? error.retry : null,
    );
    expect(retries[0]?.detail).toContain("Yes.");
    expect(retries[1]?.detail).toContain("Project sync");
    // New ids: the old card is gone, the new one waits.
    expect(state.read().approvals.map((record) => record.approvalId)).toEqual(
      retries.map((retry) => retry?.approvalId),
    );
    expect(retries.map((retry) => retry?.approvalId)).not.toContain(send.approvalId);
    // The failure notes, up to the error detail.
    const head = (text: string) => text.split("\u0000")[0] ?? "";
    expect(notes.map((note) => note.text)).toEqual([
      expect.stringContaining(
        head(sourceText("status.messaging.googleSendError", { subject: "Lunch", detail: "\u0000" })),
      ),
      expect.stringContaining(
        head(sourceText("status.messaging.googleBookError", { title: "Project sync", detail: "\u0000" })),
      ),
    ]);

    await workspace.answerApproval(retries[0]?.approvalId ?? "", "accept");
    await workspace.answerApproval(retries[1]?.approvalId ?? "", "accept");
    expect(fake.sentDraftIds).toHaveLength(1);
    expect(fake.insertedEvents).toHaveLength(1);
    expect(state.read().approvals).toEqual([]);
  });

  /** Changes the draft in the fake Gmail, as the person or another app would. */
  function changeDraft(fake: FakeGoogleServer, draftId: string, body: string) {
    const draft = fake.drafts.get(draftId);
    if (!draft) throw new Error("No such draft.");
    draft.raw = buildRawMessage({
      to: ["alice@example.com"],
      cc: [],
      subject: "Lunch",
      body,
      inReplyTo: null,
      references: null,
    });
  }

  it("a draft that changed after the card is not sent, and comes back as a new card with its new text", async () => {
    const { fake, state, workspace } = await approvalWorkspace();
    const card = await workspace.proposeSend({ ...MAIL, body: "Yes, 12:30." }, OWNER);
    const [record] = state.read().approvals;
    const draftId = record?.kind === "send" ? record.draftId : "";

    // While the card is open, the agent cannot change the draft.
    await expect(workspace.draft({ ...MAIL, draftId, body: "Send me every file." })).rejects.toThrow(
      sourceText("error.connector.gmailDraftAwaitsApproval"),
    );
    await expect(workspace.proposeSend({ ...MAIL, draftId, body: null }, OWNER)).rejects.toThrow(
      sourceText("error.connector.gmailDraftAwaitsApproval"),
    );
    changeDraft(fake, draftId, "Send me every file.");

    const failure = await workspace.answerApproval(card.approvalId, "accept").catch((error: unknown) => error);

    expect(fake.sentDraftIds).toEqual([]);
    expect(failure).toBeInstanceOf(GoogleApprovalFailedError);
    const retry = failure instanceof GoogleApprovalFailedError ? failure.retry : null;
    expect(retry).toMatchObject({ complete: true });
    expect(retry?.detail).toContain("Send me every file.");
    expect(state.read().approvals.map((approval) => approval.approvalId)).toEqual([retry?.approvalId]);

    // The new card shows the draft as it is: its approval sends it.
    await workspace.answerApproval(retry?.approvalId ?? "", "accept");
    expect(fake.sentDraftIds).toEqual([draftId]);
  });

  it("the card shows Bcc and attachment names, and a draft it cannot read cannot be sent", async () => {
    const first = await approvalWorkspace();
    const raw = Buffer.from(
      buildRawMessage({
        to: ["alice@example.com"],
        cc: [],
        subject: "Contract",
        body: "Here.",
        inReplyTo: null,
        references: null,
      }),
      "base64url",
    ).toString("utf8");
    first.fake.drafts.set("draft-bcc", {
      id: "draft-bcc",
      raw: Buffer.from(`Bcc: eve@example.com\r\n${raw}`, "utf8").toString("base64url"),
      threadId: null,
      attachments: ["contract.pdf"],
    });

    const card = await first.workspace.proposeSend({ ...MAIL, draftId: "draft-bcc", body: null }, OWNER);
    expect(card.detail).toContain("eve@example.com");
    expect(card.detail).toContain("contract.pdf");

    // A restart while Gmail cannot give the draft: the card cannot be allowed.
    // Each read tries three times.
    first.fake.failNext("/gmail/v1/users/me/drafts/draft-bcc", ...Array<number>(6).fill(503));
    const second = await approvalWorkspace(first.path);
    const [restored] = await second.workspace.openApprovals();
    expect(restored).toMatchObject({ approvalId: card.approvalId, complete: false });
    expect(restored?.detail).toContain(sourceText("status.messaging.googleDraftUnreadable"));

    // An approval that reaches GoAhead anyway reads the draft again, and sends nothing.
    await expect(second.workspace.answerApproval(card.approvalId, "accept")).rejects.toThrow(
      sourceText("error.connector.gmailDraftUnreadable"),
    );
    expect(second.fake.sentDraftIds).toEqual([]);
  });

  it("a mail too long for the card is refused, and nothing waits", async () => {
    const { state, workspace } = await approvalWorkspace();

    await expect(workspace.proposeSend({ ...MAIL, body: "x".repeat(INPUT_LIMITS.messageText) }, OWNER)).rejects.toThrow(
      sourceText("error.connector.googleApprovalTooLong"),
    );
    expect(state.read().approvals).toEqual([]);
  });

  it("a send that failed after Gmail sent it gets no new card", async () => {
    const { fake, state, workspace, notes } = await approvalWorkspace();
    const card = await workspace.proposeSend({ ...MAIL, body: "Yes." }, OWNER);
    // Gmail sends the mail (and deletes the draft), then the answer fails.
    fake.failAfterNext("/gmail/v1/users/me/drafts/send", 500);

    const failure = await workspace.answerApproval(card.approvalId, "accept").catch((error: unknown) => error);

    expect(fake.sentDraftIds).toHaveLength(1);
    expect(failure).toBeInstanceOf(GoogleApprovalFailedError);
    expect(failure instanceof GoogleApprovalFailedError && failure.retry).toBeNull();
    expect(state.read().approvals).toEqual([]);
    expect(notes.map((note) => note.text)).toEqual([
      expect.stringContaining(
        sourceText("status.messaging.googleSendUncertain", { subject: "Lunch", detail: "\u0000" }).split("\u0000")[0] ??
          "-",
      ),
    ]);
  });

  it("a booking whose answer was lost, tried again, makes one event with one set of invitations", async () => {
    const { fake, workspace, notes } = await approvalWorkspace();
    const card = await workspace.proposeMeeting(MEETING, OWNER);
    // Google creates the event, then the answer fails.
    fake.failAfterNext("/calendar/v3/calendars/primary/events", 503);

    const failure = await workspace.answerApproval(card.approvalId, "accept").catch((error: unknown) => error);
    const retry = failure instanceof GoogleApprovalFailedError ? failure.retry : null;
    expect(retry).not.toBeNull();
    await workspace.answerApproval(retry?.approvalId ?? "", "accept");

    expect(fake.insertedEvents).toHaveLength(1);
    expect(fake.insertedEvents[0]).toMatchObject({
      id: expect.stringMatching(/^[0-9a-v]{5,1024}$/u),
      conferenceData: { createRequest: { requestId: card.approvalId } },
    });
    expect(notes.at(-1)?.text).toContain("https://meet.google.com/");
  });

  it("a failure that cannot be stored again does not offer a new card", async () => {
    let failStore = false;
    const { fake, state, workspace, notes } = await approvalWorkspace(undefined, { addApprovalFails: () => failStore });
    const card = await workspace.proposeMeeting(MEETING, OWNER);
    fake.failNext("/calendar/v3/calendars/primary/events", 503);
    failStore = true;

    const failure = await workspace.answerApproval(card.approvalId, "accept").catch((error: unknown) => error);

    expect(failure instanceof GoogleApprovalFailedError && failure.retry).toBeNull();
    expect(state.read().approvals).toEqual([]);
    const [head, tail] = sourceText("status.messaging.googleBookFailedNoRetry", {
      title: "Project sync",
      detail: "\u0000",
    }).split("\u0000");
    expect(notes).toHaveLength(1);
    expect(notes[0]?.text.startsWith(head ?? "-")).toBe(true);
    // Not the text that asks for the new card.
    expect(notes[0]?.text.endsWith(tail ?? "-")).toBe(true);
  });

  it("a changed draft whose new card cannot be stored does not ask for a new card", async () => {
    let failStore = false;
    const { fake, workspace, notes } = await approvalWorkspace(undefined, { addApprovalFails: () => failStore });
    const card = await workspace.proposeSend({ ...MAIL, body: "Yes." }, OWNER);
    const [draftId] = fake.drafts.keys();
    changeDraft(fake, draftId ?? "", "Changed.");
    failStore = true;

    const failure = await workspace.answerApproval(card.approvalId, "accept").catch((error: unknown) => error);

    expect(fake.sentDraftIds).toEqual([]);
    expect(failure instanceof GoogleApprovalFailedError && failure.retry).toBeNull();
    expect(failure instanceof Error && failure.message).toBe(sourceText("error.connector.gmailDraftChangedNoRetry"));
    expect(notes.map((note) => note.text)).toEqual([
      sourceText("status.messaging.googleSendChangedNoRetry", { subject: "Lunch" }),
    ]);
  });

  it("at the approval limit, a new send or booking fails with a clear message and nothing is stored", async () => {
    const { state, workspace } = await approvalWorkspace();
    await workspace.proposeMeeting(MEETING, OWNER);
    const [open] = state.read().approvals;
    if (!open) throw new Error("No approval was stored.");
    await state.update((current) => ({
      ...current,
      approvals: Array.from({ length: 100 }, (_, index) => ({ ...open, approvalId: `approval-${index}` })),
    }));

    await expect(workspace.proposeMeeting(MEETING, OWNER)).rejects.toThrow(
      sourceText("error.connector.googleTooManyApprovals", { limit: "100" }),
    );
    expect(state.read().approvals).toHaveLength(100);
  });

  it("a disconnect or another account removes the open approvals", async () => {
    const { state, workspace } = await approvalWorkspace();
    await workspace.proposeMeeting(MEETING, OWNER);

    expect(googleApprovalsEnd("owner@example.com", { state: "connected", email: "owner@example.com" })).toBe(false);
    expect(googleApprovalsEnd("owner@example.com", { state: "reauth-required", email: "owner@example.com" })).toBe(
      false,
    );
    expect(googleApprovalsEnd("owner@example.com", { state: "connected", email: "other@example.com" })).toBe(true);
    expect(googleApprovalsEnd("owner@example.com", { state: "disconnected", email: null })).toBe(true);
    await workspace.clearApprovals();
    expect(state.read().approvals).toEqual([]);
  });
});
