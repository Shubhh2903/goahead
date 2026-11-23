import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { RoutineRunCondition } from "@openbot/contracts/ipc";
import { loginShellCommand } from "../cli";

/**
 * The check a scheduled routine run makes before it starts the agent. The command runs on this
 * computer, in the agent's working directory, as the agent's own shell commands do. A run that the
 * check skips makes no model turn, which is the point: a routine that watches for a change spends
 * nothing while nothing changes.
 *
 * The check fails open. A command that cannot start, runs too long or prints too much starts the
 * agent as if there were no condition, so a broken check never silently stops a routine.
 */

/** A check that takes longer than this starts the agent. The scheduler waits for it. */
export const RUN_CONDITION_TIMEOUT_MS = 30_000;
const RUN_CONDITION_MAX_OUTPUT_BYTES = 256 * 1024;

export interface RunConditionResult {
  exitCode: number;
  output: string;
}

export type RunConditionDecision =
  | { run: true; fingerprint?: string }
  | { run: false; reason: "condition-not-met" | "unchanged" };

export type RunConditionCommand = (command: string, cwd: string) => Promise<RunConditionResult>;

/** Whether the run starts the agent, and the fingerprint to keep when it does. */
export async function decideRunCondition(
  condition: RoutineRunCondition,
  cwd: string,
  previousFingerprint: string | null,
  runCommand: RunConditionCommand = runConditionCommand,
): Promise<RunConditionDecision> {
  let result: RunConditionResult;
  try {
    result = await runCommand(condition.command, cwd);
  } catch {
    return { run: true };
  }
  if (result.exitCode !== 0) return { run: false, reason: "condition-not-met" };
  if (condition.when === "exit-zero") return { run: true };
  const fingerprint = createHash("sha256").update(result.output).digest("hex");
  return fingerprint === previousFingerprint ? { run: false, reason: "unchanged" } : { run: true, fingerprint };
}

/**
 * Runs `command` in the user's login shell, so it finds what their terminal finds. The shell gets a
 * session of its own and the whole group ends on timeout, as in `runInLoginShell`. Unlike that
 * helper, a non-zero exit is an answer here, not a failure.
 */
export function runConditionCommand(command: string, cwd: string): Promise<RunConditionResult> {
  const shell = loginShellCommand();
  return new Promise((resolve, reject) => {
    const child = spawn(shell.command, [...shell.args, command], {
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let failure: Error | null = null;
    const stop = (error: Error) => {
      if (failure) return;
      failure = error;
      child.stdout.destroy();
      child.stderr.destroy();
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {
        // The group has already exited.
      }
    };
    const timer = setTimeout(
      () => stop(new Error("The run condition did not finish in time.")),
      RUN_CONDITION_TIMEOUT_MS,
    );
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > RUN_CONDITION_MAX_OUTPUT_BYTES) stop(new Error("The run condition printed too much output."));
      else chunks.push(chunk);
    });
    // Drained and dropped: only the output and the exit code decide.
    child.stderr.resume();
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code === null) reject(new Error(`The run condition ended with ${signal ?? "no exit code"}.`));
      else resolve({ exitCode: code, output: Buffer.concat(chunks).toString("utf8") });
    });
  });
}
