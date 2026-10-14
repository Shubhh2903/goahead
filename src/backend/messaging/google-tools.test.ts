import { type AgentEvent, sharedAgentEvent } from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentService } from "../agent-service";
import {
  callOpenBotTool,
  type FakeAgentClient,
  inputRecords,
  notification,
  openBotToolPayload,
  paramsRecord,
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  waitFor,
} from "../agent-service-test-harness";
import {
  capGmailReadMessages,
  GMAIL_READ_TOTAL_LIMIT,
  GOOGLE_MAIL_AGENT_INSTRUCTIONS,
  type GoogleWorkspace,
  googleToolRefusal,
  isSlackOwnerDirectTurn,
  organizeChange,
} from "./google-tools";

describe("googleToolRefusal", () => {
  const mailAgents = { pickedAgentId: "assistant", orchestratorIds: ["orchestrator"] };
  const MAIL_AGENT_ONLY = sourceText("error.connector.googleMailAgentOnly");
  const OWNER_ONLY = sourceText("error.connector.googleOwnerOnly");

  it("lets both mail agents use Gmail in a turn of the person at this computer", () => {
    expect(googleToolRefusal({ agentId: "assistant", mailAgents, origin: "local-owner", connected: true })).toBeNull();
    expect(
      googleToolRefusal({ agentId: "orchestrator", mailAgents, origin: "local-owner", connected: true }),
    ).toBeNull();
  });

  it("lets only the Slack Orchestrator use Gmail in the owner's own Slack DM", () => {
    expect(
      googleToolRefusal({ agentId: "orchestrator", mailAgents, origin: "slack-owner-dm", connected: true }),
    ).toBeNull();
    expect(googleToolRefusal({ agentId: "assistant", mailAgents, origin: "slack-owner-dm", connected: true })).toBe(
      OWNER_ONLY,
    );
  });

  it("refuses an agent that is not a mail agent, in every turn", () => {
    for (const origin of ["local-owner", "slack-owner-dm", "other"] as const) {
      expect(googleToolRefusal({ agentId: "builder", mailAgents, origin, connected: true })).toBe(MAIL_AGENT_ONLY);
    }
  });

  it("refuses a turn of anyone else", () => {
    expect(googleToolRefusal({ agentId: "orchestrator", mailAgents, origin: "other", connected: true })).toBe(
      OWNER_ONLY,
    );
  });
});

describe("isSlackOwnerDirectTurn", () => {
  const owner = { authorId: "UOWNER", sameLink: true, isReply: false };

  it("passes the connected owner's own direct message with GoAhead", () => {
    expect(isSlackOwnerDirectTurn({ isDirect: true, ownerId: "UOWNER", origins: [owner, owner] })).toBe(true);
  });

  it("refuses a colleague's direct message", () => {
    const colleague = { ...owner, authorId: "UCOLLEAGUE" };
    expect(isSlackOwnerDirectTurn({ isDirect: true, ownerId: "UOWNER", origins: [colleague] })).toBe(false);
    // One colleague message in a batch is enough to refuse it.
    expect(isSlackOwnerDirectTurn({ isDirect: true, ownerId: "UOWNER", origins: [owner, colleague] })).toBe(false);
  });

  it("refuses a channel, a group direct message, and a turn with no proven owner", () => {
    // A channel thread and a group direct message are links that are not direct.
    expect(isSlackOwnerDirectTurn({ isDirect: false, ownerId: "UOWNER", origins: [owner] })).toBe(false);
    // A teammate's answer has no Slack origin.
    expect(isSlackOwnerDirectTurn({ isDirect: true, ownerId: "UOWNER", origins: [owner, null] })).toBe(false);
    // The workspace was connected as the bot only: no owner is known.
    expect(isSlackOwnerDirectTurn({ isDirect: true, ownerId: null, origins: [owner] })).toBe(false);
    // A reply to a message that GoAhead sent for the owner comes from someone else.
    expect(isSlackOwnerDirectTurn({ isDirect: true, ownerId: "UOWNER", origins: [{ ...owner, isReply: true }] })).toBe(
      false,
    );
    expect(isSlackOwnerDirectTurn(null)).toBe(false);
  });
});

