// Builds, signs, notarizes, verifies and publishes the GoAhead macOS release on this Mac.
// Apple silicon (arm64) only. It replaces the deleted `.github/workflows/release.yml` jobs
// `validate`, `macos` and `publish`.
//
//   bun run release:local                 the whole release
//   bun run release:local -- --dry-run    checks the preconditions and credentials, prints the plan
//   bun run release:local -- --skip-build reuses the files in dist/, then verifies and publishes
//   bun run release:local -- --replace    uploads over a GitHub release that already has assets
//
// See docs/RELEASING.md#internal-goahead-build.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { checkLocalCredentials, type LocalCredentials } from "./release-local-credentials";
import {
  formatCommand,
  parseReleaseLocalArgs,
  RELEASE_TEAM_ID,
  releaseArtifacts,
  resolvePlaceholders,
  tagCommands,
} from "./release-local-lib";

const logger = createOpenBotLogger("release-local");

/** A step failed. The message says what to do; the script stops. */
class ReleaseStop extends Error {}

type Env = Record<string, string | undefined>;
type Step =
  | { kind: "run"; label: string; argv: string[]; cwd?: string; env?: Env }
  | { kind: "check"; label: string; describe: string; check: () => void | Promise<void> };

type Release = {
  version: string;
  tag: string;
  repo: string;
  /** A GitHub release with this tag exists already (with no assets, or `--replace` is set). */
  releaseExists: boolean;
};

const options = parseReleaseLocalArgs(process.argv.slice(2));

try {
  await main();
} catch (error) {
  if (!(error instanceof ReleaseStop)) throw error;
  logger.error(error.message);
  logger.error("The release stopped. Nothing after this step ran.");
  process.exitCode = 1;
}

async function main(): Promise<void> {
  logger.info("Step 1: preconditions");
  const preconditions = checkPreconditions();
  if (preconditions.problems.length > 0 && !options.dryRun) stopWith("Preconditions failed", preconditions.problems);
  reportProblems("Step 1", preconditions.problems);

  logger.info("Step 2: credentials");
  const credentials = checkLocalCredentials();
  if (credentials.problems.length > 0 && !options.dryRun) stopWith("Credentials are not ready", credentials.problems);
  reportProblems("Step 2", credentials.problems);

  const steps = [
    ...(options.skipBuild ? [] : buildSteps(credentials)),
    ...verifySteps(preconditions.release, credentials),
    ...checksumSteps(preconditions.release),
    ...publishSteps(preconditions.release),
  ];

  if (options.dryRun) {
    logger.info(`Dry run: the release would run these ${steps.length} steps. It runs none of them.`);
    for (const step of steps) {
      logger.info(`- ${step.label}: ${step.kind === "run" ? formatCommand(step.argv) : step.describe}`);
    }
    if (preconditions.problems.length > 0 || credentials.problems.length > 0) {
      logger.error("Dry run: fix the problems above before the release.");
      process.exitCode = 1;
    } else {
      logger.info("Dry run: preconditions and credentials passed.");
    }
    return;
  }

  for (const step of steps) {
    logger.info(`> ${step.label}`);
    if (step.kind === "run") runCommand(step.label, step.argv, step.env, step.cwd);
    else await step.check();
  }
  logger.info(`Published GoAhead ${preconditions.release.tag} to ${preconditions.release.repo}.`);
}

function reportProblems(stepName: string, problems: string[]): void {
  if (problems.length === 0) {
    logger.info(`${stepName} passed.`);
    return;
  }
  logger.error(`${stepName} failed:`);
  for (const problem of problems) logger.error(`- ${problem}`);
}

function stopWith(title: string, problems: string[]): never {
  throw new ReleaseStop([`${title}:`, ...problems.map((problem) => `- ${problem}`)].join("\n"));
}

// Step 1 -----------------------------------------------------------------------------------------

