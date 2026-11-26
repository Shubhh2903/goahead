import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  CHAT_BACKDROP_UPLOAD_TYPES,
  type ChatBackdropChoice,
  type ChatBackdropState,
  type ChatBackdropUpload,
  type ChatBackdropUploadExtension,
  isChatBackdropChoice,
  isChatBackdropUploadExtension,
  isChatBackdropUploadId,
  parseChatBackdropUpload,
  uploadBackdropId,
} from "@openbot/contracts/chat-backdrop";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";
import { isMissingFileError } from "../backend/file-errors";

/** In userData: the choice. A missing file is no backdrop, which is how the window looked before. */
export const CHAT_BACKDROP_CHOICE_FILE = "openbot-chat-backdrop-v1.json";
/** In userData: the uploaded files, as `<id>.<extension>`, and their index. */
export const CHAT_BACKDROP_UPLOAD_DIRECTORY = "chat-backdrops";
const INDEX_FILE = "backdrops-v1.json";

const logger = createOpenBotLogger("chat-backdrop-store");

interface StoredUpload extends ChatBackdropUpload {
  extension: ChatBackdropUploadExtension;
}

function parseStoredUpload(value: unknown): StoredUpload | null {
  const upload = parseChatBackdropUpload(value);
  if (!upload || !isDynamicRecord(value)) return null;
  const { extension } = value;
  if (typeof extension !== "string" || !isChatBackdropUploadExtension(extension)) return null;
  if (CHAT_BACKDROP_UPLOAD_TYPES[extension].kind !== upload.kind) return null;
  return { ...upload, extension };
}

/**
 * The backdrop behind this computer's window: the choice, and the images and videos that the user
 * uploaded in GoAhead v0.40 or v0.41. New uploads go to the renderer's custom backdrops, so this
 * store only reads, chooses and removes them; it never deletes the folder. Both are files under userData, so an app update keeps them. No database table is used.
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
    await Effect.runPromise(
      writeJsonFileAtomically(this.#indexPath, { version: 1, backdrops: uploads }, { createDirectory: true }),
    );
    this.#uploads = uploads;
  }

  async #writeChoice(choice: ChatBackdropChoice | null): Promise<void> {
    await Effect.runPromise(writeJsonFileAtomically(this.#choicePath, { version: 1, choice }));
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
