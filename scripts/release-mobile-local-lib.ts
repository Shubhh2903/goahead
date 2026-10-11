// Pure helpers for `scripts/release-mobile-local.ts`. No process, file or network access here, so
// the tests can run them on any machine.

/** The bundle id of the GoAhead phone app (`apps/mobile/app.json`). */
export const MOBILE_BUNDLE_ID = "com.multicodegenius.goahead.mobile";

export type ReleaseMobileLocalOptions = { dryRun: boolean; buildNumber: string | null };

export function parseReleaseMobileLocalArgs(args: readonly string[]): ReleaseMobileLocalOptions {
  const options: ReleaseMobileLocalOptions = { dryRun: false, buildNumber: null };
  for (const arg of args) {
    // `bun run release:mobile:local -- --dry-run` passes the separator through.
    if (arg === "--") continue;
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg.startsWith("--build-number=")) {
      const value = arg.slice("--build-number=".length);
      // Build 1 is already on App Store Connect, and each upload needs a larger number.
      if (!/^[1-9]\d*$/u.test(value) || value === "1") {
        throw new Error(`--build-number must be digits only and larger than 1 (got "${value}").`);
      }
      options.buildNumber = value;
      continue;
    }
    throw new Error(`Unknown option ${arg}. Use --dry-run or --build-number=<n>.`);
  }
  return options;
}

/**
 * The build number for an upload at `date`: the UTC time as `YYMMDDHHmm`. It increases each minute,
 * and it is always larger than build 1, the first upload.
 */
export function timestampBuildNumber(date: Date): string {
  const two = (value: number) => String(value).padStart(2, "0");
  return [
    two(date.getUTCFullYear() % 100),
    two(date.getUTCMonth() + 1),
    two(date.getUTCDate()),
    two(date.getUTCHours()),
    two(date.getUTCMinutes()),
  ].join("");
}

const NOT_TARGET_DIRECTORIES = new Set(["Pods", "build"]);

/**
 * The target directories of `apps/mobile/ios` that have an `Info.plist`: the app (`GoAhead`) and its
 * extensions, such as the widget (`ExpoWidgetsTarget`). `entries` are the top-level directory names.
 */
export function targetInfoPlists(entries: readonly string[], hasInfoPlist: (entry: string) => boolean): string[] {
  return entries
    .filter((entry) => !NOT_TARGET_DIRECTORIES.has(entry) && !/\.(xcodeproj|xcworkspace)$/u.test(entry))
    .filter(hasInfoPlist)
    .sort()
    .map((entry) => `${entry}/Info.plist`);
}

/** The `-exportOptionsPlist` file for an App Store Connect export with automatic signing. */
export function exportOptionsPlist(teamId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>destination</key>
  <string>export</string>
  <key>teamID</key>
  <string>${teamId}</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>uploadSymbols</key>
  <true/>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
</dict>
</plist>
`;
}

/** The `Delivery UUID` that `xcrun altool --upload-app` prints after a successful upload. */
export function parseDeliveryUuid(output: string): string | null {
  return /Delivery UUID:\s*([0-9a-f-]{36})/iu.exec(output)?.[1] ?? null;
}

/** Removes each line that contains `secret`, so tool output can be printed. */
export function withoutSecretLines(output: string, secret: string | undefined): string {
  if (!secret) return output;
  return output
    .split("\n")
    .filter((line) => !line.includes(secret))
    .join("\n");
}
