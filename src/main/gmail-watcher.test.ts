import { afterEach, describe, expect, it } from "vitest";
import type { GoogleTriageMail } from "../backend/messaging/google-triage";
import { GmailApi } from "./gmail-api";
import { GmailWatcher } from "./gmail-watcher";
import { GoogleApiClient } from "./google-api";
import { createGoogleMailTriage } from "./google-mail-triage";
import { GoogleNotices } from "./google-notices";
import { type FakeGmailMessage, type FakeGoogleServer, startFakeGoogleServer } from "./google-test-server";
import type { GoogleWatcherState } from "./google-watcher-state";

let google: FakeGoogleServer | null = null;

afterEach(async () => {
  await google?.close();
  google = null;
});

function mail(id: string, labelIds: string[], extra: Partial<FakeGmailMessage> = {}): FakeGmailMessage {
  return {
    id,
    threadId: `thread-${id}`,
    labelIds: ["INBOX", ...labelIds],
    from: `Sender ${id} <${id}@example.com>`,
    to: "owner@example.com",
    subject: `Subject ${id}`,
    date: "Tue, 13 Oct 2026 09:00:00 +0000",
    snippet: `Snippet ${id}.`,
    text: `Text ${id}`,
    messageIdHeader: `<${id}@example.com>`,
    ...extra,
  };
}

/** The state file in memory: the watcher reads and writes only through these two methods. */
function memoryState(initial: Partial<GoogleWatcherState> = {}) {
  let state: GoogleWatcherState = {
    version: 1,
    account: null,
    historyId: null,
    seen: [],
    pending: [],
    approvals: [],
    ...initial,
  };
  return {
    read: () => state,
    update: async (change: (current: GoogleWatcherState) => GoogleWatcherState) => {
      state = change(state);
    },
  };
}

function gmailFor(fake: FakeGoogleServer): GmailApi {
  const token = fake.issueAccessToken();
  const api = new GoogleApiClient({
    tokens: { accessToken: async () => token, renewAccessToken: async () => token },
    onReauthRequired: () => undefined,
    sleep: async () => undefined,
  });
  return new GmailApi(api, `${fake.origin}/gmail/v1`);
}

function watcherFor(fake: FakeGoogleServer, state: ReturnType<typeof memoryState>) {
  const batches: GoogleTriageMail[][] = [];
  const watcher = new GmailWatcher({
    gmail: gmailFor(fake),
    state,
    active: () => true,
    account: () => "owner@example.com",
    triage: async (mails) => {
      batches.push(mails);
      return true;
    },
  });
  return { watcher, batches };
}

