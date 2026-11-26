import { describe, expect, it } from "vitest";
import { TurnBudget, turnLimitFor } from "./turn-limit";

describe("turnLimitFor", () => {
  it("gives 40 calls and 3,000,000 tokens when the agent has no setting", () => {
    expect(turnLimitFor(undefined)).toEqual({ calls: 40, tokens: 3_000_000 });
  });

  it("gives no limit for Off and 75,000 tokens per call for the others", () => {
    expect(turnLimitFor(0)).toBeNull();
    expect(turnLimitFor(100)?.tokens).toBe(7_500_000);
  });
});

describe("TurnBudget", () => {
  it("reaches the call limit once, on the 40th call", () => {
    const budget = new TurnBudget({ calls: 40, tokens: 3_000_000 });
    for (let call = 1; call < 40; call += 1) expect(budget.recordToolCall()).toBe(false);
    expect(budget.recordToolCall()).toBe(true);
    expect(budget.recordToolCall()).toBe(false);
    expect(budget.calls).toBe(41);
  });

  it("counts tokens from the first thread total of the turn", () => {
    const budget = new TurnBudget({ calls: 40, tokens: 3_000_000 });
    expect(budget.recordProcessedTokens(1_000_000)).toBe(false);
    expect(budget.recordProcessedTokens(3_999_999)).toBe(false);
    expect(budget.recordProcessedTokens(4_000_000)).toBe(true);
    expect(budget.tokens).toBe(3_000_000);
    expect(budget.recordProcessedTokens(5_000_000)).toBe(false);
  });

  it("counts only the rise after a compaction lowers the thread total", () => {
    const budget = new TurnBudget({ calls: 40, tokens: 3_000_000 });
    budget.recordProcessedTokens(1_000_000);
    budget.recordProcessedTokens(2_000_000);
    expect(budget.recordProcessedTokens(500_000)).toBe(false);
    expect(budget.tokens).toBe(1_000_000);
    expect(budget.recordProcessedTokens(2_499_999)).toBe(false);
    expect(budget.recordProcessedTokens(2_500_000)).toBe(true);
    expect(budget.tokens).toBe(3_000_000);
  });
});
