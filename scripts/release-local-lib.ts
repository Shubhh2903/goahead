// Pure helpers for `scripts/release-local.ts` and `scripts/release-preflight.ts`. No process, file
// or network access here, so the tests can run them on any machine.

/** The Apple Team ID of the company Developer ID certificates. A team id is not a secret. */
export const RELEASE_TEAM_ID = "S29HD2MDR4";

/** The notarization variables electron-builder and `notarytool` read. Their values are secrets. */
export const NOTARIZATION_VARIABLES = ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"] as const;
export type NotarizationVariable = (typeof NOTARIZATION_VARIABLES)[number];

export type ReleaseLocalOptions = { dryRun: boolean; skipBuild: boolean; replace: boolean };

const RELEASE_FLAGS: Record<string, keyof ReleaseLocalOptions> = {
  "--dry-run": "dryRun",
  "--skip-build": "skipBuild",
  "--replace": "replace",
};

export function parseReleaseLocalArgs(args: readonly string[]): ReleaseLocalOptions {
  const options: ReleaseLocalOptions = { dryRun: false, skipBuild: false, replace: false };
  for (const arg of args) {
    // `bun run release:local -- --dry-run` passes the separator through.
    if (arg === "--") continue;
    const key = RELEASE_FLAGS[arg];
    if (key === undefined) {
      throw new Error(`Unknown option ${arg}. Use --dry-run, --skip-build or --replace.`);
    }
    options[key] = true;
  }
  return options;
}

/**
 * Reads `NAME=value` lines from a dotenv file. It accepts `export NAME=value`, single or double
 * quotes around the value, blank lines and `#` comments. It does not expand variables.
 */
export function parseEnvFile(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line);
    if (match === null) continue;
    const [, name, rawValue] = match;
    if (name === undefined || rawValue === undefined) continue;
    let value = rawValue.trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/u, "");
    }
    values.set(name, value);
  }
  return values;
}

export type DeveloperIdIdentities = { application: string | null; installer: string | null };

/**
 * Finds the Developer ID identities of `teamId` in `security find-identity -v` output. Each result is
 * the name without its certificate type prefix, as electron-builder's `CSC_NAME` expects it.
 */
export function findDeveloperIdIdentities(output: string, teamId: string): DeveloperIdIdentities {
  const result: DeveloperIdIdentities = { application: null, installer: null };
  for (const line of output.split("\n")) {
    const match = /"Developer ID (Application|Installer): (.+ \(([A-Z0-9]{10})\))"/u.exec(line);
    if (match === null || match[3] !== teamId || match[2] === undefined) continue;
    if (match[1] === "Application") result.application ??= match[2];
    else result.installer ??= match[2];
  }
  return result;
}

/** The commands to print when the tag `v<version>` is not on origin at HEAD. */
export function tagCommands(version: string): string[] {
  return [`git tag -a v${version} -m "GoAhead v${version}"`, `git push origin v${version}`];
}

export type ReleaseArtifacts = {
  dmg: string;
  zip: string;
  blockmap: string;
  manifest: string;
  checksums: string;
  app: string;
};

/** The arm64 files electron-builder writes for `version` (`artifactName` in electron-builder.yml). */
export function releaseArtifacts(version: string, productName = "GoAhead"): ReleaseArtifacts {
  return {
    dmg: `dist/${productName}-${version}-arm64.dmg`,
    zip: `dist/${productName}-${version}-arm64.zip`,
    blockmap: `dist/${productName}-${version}-arm64.zip.blockmap`,
    manifest: "dist/latest-mac.yml",
    checksums: "dist/SHA256SUMS.txt",
    app: `dist/mac-arm64/${productName}.app`,
  };
}

/**
 * Replaces `$NAME` placeholders in a command with values from `env`. The plan keeps the
 * placeholders, so a printed or logged command never holds a secret.
 */
export function resolvePlaceholders(argv: readonly string[], env: Readonly<Record<string, string | undefined>>) {
  return argv.map((arg) =>
    arg.replace(/\$([A-Z_][A-Z0-9_]*)/gu, (_whole, name: string) => {
      const value = env[name];
      if (value === undefined) throw new Error(`${name} is not set.`);
      return value;
    }),
  );
}

/** Shell-quotes a planned command for display. */
export function formatCommand(argv: readonly string[]): string {
  return argv.map((arg) => (/^[\w@%+=:,./$-]+$/u.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`)).join(" ");
}
