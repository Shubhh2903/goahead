import { DEFAULT_COMPACT_WINDOW } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { claudeCompactWindowEnvironment } from "./claude-client";
import { claudeAgentEnvironment } from "./provider-drivers";

/**
 * The Claude thread environment puts the agent part after the client environment, as
 * `ClaudeAgentClient` does when it starts a thread.
 */
function threadCompactWindow(agentWindow: number | null, hostWindow: number | null): string | undefined {
  const client = claudeAgentEnvironment({ claudeCompactWindow: () => hostWindow })();
  return { ...client, ...claudeCompactWindowEnvironment(agentWindow) }.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
}

describe("Claude compact window order", () => {
  it("uses the agent's window before the host setting", () => {
    expect(threadCompactWindow(200_000, 80_000)).toBe("200000");
  });

  it("uses the host setting when the agent has no window", () => {
    expect(threadCompactWindow(null, 80_000)).toBe("80000");
  });

  it("uses the default window when neither is set", () => {
    expect(threadCompactWindow(null, null)).toBe(String(DEFAULT_COMPACT_WINDOW));
    expect(DEFAULT_COMPACT_WINDOW).toBe(120_000);
  });
});
