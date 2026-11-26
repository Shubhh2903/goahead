import type { AgentModelOption, AgentReasoningEffort } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { type AutoModelChoice, type AutoModelInput, CACHE_WARM_MS, chooseTurnModel } from "./auto-model";

const option = (
  provider: "claude" | "codex",
  id: string,
  name: string,
  efforts: readonly AgentReasoningEffort[] = ["low", "medium", "high"],
) =>
  ({
    provider,
    id,
    name,
    description: "",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: [...efforts],
  }) satisfies AgentModelOption;

const MODELS = [
  option("claude", "claude-opus-5-5", "Claude Opus 5.5"),
  option("claude", "claude-sonnet-5-5", "Claude Sonnet 5.5"),
  option("codex", "gpt-5.6-sol", "GPT-5.6 Sol"),
  option("codex", "gpt-6-luna", "GPT-6 Luna"),
];

const NOW = 1_000_000_000;
const JUST_NOW = NOW - CACHE_WARM_MS + 1;
const QUIET = NOW - CACHE_WARM_MS;

function input(overrides: Partial<AutoModelInput> = {}): AutoModelInput {
  const agent = overrides.agent ?? {
    provider: "claude",
    model: "claude-opus-5-5",
    reasoningEffort: "high",
    autoModel: true,
  };
  return {
    agent,
    settings: { model: agent.model, reasoningEffort: agent.reasoningEffort },
    relay: false,
    messages: [{ sender: "person", text: "Thanks, sounds good!", attachmentCount: 0 }],
    models: () => MODELS,
    catalogListed: true,
    servesModel: () => true,
    lastTurn: null,
    now: NOW,
    ...overrides,
  };
}

const NO_DELEGATED: AutoModelInput["agent"] = {
  provider: "claude",
  model: "claude-opus-5-5",
  reasoningEffort: "high",
  autoModel: true,
  delegatedSmallModel: false,
};

const OWN: Omit<AutoModelChoice, "reason"> = {
  model: "claude-opus-5-5",
  reasoningEffort: "high",
  smallModelName: null,
};

