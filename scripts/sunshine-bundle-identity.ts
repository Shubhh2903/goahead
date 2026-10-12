import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PRODUCT_IDENTITY } from "@openbot/contracts/product-identity";
import { z } from "zod";
import { sha256 } from "./remote-desktop-runtime-release";

/**
 * A release ships Sunshine.app exactly as the pinned runtime has it (`dev.lizardbyte.app.Sunshine`).
 * macOS gives Screen Recording and Accessibility to the responsible app (GoAhead, or the app that
 * started a development stack), so the Sunshine bundle id does not change what the user must allow.
 * A development copy gets its own bundle id and an Apple Development signature, so it never shares an
 * id with an installed release and its signature stays the same after a runtime rebuild.
 */
export type SunshineVariant = "development" | "release";

export type SunshineSigner = { kind: "adhoc" } | { kind: "identity"; hash: string; name: string };

export interface SunshineIdentityPlan {
  bundleId: string;
  signer: SunshineSigner;
}

/** Packaged builds set this to `release`: Sunshine.app stays as pinned. Without it, a development copy. */
export const SUNSHINE_VARIANT_ENVIRONMENT = "OPENBOT_REMOTE_DESKTOP_VARIANT";
/** Written next to a development Sunshine.app: the identity it got and the file digests after the change. */
export const SUNSHINE_IDENTITY_FILE = "SUNSHINE-IDENTITY.json";
/** The CFBundleIdentifier of the pinned runtime. Releases keep it unchanged. */
export const PINNED_SUNSHINE_BUNDLE_ID = "dev.lizardbyte.app.Sunshine";
export const DEVELOPMENT_SUNSHINE_BUNDLE_ID = `${PRODUCT_IDENTITY.appId}.sunshine.dev`;
const SUNSHINE_APP = "Sunshine.app";

const identityRecordSchema = z.object({
  schemaVersion: z.literal(1),
  variant: z.literal("development"),
  bundleId: z.string(),
  signer: z.string(),
  files: z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/u)),
});
export type SunshineIdentityRecord = z.infer<typeof identityRecordSchema>;

export function sunshineVariantFromEnvironment(environment: NodeJS.ProcessEnv = process.env): SunshineVariant {
  const value = environment[SUNSHINE_VARIANT_ENVIRONMENT]?.trim();
  if (!value || value === "development") return "development";
  if (value === "release") return "release";
  throw new Error(`${SUNSHINE_VARIANT_ENVIRONMENT} must be "development" or "release".`);
}

/** The first valid "Apple Development" identity in `security find-identity -v -p codesigning` output. */
export function parseAppleDevelopmentIdentity(output: string): SunshineSigner | null {
  for (const line of output.split("\n")) {
    const match = /^\s*\d+\)\s+([0-9A-F]{40})\s+"(.+)"\s*$/u.exec(line);
    const hash = match?.[1];
    const name = match?.[2];
    if (hash && name?.includes("Apple Development")) return { kind: "identity", hash, name };
  }
  return null;
}

/** A development copy uses the keychain identity when one exists. CI never looks for one. */
export function chooseSunshineSigner(
  findIdentities: () => string,
  environment: NodeJS.ProcessEnv = process.env,
): SunshineSigner {
  if (environment.CI) return { kind: "adhoc" };
  try {
    return parseAppleDevelopmentIdentity(findIdentities()) ?? { kind: "adhoc" };
  } catch {
    return { kind: "adhoc" };
  }
}

export function signerLabel(signer: SunshineSigner): string {
  return signer.kind === "adhoc" ? "adhoc" : signer.hash;
}

export function plistBuddySetBundleIdArgs(infoPlist: string, bundleId: string): string[] {
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/u.test(bundleId)) throw new Error(`Invalid bundle id: ${bundleId}`);
  return ["-c", `Set :CFBundleIdentifier ${bundleId}`, infoPlist];
}

/** The same shape electron-builder uses for nested code: hardened runtime and the inherited entitlements. */
export function sunshineCodesignArgs(app: string, signer: SunshineSigner, entitlements: string): string[] {
  if (signer.kind === "adhoc") return ["--force", "--deep", "--sign", "-", app];
  return ["--force", "--deep", "--options", "runtime", "--entitlements", entitlements, "--sign", signer.hash, app];
}

export type CommandRunner = (command: string, args: string[]) => void;

/** Sets the bundle id, signs Sunshine.app again, and records the digests of the changed bundle. */
export async function applySunshineIdentity(input: {
  architectureRoot: string;
  plan: SunshineIdentityPlan;
  entitlements: string;
  run: CommandRunner;
}): Promise<SunshineIdentityRecord> {
  const app = join(input.architectureRoot, SUNSHINE_APP);
  input.run(
    "/usr/libexec/PlistBuddy",
    plistBuddySetBundleIdArgs(join(app, "Contents", "Info.plist"), input.plan.bundleId),
  );
  input.run("codesign", sunshineCodesignArgs(app, input.plan.signer, input.entitlements));
  const files: Record<string, string> = {};
  for (const name of await listFiles(app)) {
    files[`${SUNSHINE_APP}/${name}`] = sha256(await readFile(join(app, ...name.split("/"))));
  }
  const record: SunshineIdentityRecord = {
    schemaVersion: 1,
    variant: "development",
    bundleId: input.plan.bundleId,
    signer: signerLabel(input.plan.signer),
    files,
  };
  await writeFile(join(input.architectureRoot, SUNSHINE_IDENTITY_FILE), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

export async function readSunshineIdentityRecord(architectureRoot: string): Promise<SunshineIdentityRecord | null> {
  let contents: string;
  try {
    contents = await readFile(join(architectureRoot, SUNSHINE_IDENTITY_FILE), "utf8");
  } catch {
    return null;
  }
  return identityRecordSchema.parse(JSON.parse(contents));
}

/**
 * The pinned checksums describe Sunshine.app before its id changed. Only files inside Sunshine.app take
 * their digest from the local record; every other file keeps its pinned digest.
 */
export function sunshineDigestOverrides(record: SunshineIdentityRecord | null, prefix = ""): Map<string, string> {
  const overrides = new Map<string, string>();
  if (!record) return overrides;
  for (const [name, digest] of Object.entries(record.files)) {
    if (name.startsWith(`${SUNSHINE_APP}/`)) overrides.set(`${prefix}${name}`, digest);
  }
  return overrides;
}

export function isSunshineIdentityCurrent(record: SunshineIdentityRecord | null, plan: SunshineIdentityPlan): boolean {
  return record !== null && record.bundleId === plan.bundleId && record.signer === signerLabel(plan.signer);
}

async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(root, ...prefix.split("/").filter(Boolean)), { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listFiles(root, relativePath)));
    else files.push(relativePath);
  }
  return files.sort();
}
