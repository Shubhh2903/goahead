import { describe, expect, it } from "vitest";
import { decideRunCondition, type RunConditionCommand } from "./routine-run-condition";

const answer =
  (exitCode: number, output: string): RunConditionCommand =>
  async () => ({ exitCode, output });

describe("routine run condition", () => {
  it("starts the agent only when the output changes, and keeps the new fingerprint", async () => {
    const condition = { command: "git log -1 --format=%H", when: "output-changes" as const };
    const first = await decideRunCondition(condition, "/work", null, answer(0, "abc123\n"));
    expect(first).toMatchObject({ run: true });
    if (!first.run || !first.fingerprint) throw new Error("The first check gave no fingerprint.");

    await expect(decideRunCondition(condition, "/work", first.fingerprint, answer(0, "abc123\n"))).resolves.toEqual({
      run: false,
      reason: "unchanged",
    });
    await expect(
      decideRunCondition(condition, "/work", first.fingerprint, answer(0, "def456\n")),
    ).resolves.toMatchObject({ run: true });
  });

  it("skips when the command fails, and starts the agent when the command cannot run", async () => {
    const condition = { command: "test -f inbox/new.csv", when: "exit-zero" as const };
    await expect(decideRunCondition(condition, "/work", null, answer(1, ""))).resolves.toEqual({
      run: false,
      reason: "condition-not-met",
    });
    await expect(decideRunCondition(condition, "/work", null, answer(0, ""))).resolves.toEqual({ run: true });
    // A check that times out or cannot start must not stop the routine without a word.
    const broken: RunConditionCommand = async () => {
      throw new Error("The run condition did not finish in time.");
    };
    await expect(decideRunCondition(condition, "/work", null, broken)).resolves.toEqual({ run: true });
  });
});
