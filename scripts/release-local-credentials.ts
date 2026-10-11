import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { registerSecretValue } from "@openbot/logging";
import {
  type DeveloperIdIdentities,
  findDeveloperIdIdentities,
  NOTARIZATION_VARIABLES,
  type NotarizationVariable,
  parseEnvFile,
  RELEASE_TEAM_ID,
} from "./release-local-lib";

/** Git ignores this file. It holds the notarization values; `.env.release.example` lists the names. */
export const RELEASE_ENV_FILE = ".env.release";

export type LocalCredentials = {
  problems: string[];
  /** The Developer ID Application name without its prefix, for electron-builder's `CSC_NAME`. */
  applicationIdentity: string | null;
  notarization: Partial<Record<NotarizationVariable, string>>;
};

/**
 * Checks the signing identities in the keychain and the notarization variables, from the
 * environment or from `.env.release`. A value from the environment wins over the file. The result
 * never names a value, and each value is registered with the logger as a secret.
 */
export function checkLocalCredentials(): LocalCredentials {
  const problems: string[] = [];
  const notarization = readAppleVariables(problems);

  let identities: DeveloperIdIdentities = { application: null, installer: null };
  try {
    identities = findDeveloperIdIdentities(
      execFileSync("security", ["find-identity", "-v"], { encoding: "utf8" }),
      RELEASE_TEAM_ID,
    );
  } catch {
    problems.push("`security find-identity -v` failed");
  }
  if (identities.application === null) {
    problems.push(`no valid "Developer ID Application: … (${RELEASE_TEAM_ID})" identity in the keychain`);
  }
  if (identities.installer === null) {
    problems.push(`no valid "Developer ID Installer: … (${RELEASE_TEAM_ID})" identity in the keychain`);
  }
  return { problems, applicationIdentity: identities.application, notarization };
}

export type AppleUploadCredentials = {
  problems: string[];
  values: Partial<Record<NotarizationVariable, string>>;
};

/**
 * Checks only the Apple ID variables, for an upload that signs with Xcode and needs no Developer ID
 * identity (`bun run release:mobile:local`). Each value except the team id is registered as a secret.
 */
export function checkAppleUploadCredentials(): AppleUploadCredentials {
  const problems: string[] = [];
  return { problems, values: readAppleVariables(problems) };
}

function readAppleVariables(problems: string[]): Partial<Record<NotarizationVariable, string>> {
  const fileValues = readReleaseEnvFile(problems);
  const values: Partial<Record<NotarizationVariable, string>> = {};
  for (const name of NOTARIZATION_VARIABLES) {
    const value = process.env[name]?.trim() || fileValues.get(name)?.trim();
    if (!value) {
      problems.push(`${name} is not set in the environment or in ${RELEASE_ENV_FILE}`);
      continue;
    }
    if (name !== "APPLE_TEAM_ID") registerSecretValue(value);
    values[name] = value;
  }
  if (values.APPLE_TEAM_ID !== undefined && values.APPLE_TEAM_ID !== RELEASE_TEAM_ID) {
    problems.push(`APPLE_TEAM_ID is not the company team ${RELEASE_TEAM_ID}`);
  }
  return values;
}

function readReleaseEnvFile(problems: string[]): Map<string, string> {
  if (!existsSync(RELEASE_ENV_FILE)) return new Map();
  try {
    execFileSync("git", ["check-ignore", "-q", RELEASE_ENV_FILE]);
  } catch {
    problems.push(`${RELEASE_ENV_FILE} is not ignored by git. Add it to .gitignore before you use it`);
    return new Map();
  }
  return parseEnvFile(readFileSync(RELEASE_ENV_FILE, "utf8"));
}