function checkPreconditions(): { problems: string[]; release: Release } {
  const problems: string[] = [];
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    problems.push(`this script runs only on an Apple silicon Mac (this is ${process.platform} ${process.arch})`);
  }

  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const version = typeof packageJson?.version === "string" ? packageJson.version : "";
  if (!/^\d+\.\d+\.\d+$/u.test(version)) problems.push(`package.json version "${version}" is not semver`);
  const tag = `v${version}`;

  let repo = "";
  let defaultBranch = "master";
  try {
    const view = JSON.parse(capture(["gh", "repo", "view", "--json", "nameWithOwner,defaultBranchRef"]));
    repo = view.nameWithOwner;
    defaultBranch = view.defaultBranchRef?.name ?? defaultBranch;
  } catch {
    problems.push("`gh repo view` failed. Run `gh auth login`, then try again");
  }

  const branch = capture(["git", "rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== defaultBranch) problems.push(`the branch is ${branch}, not the default branch ${defaultBranch}`);

  // Not `capture`: trimming would cut the leading space of the first status line.
  const status = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" }).stdout ?? "";
  if (status.trim() !== "") {
    const lines = status.split("\n").filter(Boolean);
    problems.push(
      [
        `the working tree is not clean (${lines.length} changed or untracked paths). Commit or remove them:`,
        ...lines.slice(0, 10).map((line) => `    ${line}`),
        ...(lines.length > 10 ? [`    … and ${lines.length - 10} more`] : []),
      ].join("\n"),
    );
  }

  const head = capture(["git", "rev-parse", "HEAD"]);
  try {
    capture(["git", "fetch", "--quiet", "origin", defaultBranch]);
    const remoteHead = capture(["git", "rev-parse", `origin/${defaultBranch}`]);
    if (remoteHead !== head) {
      problems.push(
        `HEAD (${head.slice(0, 8)}) is not origin/${defaultBranch} (${remoteHead.slice(0, 8)}). Push or pull first`,
      );
    }
  } catch {
    problems.push(`\`git fetch origin ${defaultBranch}\` failed`);
  }

  try {
    const refs = capture(["git", "ls-remote", "--tags", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`]);
    // An annotated tag has a peeled `^{}` line with its commit; a lightweight tag has only one line.
    const lines = refs.split("\n").filter(Boolean);
    const peeled = lines.find((line) => line.endsWith(`refs/tags/${tag}^{}`)) ?? lines[0];
    const tagCommit = peeled?.split(/\s+/u)[0];
    if (tagCommit === undefined) {
      problems.push(`tag ${tag} is not on origin. Create and push it:\n    ${tagCommands(version).join("\n    ")}`);
    } else if (tagCommit !== head) {
      problems.push(`tag ${tag} on origin points at ${tagCommit.slice(0, 8)}, not HEAD (${head.slice(0, 8)})`);
    }
  } catch {
    problems.push("`git ls-remote --tags origin` failed");
  }

  let releaseExists = false;
  if (repo !== "") {
    const view = spawnSync("gh", ["release", "view", tag, "--repo", repo, "--json", "assets"], { encoding: "utf8" });
    if (view.status === 0) {
      const assets = JSON.parse(view.stdout).assets ?? [];
      releaseExists = true;
      if (assets.length > 0 && !options.replace) {
        problems.push(`GitHub release ${tag} already has ${assets.length} assets. Use --replace to upload over them`);
      }
    } else if (!/release not found/iu.test(view.stderr)) {
      problems.push(`\`gh release view ${tag}\` failed: ${view.stderr.trim()}`);
    }
  }

  const notes = spawnSync("bun", ["scripts/check-release-notes.ts"], { encoding: "utf8" });
  if (notes.status !== 0) problems.push(`release notes are not ready:\n${notes.stderr.trim()}`);

  return { problems, release: { version, tag, repo, releaseExists } };
}

// Step 3 -----------------------------------------------------------------------------------------

/** The variables electron-builder and `notarytool` read, for the steps that need them only. */
function notarizationEnv(credentials: LocalCredentials): Env {
  return {
    APPLE_ID: credentials.notarization.APPLE_ID,
    APPLE_APP_SPECIFIC_PASSWORD: credentials.notarization.APPLE_APP_SPECIFIC_PASSWORD,
    APPLE_TEAM_ID: credentials.notarization.APPLE_TEAM_ID,
  };
}

function buildSteps(credentials: LocalCredentials): Step[] {
  const profile = process.env.OPENBOT_PROVISIONING_PROFILE?.trim();
  const builderArgs = [
    "bun",
    "x",
    "electron-builder",
    "--mac",
    "--arm64",
    "--publish",
    "never",
    // The team id comes from the credentials, not from electron-builder.yml.
    "--config.mac.extendInfo.ElectronTeamID=$APPLE_TEAM_ID",
    ...(profile ? [`--config.mac.provisioningProfile=${profile}`] : []),
  ];
  const builderEnv: Env = {
    ...notarizationEnv(credentials),
    // The Developer ID identity in the login keychain signs the app and the DMG. A `.p12` from
    // CSC_LINK would replace it, so the build does not pass one.
    CSC_NAME: credentials.applicationIdentity ?? undefined,
    CSC_LINK: undefined,
    CSC_KEY_PASSWORD: undefined,
    CSC_INSTALLER_LINK: undefined,
    CSC_INSTALLER_KEY_PASSWORD: undefined,
  };
  return [
    {
      kind: "check",
      label: "Remove the old dist/ directory",
      describe: "delete dist/ so that only this release's files are in it",
      check: () => rmSync("dist", { recursive: true, force: true }),
    },
    { kind: "run", label: "Install dependencies", argv: ["bun", "install", "--frozen-lockfile"] },
    { kind: "run", label: "Install Codex runtime", argv: ["bun", "run", "install:codex-runtime"] },
    { kind: "run", label: "Install Claude runtime", argv: ["bun", "run", "install:claude-runtime"] },
    { kind: "run", label: "Install Grok runtime", argv: ["bun", "run", "install:grok-runtime"] },
    {
      kind: "run",
      label: "Install remote desktop runtime",
      argv: ["bun", "run", "install:remote-desktop-runtime"],
    },
    { kind: "run", label: "Verify remote desktop runtime", argv: ["bun", "run", "verify:remote-desktop-runtime"] },
    { kind: "run", label: "Prepare Computer Use driver", argv: ["bun", "run", "prepare:cua-driver"] },
    ...(profile
      ? [{ kind: "run" as const, label: "Check provisioning profile", argv: ["security", "cms", "-D", "-i", profile] }]
      : []),
    { kind: "run", label: "Prepare voice runtime", argv: ["bun", "run", "voice:prepare-runtime"] },
    { kind: "run", label: "Build application", argv: ["bun", "run", "build"] },
    {
      kind: "check",
      label: "Build, sign and notarize the arm64 app",
      describe: `${formatCommand(builderArgs)} (CSC_NAME = the Developer ID Application identity; up to 3 attempts when hdiutil fails)`,
      check: () => runElectronBuilder(builderArgs, builderEnv),
    },
  ];
}

/**
 * `hdiutil create` can fail with "Device not configured" or "Resource busy" when nothing is wrong
 * with the app. Only that error gets another attempt; each attempt signs and notarizes again.
 */
async function runElectronBuilder(argv: string[], env: Env): Promise<void> {
  const childEnv = mergeEnv(env);
  const resolved = resolvePlaceholders(argv, childEnv);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const [command, ...args] = resolved;
    if (command === undefined) throw new ReleaseStop("electron-builder has no command.");
    let output = "";
    const status = await new Promise<number | null>((resolveStatus, reject) => {
      const child = spawn(command, args, { env: childEnv, stdio: ["inherit", "pipe", "pipe"] });
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        process.stdout.write(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        process.stderr.write(chunk);
      });
      child.on("error", reject);
      child.on("close", resolveStatus);
    });
    if (status === 0) return;
    if (!/hdiutil: create failed - (Device not configured|Resource busy)/u.test(output)) {
      throw new ReleaseStop(`electron-builder failed (exit ${status}). See its output above.`);
    }
    logger.warn(`hdiutil could not create the DMG (attempt ${attempt} of 3).`);
    spawnSync("hdiutil", ["info"], { stdio: "inherit" });
  }
  throw new ReleaseStop("electron-builder failed 3 times: hdiutil could not create the DMG.");
}

