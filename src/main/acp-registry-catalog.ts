// The public ACP registry catalog. Main fetches and validates it; no executable comes from the
// renderer, and one malformed entry cannot hide every other agent.

import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";

const ACP_REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const CATALOG_LIMIT_BYTES = 8 * 1024 * 1024;
const CATALOG_AGENT_LIMIT = 1000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

interface RegistryLaunchOptions {
  args?: readonly string[];
  env?: Readonly<Record<string, string>>;
}

export interface RegistryBinaryTarget extends RegistryLaunchOptions {
  archive: string;
  cmd: string;
  sha256?: string;
}

export interface RegistryPackageTarget extends RegistryLaunchOptions {
  package: string;
}

export interface RegistryAgent {
  id: string;
  name: string;
  version: string;
  description: string;
  website?: string;
  license?: string;
  distribution: {
    binary?: Readonly<Record<string, RegistryBinaryTarget>>;
    npx?: RegistryPackageTarget;
    uvx?: RegistryPackageTarget;
  };
}

/** A registry failure with a message the user can read. */
export class AcpRegistryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AcpRegistryError";
  }
}

const EXACT_VERSION = "v?[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?";
const NPM_PACKAGE = new RegExp(`^(?:@[a-z0-9._-]+/[a-z0-9._-]+|[a-z0-9][a-z0-9._-]*)@${EXACT_VERSION}$`, "iu");
const UV_PACKAGE = new RegExp(`^[a-z0-9][a-z0-9._-]*(?:@|==)${EXACT_VERSION}$`, "iu");
const ID = /^[a-z0-9][a-z0-9._-]*$/u;
const ARGUMENT = /^[^\0\r\n]*$/u;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const SHA256 = /^[a-fA-F0-9]{64}$/u;

function text(value: unknown, limit: number): value is string {
  return isString(value) && value.length <= limit;
}

function argument(value: unknown): value is string {
  return text(value, 1024) && ARGUMENT.test(value);
}

function httpsUrl(value: unknown): value is string {
  if (!text(value, 2048)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** `args` and `env`, when present, or null when either is malformed. */
function launchOptions(value: DynamicRecord): RegistryLaunchOptions | null {
  const options: RegistryLaunchOptions = {};
  if (value.args !== undefined) {
    if (!Array.isArray(value.args) || value.args.length > 32 || !value.args.every(argument)) return null;
    options.args = [...value.args];
  }
  if (value.env !== undefined) {
    if (!isDynamicRecord(value.env)) return null;
    const env: Record<string, string> = {};
    for (const [name, entry] of Object.entries(value.env)) {
      if (!ENV_NAME.test(name) || !argument(entry)) return null;
      env[name] = entry;
    }
    options.env = env;
  }
  return options;
}

function binaryTarget(value: unknown): RegistryBinaryTarget | null {
  if (!isDynamicRecord(value) || !httpsUrl(value.archive) || !argument(value.cmd)) return null;
  if (value.sha256 !== undefined && !(isString(value.sha256) && SHA256.test(value.sha256))) return null;
  const options = launchOptions(value);
  if (!options) return null;
  return {
    archive: value.archive,
    cmd: value.cmd,
    ...(isString(value.sha256) ? { sha256: value.sha256 } : {}),
    ...options,
  };
}

function packageTarget(value: unknown, pattern: RegExp): RegistryPackageTarget | null {
  if (!isDynamicRecord(value) || !text(value.package, 256) || !pattern.test(value.package)) return null;
  const options = launchOptions(value);
  return options ? { package: value.package, ...options } : null;
}

/** One catalog entry, or null when any part of it is malformed. */
export function parseRegistryAgent(value: unknown): RegistryAgent | null {
  if (
    !isDynamicRecord(value) ||
    !text(value.id, 128) ||
    !ID.test(value.id) ||
    !text(value.name, 160) ||
    !text(value.version, 128) ||
    !text(value.description, 4096) ||
    (value.website !== undefined && !httpsUrl(value.website)) ||
    (value.license !== undefined && !text(value.license, 128)) ||
    !isDynamicRecord(value.distribution)
  )
    return null;
  const source = value.distribution;
  const distribution: RegistryAgent["distribution"] = {};
  if (source.binary !== undefined) {
    if (!isDynamicRecord(source.binary)) return null;
    const binary: Record<string, RegistryBinaryTarget> = {};
    for (const [target, entry] of Object.entries(source.binary)) {
      const parsed = binaryTarget(entry);
      if (!parsed) return null;
      binary[target] = parsed;
    }
    distribution.binary = binary;
  }
  if (source.npx !== undefined) {
    const npx = packageTarget(source.npx, NPM_PACKAGE);
    if (!npx) return null;
    distribution.npx = npx;
  }
  if (source.uvx !== undefined) {
    const uvx = packageTarget(source.uvx, UV_PACKAGE);
    if (!uvx) return null;
    distribution.uvx = uvx;
  }
  return {
    id: value.id,
    name: value.name,
    version: value.version,
    description: value.description,
    ...(isString(value.website) ? { website: value.website } : {}),
    ...(isString(value.license) ? { license: value.license } : {}),
    distribution,
  };
}

/** The valid catalog entries, first of each id. A malformed catalog fails as a whole. */
export function parseRegistryCatalog(raw: unknown): RegistryAgent[] {
  if (!isDynamicRecord(raw) || !Array.isArray(raw.agents) || raw.agents.length > CATALOG_AGENT_LIMIT)
    throw new AcpRegistryError(sourceText("error.provider.registryInvalid"));
  const entries: RegistryAgent[] = [];
  const ids = new Set<string>();
  for (const candidate of raw.agents) {
    const entry = parseRegistryAgent(candidate);
    if (!entry || ids.has(entry.id)) continue;
    ids.add(entry.id);
    entries.push(entry);
  }
  return entries;
}

export async function readAcpRegistry(signal?: AbortSignal): Promise<RegistryAgent[]> {
  const bytes = await registryDownload(ACP_REGISTRY_URL, CATALOG_LIMIT_BYTES, signal);
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new AcpRegistryError(sourceText("error.provider.registryInvalid"), { cause: error });
  }
  return parseRegistryCatalog(raw);
}

/** Bounds both network time and bytes. Redirects must still end on credential-free HTTPS. */
export async function registryDownload(url: string, maximum: number, signal?: AbortSignal): Promise<Buffer> {
  const timeout = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new AcpRegistryError(sourceText("error.provider.registryUnavailable"), { cause: error });
  }
  const destination = new URL(response.url || url);
  if (
    !response.ok ||
    destination.protocol !== "https:" ||
    destination.username ||
    destination.password ||
    !response.body
  )
    throw new AcpRegistryError(sourceText("error.provider.registryUnavailable"));
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > maximum) throw new AcpRegistryError(sourceText("error.provider.registryInvalid"));
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
