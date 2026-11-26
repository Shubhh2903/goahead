import {
  AGENT_REASONING_EFFORTS,
  type AgentModelOption,
  type AgentReasoningEffort,
  type AgentSummary,
  agentAutoModelEnabled,
  agentDelegatedSmallModelEnabled,
  defaultProviderModel,
  providerSupportsAutoModel,
} from "@openbot/contracts/ipc";

/**
 * The automatic model choice of one turn: a cheap, local rule with no model call. It picks the
 * agent's own model or the provider's small model, for this turn only. The plan
 * `docs/superpowers/plans/2026-11-24-v0.40-auto-model.md` has the rule table; each `reason` is one
 * row. Whenever the rule is not sure, the turn keeps the agent's own model.
 */

/** Text longer than this, or with more lines, is work rather than a chat line. */
export const AUTO_MODEL_MAX_CHARACTERS = 280;
export const AUTO_MODEL_MAX_LINES = 3;
/**
 * How long a provider's prompt cache stays warm after a turn ends. The cache is per model: a turn on
 * another model reads the whole conversation (system prompt, tools and history) without it. So a
 * turn switches model only when the own model's cache is cold anyway, or stays on the small model
 * whose cache is warm.
 */
export const CACHE_WARM_MS = 5 * 60_000;

const SMALL_MODEL_EFFORT: AgentReasoningEffort = "low";
/** The highest effort a teammate or routine turn on the small model takes. */
const DELEGATED_MAX_EFFORT: AgentReasoningEffort = "medium";

// Work that a short message can still ask for. A match keeps the agent's own model.
const WORK_WORDS =
  /\b(?:code|coding|fix|bug|debug|build|implement|refactor|deploy|test|plan|analy[sz]|review|write|create|research|compare|file|script|error|function|install|search|summari[sz]|draft|report|schedul|routine|email|spreadsheet)/iu;
