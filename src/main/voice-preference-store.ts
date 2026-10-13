import { readFile } from "node:fs/promises";
import { DEFAULT_VOICE_SETTINGS, isVoiceModelId, type VoiceSettings } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";

/**
 * The dictation model. Transcription reads it about once per second while the user speaks, so it is
 * held in memory after `load`.
 *
 * A file that is missing, unreadable or names an unknown model (such as Whisper turbo) reads as
 * Parakeet. A `language` field from an earlier file is ignored: dictation is English. `load` absorbs
 * every read error: startup awaits it, and a lost dictation choice must not stop the app from opening.
 */
export class VoicePreferenceStore {
  readonly #path: string;
  #settings: VoiceSettings = { ...DEFAULT_VOICE_SETTINGS };
  /** Writes run one at a time, so the file and the memory copy keep the last request. */
  #writes: Promise<unknown> = Promise.resolve();

  constructor(path: string) {
    this.#path = path;
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.#path, "utf8"));
      this.#settings =
        isDynamicRecord(parsed) && parsed.version === 1 && isVoiceModelId(parsed.modelId)
          ? { modelId: parsed.modelId }
          : { ...DEFAULT_VOICE_SETTINGS };
    } catch {
      this.#settings = { ...DEFAULT_VOICE_SETTINGS };
    }
  }

  get(): VoiceSettings {
    return { ...this.#settings };
  }

  set({ modelId }: VoiceSettings): Promise<VoiceSettings> {
    const write = this.#writes.then(async () => {
      await writeJsonFileAtomically(this.#path, { version: 1, modelId });
      this.#settings = { modelId };
      return this.get();
    });
    this.#writes = write.catch(() => undefined);
    return write;
  }
}
