import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  VOICE_MODEL_IDS,
  type VoiceModelId,
  type VoiceModelStatus,
  type VoiceSettings,
  type VoiceTranscriptionResult,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { VOICE_RUNTIME_ADDON, VoiceModelService } from "./voice-model-service";
import type { VoicePreferenceStore } from "./voice-preference-store";
import type {
  VoiceTranscriptionEngine,
  VoiceTranscriptionFailure,
  VoiceTranscriptionHostProcess,
  VoiceTranscriptionResponse,
} from "./voice-transcription-protocol";

const logger = createOpenBotLogger("voice-transcription-service");

const TRANSCRIPTION_TIMEOUT_MS = 180_000;
const MODEL_ENGINES: Record<VoiceModelId, VoiceTranscriptionEngine> = {
  "parakeet-tdt-0.6b-v3": "nemo-transducer",
};

/**
 * The loaded model holds about 2 GB, so the host ends after this long without a request. While
 * the user speaks, the renderer asks about once per second, so the host stays loaded until then.
 */
const HOST_IDLE_MS = 60_000;
/** `parseVoiceTranscription` accepts only the canonical 44-byte header before the PCM data. */
const WAV_HEADER_BYTES = 44;
const BYTES_PER_SECOND = 32_000;

interface VoiceTranscriptionEvents {
  modelStatus: [status: VoiceModelStatus];
}

/**
 * What the renderer is told when the build carries no speech recognition runtime at all. Linux
 * packages ship without one, so this is the whole of voice on that platform: a stated limit, not a
 * download of a model that nothing can read.
 */
const RUNTIME_UNAVAILABLE_MESSAGE = sourceText("error.voice.runtimeUnavailable");

interface VoiceTranscriptionServiceOptions {
  resourcesRoot: string;
  modelDirectories: Record<VoiceModelId, string>;
  preferences: VoicePreferenceStore;
  spawnHost: () => VoiceTranscriptionHostProcess;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

/** A failure the host reported. Only its category is known; the addon's own message stays there. */
class HostFailure extends Error {
  constructor(readonly category: VoiceTranscriptionFailure | "host-exited") {
    super(category);
  }
}

interface PendingRequest {
  id: number;
  settle: (result: { text: string } | { error: Error }) => void;
}

export class VoiceTranscriptionService extends EventEmitter<VoiceTranscriptionEvents> {
  readonly #addonPath: string;
  readonly #models: Record<VoiceModelId, VoiceModelService>;
  readonly #preferences: VoicePreferenceStore;
  readonly #spawnHost: () => VoiceTranscriptionHostProcess;
  #host: VoiceTranscriptionHostProcess | null = null;
  /** The model the running host loaded. The host holds one model, so another one starts a new host. */
  #hostModelId: VoiceModelId | null = null;
  #pending: PendingRequest | null = null;
  #nextRequestId = 1;
  #idleTimer: NodeJS.Timeout | null = null;
  #busy = false;

  constructor(options: VoiceTranscriptionServiceOptions) {
    super();
    this.#addonPath = join(options.resourcesRoot, "runtime", VOICE_RUNTIME_ADDON);
    this.#spawnHost = options.spawnHost;
    this.#preferences = options.preferences;
    const model = (modelId: VoiceModelId) => {
      const service = new VoiceModelService({
        modelId,
        directory: options.modelDirectories[modelId],
        fetch: options.fetch,
      });
      service.on("status", (status) => this.emit("modelStatus", status));
      return service;
    };
    this.#models = { "parakeet-tdt-0.6b-v3": model("parakeet-tdt-0.6b-v3") };
  }

  /** The status of the model in use. */
  async getModelStatus(): Promise<VoiceModelStatus> {
    const { modelId } = this.#preferences.get();
    return this.#runtimeMissing(modelId) ?? (await this.#models[modelId].getStatus());
  }