describe("organizeChange", () => {
  it("never trashes mail", () => {
    expect(() => organizeChange({ messageId: "m1", addLabels: ["TRASH"] })).toThrow(
      sourceText("error.connector.gmailNoTrash"),
    );
    expect(() => organizeChange({ messageId: "m1", addLabels: ["spam"] })).toThrow(
      sourceText("error.connector.gmailNoTrash"),
    );
  });
});

describe("capGmailReadMessages", () => {
  it("keeps the newest messages of a long thread within the total limit and counts the older ones left out", () => {
    // Gmail gives a thread oldest first. Each message is about 15,000 characters.
    const thread = Array.from({ length: 6 }, (_, index) => ({ id: `m${index + 1}`, text: "x".repeat(15_000) }));

    const capped = capGmailReadMessages(thread);

    expect(capped.messages.map((message) => message.id)).toEqual(["m6", "m5", "m4"]);
    expect(capped.omittedOlderMessages).toBe(3);
    expect(JSON.stringify(capped.messages).length).toBeLessThanOrEqual(GMAIL_READ_TOTAL_LIMIT);
  });

  it("leaves a short thread complete", () => {
    const capped = capGmailReadMessages([{ id: "m1" }, { id: "m2" }]);
    expect(capped).toEqual({ messages: [{ id: "m2" }, { id: "m1" }], omittedOlderMessages: 0 });
  });
});

let root = "";
let service: AgentService | null = null;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

function workspaceStub(): GoogleWorkspace & {
  queries: string[];
  answers: Array<{ approvalId: string; decision: string }>;
} {
  const queries: string[] = [];
  const answers: Array<{ approvalId: string; decision: string }> = [];
  return {
    queries,
    answers,
    connected: () => true,
    mailAgentId: () => "assistant",
    search: async ({ query }) => {
      queries.push(query);
      return [];
    },
    read: async () => [],
    organize: async ({ messageId }) => ({ id: messageId, labelIds: [] }),
    draft: async () => ({ draftId: "draft-1", messageId: "message-1", threadId: "thread-1" }),
    findTimes: async () => ({ timeZone: "UTC", slots: [] }),
    notify: async () => ({ noticeId: "notice-1" }),
    proposeSend: async (_input, owner) => ({
      approvalId: "approval-1",
      kind: "send",
      ...owner,
      detail: "To: alice@example.com",
      complete: true,
    }),
    proposeMeeting: async (_input, owner) => ({
      approvalId: "approval-2",
      kind: "meeting",
      ...owner,
      detail: "Sync",
      complete: true,
    }),
    answerApproval: async (approvalId, decision) => {
      answers.push({ approvalId, decision });
    },
    openApprovals: async () => [],
    clearApprovals: async () => undefined,
  };
}

/** A service whose agent `assistant` is the agent picked in the Google panel (`mailAgentId` of the stub). */
async function startMailAgent(
  workspace: GoogleWorkspace,
  approvalAutomation?: { autoApproves: (agentId: string) => boolean; turboEnabled: () => boolean },
) {
  const started = await startService(root, {
    provider: "codex",
    autoComplete: false,
    googleWorkspace: workspace,
    ...(approvalAutomation ? { approvalAutomation } : {}),
  });
  service = started.service;
  const chief = await started.store.getOrCreate("assistant");
  return { ...started, chief };
}

/** Sends one message and waits for the turn that the fake provider starts for it. */
async function nextTurn(client: FakeAgentClient, send: () => Promise<unknown>) {
  const turns: Array<{ threadId: string; turnId: string }> = [];
  client.on("notification", (event: { method: string; params: unknown }) => {
    const params = paramsRecord(event.params);
    const turn = params && paramsRecord(params.turn);
    if (event.method === "turn/started" && isString(params?.threadId) && isString(turn?.id)) {
      turns.push({ threadId: params.threadId, turnId: turn.id });
    }
  });
  await send();
  await waitFor(() => turns.length > 0);
  const [turn] = turns;
  if (!turn) throw new Error("No turn started.");
  return turn;
}

