import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";
import type { AcpRegistryDistribution } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { checkAcpAgent } from "../backend/acp-agent-check";
import { assertAgentArgs, assertWindowsScriptArgs, resolveAgentCommand } from "../backend/acp-agent-command";
import { AcpRegistryError, type RegistryAgent, registryDownload } from "./acp-registry-catalog";
import { runRegistryInstaller } from "./acp-registry-process";
import { assertSafeArchive, extractArchive, extractZipTree, rejectNonRegularFiles } from "./provider-runtime-archive";

const execFileAsync = promisify(execFile);
const BINARY_LIMIT_BYTES = 512 * 1024 * 1024;

/** The registry's name for this computer, such as `darwin-aarch64` or `windows-x86_64`. */
function registryTarget(platform = process.platform, arch = process.arch): string {
  return `${platform === "win32" ? "windows" : platform}-${arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : arch}`;
}

/** The distributions this computer can install, in order of preference. */
export function registryDistributions(agent: RegistryAgent): AcpRegistryDistribution[] {
  return [
    ...(agent.distribution.binary?.[registryTarget()] ? ["binary" as const] : []),
    ...(agent.distribution.npx ? ["npx" as const] : []),
    ...(agent.distribution.uvx ? ["uvx" as const] : []),
  ];
}