// Step 4 -----------------------------------------------------------------------------------------

function verifySteps(release: Release, credentials: LocalCredentials): Step[] {
  const files = releaseArtifacts(release.version);
  const teamEnv: Env = { APPLE_TEAM_ID: RELEASE_TEAM_ID };
  const runtimePath = `${files.app}/Contents/Resources/remote-desktop-runtime/darwin/arm64`;
  const providers: [string, string][] = [
    ["build/codex/mac/arm64/bin/codex", "2DC432GLL2"],
    ["build/claude/mac/arm64/bin/claude", "Q6L2SF6YDW"],
    ["build/grok/mac/arm64/bin/grok", "5Y6N3AJ54S"],
  ];
  const codesign = (label: string, path: string, deep = false): Step => ({
    kind: "run",
    label,
    argv: ["codesign", "--verify", ...(deep ? ["--deep"] : []), "--strict", "--verbose=2", path],
  });
  return [
    { kind: "run", label: "Verify package metadata and launch", argv: ["bun", "run", "verify:package"], env: teamEnv },
    {
      kind: "check",
      label: "Require the app",
      describe: `${files.app} exists`,
      check: () => {
        if (!existsSync(files.app)) throw new ReleaseStop(`${files.app} does not exist. Build first.`);
      },
    },
    codesign("Verify app signature", files.app, true),
    codesign("Verify Sunshine signature", `${runtimePath}/Sunshine.app`, true),
    codesign("Verify web-server signature", `${runtimePath}/web-server`),
    codesign("Verify streamer signature", `${runtimePath}/streamer`),
    ...providers.flatMap(([path, team]): Step[] => [
      codesign(`Verify ${basename(path)} signature`, path),
      {
        kind: "check",
        label: `Verify ${basename(path)} team`,
        describe: `codesign -d --verbose=4 ${path} shows TeamIdentifier=${team}`,
        check: () => requireTeam(path, team),
      },
    ]),
    {
      kind: "check",
      label: "Verify app team, entitlements and Info.plist",
      describe: `TeamIdentifier=${RELEASE_TEAM_ID}, audio-input entitlement, NSUserActivityTypeBrowsingWeb, ElectronTeamID`,
      check: () => verifyAppMetadata(files.app),
    },
    {
      kind: "run",
      label: "Assess app with Gatekeeper",
      argv: ["spctl", "--assess", "--type", "execute", "--verbose=2", files.app],
    },
    { kind: "run", label: "Validate app staple", argv: ["xcrun", "stapler", "validate", files.app] },
    // electron-builder signs the DMG (`dmg.sign`) but notarizes only the app. Stapling changes the
    // DMG bytes, so this runs before the checksums, and `dmg.writeUpdateInfo: false` keeps the DMG
    // out of `latest-mac.yml` and the block maps.
    {
      kind: "check",
      label: "Check DMG before notarization",
      describe: `${files.dmg} exists, has no block map, is not in latest-mac.yml, is signed by ${RELEASE_TEAM_ID}`,
      check: () => {
        if (!existsSync(files.dmg)) throw new ReleaseStop(`${files.dmg} does not exist.`);
        if (readFileSync(files.manifest, "utf8").includes(".dmg")) {
          throw new ReleaseStop("latest-mac.yml lists the DMG. Stapling would make its hash wrong.");
        }
        if (existsSync(`${files.dmg}.blockmap`)) {
          throw new ReleaseStop("The DMG has a block map. Stapling would make it wrong.");
        }
        runCommand("Verify DMG signature", ["codesign", "--verify", "--strict", "--verbose=2", files.dmg]);
        requireTeam(files.dmg, RELEASE_TEAM_ID);
      },
    },
    {
      kind: "check",
      label: "Notarize DMG",
      describe: `${formatCommand(notarytoolArgs(files.dmg))} (requires status Accepted)`,
      check: () => {
        const result = capture(notarytoolArgs(files.dmg), notarizationEnv(credentials));
        let status: unknown;
        try {
          status = JSON.parse(result).status;
        } catch {
          status = undefined;
        }
        if (status !== "Accepted") {
          throw new ReleaseStop(`Apple did not accept the DMG (status ${String(status)}):\n${result}`);
        }
      },
    },
    { kind: "run", label: "Staple DMG", argv: ["xcrun", "stapler", "staple", files.dmg] },
    { kind: "run", label: "Validate DMG staple", argv: ["xcrun", "stapler", "validate", files.dmg] },
    {
      kind: "run",
      label: "Assess DMG with Gatekeeper",
      argv: ["spctl", "--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=2", files.dmg],
    },
    {
      kind: "check",
      label: "Verify updater metadata",
      describe: `one DMG, one ZIP and latest-mac.yml in dist/; latest-mac.yml has version ${release.version} and only the ZIP; ZIP < 800000000 bytes`,
      check: () => verifyUpdaterMetadata(release),
    },
    { kind: "run", label: "Verify update artifacts", argv: ["bun", "run", "verify:update-artifacts", "macos"] },
    {
      kind: "check",
      label: "Compare ZIP size with v0.1.21",
      describe: "when the repository has release v0.1.21, the ZIP must be smaller than its ZIP",
      check: () => compareWithOldRelease(release),
    },
    {
      kind: "check",
      label: "Test native tenant setup",
      describe:
        "xcrun swiftc -parse-as-library -D TENANT_SETUP_TESTS scripts/macos-tenant-setup.swift scripts/macos-tenant-setup-tests.swift, then run it",
      check: () => {
        const output = join(mkdtempSync(join(tmpdir(), "goahead-tenant-setup-")), "tests");
        runCommand("Compile tenant setup tests", [
          "xcrun",
          "swiftc",
          "-parse-as-library",
          "-D",
          "TENANT_SETUP_TESTS",
          "scripts/macos-tenant-setup.swift",
          "scripts/macos-tenant-setup-tests.swift",
          "-o",
          output,
        ]);
        runCommand("Run tenant setup tests", [output]);
      },
    },
  ];
}

