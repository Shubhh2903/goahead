import { type AgentTurnLimit, DEFAULT_TURN_LIMIT } from "@openbot/contracts/ipc";

/** The processed tokens a turn may use for each tool call that its limit allows. */
export const TOKENS_PER_TOOL_CALL_LIMIT = 75_000;

/** The limits of one turn for the agent's setting, or null when the setting is Off. */
export function turnLimitFor(setting: AgentTurnLimit | undefined): { calls: number; tokens: number } | null {
  const calls = setting ?? DEFAULT_TURN_LIMIT;
  if (calls === 0) return null;
  return { calls, tokens: calls * TOKENS_PER_TOOL_CALL_LIMIT };
}

/**
 * What one turn used against its limits. Each record method answers true once, at the record that
 * first reaches a limit, so the host stops the turn and asks once.
 */
export class TurnBudget {
  readonly #limit: { calls: number; tokens: number };
  #calls = 0;
  #tokens = 0;
  /** The thread total that the next rise is measured from. Null until the first total. */
  #lastTotal: number | null = null;
  #reached = false;

  constructor(limit: { calls: number; tokens: number }) {
    this.#limit = limit;
  }

  get calls(): number {
    return this.#calls;
  }

  get tokens(): number {
    return this.#tokens;
  }

  recordToolCall(): boolean {
    this.#calls += 1;
    return this.#reach(this.#calls >= this.#limit.calls);
  }

  /**
   * `total` is the processed tokens of the whole thread. The first total is the baseline. A total
   * lower than the last one, after a compaction, becomes the new baseline: only a rise counts.
   */
  recordProcessedTokens(total: number): boolean {
    if (!Number.isFinite(total) || total < 0) return false;
    if (this.#lastTotal !== null && total > this.#lastTotal) this.#tokens += total - this.#lastTotal;
    this.#lastTotal = total;
    return this.#reach(this.#tokens >= this.#limit.tokens);
  }

  #reach(over: boolean): boolean {
    if (!over || this.#reached) return false;
    this.#reached = true;
    return true;
  }
}

/**
 * The processed tokens of the running turn, from a client whose provider reports no thread total
 * while the turn works. `processedTokens` is the sum for this turn so far.
 */
export const TURN_TOKENS_METHOD = "openbot/turnTokens";
