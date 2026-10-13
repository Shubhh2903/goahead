// The Bitwarden connection of this computer. It runs the user's installed `bw` CLI with a session key
// that stays in memory, and reads only the logins in the folder the user shared with GoAhead.

import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import type { BitwardenConnectorStatus } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { z } from "zod";
import type { PasswordVault, VaultLogin } from "../backend/password-vault";

const IDLE_MS = 8 * 60 * 60 * 1000;
const SHARED_FOLDER = "Shared with OpenBot";
const foldersSchema = z.array(z.object({ id: z.string().nullable(), name: z.string() }));
const itemSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.number(),
  folderId: z.string().nullable(),
  reprompt: z.number().optional(),
  deletedDate: z.string().nullable().optional(),
  login: z
    .object({
      username: z.string().nullable().optional(),
      password: z.string().nullable().optional(),
      totp: z.string().nullable().optional(),
      uris: z
        .array(z.object({ uri: z.string().nullable(), match: z.number().nullable().optional() }))
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});
type Item = z.infer<typeof itemSchema>;

interface Session {
  executable: string;
  key: string;
  folderId: string;
  abort: AbortController;
}

export type BitwardenCliRunner = (
  executable: string,
  args: string[],
  key: string,
  signal: AbortSignal,
) => Promise<string>;

/** The one failure every caller sees. It never carries CLI output, the key or a vault value. */
function failure(): Error {
  return new Error(sourceText("error.connector.bitwardenFailed"));
}

function parse<T>(schema: z.ZodType<T>, output: string): T {
  try {
    return schema.parse(JSON.parse(output));
  } catch {
    throw failure();
  }
}

/** No shell, inherited credentials, or command output in an error. */
export const runBitwardenCli: BitwardenCliRunner = (executable, args, key, signal) => {
  const env: NodeJS.ProcessEnv = { BW_SESSION: key, BITWARDENCLI_INTERACTIVE: "false" };
  for (const name of [
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "SystemRoot",
    "TEMP",
    "TMP",
    "TMPDIR",
    "PATH",
    "BITWARDENCLI_APPDATA_DIR",
  ]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      { env, signal, timeout: 30_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error) reject(failure());
        else resolve(stdout);
      },
    );
  });
};

async function findCli(): Promise<string> {
  const name = process.platform === "win32" ? "bw.exe" : "bw";
  const directories = [...(process.env.PATH ?? "").split(delimiter), "/opt/homebrew/bin", "/usr/local/bin"];
  for (const directory of new Set(directories.filter(isAbsolute))) {
    try {
      const path = await realpath(join(directory, name));
      await access(path, constants.X_OK);
      return path;
    } catch {
      /* Try the next installation directory. */
    }
  }
  throw failure();
}

/**
 * Exact HTTPS origins only. Never widens Bitwarden's matching rule to a parent domain. Only the
 * default (`null`), domain (0) and host (1) rules are accepted; the others use the manual card.
 */
function matches(item: Item, folderId: string, origin: string): boolean {
  if (
    item.type !== 1 ||
    item.folderId !== folderId ||
    (item.reprompt !== undefined && item.reprompt !== 0) ||
    item.deletedDate
  )
    return false;
  return (
    item.login?.uris?.some((entry) => {
      if (!entry.uri || (entry.match != null && entry.match !== 0 && entry.match !== 1)) return false;
      try {
        const saved = new URL(entry.uri);
        const page = new URL(origin);
        return saved.protocol === "https:" && page.protocol === "https:" && saved.origin === page.origin;
      } catch {
        return false;
      }
    }) ?? false
  );
}

/** Owns one memory-only CLI session. It reads only logins in the folder the user shared. */
export class BitwardenConnectorService implements PasswordVault {
  readonly #run: BitwardenCliRunner;
  readonly #find: () => Promise<string>;
  readonly #running = new Set<Promise<string>>();
  readonly #listeners = new Set<(status: BitwardenConnectorStatus) => void>();
  /** One CLI call at a time: `bw` shares one cache file between calls. */
  #queue: Promise<unknown> = Promise.resolve();
  #session: Session | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #attempt = 0;

