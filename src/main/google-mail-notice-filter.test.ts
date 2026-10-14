import { type AgentEvent, sharedAgentEvent } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentService } from "../backend/agent-service";
import { startAgentTestFixture, startService, stopAgentTestFixture } from "../backend/agent-service-test-harness";
import {
  conversationForCapabilities,
  conversationPageForTeam,
  markerExclusionsForCapabilities,
} from "./team-api/request-helpers";

const NOTE = "Important mail from Alice <alice@example.com>: Contract";
/** Every marker capability: the note is dropped also for the newest client. */
const ALL_MARKERS = new Set(["routine-event-markers", "routine-run-event-markers", "hosted-site-event-markers"]);

let root = "";
let service: AgentService | null = null;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

describe("mail notes stay on this computer", () => {
  it("the desktop sees a google-mail-notice note; the Team API, its events, search and the Live Activity snapshot do not", async () => {
    const started = await startService(root, { provider: "codex", autoComplete: false });
    service = started.service;
    const agent = await started.store.getOrCreate("assistant");
    const events: AgentEvent[] = [];
    started.service.on("event", (event) => events.push(event));

    started.service.postGoogleInformation(agent.id, NOTE);

    const texts = (messages: Array<{ text: string }>) => messages.map((message) => message.text);
    // This desktop's renderer reads the conversation directly.
    expect(texts((await started.service.readConversation(agent.id)).messages)).toContain(NOTE);

    // A Team API client: full read, page read, live events and search.
    const full = await started.service.readConversationFor(agent.id, "member-1");
    expect(texts(conversationForCapabilities(full, ALL_MARKERS).messages)).not.toContain(NOTE);
    const page = await started.service.readConversationPageFor(agent.id, "member-1");
    expect(texts(conversationPageForTeam(page).messages)).not.toContain(NOTE);
    const published = events.find((event) => event.type === "conversation");
    const shared = published ? sharedAgentEvent(published) : null;
    expect(shared?.type).toBe("conversation");
    expect(shared?.type === "conversation" ? texts(shared.snapshot.messages) : [NOTE]).not.toContain(NOTE);
    expect(started.service.searchConversationMessages("Contract").results).toEqual([]);

    // The phone and the Live Activity push read the runtime snapshot.
    expect(texts(started.service.getRuntimeSnapshot().latestMessages)).not.toContain(NOTE);
  });

  it("a mail note is not unread for a Team API member or the Live Activity; the desktop owner still counts it", async () => {
    const started = await startService(root, { provider: "codex", autoComplete: false });
    service = started.service;
    const agent = await started.store.getOrCreate("assistant");
    await started.service.sendMessage({ agentId: agent.id, text: "Hello" });
    // `GET /v1/agents/conversation-reads` and the Live Activity push read with these options.
    const memberOptions = markerExclusionsForCapabilities(ALL_MARKERS);
    const owner = "local-user:owner";
    // Both readers start with every message read.
    started.service.listConversationReads("member-1", memberOptions);
    started.service.listConversationReads(owner);

    started.service.postGoogleInformation(agent.id, NOTE);

    const nothingUnread = { unreadCount: 0, firstUnreadMessageId: null };
    expect(started.service.listConversationReads("member-1", memberOptions)[agent.id]).toMatchObject(nothingUnread);
    const full = await started.service.readConversationFor(agent.id, "member-1", { excludeLocalOnly: true });
    expect(conversationForCapabilities(full, ALL_MARKERS).readState).toMatchObject(nothingUnread);
    const page = await started.service.readConversationPageFor(
      agent.id,
      "member-1",
      undefined,
      undefined,
      memberOptions,
    );
    expect(conversationPageForTeam(page).readState).toMatchObject(nothingUnread);

    // Mark unread from a Team API client: only the user's own message is before the note, so nothing counts.
    expect(await started.service.markConversationUnread(agent.id, "member-1", memberOptions)).toMatchObject(
      nothingUnread,
    );

    // The desktop owner sees the note as unread.
    const note = (await started.service.readConversation(agent.id)).messages.find((message) => message.text === NOTE);
    expect(started.service.listConversationReads(owner)[agent.id]).toMatchObject({
      unreadCount: 1,
      firstUnreadMessageId: note?.id,
    });
  });
});