describe("chooseTurnModel", () => {
  it("runs a short chat message from the person on the small model at low effort", () => {
    expect(chooseTurnModel(input())).toEqual({
      model: "claude-sonnet-5-5",
      reasoningEffort: "low",
      smallModelName: "Claude Sonnet 5.5",
      reason: "small-model",
    });
    expect(
      chooseTurnModel(
        input({ agent: { provider: "codex", model: "gpt-5.6-sol", reasoningEffort: "high", autoModel: true } }),
      ),
    ).toMatchObject({ model: "gpt-6-luna", reasoningEffort: "low", reason: "small-model" });
  });

  it.each([
    ["off", input({ agent: { provider: "claude", model: "claude-opus-5-5", reasoningEffort: "high" } })],
    [
      "off",
      input({ agent: { provider: "claude", model: "claude-opus-5-5", reasoningEffort: "high", autoModel: false } }),
    ],
    [
      "thread-profile",
      input({ settings: { model: "claude-sonnet-5-5", reasoningEffort: "low" } }),
      { model: "claude-sonnet-5-5", reasoningEffort: "low", smallModelName: null },
    ],
    ["relay", input({ relay: true })],
    [
      "not-from-person",
      input({ agent: NO_DELEGATED, messages: [{ sender: "teammate", text: "Done.", attachmentCount: 0 }] }),
    ],
    [
      "not-from-person",
      input({ agent: NO_DELEGATED, messages: [{ sender: "routine", text: "Say hi.", attachmentCount: 0 }] }),
    ],
    [
      "not-from-person",
      input({
        messages: [
          { sender: "teammate", text: "Done.", attachmentCount: 0 },
          { sender: "person", text: "Thanks!", attachmentCount: 0 },
        ],
      }),
    ],
    ["attachments", input({ messages: [{ sender: "person", text: "Look.", attachmentCount: 1 }] })],
    ["long-text", input({ messages: [{ sender: "person", text: "a".repeat(281), attachmentCount: 0 }] })],
    ["long-text", input({ messages: [{ sender: "person", text: "a\nb\nc\nd", attachmentCount: 0 }] })],
    ["work-words", input({ messages: [{ sender: "person", text: "Can you fix it?", attachmentCount: 0 }] })],
    ["work-words", input({ messages: [{ sender: "person", text: "Make a plan", attachmentCount: 0 }] })],
    ["work-words", input({ messages: [{ sender: "person", text: "Run `ls`", attachmentCount: 0 }] })],
    ["work-words", input({ messages: [{ sender: "person", text: "See notes.md", attachmentCount: 0 }] })],
    ["work-words", input({ messages: [{ sender: "person", text: "https://example.com", attachmentCount: 0 }] })],
    [
      "not-larger-model",
      input({ agent: { provider: "claude", model: "claude-sonnet-5-5", reasoningEffort: "high", autoModel: true } }),
      { model: "claude-sonnet-5-5", reasoningEffort: "high", smallModelName: null },
    ],
    [
      "not-larger-model",
      input({
        agent: { provider: "claude", model: "claude-opus-5-5[1m]", reasoningEffort: "high", autoModel: true },
      }),
      { model: "claude-opus-5-5[1m]", reasoningEffort: "high", smallModelName: null },
    ],
    ["catalog-not-listed", input({ catalogListed: false })],
    // The own model's cache is warm: a switch would read the conversation uncached.
    ["warm-cache", input({ lastTurn: { model: "claude-opus-5-5", at: JUST_NOW } })],
  ] as const)("keeps the turn's own model: %s", (reason, turn, own: Omit<AutoModelChoice, "reason"> = OWN) => {
    expect(chooseTurnModel(turn)).toEqual({ ...own, reason });
  });

  it("keeps the agent's model for a provider that takes no model per turn", () => {
    expect(
      chooseTurnModel(
        input({ agent: { provider: "grok", model: "grok-4.6", reasoningEffort: "medium", autoModel: true } }),
      ),
    ).toEqual({ model: "grok-4.6", reasoningEffort: "medium", smallModelName: null, reason: "provider-unsupported" });
  });

  it("stays on the small model when the last turn ran on it moments ago: its cache is warm", () => {
    expect(chooseTurnModel(input({ lastTurn: { model: "claude-sonnet-5-5", at: JUST_NOW } }))).toMatchObject({
      model: "claude-sonnet-5-5",
      reason: "small-model",
    });
  });

  it("goes to the small model after five quiet minutes, or with no turn yet: both caches are cold", () => {
    expect(chooseTurnModel(input({ lastTurn: { model: "claude-opus-5-5", at: QUIET } }))).toMatchObject({
      model: "claude-sonnet-5-5",
      reason: "small-model",
    });
    expect(chooseTurnModel(input({ lastTurn: null }))).toMatchObject({ reason: "small-model" });
  });

  it("falls back to the agent's model when the provider does not list the small model or no longer serves it", () => {
    const unlisted = MODELS.filter((model) => model.id !== "claude-sonnet-5-5");
    expect(chooseTurnModel(input({ models: () => unlisted }))).toEqual({ ...OWN, reason: "small-model-unavailable" });
    // Listed for another provider is not listed for this one.
    expect(
      chooseTurnModel(input({ models: () => [...unlisted, option("codex", "claude-sonnet-5-5", "Wrong")] })),
    ).toEqual({ ...OWN, reason: "small-model-unavailable" });
    expect(chooseTurnModel(input({ servesModel: (model) => model !== "claude-sonnet-5-5" }))).toEqual({
      ...OWN,
      reason: "small-model-unavailable",
    });
  });

  it("uses the small model's default effort when it does not list low", () => {
    const models = MODELS.map((model) =>
      model.id === "claude-sonnet-5-5" ? option("claude", model.id, model.name, ["medium", "high"]) : model,
    );
    expect(chooseTurnModel(input({ models: () => models }))).toMatchObject({
      model: "claude-sonnet-5-5",
      reasoningEffort: "medium",
    });
  });

  describe("teammate and routine turns", () => {
    const FABLE_MODELS = [option("claude", "claude-fable-5-2", "Claude Fable 5.2"), ...MODELS];
    const fable = (overrides: Partial<AutoModelInput["agent"]> = {}): AutoModelInput["agent"] => ({
      provider: "claude",
      model: "claude-fable-5-2",
      reasoningEffort: "high",
      ...overrides,
    });
    const delegated = (overrides: Partial<AutoModelInput> = {}) =>
      input({
        agent: fable(),
        models: () => FABLE_MODELS,
        messages: [
          { sender: "teammate", text: "Please implement the parser and write the tests.", attachmentCount: 1 },
          { sender: "teammate", text: "x".repeat(400), attachmentCount: 0 },
        ],
        // A warm cache on the agent's own model does not keep a delegated turn there.
        lastTurn: { model: "claude-fable-5-2", at: JUST_NOW },
        ...overrides,
      });
    const FABLE_OWN = { model: "claude-fable-5-2", reasoningEffort: "high", smallModelName: null };

    it("runs every-teammate and every-routine turns on the small model, effort capped at medium", () => {
      expect(chooseTurnModel(delegated())).toEqual({
        model: "claude-sonnet-5-5",
        reasoningEffort: "medium",
        smallModelName: "Claude Sonnet 5.5",
        reason: "delegated-small-model",
      });
      expect(
        chooseTurnModel(delegated({ messages: [{ sender: "routine", text: "Write the report", attachmentCount: 0 }] })),
      ).toMatchObject({ model: "claude-sonnet-5-5", reason: "delegated-small-model" });
      // A lower own effort stays.
      expect(chooseTurnModel(delegated({ agent: fable({ reasoningEffort: "low" }) }))).toMatchObject({
        model: "claude-sonnet-5-5",
        reasoningEffort: "low",
        reason: "delegated-small-model",
      });
    });

    it("never runs above medium when the small model does not list the capped effort", () => {
      const withEfforts = (efforts: readonly AgentReasoningEffort[], fallback: AgentReasoningEffort = "medium") =>
        FABLE_MODELS.map((model) =>
          model.id === "claude-sonnet-5-5"
            ? { ...option("claude", model.id, model.name, efforts), defaultReasoningEffort: fallback }
            : model,
        );
      // No medium: the highest effort under it, not the default.
      expect(chooseTurnModel(delegated({ models: () => withEfforts(["low", "high"], "high") }))).toMatchObject({
        model: "claude-sonnet-5-5",
        reasoningEffort: "low",
        reason: "delegated-small-model",
      });
      // Nothing at or under medium, and a default above it: the turn keeps the agent's model.
      expect(chooseTurnModel(delegated({ models: () => withEfforts(["high", "max"], "high") }))).toEqual({
        ...FABLE_OWN,
        reason: "small-model-unavailable",
      });
    });

    it.each([
      // One message from the person: the turn is the person's, and the existing rules decide.
      [
        "off",
        delegated({
          messages: [
            { sender: "teammate", text: "Done.", attachmentCount: 0 },
            { sender: "person", text: "Thanks!", attachmentCount: 0 },
          ],
        }),
        FABLE_OWN,
      ],
      ["off", delegated({ agent: fable({ delegatedSmallModel: false }) }), FABLE_OWN],
      [
        "not-larger-model",
        delegated({ agent: fable({ model: "claude-sonnet-5-5" }) }),
        { ...FABLE_OWN, model: "claude-sonnet-5-5" },
      ],
      ["catalog-not-listed", delegated({ catalogListed: false }), FABLE_OWN],
      [
        "small-model-unavailable",
        delegated({ models: () => FABLE_MODELS.filter((model) => model.id !== "claude-sonnet-5-5") }),
        FABLE_OWN,
      ],
      // The Slack reply profile keeps its own model and effort.
      [
        "off",
        delegated({ settings: { model: "claude-sonnet-5-5", reasoningEffort: "low" } }),
        { model: "claude-sonnet-5-5", reasoningEffort: "low", smallModelName: null },
      ],
    ] as const)("keeps the turn's own model: %s", (reason, turn, own) => {
      expect(chooseTurnModel(turn)).toEqual({ ...own, reason });
    });
  });
});