export interface RegistryPrepared {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export type PrepareRegistryAgent = (
  agent: RegistryAgent,
  distribution: AcpRegistryDistribution,
  folder: string,
  signal: AbortSignal,
) => Promise<RegistryPrepared>;

function invalidArchive(): AcpRegistryError {
  return new AcpRegistryError(sourceText("error.provider.nativeArchiveInvalid"));
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new AcpRegistryError(sourceText("error.provider.registryCancelled"));
}

/** Rejects paths before archive or package metadata can select an executable. */
function registryRelativePath(value: string): string {
  const path = value.replace(/^\.\//u, "");
  if (
    !path ||
    isAbsolute(path) ||
    /^[A-Za-z]:/u.test(path) ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw invalidArchive();
  return path;
}

async function packageCommand(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  signal: AbortSignal,
): Promise<void> {
  const executable = await resolveAgentCommand(command);
  if (!executable) throw new AcpRegistryError(sourceText("error.provider.registryPrerequisite", { tool: command }));
  await runRegistryInstaller(executable, args, cwd, env, signal);
}

async function prepareBinary(
  agent: RegistryAgent,
  payload: string,
  folder: string,
  signal: AbortSignal,
): Promise<RegistryPrepared> {
  const target = agent.distribution.binary?.[registryTarget()];
  if (!target) throw new AcpRegistryError(sourceText("error.provider.registryMissing"));
  const commandPath = registryRelativePath(target.cmd);
  const bytes = await registryDownload(target.archive, BINARY_LIMIT_BYTES, signal);
  throwIfCancelled(signal);
  if (target.sha256 && createHash("sha256").update(bytes).digest("hex") !== target.sha256.toLowerCase())
    throw new AcpRegistryError(sourceText("error.provider.nativeChecksum"));
  const archive = join(folder, "download");
  await writeFile(archive, bytes, { mode: 0o600 });
  const pathname = new URL(target.archive).pathname;
  if (pathname.endsWith(".zip")) {
    await extractZipTree(archive, payload, "", sourceText("error.provider.nativeArchiveInvalid"));
  } else if (pathname.endsWith(".tar.gz") || pathname.endsWith(".tgz")) {
    const listing = await execFileAsync("tar", ["-tzf", archive], {
      signal,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    const roots = listing.stdout
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((name) => name.split("/")[0] ?? "");
    await assertSafeArchive(archive, roots, sourceText("error.provider.nativeArchiveInvalid"));
    await extractArchive(archive, payload);
  } else {
    const command = join(payload, commandPath);
    await mkdir(dirname(command), { recursive: true });
    await copyFile(archive, command);
  }
  await rejectNonRegularFiles(payload);
  const prepared = { command: join(payload, commandPath), args: [...(target.args ?? [])], env: { ...target.env } };
  if (process.platform !== "win32") await chmod(prepared.command, 0o755);
  return prepared;
}

async function prepareNpx(
  agent: RegistryAgent,
  payload: string,
  folder: string,
  signal: AbortSignal,
): Promise<RegistryPrepared> {
  const target = agent.distribution.npx;
  if (!target) throw new AcpRegistryError(sourceText("error.provider.registryMissing"));
  await packageCommand(
    "npm",
    ["install", "--prefix", payload, "--omit=dev", "--no-audit", "--no-fund", "--save-exact", target.package],
    folder,
    {},
    signal,
  );
  const name = target.package.slice(0, target.package.lastIndexOf("@"));
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(join(payload, "node_modules", name, "package.json"), "utf8"));
  } catch {
    throw invalidArchive();
  }
  const bin = isDynamicRecord(manifest) ? manifest.bin : undefined;
  const bins = isString(bin) ? { [basename(name)]: bin } : isDynamicRecord(bin) ? bin : {};
  const entries = Object.entries(bins).filter((pair): pair is [string, string] => isString(pair[1]));
  const selected = entries.find(([key]) => key === basename(name)) ?? (entries.length === 1 ? entries[0] : undefined);
  if (!selected) throw invalidArchive();
  registryRelativePath(selected[1]);
  const binName = registryRelativePath(selected[0]);
  if (binName.includes("/")) throw invalidArchive();
  return {
    command: join(payload, "node_modules", ".bin", `${binName}${process.platform === "win32" ? ".cmd" : ""}`),
    args: [...(target.args ?? [])],
    env: { ...target.env },
  };
}

async function prepareUvx(
  agent: RegistryAgent,
  payload: string,
  folder: string,
  signal: AbortSignal,
): Promise<RegistryPrepared> {
  const target = agent.distribution.uvx;
  if (!target) throw new AcpRegistryError(sourceText("error.provider.registryMissing"));
  const binDirectory = join(payload, "bin");
  const env = { UV_TOOL_DIR: join(payload, "tools"), UV_TOOL_BIN_DIR: binDirectory };
  await packageCommand(
    "uv",
    ["tool", "install", "--no-progress", "--no-managed-python", target.package.replace(/@(?=v?\d)/u, "==")],
    folder,
    env,
    signal,
  );
  const names = await readdir(binDirectory);
  const packageName = target.package.split(/@|==/u)[0];
  const wanted = `${packageName}${process.platform === "win32" ? ".exe" : ""}`;
  const name = names.includes(wanted) ? wanted : names.length === 1 ? names[0] : undefined;
  if (!name) throw invalidArchive();
  return { command: join(binDirectory, name), args: [...(target.args ?? [])], env: { ...target.env } };
}

/**
 * Stages one distribution in `folder`, a unique permanent path: uv's virtual environments cannot be
 * moved after installation. The executable must stay inside the staged files, and the agent must
 * answer an ACP initialization before the caller activates it.
 */
export const prepareRegistryAgent: PrepareRegistryAgent = async (agent, distribution, folder, signal) => {
  const payload = join(folder, "runtime");
  await mkdir(payload, { recursive: true, mode: 0o700 });
  const prepared =
    distribution === "binary"
      ? await prepareBinary(agent, payload, folder, signal)
      : distribution === "npx"
        ? await prepareNpx(agent, payload, folder, signal)
        : await prepareUvx(agent, payload, folder, signal);
  throwIfCancelled(signal);
  const executable = await realpath(prepared.command).catch(() => {
    throw invalidArchive();
  });
  const within = relative(payload, executable);
  if (within.startsWith("..") || isAbsolute(within) || !(await stat(executable)).isFile()) throw invalidArchive();
  assertAgentArgs(prepared.args);
  assertWindowsScriptArgs(prepared.command, prepared.args);
  await checkAcpAgent({ executable: prepared.command, args: prepared.args, env: prepared.env });
  throwIfCancelled(signal);
  return prepared;
};