  async getModelStatuses(): Promise<VoiceModelStatus[]> {
    const statuses: VoiceModelStatus[] = [];
    for (const modelId of VOICE_MODEL_IDS) {
      statuses.push(this.#runtimeMissing(modelId) ?? (await this.#models[modelId].getStatus()));
    }
    return statuses;
  }

  /** Downloads the model in use when it is missing. */
  prepareModel(): Promise<VoiceModelStatus> {
    return this.downloadModel(this.#preferences.get().modelId);
  }

  async downloadModel(modelId: VoiceModelId): Promise<VoiceModelStatus> {
    return this.#runtimeMissing(modelId) ?? (await this.#models[modelId].prepare());
  }

  async cancelModelDownload(modelId: VoiceModelId): Promise<VoiceModelStatus> {
    return this.#runtimeMissing(modelId) ?? (await this.#models[modelId].cancel());
  }

  getSettings(): VoiceSettings {
    return this.#preferences.get();
  }

  setSettings(settings: VoiceSettings): Promise<VoiceSettings> {
    return this.#preferences.set(settings);
  }

  async transcribe(audio: Uint8Array): Promise<VoiceTranscriptionResult> {
    if (this.#busy) throw new Error(sourceText("error.voice.busy"));
    this.#busy = true;
    try {
      const settings = this.#preferences.get();
      // After the first full check in this process, this is a `stat` of each model file.
      const modelStatus = await this.downloadModel(settings.modelId);
      if (modelStatus.phase !== "ready") {
        throw new Error(modelStatus.message ?? sourceText("error.voice.modelUnavailable"));
      }
      const startedAt = Date.now();
      const pcm = audio.slice(WAV_HEADER_BYTES);
      const audioSeconds = (pcm.byteLength / BYTES_PER_SECOND).toFixed(1);
      try {
        const text = await this.#request(pcm, settings);
        if (text.length > INPUT_LIMITS.messageText) throw new Error("The voice transcript is too long.");
        logger.info(`Voice transcription of ${audioSeconds}s completed in ${Date.now() - startedAt}ms.`);
        return { text };
      } catch (error) {
        logger.error(
          `Voice transcription of ${audioSeconds}s failed after ${Date.now() - startedAt}ms.`,
          errorCategory(error),
        );
        throw userFacingError(error);
      }
    } finally {
      this.#busy = false;
    }
  }

  async shutdown(): Promise<void> {
    this.#stopHost();
    for (const modelId of VOICE_MODEL_IDS) await this.#models[modelId].shutdown();
  }

  /** Reports a build with no bundled speech recognition runtime. */
  #runtimeMissing(modelId: VoiceModelId): VoiceModelStatus | null {
    if (existsSync(this.#addonPath)) return null;
    const status: VoiceModelStatus = { modelId, phase: "error", progress: null, message: RUNTIME_UNAVAILABLE_MESSAGE };
    this.emit("modelStatus", status);
    return status;
  }

  /** Sends one request to the host, starting it if needed, and keeps it loaded until it is idle. */
  #request(pcm: Uint8Array, { modelId }: VoiceSettings): Promise<string> {
    return new Promise<string>((resolveRequest, rejectRequest) => {
      this.#cancelIdleStop();
      if (this.#hostModelId !== modelId) this.#stopHost();
      const host = this.#ensureHost();
      this.#hostModelId = modelId;
      const id = this.#nextRequestId++;
      const timer = setTimeout(() => {
        if (this.#pending?.id === id) this.#pending = null;
        // A decode cannot be cancelled, and a host that still works on it would answer late.
        this.#stopHost();
        rejectRequest(new Error(sourceText("error.voice.transcriptionTimedOut")));
      }, TRANSCRIPTION_TIMEOUT_MS);
      this.#pending = {
        id,
        settle: (result) => {
          clearTimeout(timer);
          this.#scheduleIdleStop();
          if ("text" in result) resolveRequest(result.text);
          else rejectRequest(result.error);
        },
      };
      const engine = MODEL_ENGINES[modelId];
      host.send({
        id,
        addonPath: this.#addonPath,
        modelDirectory: this.#models[modelId].directory,
        engine,
        pcm,
      });
    });
  }

  #ensureHost(): VoiceTranscriptionHostProcess {
    if (this.#host) return this.#host;
    const host = this.#spawnHost();
    this.#host = host;
    host.onResponse((response) => {
      if (this.#host !== host) return;
      this.#settle(response.id, responseResult(response));
    });
    host.onExit(() => {
      if (this.#host !== host) return;
      this.#host = null;
      this.#hostModelId = null;
      this.#cancelIdleStop();
      const pending = this.#pending;
      if (pending) this.#settle(pending.id, { error: new HostFailure("host-exited") });
    });
    return host;
  }

  #settle(id: number, result: { text: string } | { error: Error }): void {
    const pending = this.#pending;
    if (pending?.id !== id) return;
    this.#pending = null;
    pending.settle(result);
  }

  #scheduleIdleStop(): void {
    this.#cancelIdleStop();
    if (!this.#host) return;
    this.#idleTimer = setTimeout(() => this.#stopHost(), HOST_IDLE_MS);
    this.#idleTimer.unref();
  }

  #cancelIdleStop(): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
  }

  /** Ends the host. Its exit is not reported as a failure: nothing waits on it any more. */
  #stopHost(): void {
    this.#cancelIdleStop();
    const host = this.#host;
    this.#host = null;
    this.#hostModelId = null;
    host?.kill();
  }
}

function responseResult(response: VoiceTranscriptionResponse): { text: string } | { error: Error } {
  if ("text" in response) return { text: response.text };
  return { error: new HostFailure(response.error) };
}

function errorCategory(
  error: unknown,
): "unknown" | "timeout" | "runtime-unavailable" | "model-load-failed" | "inference-failed" | "host-exited" {
  if (error instanceof HostFailure) return error.category;
  if (!(error instanceof Error)) return "unknown";
  if (error.message === sourceText("error.voice.transcriptionTimedOut")) return "timeout";
  return "inference-failed";
}

function userFacingError(error: unknown): Error {
  if (error instanceof Error && error.message === sourceText("error.voice.transcriptionTimedOut")) return error;
  if (error instanceof HostFailure && error.category === "runtime-unavailable") {
    return new Error(sourceText("error.voice.prepareRequired"));
  }
  return new Error(sourceText("error.voice.transcriptionFailed"));
}
