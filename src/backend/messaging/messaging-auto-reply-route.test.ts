// @vitest-environment node

// Failure modes:
// - A pending turn takes a send or a turn event from any thread: "a pending route accepts no thread".
// - A reply context or main route takes another thread's send: "a known route accepts only its thread".
import { describe, expect, it } from "vitest";
import { autoReplyRouteAccepts } from "./messaging-auto-reply-route";

describe("autoReplyRouteAccepts", () => {
  it("a pending route accepts no thread", () => {
    expect(autoReplyRouteAccepts({ kind: "pending" }, "thread-other-context")).toBe(false);
    expect(autoReplyRouteAccepts({ kind: "pending" }, "")).toBe(false);
  });

  it("a known route accepts only its thread", () => {
    expect(autoReplyRouteAccepts({ kind: "context", threadId: "context-a" }, "context-a")).toBe(true);
    expect(autoReplyRouteAccepts({ kind: "context", threadId: "context-a" }, "context-b")).toBe(false);
    expect(autoReplyRouteAccepts({ kind: "main", threadId: "main" }, "main")).toBe(true);
    expect(autoReplyRouteAccepts({ kind: "main", threadId: "main" }, "context-a")).toBe(false);
  });
});
