// Builds, signs and uploads the GoAhead phone app to TestFlight on this Mac. Xcode signs with
// automatic signing; `xcrun altool` uploads with the Apple ID in `.env.release`. No App Store Connect
// API key is needed.
//
//   bun run release:mobile:local                         the whole release
//   bun run release:mobile:local -- --dry-run            checks the preconditions and credentials, prints the plan
//   bun run release:mobile:local -- --build-number=<n>   uses <n> in place of the UTC timestamp build number
//
// See docs/goahead-internal-release.md (section 6b).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenBotLogger } from "@openbot/logging";
import { checkAppleUploadCredentials } from "./release-local-credentials";
import { formatCommand, RELEASE_TEAM_ID, resolvePlaceholders } from "./release-local-lib";
import {
  exportOptionsPlist,
  MOBILE_BUNDLE_ID,
  parseDeliveryUuid,
  parseReleaseMobileLocalArgs,
  targetInfoPlists,
  timestampBuildNumber,
  withoutSecretLines,
} from "./release-mobile-local-lib";

const logger = createOpenBotLogger("release-mobile-local");

/** A step failed. The message says what to do; the script stops. */
class ReleaseStop extends Error {}

type Env = Record<string, string | undefined>;
type Step =
  | { kind: "run"; label: string; argv: string[]; cwd?: string; env?: Env }
  | { kind: "check"; label: string; describe: string; check: () => void };

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const mobileRoot = join(repoRoot, "apps/mobile");
const iosRoot = join(mobileRoot, "ios");
const HOMEBREW_BIN = "/opt/homebrew/bin";
const PASSWORD_VARIABLE = "APPLE_APP_SPECIFIC_PASSWORD";

const options = parseReleaseMobileLocalArgs(process.argv.slice(2));
// `.env.release` and the git checks are relative to the repository root.
process.chdir(repoRoot);

const buildNumber = options.buildNumber ?? timestampBuildNumber(new Date());
const outDir = join(repoRoot, ".openbot-build/mobile-testflight", buildNumber);
const archivePath = join(outDir, "GoAhead.xcarchive");
const exportPath = join(outDir, "export");
let deliveryUuid: string | null = null;

try {
  main();
} catch (error) {
  if (!(error instanceof ReleaseStop)) throw error;
  logger.error(error.message);
  logger.error("The release stopped. Nothing after this step ran.");
  process.exitCode = 1;
}

function main(): void {
  logger.info("Step 1: preconditions");
  const preconditions = checkPreconditions();
  if (preconditions.problems.length > 0 && !options.dryRun) stopWith("Preconditions failed", preconditions.problems);
  reportProblems("Step 1", preconditions.problems);

  logger.info("Step 2: credentials");
  const credentials = checkAppleUploadCredentials();
  if (credentials.problems.length > 0 && !options.dryRun) stopWith("Credentials are not ready", credentials.problems);
  reportProblems("Step 2", credentials.problems);

  const { version, pod } = preconditions;
  const overrides = [`MARKETING_VERSION=${version}`, `CURRENT_PROJECT_VERSION=${buildNumber}`];
  const steps: Step[] = [
    ...prebuildSteps(pod),
    ...versionSteps(version),
    ...archiveSteps(overrides),
    ...exportSteps(version),
    ...uploadSteps(credentials.values.APPLE_ID, credentials.values.APPLE_APP_SPECIFIC_PASSWORD),
  ];

  logger.info(`GoAhead ${version}, build ${buildNumber}, output ${outDir}`);
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

  mkdirSync(outDir, { recursive: true });
  for (const step of steps) {
    logger.info(`> ${step.label}`);
    if (step.kind === "run") runCommand(step.label, step.argv, step.env, step.cwd);
    else step.check();
  }

  logger.info(`Step 8: uploaded GoAhead ${version} (build ${buildNumber}) to App Store Connect.`);
  logger.info(`Delivery UUID: ${deliveryUuid ?? "not found in the altool output"}`);
  logger.info("Next: Apple processes the build in 10-30 minutes. Then open App Store Connect > GoAhead by");
  logger.info("Multi Code Genius > TestFlight > Internal Testing, and add the build to the group.");
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

function checkPreconditions(): { problems: string[]; version: string; pod: string } {
  const problems: string[] = [];
  if (process.platform !== "darwin") problems.push(`this script runs only on macOS (this is ${process.platform})`);

  // Not trimmed: trimming would cut the leading space of the first status line.
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

  let version = "";
  try {
    const appJson = JSON.parse(readFileSync(join(mobileRoot, "app.json"), "utf8"));
    version = typeof appJson?.expo?.version === "string" ? appJson.expo.version : "";
    if (!/^\d+\.\d+\.\d+$/u.test(version))
      problems.push(`apps/mobile/app.json expo.version "${version}" is not semver`);
  } catch {
    problems.push("apps/mobile/app.json cannot be read");
  }

  const xcode = spawnSync("xcodebuild", ["-version"], { encoding: "utf8" });
  if (xcode.status !== 0) {
    problems.push("`xcodebuild -version` failed. Install Xcode and run `sudo xcode-select -s /Applications/Xcode.app`");
  } else {
    logger.info(`Xcode: ${xcode.stdout.split("\n")[0]?.trim()}`);
  }

  const pod = findPod();
  if (pod === null) {
    problems.push(`no working CocoaPods. Run \`brew install cocoapods\` (it installs ${HOMEBREW_BIN}/pod)`);
  }

  if (existsSync(outDir) && !options.dryRun) {
    problems.push(`${outDir} exists already. Use another --build-number or remove the directory`);
  }

  return { problems, version: version || "<version>", pod: pod ?? "pod" };
}

/** The first `pod` that runs: Homebrew's, then the one on PATH. A broken rbenv shim fails here. */
function findPod(): string | null {
  for (const candidate of [`${HOMEBREW_BIN}/pod`, "pod"]) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8", env: homebrewEnv() });
    if (result.status === 0) {
      logger.info(`CocoaPods: ${candidate} ${result.stdout.trim()}`);
      return candidate;
    }
  }
  return null;
}

