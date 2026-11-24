import { randomUUID } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  CHAT_BACKDROP_UPLOAD_LIMITS,
  CHAT_BACKDROP_UPLOAD_TYPES,
  type ChatBackdropChoice,
  type ChatBackdropState,
  type ChatBackdropUpload,
  type ChatBackdropUploadExtension,
  type ChatBackdropUploadResult,
  isChatBackdropChoice,
  isChatBackdropUploadExtension,
  isChatBackdropUploadId,
  parseChatBackdropUpload,
  uploadBackdropChoice,
  uploadBackdropId,
} from "@openbot/contracts/chat-backdrop";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";
import { isMissingFileError } from "../backend/file-errors";

/** In userData: the choice. A missing file is no backdrop, which is how the window looked before. */
export const CHAT_BACKDROP_CHOICE_FILE = "openbot-chat-backdrop-v1.json";
/** In userData: the uploaded files, as `<id>.<extension>`, and their index. */
export const CHAT_BACKDROP_UPLOAD_DIRECTORY = "chat-backdrops";
const INDEX_FILE = "backdrops-v1.json";

const logger = createOpenBotLogger("chat-backdrop-store");
const SIGNATURE_BYTES = 16;

interface StoredUpload extends ChatBackdropUpload {
  extension: ChatBackdropUploadExtension;
}

function ascii(bytes: Uint8Array, start: number, text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[start + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

/**
 * Whether the first bytes of a file are the signature of its type. The extension alone is a claim:
 * this keeps a file that is something else out of the image and video decoders.
 */
function matchesChatBackdropSignature(extension: ChatBackdropUploadExtension, head: Uint8Array): boolean {
  switch (CHAT_BACKDROP_UPLOAD_TYPES[extension].mimeType) {
    case "image/png":
      return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => head[index] === byte);
    case "image/jpeg":
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case "image/gif":
      return ascii(head, 0, "GIF87a") || ascii(head, 0, "GIF89a");
    case "image/webp":
      return ascii(head, 0, "RIFF") && ascii(head, 8, "WEBP");
    case "image/avif":
      return ascii(head, 4, "ftyp") && (ascii(head, 8, "avif") || ascii(head, 8, "avis"));
    case "video/mp4":
      return ascii(head, 4, "ftyp") && !ascii(head, 8, "avif") && !ascii(head, 8, "avis");
    case "video/webm":
      return head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
  }
}

function parseStoredUpload(value: unknown): StoredUpload | null {
  const upload = parseChatBackdropUpload(value);
  if (!upload || !isDynamicRecord(value)) return null;
  const { extension } = value;
  if (typeof extension !== "string" || !isChatBackdropUploadExtension(extension)) return null;
  if (CHAT_BACKDROP_UPLOAD_TYPES[extension].kind !== upload.kind) return null;
  return { ...upload, extension };
}

function uploadName(path: string): string {
  const name = basename(path, extname(path)).trim().slice(0, CHAT_BACKDROP_UPLOAD_LIMITS.name);
  return name || basename(path).slice(0, CHAT_BACKDROP_UPLOAD_LIMITS.name);
}

/** Counts the bytes that pass, and fails once they are more than the limit. */
function byteLimit(limit: number): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.byteLength;
      if (total > limit) callback(new Error("The file grew past the backdrop size limit."));
      else callback(null, chunk);
    },
  });
}

/**
 * The backdrop behind this computer's window: the choice, and the images and videos that the user
 * uploaded. Both are files under userData, so an app update keeps them. No database table is used.
 *
 * A choice file that is missing, unreadable, or of another version reads as no backdrop. An index
 * that cannot be read reads as no uploads; its files stay on disk. Writes are chained, so an older
 * write cannot land after a newer one.
 */
export class ChatBackdropStore {
  readonly #choicePath: string;
  readonly #directory: string;
  readonly #indexPath: string;
  #choice: ChatBackdropChoice | null = null;
  #uploads: StoredUpload[] = [];
  #pending: Promise<unknown> = Promise.resolve();

  constructor(userDataPath: string) {
    this.#choicePath = join(userDataPath, CHAT_BACKDROP_CHOICE_FILE);
    this.#directory = join(userDataPath, CHAT_BACKDROP_UPLOAD_DIRECTORY);
    this.#indexPath = join(this.#directory, INDEX_FILE);
  }

