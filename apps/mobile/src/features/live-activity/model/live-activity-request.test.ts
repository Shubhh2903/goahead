import type { AgentEvent, AgentRuntimeApproval } from "@openbot/contracts/ipc";
import { DynamicIslandCoordinator } from "@openbot/team-client/dynamic-island-coordinator";
import { type LiveActivityAction, liveActivityIslandText } from "@openbot/team-client/live-activity-props";
import { expect, it } from "vitest";
import { textFor } from "../../../shared/lib/text-value";
import { checkLiveActivityRequest } from "./live-activity-request";

const text = liveActivityIslandText(textFor("en").t);
const approval: AgentRuntimeApproval = {
  truncated: false,
  requestId: 7,
  agentId: "ada",
  threadId: "thread-ada",
  turnId: "turn-1",
  kind: "command",
  command: "npm test",
  cwd: null,
  reason: null,
  grantRoot: null,
  permissions: null,
};
const prompt = {
  requestId: 9,
  agentId: "ada",
  threadId: "thread-ada",
  turnId: "turn-1",
  questions: [
    {
      id: "deploy",
      header: "Deploy",
      question: "Deploy now?",
      isSecret: false,
      options: [
        { label: "Yes", description: "" },
        { label: "No", description: "" },
      ],
    },
  ],
};

function state(pendingApprovals: AgentRuntimeApproval[], pendingPrompts: (typeof prompt)[] = []) {
  const coordinator = new DynamicIslandCoordinator(() => text);
  const event: AgentEvent = {
    type: "runtime-snapshot",
    snapshot: {
      agents: [],
      activeTurns: [],
      work: [],
      latestMessages: [],
      attentionComplete: true,
      pendingPrompts,
      pendingApprovals,
      pendingBrowserTakeovers: [],
      failedTurns: [],
    },
  };
  coordinator.applyEvent({ serverId: "server-1", event }, "server-1");
  return coordinator.serverState("server-1");
}

const decline: LiveActivityAction = {
  type: "respond-approval",
  serverId: "server-1",
  agentId: "ada",
  requestId: 7,
  decision: "decline",
};
const answer = (label: string, requestId = 9) => ({
  action: {
    type: "answer-prompt" as const,
    serverId: "server-1",
    agentId: "ada",
    requestId,
    answers: { deploy: [label] },
  },
  command: null,
});

it("sends Decline and an answer only to the request that still waits", () => {
  expect(checkLiveActivityRequest({ action: decline, command: "npm test" }, state([approval]), text)).toBe("perform");
  expect(checkLiveActivityRequest({ action: decline, command: "make" }, state([approval]), text)).toBe("changed");
  expect(checkLiveActivityRequest({ action: decline, command: "npm test" }, state([]), text)).toBe("changed");

  expect(checkLiveActivityRequest(answer("Yes"), state([], [prompt]), text)).toBe("perform");
  expect(checkLiveActivityRequest(answer("Maybe"), state([], [prompt]), text)).toBe("changed");
  expect(checkLiveActivityRequest(answer("Yes", 10), state([], [prompt]), text)).toBe("changed");
  // Unknown host state never acts.
  expect(checkLiveActivityRequest(answer("Yes"), null, text)).toBe("changed");
});

it("matches Deny of a long command whose copies are cut at different lengths", () => {
  const long = `npm run deploy -- ${"x".repeat(282)}`;
  expect(long).toHaveLength(300);
  const full = { ...approval, command: long };
  // A runtime snapshot keeps 240 characters and marks the copy.
  const snapshotCopy = { ...approval, command: long.slice(0, 240), truncated: true };
  const deny = (command: string, { agentId = "ada", requestId = 7 } = {}) => ({
    action: {
      type: "respond-approval" as const,
      serverId: "server-1",
      agentId,
      requestId,
      decision: "decline" as const,
    },
    command,
  });

  // After a cold start the phone has the snapshot copy, and the host signed the whole command.
  expect(checkLiveActivityRequest(deny(long), state([snapshotCopy]), text)).toBe("perform");
  // The phone signed the snapshot copy, and a later event gave the whole command.
  expect(checkLiveActivityRequest(deny(long.slice(0, 240)), state([full]), text)).toBe("perform");

  expect(checkLiveActivityRequest(deny(long, { agentId: "grace" }), state([snapshotCopy]), text)).toBe("changed");
  expect(checkLiveActivityRequest(deny(long, { requestId: 8 }), state([snapshotCopy]), text)).toBe("changed");
  const other = `npm run destroy ${long.slice(16)}`;
  expect(other.slice(0, 240)).not.toBe(long.slice(0, 240));
  expect(checkLiveActivityRequest(deny(other), state([snapshotCopy]), text)).toBe("changed");
  // A shorter copy that is not cut at a known length is another command.
  expect(checkLiveActivityRequest(deny(long.slice(0, 200)), state([full]), text)).toBe("changed");
});

it("confirms Approve only for the whole waiting command, never for a cut copy of it", () => {
  const approve = (command: string) => ({
    action: {
      type: "respond-approval" as const,
      serverId: "server-1",
      agentId: "ada",
      requestId: 7,
      decision: "accept" as const,
    },
    command,
  });
  const held = (length: number) => ({ ...approval, command: `npm test ${"y".repeat(length - 9)}` });

  // The host would run the longer command, and the confirmation would show only its start.
  const long = held(300);
  expect(checkLiveActivityRequest(approve(long.command.slice(0, 240)), state([long]), text)).toBe("changed");
  const longer = held(700);
  expect(checkLiveActivityRequest(approve(longer.command.slice(0, 600)), state([longer]), text)).toBe("changed");
  expect(checkLiveActivityRequest(approve("npm test"), state([approval]), text)).toBe("confirm");
});
