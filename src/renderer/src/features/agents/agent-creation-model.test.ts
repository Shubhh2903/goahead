import type { AgentModelOption } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { resolveOrchestratorModel } from "./agent-creation-model";

const model = (provider: AgentModelOption["provider"], id: string): AgentModelOption => ({
  provider,
  id,
  name: id,
  description: "",
  defaultReasoningEffort: "medium",
  supportedReasoningEfforts: ["low", "medium", "high"],
});

describe("resolveOrchestratorModel", () => {
  it("starts the orchestrator on the newest Sonnet the catalog lists", () => {
    const options = [model("claude", "claude-opus-5-5"), model("claude", "claude-sonnet-5"), model("codex", "gpt-5.6")];
    expect(resolveOrchestratorModel(null, options)).toEqual({ provider: "claude", model: "claude-sonnet-5" });
    expect(resolveOrchestratorModel(null, [...options, model("claude", "claude-sonnet-5-5")])).toEqual({
      provider: "claude",
      model: "claude-sonnet-5-5",
    });
  });

  it("falls back to a new agent's model when no Sonnet is listed", () => {
    expect(resolveOrchestratorModel(null, [model("codex", "gpt-5.6")])).toEqual({
      provider: "codex",
      model: "gpt-5.6",
    });
  });
});