describe("the Google tools in the tool router", () => {
  it("the picked mail agent searches Gmail in a turn of the person at this computer", async () => {
    const workspace = workspaceStub();
    const started = await startMailAgent(workspace);
    const turn = await nextTurn(started.client, () =>
      started.service.sendLocalOwnerMessage({ agentId: started.chief.id, text: "What is new in my mail?" }),
    );

    const answer = await callOpenBotTool(
      started.client,
      turn.threadId,
      "gmail_search",
      { query: "is:unread" },
      turn.turnId,
    );

    expect(paramsRecord(answer.result)?.success).toBe(true);
    expect(workspace.queries).toEqual(["is:unread"]);
  });

  it("a turn that is not the local owner's cannot use a Google tool", async () => {
    const workspace = workspaceStub();
    const started = await startMailAgent(workspace);
    // A Team API member, a remote client, or a delivery whose local-owner proof a restart lost.
    const turn = await nextTurn(started.client, () =>
      started.service.sendMessage({ agentId: started.chief.id, text: "Read my mail" }),
    );

    const answer = await callOpenBotTool(
      started.client,
      turn.threadId,
      "gmail_search",
      { query: "is:unread" },
      turn.turnId,
    );

    expect(paramsRecord(answer.result)?.success).toBe(false);
    expect(openBotToolPayload(answer.result).error).toBe(sourceText("error.connector.googleOwnerOnly"));
    expect(workspace.queries).toEqual([]);
  });

  it("the person's own app turn of the picked mail agent starts with the Gmail rules; another agent's turn does not", async () => {
    const workspace = workspaceStub();
    const started = await startMailAgent(workspace);
    const builder = await started.store.getOrCreate("builder");
    const turn = await nextTurn(started.client, () =>
      started.service.sendLocalOwnerMessage({ agentId: builder.id, text: "Read my mail" }),
    );
    expect(promptText(started.client, 0)).not.toContain(GOOGLE_MAIL_AGENT_INSTRUCTIONS);

    const answer = await callOpenBotTool(
      started.client,
      turn.threadId,
      "gmail_search",
      { query: "is:unread" },
      turn.turnId,
    );
    expect(openBotToolPayload(answer.result).error).toBe(sourceText("error.connector.googleMailAgentOnly"));
    expect(workspace.queries).toEqual([]);

    await nextTurn(started.client, () =>
      started.service.sendLocalOwnerMessage({ agentId: started.chief.id, text: "What is new in my mail?" }),
    );
    expect(promptText(started.client, 1)).toContain(GOOGLE_MAIL_AGENT_INSTRUCTIONS);
  });
});

describe("Google approvals in the agent service", () => {
  it("Turbo does not answer a Google approval, and the Team API never shows or answers it", async () => {
    const workspace = workspaceStub();
    const started = await startMailAgent(workspace, { autoApproves: () => true, turboEnabled: () => true });
    const events: AgentEvent[] = [];
    started.service.on("event", (event) => events.push(event));
    const turn = await nextTurn(started.client, () =>
      started.service.sendLocalOwnerMessage({ agentId: started.chief.id, text: "Send Alice a yes." }),
    );

    const answer = await callOpenBotTool(
      started.client,
      turn.threadId,
      "gmail_send",
      { to: ["alice@example.com"], subject: "Lunch", body: "Yes." },
      turn.turnId,
    );
    expect(openBotToolPayload(answer.result).status).toBe("waiting_for_approval");

    const [approval] = started.service.getRuntimeSnapshot("local").pendingApprovals;
    expect(approval?.reason).toContain("alice@example.com");
    expect(workspace.answers).toEqual([]);
    // The Team API and the phone read the shared snapshot and the shared events.
    expect(started.service.getRuntimeSnapshot().pendingApprovals).toEqual([]);
    const approvalEvent = events.find((event) => event.type === "approval");
    expect(approvalEvent && sharedAgentEvent(approvalEvent)).toBeNull();
    const snapshotEvent = events.findLast((event) => event.type === "runtime-snapshot");
    const sharedSnapshot = snapshotEvent && sharedAgentEvent(snapshotEvent);
    expect(sharedSnapshot?.type === "runtime-snapshot" && sharedSnapshot.snapshot.pendingApprovals).toEqual([]);

    const requestId = approval?.requestId ?? "";
    await expect(started.service.respondToApproval({ requestId, decision: "accept" })).rejects.toThrow(
      sourceText("error.connector.googleApprovalLocalOnly"),
    );
    await started.service.respondToApproval({ requestId, decision: "accept" }, "local-owner");
    await expect(started.service.respondToApproval({ requestId, decision: "accept" }, "local-owner")).rejects.toThrow(
      sourceText("error.backend.approvalInactive"),
    );
    expect(workspace.answers).toEqual([{ approvalId: "approval-1", decision: "accept" }]);
    const resolved = events.find((event) => event.type === "agent-input-resolved" && event.requestId === requestId);
    expect(resolved && sharedAgentEvent(resolved)).toBeNull();
  });
});

