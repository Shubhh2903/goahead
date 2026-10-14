import { type ChildProcess, spawn } from "node:child_process";
import { sourceText } from "@openbot/i18n/source";
import { cliSpawnTarget } from "../backend/cli";
import { stopWindowsProcessTree } from "../backend/windows-process-tree";
import { AcpRegistryError } from "./acp-registry-catalog";

const INSTALLER_TIMEOUT_MS = 300_000;
const STOP_GRACE_MS = 2_000;

/**
 * Runs one package installer (`npm` or `uv`) and owns its process group until the group has exited.
 * A cancel, a timeout or a failure stops the whole group before the promise settles, so no installer
 * keeps writing into a folder that the caller then removes.
 */
export async function runRegistryInstaller(
  executable: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new AcpRegistryError(sourceText("error.provider.registryCancelled"));
  const target = cliSpawnTarget(executable, args);
  const child = spawn(target.command, target.args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "ignore",
    windowsVerbatimArguments: target.windowsVerbatimArguments,
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  const closed = new Promise<number | null>((resolve) => {
    child.once("close", (code) => resolve(code));
    child.once("error", () => resolve(null));
  });
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const stopped = new Promise<"timeout" | "cancelled">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), INSTALLER_TIMEOUT_MS);
    onAbort = () => resolve("cancelled");
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const outcome = await Promise.race([closed, stopped]);
    if (outcome === "cancelled") throw new AcpRegistryError(sourceText("error.provider.registryCancelled"));
    if (outcome !== 0) throw new AcpRegistryError(sourceText("error.provider.registryInstallFailed"));
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    await stopInstaller(child, closed);
  }
}

async function stopInstaller(child: ChildProcess, closed: Promise<unknown>): Promise<void> {
  if (process.platform === "win32") {
    await stopWindowsProcessTree(child).catch(() => undefined);
    return;
  }
  const signalGroup = (value: NodeJS.Signals) => {
    try {
      if (child.pid) process.kill(-child.pid, value);
    } catch {
      // The owned group has already exited.
    }
  };
  signalGroup("SIGTERM");
  let grace: NodeJS.Timeout | undefined;
  const late = new Promise<"late">((resolve) => {
    grace = setTimeout(() => resolve("late"), STOP_GRACE_MS);
  });
  const result = await Promise.race([closed, late]);
  clearTimeout(grace);
  if (result === "late") {
    signalGroup("SIGKILL");
    await closed;
  }
  // A process the leader left behind in the group.
  signalGroup("SIGKILL");
}
