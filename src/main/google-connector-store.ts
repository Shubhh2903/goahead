// The one Google sign-in of this computer, encrypted at rest by the operating system.

import { readFile, rm } from "node:fs/promises";
import { sourceText } from "@openbot/i18n/source";
import { z } from "zod";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";
import type { SecretCipher } from "./provider-credential-store";

const googleConnectorRecordSchema = z.object({
  accessToken: z.string().min(1),
  /** Epoch milliseconds. */
  accessTokenExpiresAt: z.number(),
  refreshToken: z.string().min(1),
  email: z.string().min(3).max(320),
  scopes: z.array(z.string().min(1)).max(16),
});

export type GoogleConnectorRecord = z.infer<typeof googleConnectorRecordSchema>;

/** `version` is checked: an envelope that this build cannot read stays on disk, unread. */
const envelopeSchema = z.object({ version: z.literal(1), record: z.string() });

/** One token set is small; a larger file is not one that this app wrote. */
const MAX_ENVELOPE_BYTES = 64 * 1024;

/**
 * Reads and writes the Google sign-in. The decrypted record is kept in memory only. `electron` is
 * not imported: the cipher arrives as an argument. Writes run one at a time, because a refresh and
 * a disconnect can arrive together.
 */
export class GoogleConnectorStore {
  readonly #path: string;
  readonly #cipher: SecretCipher;
  #record: GoogleConnectorRecord | null = null;
  #queue: Promise<void> = Promise.resolve();

  constructor(path: string, cipher: SecretCipher) {
    this.#path = path;
    this.#cipher = cipher;
  }

  /** Reads the file. Returns the error when the file is there but cannot be read; the file stays. */
  async load(): Promise<Error | null> {
    this.#record = null;
    try {
      this.#record = await this.#read();
      return null;
    } catch (error) {
      return error instanceof Error ? error : new Error(sourceText("error.connector.googleFileUnreadable"));
    }
  }

  read(): GoogleConnectorRecord | null {
    return this.#record;
  }

  write(record: GoogleConnectorRecord): Promise<void> {
    return this.#enqueue(async () => {
      const encrypted = this.#cipher.encrypt(JSON.stringify(record)).toString("base64");
      await writeJsonFileAtomically(this.#path, { version: 1, record: encrypted }, { createDirectory: true });
      this.#record = record;
    });
  }

  clear(): Promise<void> {
    return this.#enqueue(async () => {
      await rm(this.#path, { force: true });
      this.#record = null;
    });
  }

  #enqueue(change: () => Promise<void>): Promise<void> {
    const result = this.#queue.then(change, change);
    this.#queue = result.catch(() => undefined);
    return result;
  }

  async #read(): Promise<GoogleConnectorRecord | null> {
    let source: string;
    try {
      source = await readFile(this.#path, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
    if (source.length > MAX_ENVELOPE_BYTES) throw new Error(sourceText("error.connector.googleFileTooLarge"));
    try {
      const envelope = envelopeSchema.parse(JSON.parse(source));
      return googleConnectorRecordSchema.parse(
        JSON.parse(this.#cipher.decrypt(Buffer.from(envelope.record, "base64"))),
      );
    } catch {
      throw new Error(sourceText("error.connector.googleFileUnreadable"));
    }
  }
}