function notarytoolArgs(dmg: string): string[] {
  return [
    "xcrun",
    "notarytool",
    "submit",
    dmg,
    "--apple-id",
    "$APPLE_ID",
    "--password",
    "$APPLE_APP_SPECIFIC_PASSWORD",
    "--team-id",
    "$APPLE_TEAM_ID",
    "--wait",
    "--timeout",
    "20m",
    "--output-format",
    "json",
  ];
}

function requireTeam(path: string, team: string): void {
  const details = capture(["codesign", "-d", "--verbose=4", path]);
  if (!details.split("\n").includes(`TeamIdentifier=${team}`)) {
    throw new ReleaseStop(`${path} is not signed by team ${team}.`);
  }
}

function verifyAppMetadata(app: string): void {
  requireTeam(app, RELEASE_TEAM_ID);
  if (process.env.OPENBOT_PROVISIONING_PROFILE?.trim() && !existsSync(`${app}/Contents/embedded.provisionprofile`)) {
    throw new ReleaseStop("The app has no embedded provisioning profile.");
  }
  const entitlementsPath = join(mkdtempSync(join(tmpdir(), "goahead-entitlements-")), "entitlements.plist");
  writeFileSync(entitlementsPath, capture(["codesign", "-d", "--entitlements", ":-", app], {}, "stdout"));
  if (statSync(entitlementsPath).size === 0) throw new ReleaseStop("The app has no entitlements.");
  capture(["plutil", "-lint", entitlementsPath]);
  const audio = capture([
    "/usr/libexec/PlistBuddy",
    "-c",
    "Print :com.apple.security.device.audio-input",
    entitlementsPath,
  ]);
  if (audio !== "true") throw new ReleaseStop("The app has no audio-input entitlement.");
  const plist = `${app}/Contents/Info.plist`;
  if (capture(["plutil", "-extract", "NSUserActivityTypes.0", "raw", plist]) !== "NSUserActivityTypeBrowsingWeb") {
    throw new ReleaseStop("Info.plist NSUserActivityTypes does not start with NSUserActivityTypeBrowsingWeb.");
  }
  if (capture(["plutil", "-extract", "ElectronTeamID", "raw", plist]) !== RELEASE_TEAM_ID) {
    throw new ReleaseStop(`Info.plist ElectronTeamID is not ${RELEASE_TEAM_ID}.`);
  }
}

