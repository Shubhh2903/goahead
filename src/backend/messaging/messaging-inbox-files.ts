import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import type { InboxFile } from "./messaging-types";

/** The largest file the inbox downloads to show. A larger one shows as a chip only. */
export const INBOX_FILE_MAX_BYTES = 20 * 1024 * 1024;
/** The most bytes the inbox keeps for one workspace. The oldest files go first. */
export const INBOX_FILES_TOTAL_BYTES = 200 * 1024 * 1024;
/** The most messages with files that the index of one workspace remembers. */
const INDEX_LIMIT = 5_000;
const INDEX_FILE = "files.json";
const BYTES_DIRECTORY = "bytes";
/** A Slack file id. It also names the cached file, so nothing else may reach a path. */
const FILE_ID = /^F[A-Z0-9]{4,40}$/u;
/** A connection id names a folder, so it must be a plain name. */
const CONNECTION_ID = /^[A-Za-z0-9_-]{1,128}$/u;

interface IndexEntry {
  sentAt: string;
  files: InboxFile[];
}

/** Downloads one Slack file to `destination`, and refuses a file larger than `maxBytes`. */
export type InboxFileDownload = (url: string, destination: string, maxBytes: number) => Promise<void>;

/**
 * Owns what the inbox knows about files that Slack messages shared, and their cached bytes, under one
 * folder per connection: `<root>/<connectionId>/files.json` and `<root>/<connectionId>/bytes/<fileId>`.
 *
 * The SQLite inbox row has no place for files, and a migration only for this is not worth its risk:
 * the index is a cache of what Slack sent. When it is lost, a message shows without its files.
 * `conversations.history` cannot fill it again on demand: Slack allows apps outside its Marketplace
 * one call a minute. The index never holds a token, and nothing here logs a file address.
 */
export class MessagingInboxFiles {
  readonly #root: string;
  readonly #indexes = new Map<string, Promise<Map<string, IndexEntry>>>();
  readonly #writes = new Map<string, Promise<void>>();
  readonly #downloads = new Map<string, Promise<string>>();

  constructor(root: string) {
    this.#root = root;
  }

  /** Remembers the files of one message. A message without files changes nothing. */
  async remember(
    connectionId: string,
    platformChannelId: string,
    platformMessageId: string,
    sentAt: string,
    files: readonly InboxFile[],
  ): Promise<void> {
    const kept = files.filter((file) => FILE_ID.test(file.id));
    if (kept.length === 0 || !CONNECTION_ID.test(connectionId)) return;
    const index = await this.#index(connectionId);
    index.set(messageKey(platformChannelId, platformMessageId), { sentAt, files: kept });
    if (index.size > INDEX_LIMIT) {
      const oldest = [...index.entries()].sort((left, right) => left[1].sentAt.localeCompare(right[1].sentAt));
      for (const [key] of oldest.slice(0, index.size - INDEX_LIMIT)) index.delete(key);
    }
    await this.#save(connectionId, index);
  }

  /** The files of each message of one conversation that has some, by message id. */
  async forMessages(
    connectionId: string,
    platformChannelId: string,
    platformMessageIds: readonly string[],
  ): Promise<Map<string, InboxFile[]>> {
    const result = new Map<string, InboxFile[]>();
    if (!CONNECTION_ID.test(connectionId)) return result;
    const index = await this.#index(connectionId);
    for (const id of platformMessageIds) {
      const entry = index.get(messageKey(platformChannelId, id));
      if (entry) result.set(id, entry.files);
    }
    return result;
  }

