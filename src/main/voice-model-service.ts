import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { VoiceModelId, VoiceModelStatus } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";

/** The N-API addon of sherpa-onnx. Its libraries are in the same directory. */
export const VOICE_RUNTIME_ADDON = "sherpa-onnx.node";

export interface VoiceModelFile {
  name: string;
  url: string;
  bytes: number;
  sha256: string;
}

const PARAKEET_MODEL_REVISION = "2bda32ec70b097a55adaa07d9a7173915b43cc78";
const PARAKEET_MODEL_BASE_URL = `https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/${PARAKEET_MODEL_REVISION}`;

/** The directory name of the model in `<userData>/runtimes`. A new pin needs a new name. */
export const PARAKEET_MODEL_DIRECTORY = "parakeet-tdt-0.6b-v3-int8";

/** NVIDIA Parakeet TDT 0.6B v3 (CC-BY-4.0), int8 ONNX export for sherpa-onnx. */
export const PARAKEET_MODEL_FILES: readonly VoiceModelFile[] = [
  {
    name: "encoder.int8.onnx",
    url: `${PARAKEET_MODEL_BASE_URL}/encoder.int8.onnx`,
    bytes: 652_184_281,
    sha256: "acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247",
  },
  {
    name: "decoder.int8.onnx",
    url: `${PARAKEET_MODEL_BASE_URL}/decoder.int8.onnx`,
    bytes: 11_845_275,
    sha256: "179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e",
  },
  {
    name: "joiner.int8.onnx",
    url: `${PARAKEET_MODEL_BASE_URL}/joiner.int8.onnx`,
    bytes: 6_355_277,
    sha256: "3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3",
  },
  {
    name: "tokens.txt",
    url: `${PARAKEET_MODEL_BASE_URL}/tokens.txt`,
    bytes: 93_939,
    sha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d",
  },
];

/** The files of each model. */
const VOICE_MODEL_FILES: Record<VoiceModelId, readonly VoiceModelFile[]> = {
  "parakeet-tdt-0.6b-v3": PARAKEET_MODEL_FILES,
};

interface VoiceModelEvents {
  status: [status: VoiceModelStatus];
}

interface VoiceModelServiceOptions {
  modelId?: VoiceModelId;
  directory: string;
  files?: readonly VoiceModelFile[];
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

/** What a verified file looked like, so a later check can skip the hash while nothing changed. */
interface VerifiedFile {
  size: number;
  mtimeMs: number;
}

export class VoiceModelService extends EventEmitter<VoiceModelEvents> {
  readonly modelId: VoiceModelId;
  readonly #directory: string;
  readonly #files: readonly VoiceModelFile[];
  readonly #totalBytes: number;
  readonly #fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  /**
   * Files that passed the full SHA-256 check in this process. Transcription asks for the model about
   * once per second while the user speaks, and hashing 670 MB each time is not acceptable. A file
   * whose size or modification time changed is hashed again.
   */
  readonly #verified = new Map<string, VerifiedFile>();
  #status: Omit<VoiceModelStatus, "modelId"> = { phase: "missing", progress: null, message: null };
  #preparation: Promise<VoiceModelStatus> | null = null;
  #abortController: AbortController | null = null;
  #stopping = false;
  /** The user stopped the download in progress, so it ends as missing rather than failed. */
  #cancelled = false;

  constructor(options: VoiceModelServiceOptions) {
    super();
    this.modelId = options.modelId ?? "parakeet-tdt-0.6b-v3";
    this.#directory = options.directory;
    this.#files = options.files ?? VOICE_MODEL_FILES[this.modelId];
    this.#totalBytes = this.#files.reduce((total, file) => total + file.bytes, 0);
    this.#fetch = options.fetch ?? fetch;
  }

  get directory(): string {
    return this.#directory;
  }

  async getStatus(): Promise<VoiceModelStatus> {
    if (this.#status.phase === "downloading") return this.#copyStatus();
    const ready = await this.#isComplete();
    this.#setStatus({ phase: ready ? "ready" : "missing", progress: ready ? 100 : null, message: null });
    return this.#copyStatus();
  }

  /** Downloads the files that are missing. Concurrent callers share one download. */
  prepare(): Promise<VoiceModelStatus> {
    if (this.#preparation) return this.#preparation;
    this.#cancelled = false;
    const preparation = this.#prepare().finally(() => {
      if (this.#preparation === preparation) {
        this.#preparation = null;
        this.#abortController = null;
      }
    });
    this.#preparation = preparation;
    return preparation;
  }

  /** Stops the download in progress, if any, and answers the status after it ends. */
  async cancel(): Promise<VoiceModelStatus> {
    const preparation = this.#preparation;
    if (!preparation) return this.getStatus();
    this.#cancelled = true;
    this.#abortController?.abort();
    await preparation;
    return this.#copyStatus();
  }

