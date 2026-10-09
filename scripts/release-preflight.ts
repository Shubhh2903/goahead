import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { checkLocalCredentials } from "./release-local-credentials";
import { releaseNotesProblems } from "./release-notes";

const logger = createOpenBotLogger("release-preflight");

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
if (!isDynamicRecord(packageJson) || !isString(packageJson.version)) {
  throw new Error("package.json has no valid version.");
}
const changelog = await readFile("CHANGELOG.md", "utf8");
const failures: string[] = [];

if (!/^\d+\.\d+\.\d+$/.test(packageJson.version)) failures.push("package version is not semver");
failures.push(...releaseNotesProblems(changelog, packageJson.version));
if (run("git", ["status", "--porcelain"])) failures.push("working tree is not clean");
// The repository's default branch (master in the GoAhead repository), as release:local checks it.
const defaultBranch = defaultRemoteBranch();
if (run("git", ["rev-list", "--left-right", "--count", `${defaultBranch}...HEAD`]) !== "0\t0") {
  failures.push(`HEAD is not synchronized with ${defaultBranch}`);
}
if (run("git", ["tag", "--list", `v${packageJson.version}`])) {
  failures.push(`tag v${packageJson.version} already exists`);
}

// Releases are built on this Mac (`bun run release:local`), so the signing identities and the
// notarization values must be here, not in GitHub. `--skip-credentials` leaves this check out.
if (!process.argv.includes("--skip-credentials")) failures.push(...checkLocalCredentials().problems);

if (failures.length > 0) {
  logger.error("GoAhead release preflight failed:\n");
  for (const failure of failures) logger.error(`- ${failure}`);
  logger.error("\nNo release tag was created.");
  process.exitCode = 1;
} else {
  logger.info(`GoAhead v${packageJson.version} release preflight passed.`);
}

function run(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function defaultRemoteBranch(): string {
  try {
    return run("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]) || "origin/master";
  } catch {
    return "origin/master";
  }
}
