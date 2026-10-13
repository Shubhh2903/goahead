import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Local cache for the remote desktop source build. It stores source archives by SHA-256 and bare git
 * mirrors by remote URL. The cache is never trusted: an archive is used only when its SHA-256 equals
 * the lock, and every checked-out submodule HEAD must equal the commit that the lock pins.
 */

export function remoteDesktopCacheRoot(): string {
  return resolve("build/remote-desktop-cache");
}

export function sha256Hex(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function archiveCachePath(root: string, sha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`Invalid SHA-256: ${sha256}.`);
  return join(root, "archives", sha256);
}

export function mirrorCachePath(root: string, url: string): string {
  return join(root, "mirrors", `${sha256Hex(url)}.git`);
}

/** Returns the cached archive bytes only when their SHA-256 equals the expected one. */
export async function readCachedArchive(root: string, sha256: string): Promise<Buffer | null> {
  const path = archiveCachePath(root, sha256);
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    return null;
  }
  if (sha256Hex(bytes) === sha256) return bytes;
  await rm(path, { force: true });
  return null;
}

export interface GitStep {
  args: string[];
}

/**
 * The commands that fill one submodule of a parent repo from a local mirror. `update` checks out the
 * commit that the parent tree records; the caller then compares it with the lock. The URL goes back
 * to the real one afterwards, so the work tree does not point at the cache.
 */
export function submodulePlan(entry: { name: string; path: string; url: string; mirror: string }): GitStep[] {
  const key = `submodule.${entry.name}.url`;
  return [
    { args: ["submodule", "init", "--", entry.path] },
    { args: ["config", key, entry.mirror] },
    { args: ["-c", "protocol.file.allow=always", "submodule", "update", "--", entry.path] },
    { args: ["config", key, entry.url] },
  ];
}

export function verifyPinnedCommit(path: string, expected: string | undefined, actual: string): void {
  if (!expected) throw new Error(`The required submodule is not pinned: ${path}.`);
  if (actual.trim() !== expected) throw new Error(`Unexpected submodule commit for ${path}.`);
}

export function parseGitmodulesPaths(output: string): Map<string, string> {
  const byPath = new Map<string, string>();
  for (const line of output.split("\n")) {
    const match = /^submodule\.(.+)\.path (.+)$/.exec(line.trim());
    if (match?.[1] && match[2]) byPath.set(match[2], match[1]);
  }
  return byPath;
}

export async function withRetries<T>(
  action: () => T | Promise<T>,
  options: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 2000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      if (attempt >= attempts) throw error;
      await sleep(delayMs * 2 ** (attempt - 1));
    }
  }
}

function hasCommit(mirror: string, commit: string): boolean {
  try {
    execFileSync("git", ["-C", mirror, "cat-file", "-e", `${commit}^{commit}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Makes a bare mirror of `url` that holds `commit`. Clones once, fetches when the commit is missing. */
export async function ensureMirror(root: string, url: string, commit: string): Promise<string> {
  const mirror = mirrorCachePath(root, url);
  let exists = true;
  try {
    execFileSync("git", ["-C", mirror, "rev-parse", "--git-dir"], { stdio: "ignore" });
  } catch {
    exists = false;
  }
  if (exists && hasCommit(mirror, commit)) return mirror;
  await withRetries(async () => {
    if (exists) {
      execFileSync("git", ["-C", mirror, "fetch", "--quiet", "--prune", "origin", "+refs/*:refs/*"], {
        stdio: "inherit",
      });
    } else {
      await rm(mirror, { recursive: true, force: true });
      execFileSync("git", ["clone", "--quiet", "--mirror", url, mirror], { stdio: "inherit" });
      exists = true;
    }
  });
  if (!hasCommit(mirror, commit)) {
    // A pinned commit may sit on no ref (for example a force-pushed branch); ask for it by id.
    await withRetries(() =>
      execFileSync("git", ["-C", mirror, "fetch", "--quiet", "origin", commit], { stdio: "inherit" }),
    );
  }
  if (!hasCommit(mirror, commit)) throw new Error(`The mirror of ${url} lacks the pinned commit ${commit}.`);
  return mirror;
}

/** Fills `submodulePaths` (direct children of the repo at `cwd`) from mirrors and verifies each commit. */
export async function populateSubmodulesFromCache(
  root: string,
  cwd: string,
  submodulePaths: string[],
  expectedCommit: (path: string) => string | undefined,
  prefix = "",
): Promise<void> {
  if (submodulePaths.length === 0) return;
  const names = parseGitmodulesPaths(
    execFileSync("git", ["config", "-f", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"], {
      cwd,
      encoding: "utf8",
    }),
  );
  for (const path of submodulePaths) {
    const name = names.get(path);
    if (!name) throw new Error(`The submodule is not in .gitmodules: ${prefix}${path}.`);
    const url = execFileSync("git", ["config", "-f", ".gitmodules", `submodule.${name}.url`], {
      cwd,
      encoding: "utf8",
    }).trim();
    if (!/^https:\/\//.test(url)) throw new Error(`The submodule URL is not an HTTPS URL: ${prefix}${path}.`);
    const commit = expectedCommit(`${prefix}${path}`);
    if (!commit) throw new Error(`The required submodule is not pinned: ${prefix}${path}.`);
    const mirror = await ensureMirror(root, url, commit);
    for (const step of submodulePlan({ name, path, url, mirror })) {
      execFileSync("git", step.args, { cwd, stdio: "inherit" });
    }
    const actual = execFileSync("git", ["-C", join(cwd, path), "rev-parse", "HEAD"], { encoding: "utf8" });
    verifyPinnedCommit(`${prefix}${path}`, commit, actual);
  }
}