const CODE_OR_PATH =
  /`|https?:\/\/|www\.|(?:^|\s)[~.]?\/\S|\b\w+\.(?:ts|tsx|js|jsx|py|md|json|txt|csv|pdf|docx?|xlsx?|html|css|sh)\b/iu;

/** Whether a model is larger than the provider's small model. An unknown model is not. */
function isLargerModel(provider: AgentSummary["provider"], model: string): boolean {
  // A long-context variant can hold more than the small model's window.
  if (model.includes("[")) return false;
  if (provider === "claude") return /^claude-(?:opus|fable)-/u.test(model);
  if (provider === "codex") return /^gpt-.*-(?:terra|sol|astra)(?:-|$)/u.test(model);
  return false;
}

export type AutoModelReason =
  | "off"
  | "provider-unsupported"
  | "thread-profile"
  | "relay"
  | "not-from-person"
  | "attachments"
  | "long-text"
  | "work-words"
  | "not-larger-model"
  | "catalog-not-listed"
  | "small-model-unavailable"
  | "warm-cache"
  | "small-model"
  | "delegated-small-model";

export interface AutoModelMessage {
  sender: "person" | "teammate" | "routine";
  text: string;
  attachmentCount: number;
}

export interface AutoModelInput {
  agent: Pick<AgentSummary, "provider" | "model" | "reasoningEffort" | "autoModel" | "delegatedSmallModel">;
  /** The model and effort of the turn before the choice: the agent's own, or a thread profile's. */
  settings: { model: string; reasoningEffort: AgentReasoningEffort };
  /** A channel task or an external conversation, such as a Slack thread. */
  relay: boolean;
  messages: readonly AutoModelMessage[];
  /** The provider's model list now. Read only when the rule gets that far. */
  models: () => readonly AgentModelOption[];
  /**
   * Whether the provider's own CLI listed the models in that list, at its last read. A list that is
   * still `FALLBACK_MODELS`, or one kept after a failed read, may name a model the CLI does not serve.
   */
  catalogListed: boolean;
  /** False for a model whose endpoint was removed. */
  servesModel: (model: string) => boolean;
  /**
   * The last turn the provider accepted on this provider thread in this run: its model, and when it
   * ended. Null when there was none, as after a restart, whose new process has a cold cache.
   */
  lastTurn: { model: string; at: number } | null;
  now: number;
}

export interface AutoModelChoice {
  model: string;
  reasoningEffort: AgentReasoningEffort;
  /** The display name of the small model, set only when the turn runs on it. */
  smallModelName: string | null;
  reason: AutoModelReason;
}

export function chooseTurnModel(input: AutoModelInput): AutoModelChoice {
  const { agent, settings } = input;
  const keep = (reason: AutoModelReason): AutoModelChoice => ({
    model: settings.model,
    reasoningEffort: settings.reasoningEffort,
    smallModelName: null,
    reason,
  });
  const delegated = chooseDelegatedModel(input, keep);
  if (delegated) return delegated;
  if (!agentAutoModelEnabled(agent)) return keep("off");
  if (!providerSupportsAutoModel(agent.provider)) return keep("provider-unsupported");
  if (settings.model !== agent.model || settings.reasoningEffort !== agent.reasoningEffort) {
    return keep("thread-profile");
  }
  if (input.relay) return keep("relay");
  if (input.messages.length === 0 || input.messages.some((message) => message.sender !== "person")) {
    return keep("not-from-person");
  }
  if (input.messages.some((message) => message.attachmentCount > 0)) return keep("attachments");
  const text = input.messages.map((message) => message.text).join("\n");
  if (text.length > AUTO_MODEL_MAX_CHARACTERS || text.split("\n").length > AUTO_MODEL_MAX_LINES) {
    return keep("long-text");
  }
  if (WORK_WORDS.test(text) || CODE_OR_PATH.test(text)) return keep("work-words");
  if (!isLargerModel(agent.provider, agent.model)) return keep("not-larger-model");
  if (!input.catalogListed) return keep("catalog-not-listed");
  const smallId = defaultProviderModel(agent.provider);
  const small = input.models().find((model) => model.provider === agent.provider && model.id === smallId);
  if (!small || !input.servesModel(small.id)) return keep("small-model-unavailable");
  // A warm cache on another model than the small one: switching would read the conversation uncached.
  const { lastTurn } = input;
  if (lastTurn && input.now - lastTurn.at < CACHE_WARM_MS && lastTurn.model !== small.id) {
    return keep("warm-cache");
  }
  return {
    model: small.id,
    reasoningEffort: small.supportedReasoningEfforts.includes(SMALL_MODEL_EFFORT)
      ? SMALL_MODEL_EFFORT
      : small.defaultReasoningEffort,
    smallModelName: small.name,
    reason: "small-model",
  };
}

/**
 * A turn whose every message comes from a teammate or a routine runs on the provider's small model
 * when the agent's own model is larger, with the "Use the smaller model for teammate and routine
 * turns" setting on (the default). It needs no `autoModel` and no short-text check, and it ignores the
 * warm cache: the small model costs less even on a cold read. A thread profile, such as the Slack
 * reply profile, keeps its own rule. Null when the rule does not apply, so the other rules decide.
 */
function chooseDelegatedModel(
  input: AutoModelInput,
  keep: (reason: AutoModelReason) => AutoModelChoice,
): AutoModelChoice | null {
  const { agent, settings } = input;
  if (!agentDelegatedSmallModelEnabled(agent)) return null;
  if (!providerSupportsAutoModel(agent.provider)) return null;
  if (settings.model !== agent.model || settings.reasoningEffort !== agent.reasoningEffort) return null;
  if (input.messages.length === 0 || input.messages.some((message) => message.sender === "person")) return null;
  if (!isLargerModel(agent.provider, agent.model)) return keep("not-larger-model");
  if (!input.catalogListed) return keep("catalog-not-listed");
  const smallId = defaultProviderModel(agent.provider);
  const small = input.models().find((model) => model.provider === agent.provider && model.id === smallId);
  if (!small || !input.servesModel(small.id)) return keep("small-model-unavailable");
  const reasoningEffort = delegatedEffort(agent.reasoningEffort, small);
  if (!reasoningEffort) return keep("small-model-unavailable");
  return {
    model: small.id,
    reasoningEffort,
    smallModelName: small.name,
    reason: "delegated-small-model",
  };
}

/**
 * The agent's own effort, capped at medium: the highest effort the small model supports at or below
 * that cap. The small model's default counts only when it lists no effort at or below the cap and the
 * default is not above it. Null when no effort fits, so the turn keeps the agent's model.
 */
function delegatedEffort(own: AgentReasoningEffort, small: AgentModelOption): AgentReasoningEffort | null {
  const rank = (effort: AgentReasoningEffort) => AGENT_REASONING_EFFORTS.indexOf(effort);
  const cap = Math.min(rank(own), rank(DELEGATED_MAX_EFFORT));
  const supported = small.supportedReasoningEfforts.filter((effort) => rank(effort) <= cap);
  const highest = supported.reduce<AgentReasoningEffort | null>(
    (best, effort) => (best === null || rank(effort) > rank(best) ? effort : best),
    null,
  );
  if (highest) return highest;
  return rank(small.defaultReasoningEffort) <= cap ? small.defaultReasoningEffort : null;
}