  /** A file that cannot be read does not stop the app: it reads as its empty state. */
  async load(): Promise<void> {
    this.#uploads = await readJsonFile(this.#indexPath, parseIndex, []).catch((error: unknown) => {
      logUnreadable("upload index", error);
      return [];
    });
    this.#choice = await readJsonFile(this.#choicePath, parseChoiceFile, null).catch((error: unknown) => {
      logUnreadable("choice", error);
      return null;
    });
  }

  state(): ChatBackdropState {
    return {
      choice: this.#shownChoice(),
      uploads: this.#uploads.map(({ id, name, kind, createdAt }) => ({ id, name, kind, createdAt })),
    };
  }

  /** The file of an upload in the index, for the `openbot-backdrop` protocol. */
  resolveUpload(id: string): { path: string; mimeType: string } | null {
    if (!isChatBackdropUploadId(id)) return null;
    const upload = this.#uploads.find((item) => item.id === id);
    if (!upload) return null;
    return { path: this.#filePath(upload), mimeType: CHAT_BACKDROP_UPLOAD_TYPES[upload.extension].mimeType };
  }

  setChoice(choice: ChatBackdropChoice | null): Promise<ChatBackdropState> {
    return this.#serial(async () => {
      const id = choice === null ? null : uploadBackdropId(choice);
      if (id !== null && !this.#uploads.some((upload) => upload.id === id)) {
        throw new Error("Unknown backdrop upload.");
      }
      await this.#writeChoice(choice);
      return this.state();
    });
  }

  /**
   * Copies a file that the user chose in main's file dialog, and shows it. The extension must be in
   * the allowlist, the first bytes must be its signature, and the size must be in the limit of its
   * kind. The copy reads the file that was checked, and stops when it grows past the limit.
   */
  importFile(path: string): Promise<ChatBackdropUploadResult> {
    return this.#serial(async () => {
      const extension = extname(path).slice(1).toLowerCase();
      if (!isChatBackdropUploadExtension(extension)) return { status: "refused", reason: "type" };
      const { kind } = CHAT_BACKDROP_UPLOAD_TYPES[extension];
      const limit = CHAT_BACKDROP_UPLOAD_LIMITS[kind];
      // Non-blocking, so a FIFO does not hold the open; `stat` then refuses it as not a file.
      const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
      const id = randomUUID();
      const upload: StoredUpload = { id, name: uploadName(path), kind, extension, createdAt: Date.now() };
      const target = this.#filePath(upload);
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        const stats = await file.stat();
        if (!stats.isFile()) return { status: "refused", reason: "type" };
        if (stats.size > limit) return { status: "refused", reason: "size" };
        const head = new Uint8Array(SIGNATURE_BYTES);
        const { bytesRead } = await file.read(head, 0, SIGNATURE_BYTES, 0);
        if (!matchesChatBackdropSignature(extension, head.subarray(0, bytesRead))) {
          return { status: "refused", reason: "type" };
        }
        await mkdir(this.#directory, { recursive: true, mode: 0o700 });
        try {
          await pipeline(
            file.createReadStream({ start: 0, autoClose: false }),
            byteLimit(limit),
            createWriteStream(temporary, { mode: 0o600 }),
          );
        } catch (error) {
          await rm(temporary, { force: true });
          if ((await file.stat()).size > limit) return { status: "refused", reason: "size" };
          throw error;
        }
        await rename(temporary, target);
      } finally {
        await file.close().catch(() => undefined);
      }

      // The new upload shows, so the oldest others go first when there are too many.
      const kept = [...this.#uploads, upload];
      const removed: StoredUpload[] = [];
      while (kept.length > CHAT_BACKDROP_UPLOAD_LIMITS.count) {
        const oldest = kept.shift();
        if (oldest) removed.push(oldest);
      }
      try {
        await this.#writeIndex(kept);
      } catch (error) {
        await rm(target, { force: true });
        throw error;
      }
      await Promise.all(removed.map((old) => rm(this.#filePath(old), { force: true })));
      await this.#writeChoice(uploadBackdropChoice(id));
      return { status: "added", state: this.state() };
    });
  }

  remove(id: string): Promise<ChatBackdropState> {
    return this.#serial(async () => {
      const upload = this.#uploads.find((item) => item.id === id);
      if (!upload) return this.state();
      await this.#writeIndex(this.#uploads.filter((item) => item.id !== id));
      await rm(this.#filePath(upload), { force: true });
      if (this.#choice !== null && uploadBackdropId(this.#choice) === id) await this.#writeChoice(null);
      return this.state();
    });
  }

  /** A choice whose upload is gone shows nothing, which is what the window shows. */
  #shownChoice(): ChatBackdropChoice | null {
    const choice = this.#choice;
    if (choice === null) return null;
    const id = uploadBackdropId(choice);
    return id === null || this.#uploads.some((upload) => upload.id === id) ? choice : null;
  }

  #filePath(upload: StoredUpload): string {
    return join(this.#directory, `${upload.id}.${upload.extension}`);
  }

  async #writeIndex(uploads: StoredUpload[]): Promise<void> {
    await writeJsonFileAtomically(this.#indexPath, { version: 1, backdrops: uploads }, { createDirectory: true });
    this.#uploads = uploads;
  }

  async #writeChoice(choice: ChatBackdropChoice | null): Promise<void> {
    await writeJsonFileAtomically(this.#choicePath, { version: 1, choice });
    this.#choice = choice;
  }

  #serial<Result>(run: () => Promise<Result>): Promise<Result> {
    const next = this.#pending.then(run, run);
    this.#pending = next.catch(() => undefined);
    return next;
  }
}

function parseIndex(value: unknown): StoredUpload[] {
  if (!isDynamicRecord(value) || value.version !== 1 || !Array.isArray(value.backdrops)) return [];
  return value.backdrops.flatMap((item) => parseStoredUpload(item) ?? []);
}

function parseChoiceFile(value: unknown): ChatBackdropChoice | null {
  return isDynamicRecord(value) && value.version === 1 && isChatBackdropChoice(value.choice) ? value.choice : null;
}

/**
 * Only the error's code or class is logged: the message holds the path, and the path holds the
 * user's name.
 */
function logUnreadable(file: string, error: unknown): void {
  const code = isDynamicRecord(error) && typeof error.code === "string" ? error.code : null;
  const kind = code ?? (error instanceof Error ? error.name : "unknown");
  logger.warn(`The chat backdrop ${file} file could not be read (${kind}). No backdrop is used.`);
}

/** A missing file or one that is not JSON reads as `fallback`. Another read error is thrown. */
async function readJsonFile<Value>(path: string, parse: (value: unknown) => Value, fallback: Value): Promise<Value> {
  try {
    return parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (isMissingFileError(error) || error instanceof SyntaxError) return fallback;
    throw error;
  }
}