  async shutdown(): Promise<void> {
    this.#stopping = true;
    this.#abortController?.abort();
    if (this.#preparation) await this.#preparation;
  }

  async #prepare(): Promise<VoiceModelStatus> {
    if (await this.#isComplete()) {
      // Each transcription prepares the model, so a ready model does not announce itself again.
      if (this.#status.phase !== "ready") this.#setStatus({ phase: "ready", progress: 100, message: null });
      return this.#copyStatus();
    }
    if (this.#stopping) {
      this.#setStatus({ phase: "error", progress: null, message: sourceText("error.voice.downloadStopped") });
      return this.#copyStatus();
    }
    if (this.#cancelled) {
      this.#setStatus({ phase: "missing", progress: null, message: null });
      return this.#copyStatus();
    }
    const controller = new AbortController();
    this.#abortController = controller;
    this.#setStatus({ phase: "downloading", progress: 0, message: null });
    try {
      await mkdir(this.#directory, { recursive: true, mode: 0o700 });
      let completedBytes = 0;
      for (const file of this.#files) {
        const path = join(this.#directory, file.name);
        if (!(await this.#isVerified(file))) {
          await rm(path, { force: true });
          await this.#download(file, path, controller.signal, completedBytes);
        }
        completedBytes += file.bytes;
      }
      this.#setStatus({ phase: "ready", progress: 100, message: null });
    } catch (error) {
      if (this.#cancelled) {
        // Files that completed stay verified, so the next download starts at the first one missing.
        this.#setStatus({ phase: "missing", progress: null, message: null });
      } else {
        const stopped = error instanceof Error && error.name === "AbortError";
        this.#setStatus({
          phase: "error",
          progress: null,
          message: stopped ? sourceText("error.voice.downloadStopped") : sourceText("error.voice.downloadFailed"),
        });
      }
    } finally {
      controller.abort();
    }
    return this.#copyStatus();
  }

  /** Streams one file to `<path>.part`, checks its size and hash, and only then moves it into place. */
  async #download(file: VoiceModelFile, path: string, signal: AbortSignal, completedBytes: number): Promise<void> {
    const partialPath = `${path}.part`;
    let committed = false;
    try {
      await rm(partialPath, { force: true });
      const response = await this.#fetch(file.url, { signal });
      if (!response.ok || !response.body) throw new Error(`download-status-${response.status}`);
      const hash = createHash("sha256");
      let receivedBytes = 0;
      let lastProgress = -1;
      const destination = await open(partialPath, "wx", 0o600);
      try {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            receivedBytes += value.byteLength;
            if (receivedBytes > file.bytes) throw new Error("download-too-large");
            hash.update(value);
            let writtenBytes = 0;
            while (writtenBytes < value.byteLength) {
              const result = await destination.write(value, writtenBytes, value.byteLength - writtenBytes);
              writtenBytes += result.bytesWritten;
            }
            const progress = Math.min(100, Math.floor(((completedBytes + receivedBytes) / this.#totalBytes) * 100));
            if (progress !== lastProgress) {
              lastProgress = progress;
              this.#setStatus({ phase: "downloading", progress, message: null });
            }
          }
        } finally {
          await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
      } finally {
        await destination.close();
      }
      if (receivedBytes !== file.bytes || hash.digest("hex") !== file.sha256) {
        throw new Error("download-integrity-failed");
      }
      await rename(partialPath, path);
      committed = true;
      const { size, mtimeMs } = await stat(path);
      this.#verified.set(file.name, { size, mtimeMs });
    } finally {
      if (!committed) await rm(partialPath, { force: true });
    }
  }

  async #isComplete(): Promise<boolean> {
    for (const file of this.#files) if (!(await this.#isVerified(file))) return false;
    return true;
  }

  /** A file verified earlier in this process needs only a `stat`; any other file is hashed. */
  async #isVerified(file: VoiceModelFile): Promise<boolean> {
    const path = join(this.#directory, file.name);
    if (!existsSync(path)) {
      this.#verified.delete(file.name);
      return false;
    }
    const { size, mtimeMs } = await stat(path);
    const known = this.#verified.get(file.name);
    if (known && known.size === size && known.mtimeMs === mtimeMs) return true;
    this.#verified.delete(file.name);
    if (size !== file.bytes || !(await hasSha256(path, file.sha256))) return false;
    this.#verified.set(file.name, { size, mtimeMs });
    return true;
  }

  #setStatus(status: Omit<VoiceModelStatus, "modelId">): void {
    this.#status = status;
    this.emit("status", this.#copyStatus());
  }

  #copyStatus(): VoiceModelStatus {
    return { modelId: this.modelId, ...this.#status };
  }
}

/**
 * Deletes the Whisper model cache that earlier versions downloaded (`<userData>/runtimes/whisper`).
 * It is a 539 MB application download, not user data, and no version reads it any more.
 */
export async function removeLegacyWhisperCache(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}

async function hasSha256(path: string, expectedSha256: string): Promise<boolean> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex") === expectedSha256;
}
