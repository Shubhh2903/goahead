import { describe, expect, it } from "vitest";
import { isAgentEvent } from "./ipc-agent-events";
import { sharedAgentEvent } from "./ipc-local-only";

describe("local-only agent events", () => {
  it("never shares the held-text preview of a turn with another client", () => {
    const preview = {
      type: "turn-text-preview" as const,
      agentId: "chief",
      threadId: "thread-1",
      turnId: "turn-1",
      text: "Draft of an answer the turn has not published",
    };
    expect(isAgentEvent(preview)).toBe(true);
    expect(sharedAgentEvent(preview)).toBeNull();
    expect(isAgentEvent({ ...preview, text: "x".repeat(4_001) })).toBe(false);
  });
});