describe("local-only approvals in the runtime snapshot", () => {
  const card = (approvalId: string, owner: { agentId: string; threadId: string; turnId: string }) => ({
    approvalId,
    kind: "send" as const,
    ...owner,
    detail: "To: alice@example.com",
    complete: true,
  });

  it("Google cards take no place in the shared budget, survive the turn, and close on a disconnect", async () => {
    const workspace = workspaceStub();
    let cleared = 0;
    workspace.clearApprovals = async () => {
      cleared += 1;
    };
    const started = await startMailAgent(workspace);
    const turn = await nextTurn(started.client, () =>
      started.service.sendLocalOwnerMessage({ agentId: started.chief.id, text: "Run the checks." }),
    );
    const owner = { agentId: started.chief.id, threadId: turn.threadId, turnId: turn.turnId };
    started.service.surfaceGoogleApproval(card("google-1", owner));
    started.service.surfaceGoogleApproval(card("google-2", owner));
    for (const id of ["a1", "a2", "a3", "a4"]) {
      started.client.emit("request", {
        id,
        method: "item/commandExecution/requestApproval",
        params: { ...turn, command: `npm run ${id}` },
      });
    }
    await waitFor(() => started.service.getRuntimeSnapshot().pendingApprovals.length === 4);

    const shared = started.service.getRuntimeSnapshot();
    expect(shared.pendingApprovals.map((approval) => approval.requestId)).toEqual(["a1", "a2", "a3", "a4"]);
    expect(shared.attentionComplete).toBe(true);
    expect(started.service.getRuntimeSnapshot("local").attentionComplete).toBe(false);

    // The turn ends: the provider approvals close, the Google cards wait.
    started.client.emit(
      "notification",
      notification("turn/completed", { threadId: turn.threadId, turn: { id: turn.turnId, status: "completed" } }),
    );
    await waitFor(() => started.service.getRuntimeSnapshot("local").pendingApprovals.length === 2);
    expect(started.service.localOnlyApprovals().map((approval) => approval.requestId)).toEqual([
      "local-only:google:send:google-1",
      "local-only:google:send:google-2",
    ]);

    await started.service.clearGoogleApprovals();
    expect(cleared).toBe(1);
    expect(started.service.getRuntimeSnapshot("local").pendingApprovals).toEqual([]);
  });

  it("a card that cannot show the whole request can only be declined", async () => {
    const workspace = workspaceStub();
    const started = await startMailAgent(workspace);
    const owner = { agentId: started.chief.id, threadId: "thread-1", turnId: "turn-1" };
    started.service.surfaceGoogleApproval({ ...card("google-1", owner), complete: false });
    const [approval] = started.service.localOnlyApprovals();
    // The card title asks the question; the reason is only the request, so the question is not repeated.
    expect(approval).toMatchObject({ truncated: true, permissions: null, reason: "To: alice@example.com" });
    const requestId = approval?.requestId ?? "";

    await expect(started.service.respondToApproval({ requestId, decision: "accept" }, "local-owner")).rejects.toThrow(
      sourceText("error.connector.googleApprovalIncomplete"),
    );
    expect(workspace.answers).toEqual([]);
    await started.service.respondToApproval({ requestId, decision: "decline" }, "local-owner");
    expect(workspace.answers).toEqual([{ approvalId: "google-1", decision: "decline" }]);
  });
});

/** The text of the `index`th turn that the fake provider started. */
function promptText(client: FakeAgentClient, index: number): string {
  const start = client.requests.filter((request) => request.method === "turn/start")[index];
  return start
    ? inputRecords(start.params)
        .map((item) => (isString(item.text) ? item.text : ""))
        .join("\n")
    : "";
}