function homebrewEnv(): Env {
  return { ...process.env, PATH: `${HOMEBREW_BIN}:${process.env.PATH ?? ""}` };
}

// Step 3 -----------------------------------------------------------------------------------------

function prebuildSteps(pod: string): Step[] {
  const expo = createRequire(join(mobileRoot, "package.json")).resolve("expo/bin/cli");
  return [
    {
      kind: "run",
      label: "Step 3: Expo prebuild (iOS)",
      argv: ["node", expo, "prebuild", "--platform", "ios", "--no-clean", "--no-install"],
      cwd: mobileRoot,
    },
    { kind: "run", label: "Step 3: pod install", argv: [pod, "install"], cwd: iosRoot, env: homebrewEnv() },
  ];
}

// Step 4 -----------------------------------------------------------------------------------------

function findInfoPlists(): string[] {
  if (!existsSync(iosRoot)) return [];
  const entries = readdirSync(iosRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  return targetInfoPlists(entries, (entry) => existsSync(join(iosRoot, entry, "Info.plist")));
}

function versionSteps(version: string): Step[] {
  const known = findInfoPlists();
  return [
    {
      kind: "check",
      label: "Step 4: set version and build number in each target Info.plist",
      describe: `CFBundleShortVersionString=${version}, CFBundleVersion=${buildNumber} in apps/mobile/ios/{${
        known.length > 0 ? known.join(",") : "GoAhead/Info.plist,<widget>/Info.plist"
      }} (found after prebuild)`,
      check: () => {
        const plists = findInfoPlists();
        if (!plists.includes("GoAhead/Info.plist")) {
          throw new ReleaseStop("apps/mobile/ios/GoAhead/Info.plist is missing after prebuild.");
        }
        for (const plist of plists) {
          const path = join(iosRoot, plist);
          capture([
            "/usr/libexec/PlistBuddy",
            "-c",
            `Set :CFBundleShortVersionString ${version}`,
            "-c",
            `Set :CFBundleVersion ${buildNumber}`,
            path,
          ]);
          logger.info(`  ${plist}: ${version} (${buildNumber})`);
        }
      },
    },
  ];
}

// Step 5 -----------------------------------------------------------------------------------------

function archiveSteps(overrides: string[]): Step[] {
  return [
    {
      kind: "run",
      label: "Step 5: archive",
      argv: [
        "xcodebuild",
        "archive",
        "-workspace",
        join(iosRoot, "GoAhead.xcworkspace"),
        "-scheme",
        "GoAhead",
        "-configuration",
        "Release",
        "-destination",
        "generic/platform=iOS",
        "-archivePath",
        archivePath,
        "-allowProvisioningUpdates",
        ...overrides,
      ],
    },
  ];
}

// Step 6 -----------------------------------------------------------------------------------------

function exportSteps(version: string): Step[] {
  const optionsPath = join(outDir, "ExportOptions.plist");
  return [
    {
      kind: "check",
      label: "Step 6: write ExportOptions.plist",
      describe: `${optionsPath} (app-store-connect, export, team ${RELEASE_TEAM_ID}, automatic signing)`,
      check: () => writeFileSync(optionsPath, exportOptionsPlist(RELEASE_TEAM_ID)),
    },
    {
      kind: "run",
      label: "Step 6: export",
      argv: [
        "xcodebuild",
        "-exportArchive",
        "-archivePath",
        archivePath,
        "-exportPath",
        exportPath,
        "-exportOptionsPlist",
        optionsPath,
        "-allowProvisioningUpdates",
      ],
    },
    {
      kind: "check",
      label: "Step 6: verify the IPA",
      describe: `exactly one .ipa in ${exportPath}; bundle id ${MOBILE_BUNDLE_ID}, version ${version}, build ${buildNumber}`,
      check: () => verifyIpa(version),
    },
  ];
}

function findIpa(): string {
  const ipas = existsSync(exportPath) ? readdirSync(exportPath).filter((name) => name.endsWith(".ipa")) : [];
  const [ipa] = ipas;
  if (ipas.length !== 1 || ipa === undefined) {
    throw new ReleaseStop(`Expected exactly one .ipa in ${exportPath}, found ${ipas.length}.`);
  }
  return join(exportPath, ipa);
}

function verifyIpa(version: string): void {
  const ipa = findIpa();
  const unzip = spawnSync("unzip", ["-p", ipa, "Payload/GoAhead.app/Info.plist"], { maxBuffer: 16 * 1024 * 1024 });
  if (unzip.status !== 0 || unzip.stdout.length === 0) {
    throw new ReleaseStop(`Cannot read Payload/GoAhead.app/Info.plist from ${ipa}.`);
  }
  const tempDir = mkdtempSync(join(tmpdir(), "goahead-ipa-"));
  try {
    const plist = join(tempDir, "Info.plist");
    writeFileSync(plist, unzip.stdout);
    const read = (key: string) => capture(["/usr/libexec/PlistBuddy", "-c", `Print :${key}`, plist]);
    const expected: Record<string, string> = {
      CFBundleIdentifier: MOBILE_BUNDLE_ID,
      CFBundleShortVersionString: version,
      CFBundleVersion: buildNumber,
    };
    const problems = Object.entries(expected)
      .map(([key, value]) => ({ key, value, actual: read(key) }))
      .filter(({ value, actual }) => value !== actual)
      .map(({ key, value, actual }) => `${key} is "${actual}", expected "${value}"`);
    if (problems.length > 0) stopWith(`The IPA ${ipa} is wrong`, problems);
    logger.info(`  ${ipa}: ${MOBILE_BUNDLE_ID} ${version} (${buildNumber})`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// Step 7 -----------------------------------------------------------------------------------------

function uploadSteps(appleId: string | undefined, password: string | undefined): Step[] {
  // The password is only in the child environment; altool reads it with `@env:`. It is never on argv.
  const argv = [
    "xcrun",
    "altool",
    "--upload-app",
    "--type",
    "ios",
    "--file",
    "<the .ipa>",
    "--username",
    "$APPLE_ID",
    "--password",
    `@env:${PASSWORD_VARIABLE}`,
    "--output-format",
    "normal",
  ];
  return [
    {
      kind: "check",
      label: "Step 7: upload to App Store Connect",
      describe: formatCommand(argv),
      check: () => {
        const ipa = findIpa();
        const env = { ...process.env, APPLE_ID: appleId, [PASSWORD_VARIABLE]: password };
        const [command, ...args] = resolvePlaceholders(
          argv.map((arg) => (arg === "<the .ipa>" ? ipa : arg)),
          env,
        );
        if (command === undefined) throw new ReleaseStop("The upload has no command.");
        const result = spawnSync(command, args, { env, encoding: "utf8" });
        const output = withoutSecretLines(`${result.stdout ?? ""}${result.stderr ?? ""}`, password);
        if (result.status !== 0 || !output.includes("UPLOAD SUCCEEDED")) {
          throw new ReleaseStop(
            `Upload failed (exit ${result.status ?? result.signal}): ${formatCommand(argv)}\n${output.trim()}`,
          );
        }
        logger.info(output.trim());
        deliveryUuid = parseDeliveryUuid(output);
      },
    },
  ];
}

// Process helpers --------------------------------------------------------------------------------

function runCommand(label: string, argv: string[], env?: Env, cwd?: string): void {
  const [command, ...args] = argv;
  if (command === undefined) throw new ReleaseStop(`${label} has no command.`);
  const result = spawnSync(command, args, { cwd, env: env ?? process.env, stdio: "inherit" });
  if (result.status !== 0) {
    throw new ReleaseStop(`${label} failed (exit ${result.status ?? result.signal}): ${formatCommand(argv)}`);
  }
}

/** Runs a command and returns its trimmed output (stdout and stderr). */
function capture(argv: string[]): string {
  const [command, ...args] = argv;
  if (command === undefined) throw new ReleaseStop("Empty command.");
  const result = spawnSync(command, args, { encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new ReleaseStop(`${formatCommand(argv)} failed (exit ${result.status ?? result.signal}):\n${output.trim()}`);
  }
  return output.trim();
}