  /**
   * The cached bytes of one image file that the index holds, downloaded the first time. Null for a
   * file the index does not hold, a file that is not an image, a larger file than the cap, or an
   * address that is not Slack's: only an address that Slack sent is ever fetched.
   */
  async image(connectionId: string, fileId: string, download: InboxFileDownload): Promise<InboxImage | null> {
    if (!CONNECTION_ID.test(connectionId) || !FILE_ID.test(fileId)) return null;
    const file = [...(await this.#index(connectionId)).values()]
      .flatMap((entry) => entry.files)
      .find((candidate) => candidate.id === fileId);
    if (!file || !isInboxImage(file.mimeType)) return null;
    const url = file.thumbnailUrl ?? file.url;
    if (!isSlackFileUrl(url)) return null;
    // Slack's own size is of the whole file; a thumbnail is smaller, and the download cuts at the cap.
    if (file.thumbnailUrl === null && file.size > INBOX_FILE_MAX_BYTES) return null;
    const key = `${connectionId}/${fileId}`;
    let pending = this.#downloads.get(key);
    if (!pending) {
      pending = this.#download(connectionId, fileId, url, download).finally(() => this.#downloads.delete(key));
      this.#downloads.set(key, pending);
    }
    const path = await pending.catch(() => null);
    return path
      ? { path, mimeType: file.thumbnailUrl ? thumbnailType(file.thumbnailUrl, file.mimeType) : file.mimeType }
      : null;
  }

  /** Forgets the files of messages sent before `time`, and their bytes. */
  async purgeBefore(time: string): Promise<void> {
    let connections: string[];
    try {
      connections = await readdir(this.#root);
    } catch {
      return;
    }
    for (const connectionId of connections.filter((name) => CONNECTION_ID.test(name))) {
      const index = await this.#index(connectionId);
      const gone: string[] = [];
      for (const [key, entry] of index)
        if (entry.sentAt < time) {
          index.delete(key);
          gone.push(...entry.files.map((file) => file.id));
        }
      if (gone.length === 0) continue;
      await this.#save(connectionId, index);
      await Promise.all(
        gone.map((id) =>
          rm(join(this.#root, connectionId, BYTES_DIRECTORY, id), { force: true }).catch(() => undefined),
        ),
      );
    }
  }

  /** Forgets one workspace's files and bytes, as a disconnect forgets its inbox. */
  async deleteForConnection(connectionId: string): Promise<void> {
    if (!CONNECTION_ID.test(connectionId)) return;
    await this.#writes.get(connectionId)?.catch(() => undefined);
    this.#indexes.delete(connectionId);
    await rm(join(this.#root, connectionId), { recursive: true, force: true });
  }

  async #download(connectionId: string, fileId: string, url: string, download: InboxFileDownload): Promise<string> {
    const directory = join(this.#root, connectionId, BYTES_DIRECTORY);
    const path = join(directory, fileId);
    if (
      await stat(path).then(
        (info) => info.isFile(),
        () => false,
      )
    )
      return path;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const partial = `${path}.part`;
    try {
      await download(url, partial, INBOX_FILE_MAX_BYTES);
      await rename(partial, path);
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }
    await this.#trim(directory, path);
    return path;
  }

  /** Keeps the bytes of one workspace under the total cap. The oldest files go first, never `keep`. */
  async #trim(directory: string, keep: string): Promise<void> {
    const names: string[] = await readdir(directory).catch(() => []);
    const files = (
      await Promise.all(
        names.map(async (name) => {
          const path = join(directory, name);
          const info = await stat(path).catch(() => null);
          return info?.isFile() ? { path, size: info.size, time: info.mtimeMs } : null;
        }),
      )
    ).filter((file) => file !== null);
    let total = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files.sort((left, right) => left.time - right.time)) {
      if (total <= INBOX_FILES_TOTAL_BYTES) break;
      if (file.path === keep) continue;
      await rm(file.path, { force: true });
      total -= file.size;
    }
  }

  #index(connectionId: string): Promise<Map<string, IndexEntry>> {
    let index = this.#indexes.get(connectionId);
    if (!index) {
      index = readFile(join(this.#root, connectionId, INDEX_FILE), "utf8").then(
        (text) => parseIndex(text),
        () => new Map<string, IndexEntry>(),
      );
      this.#indexes.set(connectionId, index);
    }
    return index;
  }

  /** Writes the index after the write before it, through a temporary file, so a crash keeps one whole. */
  #save(connectionId: string, index: Map<string, IndexEntry>): Promise<void> {
    const previous = this.#writes.get(connectionId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const directory = join(this.#root, connectionId);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const path = join(directory, INDEX_FILE);
        const temporary = `${path}.tmp`;
        await writeFile(temporary, JSON.stringify({ version: 1, messages: Object.fromEntries(index) }), {
          mode: 0o600,
        });
        await rename(temporary, path);
      });
    this.#writes.set(connectionId, next);
    return next;
  }
}

export interface InboxImage {
  path: string;
  mimeType: string;
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function isInboxImage(mimeType: string): boolean {
  return IMAGE_TYPES.has(mimeType);
}

/** Slack's file hosts. Only these are fetched, with the token, for an inbox file. */
export function isSlackFileUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "slack.com" || url.hostname.endsWith(".slack.com"));
  } catch {
    return false;
  }
}

/** Slack makes a thumbnail of a GIF or a WebP as PNG or JPEG; its address names the type. */
function thumbnailType(url: string, fallback: string): string {
  const path = new URL(url).pathname.toLowerCase();
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".webp")) return "image/webp";
  return fallback;
}

function messageKey(platformChannelId: string, platformMessageId: string): string {
  return `${platformChannelId}:${platformMessageId}`;
}

function parseIndex(text: string): Map<string, IndexEntry> {
  const index = new Map<string, IndexEntry>();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return index;
  }
  if (!isDynamicRecord(value) || !isDynamicRecord(value.messages)) return index;
  for (const [key, entry] of Object.entries(value.messages)) {
    if (!isDynamicRecord(entry) || !isString(entry.sentAt) || !Array.isArray(entry.files)) continue;
    const files = entry.files.filter(isInboxFile);
    if (files.length) index.set(key, { sentAt: entry.sentAt, files });
  }
  return index;
}

function isInboxFile(value: unknown): value is InboxFile {
  return (
    isDynamicRecord(value) &&
    isString(value.id) &&
    FILE_ID.test(value.id) &&
    isString(value.name) &&
    isString(value.mimeType) &&
    isNumber(value.size) &&
    isString(value.url) &&
    (value.thumbnailUrl === null || isString(value.thumbnailUrl)) &&
    (value.permalink === null || isString(value.permalink))
  );
}