function verifyUpdaterMetadata(release: Release): void {
  const names = readdirSync("dist");
  const dmgs = names.filter((name) => name.endsWith(".dmg"));
  const zips = names.filter((name) => name.endsWith(".zip"));
  if (dmgs.length !== 1 || zips.length !== 1 || !names.includes("latest-mac.yml")) {
    throw new ReleaseStop(`Expected one DMG, one ZIP and latest-mac.yml in dist/. Found: ${names.join(", ")}`);
  }
  const manifest = readFileSync("dist/latest-mac.yml", "utf8");
  if (!manifest.includes(`version: ${release.version}`)) {
    throw new ReleaseStop(`latest-mac.yml does not have version ${release.version}.`);
  }
  if (!manifest.includes(".zip")) throw new ReleaseStop("latest-mac.yml does not list the ZIP.");
  const zip = zips[0];
  if (zip !== undefined && statSync(join("dist", zip)).size >= 800_000_000) {
    throw new ReleaseStop(`The macOS ZIP is ${statSync(join("dist", zip)).size} bytes. The limit is 800000000 bytes.`);
  }
}

function compareWithOldRelease(release: Release): void {
  const view = spawnSync("gh", ["release", "view", "v0.1.21", "--repo", release.repo], { stdio: "ignore" });
  if (view.status !== 0) {
    logger.info("The repository has no release v0.1.21. Nothing to compare.");
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), "goahead-0.1.21-"));
  runCommand("Download v0.1.21 ZIP", [
    "gh",
    "release",
    "download",
    "v0.1.21",
    "--repo",
    release.repo,
    "--pattern",
    "*.zip",
    "--dir",
    directory,
  ]);
  const oldZips = readdirSync(directory).filter((name) => name.endsWith(".zip"));
  const oldZip = oldZips[0];
  if (oldZips.length !== 1 || oldZip === undefined) throw new ReleaseStop("Expected one macOS ZIP in v0.1.21.");
  const oldSize = statSync(join(directory, oldZip)).size;
  const currentSize = statSync(releaseArtifacts(release.version).zip).size;
  if (currentSize >= oldSize) {
    throw new ReleaseStop(`The macOS ZIP is not smaller than v0.1.21 (${currentSize} >= ${oldSize}).`);
  }
}

