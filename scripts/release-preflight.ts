import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
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
// The repository's default branch (master in the GoAhead repository), as the tag workflow checks it.
const defaultBranch = defaultRemoteBranch();
if (run("git", ["rev-list", "--left-right", "--count", `${defaultBranch}...HEAD`]) !== "0\t0") {
  failures.push(`HEAD is not synchronized with ${defaultBranch}`);
}
if (run("git", ["tag", "--list", `v${packageJson.version}`])) {
  failures.push(`tag v${packageJson.version} already exists`);
}

let releaseSecrets = "";
try {
  releaseSecrets = run("gh", ["secret", "list", "--env", "release"]);
} catch {
  failures.push("GitHub release secrets could not be inspected");
}
for (const name of [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "CSC_INSTALLER_LINK",
  "CSC_INSTALLER_KEY_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
  // MAC_PROVISIONING_PROFILE is optional: the internal build has no associated domains.
]) {
  if (!releaseSecrets.split("\n").some((line) => line.startsWith(`${name}\t`))) {
    failures.push(`GitHub release secret ${name} is missing`);
  }
}

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
    return run("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]) || "origin/main";
  } catch {
    return "origin/main";
  }
}
