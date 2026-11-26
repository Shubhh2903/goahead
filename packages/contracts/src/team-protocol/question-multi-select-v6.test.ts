import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../ipc-agent-events";
import type { AgentRuntimePromptQuestion } from "../ipc-agent-runtime";
import { encodeTeamProtocolV1CurrentEvent } from "./v1-adapter";
import { encodeTeamProtocolV4BaseCurrentEvent } from "./v4-base-adapter";
import { encodeTeamProtocolV5BaseCurrentEvent } from "./v5-base-adapter";
import { decodeTeamProtocolV6BaseEvent } from "./v6-base";
import { decodeTeamProtocolV6BaseCurrentEvent, encodeTeamProtocolV6BaseCurrentEvent } from "./v6-base-adapter";

const options = [
  { label: "Red", description: "" },
  { label: "Blue", description: "" },
];

function promptEvent(multiSelect?: true): AgentEvent {
  return {
    type: "prompt",
    requestId: "request-1",
    agentId: "agent-1",
    threadId: "thread-1",
    turnId: "turn-1",
    questions: [{ id: "color", header: "Color", question: "Which colors?", isSecret: false, options, multiSelect }],
  };
}

describe("question multi-select", () => {
  it("carries multiSelect: true from the host to the current client", () => {
    const wire = encodeTeamProtocolV6BaseCurrentEvent(promptEvent(true));
    expect(wire).toContain('"multiSelect":true');
    const decoded = decodeTeamProtocolV6BaseCurrentEvent(JSON.parse(wire ?? ""));
    expect(decoded).toMatchObject({
      kind: "known",
      event: { type: "prompt", questions: [{ id: "color", multiSelect: true }] },
    });
  });

  it("shows an older client a usable single-choice question", () => {
    const wire = encodeTeamProtocolV6BaseCurrentEvent(promptEvent(true));
    // The frozen codec is what a client without this change runs.
    const older = decodeTeamProtocolV6BaseEvent(JSON.parse(wire ?? ""));
    expect(older.kind).toBe("known");
    if (older.kind !== "known" || older.event.type !== "prompt") throw new Error("Expected a prompt.");
    expect(older.event.questions[0]).toMatchObject({ id: "color", options });
    expect(older.event.questions[0]).not.toHaveProperty("multiSelect");
  });

  it("leaves the key out of a single-choice question and fails closed on a bad value", () => {
    expect(encodeTeamProtocolV6BaseCurrentEvent(promptEvent())).not.toContain("multiSelect");
    const bad = promptEvent();
    if (bad.type !== "prompt") throw new Error("Expected a prompt.");
    Object.assign(bad.questions[0] ?? {}, { multiSelect: "yes" });
    expect(() => encodeTeamProtocolV6BaseCurrentEvent(bad)).toThrow("Invalid multi-select question marker.");
  });

  // The host's own runtime snapshot says `multiSelect` for its Live Activity push. The released
  // snapshot wire has no such key, so every adapter must send the same bytes with or without it.
  it("sends the same runtime snapshot bytes whether or not the host copy has multiSelect", () => {
    const snapshot = (multiSelect?: boolean): AgentEvent => {
      const question: AgentRuntimePromptQuestion = {
        id: "color",
        header: "Color",
        question: "Which colors?",
        isSecret: false,
        options,
        ...(multiSelect === undefined ? {} : { multiSelect }),
      };
      return {
        type: "runtime-snapshot",
        snapshot: {
          agents: [],
          activeTurns: [],
          work: [],
          latestMessages: [],
          attentionComplete: true,
          pendingPrompts: [
            {
              requestId: "request-1",
              agentId: "agent-1",
              threadId: "thread-1",
              turnId: "turn-1",
              questions: [question],
            },
          ],
          pendingApprovals: [],
          pendingBrowserTakeovers: [],
          failedTurns: [],
        },
      };
    };
    for (const encode of [
      encodeTeamProtocolV1CurrentEvent,
      encodeTeamProtocolV4BaseCurrentEvent,
      encodeTeamProtocolV5BaseCurrentEvent,
      encodeTeamProtocolV6BaseCurrentEvent,
    ]) {
      const without = encode(snapshot());
      expect(without).toContain('"questions":[{"id":"color"');
      expect(encode(snapshot(true))).toBe(without);
      expect(encode(snapshot(false))).toBe(without);
    }
  });
});
