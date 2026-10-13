import {
  DEFAULT_VOICE_SETTINGS,
  type OpenBotDesktopApi,
  VOICE_MODEL_IDS,
  type VoiceModelId,
  type VoiceModelStatus,
  type VoiceSettings,
} from "@openbot/contracts/ipc";
import { clone, type Listener, type MockRuntime } from "./mock-support";

export interface MockVoiceOptions {
  /** The models already downloaded. Parakeet when not given. */
  voiceModelsReady?: readonly VoiceModelId[];
  voiceSettings?: VoiceSettings;
}

/** The local dictation models, with download progress the preview makes up. */
export function createMockVoice(options: MockVoiceOptions, { emit, schedule }: MockRuntime) {
  const ready = new Set(options.voiceModelsReady ?? ["parakeet-tdt-0.6b-v3"]);
  let settings: VoiceSettings = clone(options.voiceSettings ?? DEFAULT_VOICE_SETTINGS);
  const statuses = new Map<VoiceModelId, VoiceModelStatus>(
    VOICE_MODEL_IDS.map((modelId) => [
      modelId,
      ready.has(modelId)
        ? { modelId, phase: "ready", progress: 100, message: null }
        : { modelId, phase: "missing", progress: null, message: null },
    ]),
  );
  const listeners = new Set<Listener<VoiceModelStatus>>();
  const transfers = new Map<VoiceModelId, { settle: (status: VoiceModelStatus) => void }>();
  const status = (modelId: VoiceModelId): VoiceModelStatus =>
    clone(statuses.get(modelId) ?? { modelId, phase: "missing", progress: null, message: null });
  const setStatus = (next: VoiceModelStatus) => {
    statuses.set(next.modelId, next);
    emit(listeners, next);
  };

  const download = (modelId: VoiceModelId) =>
    new Promise<VoiceModelStatus>((resolve) => {
      const current = status(modelId);
      if (current.phase === "ready") return resolve(current);
      const transfer = { settle: resolve };
      transfers.set(modelId, transfer);
      setStatus({ modelId, phase: "downloading", progress: 0, message: null });
      const advance = (progress: number) => {
        if (transfers.get(modelId) !== transfer) return;
        if (progress >= 100) {
          transfers.delete(modelId);
          setStatus({ modelId, phase: "ready", progress: 100, message: null });
          return resolve(status(modelId));
        }
        setStatus({ modelId, phase: "downloading", progress, message: null });
        schedule(() => advance(progress + 5), 200);
      };
      schedule(() => advance(5), 200);
    });

  const voice: OpenBotDesktopApi["voice"] = {
    getModelStatus: async () => status(settings.modelId),
    getModelStatuses: async () => VOICE_MODEL_IDS.map(status),
    prepareModel: () => download(settings.modelId),
    downloadModel: ({ modelId }) => download(modelId),
    cancelModelDownload: async ({ modelId }) => {
      const transfer = transfers.get(modelId);
      if (!transfer) return status(modelId);
      transfers.delete(modelId);
      setStatus({ modelId, phase: "missing", progress: null, message: null });
      transfer.settle(status(modelId));
      return status(modelId);
    },
    getSettings: async () => clone(settings),
    setSettings: async (next) => {
      settings = clone(next);
      return clone(settings);
    },
    transcribe: async () => ({ text: "Mock voice transcript" }),
    onModelStatus: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { voice };
}