  constructor(options: { runCli?: BitwardenCliRunner; findCli?: () => Promise<string> } = {}) {
    this.#run = options.runCli ?? runBitwardenCli;
    this.#find = options.findCli ?? findCli;
  }

  connected(): boolean {
    return Boolean(this.#session?.folderId);
  }

  status(): BitwardenConnectorStatus {
    return { connected: this.connected() };
  }

  onChanged(listener: (status: BitwardenConnectorStatus) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async connect(key: string): Promise<BitwardenConnectorStatus> {
    this.disconnect();
    const attempt = this.#attempt;
    registerSecretValue(key);
    let executable: string;
    try {
      executable = await this.#find();
    } catch {
      throw failure();
    }
    // A disconnect while the CLI was looked up wins.
    if (attempt !== this.#attempt) return this.status();
    const session: Session = { executable, key, folderId: "", abort: new AbortController() };
    // Keep the pending session so disconnect can cancel the CLI while connect is waiting.
    this.#session = session;
    try {
      await this.#call(session, ["sync"]);
      const folders = parse(foldersSchema, await this.#call(session, ["list", "folders"]));
      const shared = folders.filter((folder) => folder.name === SHARED_FOLDER);
      const folderId = shared.length === 1 ? shared[0]?.id : null;
      if (!folderId) throw failure();
      session.folderId = folderId;
      this.#touch();
      this.#emit();
      return this.status();
    } catch {
      if (this.#session === session) this.disconnect();
      throw failure();
    }
  }

  disconnect(): BitwardenConnectorStatus {
    this.#attempt++;
    this.#session?.abort.abort();
    this.#session = null;
    clearTimeout(this.#timer);
    this.#emit();
    return this.status();
  }

  /** Stops access first, then waits for the child processes to finish. */
  async dispose(): Promise<void> {
    this.disconnect();
    await Promise.allSettled([...this.#running]);
    this.#listeners.clear();
  }

  async loginsFor(origin: string): Promise<VaultLogin[] | null> {
    const session = this.#session;
    if (!session?.folderId) return null;
    await this.#call(session, ["sync"]);
    const items = parse(
      z.array(itemSchema),
      await this.#call(session, ["list", "items", "--folderid", session.folderId]),
    );
    return items
      .filter((item) => matches(item, session.folderId, origin))
      .map((item) => ({
        id: item.id,
        title: item.name,
        username: item.login?.username ?? null,
        hasOneTimePassword: Boolean(item.login?.totp),
      }));
  }

  async secretFor(id: string, origin: string, kind: "password" | "totp"): Promise<string | null> {
    const session = this.#session;
    // A Bitwarden item id is a UUID. Anything else could be read by the CLI as an option.
    if (!session?.folderId || !/^[a-f0-9-]{36}$/iu.test(id)) return null;
    await this.#call(session, ["sync"]);
    const item = parse(itemSchema, await this.#call(session, ["get", "item", id]));
    // The list can be old: the item as the vault holds it now decides.
    if (item.id !== id || !matches(item, session.folderId, origin)) return null;
    const value =
      kind === "password"
        ? item.login?.password
        : item.login?.totp
          ? (await this.#call(session, ["get", "totp", id])).trim()
          : null;
    if (!value) return null;
    // A six-digit code is shorter than the usual limit, but it is a credential too.
    registerSecretValue(value, { allowShort: true });
    return value;
  }

  /** Runs one CLI call of `session`. A call that ends after a disconnect or a new connect fails. */
  #call(session: Session, args: string[]): Promise<string> {
    const operation = async (): Promise<string> => {
      if (this.#session !== session) throw failure();
      const pending = this.#run(session.executable, args, session.key, session.abort.signal);
      this.#running.add(pending);
      let value: string;
      try {
        value = await pending;
      } catch {
        throw failure();
      } finally {
        this.#running.delete(pending);
      }
      if (this.#session !== session) throw failure();
      this.#touch();
      return value;
    };
    const next = this.#queue.then(operation, operation);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  #touch(): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#attempt++;
      this.#session?.abort.abort();
      this.#session = null;
      this.#emit();
    }, IDLE_MS);
    this.#timer.unref();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener(this.status());
  }
}