describe("GmailWatcher", () => {
  it("starts at the current history, then triages only important, primary or invite mail", async () => {
    const fake = await startFakeGoogleServer();
    google = fake;
    fake.addMessage(mail("old", ["IMPORTANT"]));
    const state = memoryState();
    const { watcher, batches } = watcherFor(fake, state);

    expect(await watcher.poll()).toBe("started");
    expect(batches).toEqual([]);

    fake.addMessage(mail("important", ["IMPORTANT"]));
    fake.addMessage(mail("promotion", ["CATEGORY_PROMOTIONS"]));
    fake.addMessage(mail("invite", [], { invite: true }));
    expect(await watcher.poll()).toBe("triaged");

    expect(batches.map((batch) => batch.map((item) => item.id))).toEqual([["important", "invite"]]);
    expect(state.read().historyId).toBe(String(fake.historyId));
    expect(await watcher.poll()).toBe("nothing-new");
    expect(batches).toHaveLength(1);
  });

  it("keeps the selected mail beyond the batch limit and triages it first on the next poll", async () => {
    const fake = await startFakeGoogleServer();
    google = fake;
    const state = memoryState();
    const { watcher, batches } = watcherFor(fake, state);
    expect(await watcher.poll()).toBe("started");

    const ids = Array.from({ length: 12 }, (_, index) => `mail-${index + 1}`);
    for (const id of ids) fake.addMessage(mail(id, ["IMPORTANT"]));
    expect(await watcher.poll()).toBe("triaged");
    expect(batches.map((batch) => batch.length)).toEqual([10]);
    // The history position moves on; the two mails wait in the state file.
    expect(state.read().historyId).toBe(String(fake.historyId));
    expect(state.read().pending.map((candidate) => candidate.id)).toEqual(["mail-11", "mail-12"]);

    fake.addMessage(mail("later", ["IMPORTANT"]));
    expect(await watcher.poll()).toBe("triaged");
    expect(await watcher.poll()).toBe("nothing-new");

    const triaged = batches.flat().map((item) => item.id);
    expect(batches[1]?.map((item) => item.id)).toEqual(["mail-11", "mail-12", "later"]);
    expect(triaged).toEqual([...ids, "later"]);
    expect(new Set(triaged).size).toBe(triaged.length);
    expect(state.read().pending).toEqual([]);
  });

  it("an expired history id starts again from the profile with no backlog", async () => {
    const fake = await startFakeGoogleServer();
    google = fake;
    fake.addMessage(mail("missed", ["IMPORTANT"]));
    fake.oldestHistoryId = 900;
    const state = memoryState({ account: "owner@example.com", historyId: "5" });
    const { watcher, batches } = watcherFor(fake, state);

    expect(await watcher.poll()).toBe("restarted");

    expect(batches).toEqual([]);
    expect(state.read().historyId).toBe(String(fake.historyId));
  });

  it("stop() during a triage aborts it, and the poll writes no state after it", async () => {
    const fake = await startFakeGoogleServer();
    google = fake;
    const state = memoryState();
    const triage: { signal: AbortSignal | null } = { signal: null };
    const watcher: GmailWatcher = new GmailWatcher({
      gmail: gmailFor(fake),
      state,
      active: () => true,
      account: () => "owner@example.com",
      triage: async (_mails, triageSignal) => {
        triage.signal = triageSignal;
        watcher.stop();
        return true;
      },
    });
    expect(await watcher.poll()).toBe("started");
    const historyId = state.read().historyId;
    fake.addMessage(mail("important", ["IMPORTANT"]));

    expect(await watcher.poll()).toBe("stopped");

    expect(triage.signal?.aborted).toBe(true);
    expect(state.read().historyId).toBe(historyId);
    expect(state.read().seen).toEqual([]);
  });

  it("forget() after a disconnect: a reconnect to the same account triages no mail from the time between", async () => {
    const fake = await startFakeGoogleServer();
    google = fake;
    const state = memoryState();
    const { watcher, batches } = watcherFor(fake, state);
    expect(await watcher.poll()).toBe("started");
    fake.addMessage(mail("waiting", ["IMPORTANT"]));
    await state.update((current) => ({ ...current, pending: [{ id: "queued", labelIds: ["IMPORTANT"] }] }));

    await watcher.forget();
    fake.addMessage(mail("while-disconnected", ["IMPORTANT"]));

    expect(state.read()).toMatchObject({ account: null, historyId: null, seen: [], pending: [] });
    expect(await watcher.poll()).toBe("started");
    expect(await watcher.poll()).toBe("nothing-new");
    expect(batches).toEqual([]);
  });

  it("a notification listener that throws does not show the same notice again on the next poll", async () => {
    const fake = await startFakeGoogleServer();
    google = fake;
    const state = memoryState();
    const notices = new GoogleNotices();
    notices.onAdded(() => {
      throw new Error("The notification failed.");
    });
    const watcher = new GmailWatcher({
      gmail: gmailFor(fake),
      state,
      active: () => true,
      account: () => "owner@example.com",
      triage: createGoogleMailTriage({
        mailAgentId: () => "assistant",
        agentExists: () => true,
        notices,
        postInformation: () => undefined,
        gmail: {
          read: async () => {
            throw new Error("not used");
          },
          organize: async ({ messageId }) => ({ id: messageId, labelIds: [] }),
        },
        runTriage: async () => ({ status: "unavailable", reason: "no Claude", notified: [] }),
      }),
    });
    expect(await watcher.poll()).toBe("started");
    fake.addMessage(mail("important", ["IMPORTANT"]));

    expect(await watcher.poll()).toBe("triaged");
    expect(await watcher.poll()).toBe("nothing-new");

    expect(notices.list().map((notice) => notice.gmailMessageId)).toEqual(["important"]);
  });
});