// Step 5 -----------------------------------------------------------------------------------------

function checksumSteps(release: Release): Step[] {
  const files = releaseArtifacts(release.version);
  const argv = ["shasum", "-a", "256", basename(files.dmg), basename(files.zip)];
  return [
    {
      kind: "check",
      label: "Write checksums",
      describe: `(cd dist && ${formatCommand(argv)} > ${basename(files.checksums)}), after the DMG is stapled`,
      check: () => writeFileSync(files.checksums, `${capture(argv, {}, "stdout", "dist")}\n`),
    },
  ];
}

// Step 6 -----------------------------------------------------------------------------------------

function publishSteps(release: Release): Step[] {
  const files = releaseArtifacts(release.version);
  const assets = [files.dmg, files.zip, files.blockmap, files.manifest, files.checksums];
  const repo = release.repo || "<owner/repo>";
  if (release.releaseExists) {
    return [
      {
        kind: "run",
        label: "Upload release assets",
        argv: ["gh", "release", "upload", release.tag, ...assets, "--clobber", "--repo", repo],
      },
      {
        kind: "run",
        label: "Mark release as latest",
        argv: ["gh", "release", "edit", release.tag, "--draft=false", "--latest", "--repo", repo],
      },
    ];
  }
  return [
    {
      kind: "run",
      label: "Create GitHub release",
      argv: [
        "gh",
        "release",
        "create",
        release.tag,
        ...assets,
        "--title",
        `GoAhead ${release.tag}`,
        "--generate-notes",
        "--latest",
        "--repo",
        repo,
      ],
    },
  ];
}

// Process helpers --------------------------------------------------------------------------------

/** The child environment: this process's environment with `extra` set, and `undefined` removing a name. */
function mergeEnv(extra: Env = {}): Env {
  const env: Env = { ...process.env };
  for (const [name, value] of Object.entries(extra)) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  return env;
}

function runCommand(label: string, argv: string[], extraEnv?: Env, cwd?: string): void {
  const env = mergeEnv(extraEnv);
  const [command, ...args] = resolvePlaceholders(argv, env);
  if (command === undefined) throw new ReleaseStop(`${label} has no command.`);
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.status !== 0) {
    // The message shows the command with its placeholders, never a resolved secret.
    throw new ReleaseStop(`${label} failed (exit ${result.status ?? result.signal}): ${formatCommand(argv)}`);
  }
}

/**
 * Runs a command and returns its trimmed output. `codesign -d` writes to stderr, so both streams are
 * returned unless `stream` is "stdout".
 */
function capture(argv: string[], extraEnv: Env = {}, stream: "both" | "stdout" = "both", cwd?: string): string {
  const env = mergeEnv(extraEnv);
  const [command, ...args] = resolvePlaceholders(argv, env);
  if (command === undefined) throw new ReleaseStop("Empty command.");
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8" });
  const output = stream === "stdout" ? result.stdout : `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new ReleaseStop(`${formatCommand(argv)} failed (exit ${result.status ?? result.signal}):\n${output.trim()}`);
  }
  return output.trim();
}
