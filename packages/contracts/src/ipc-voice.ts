import { isOneOf } from "./runtime-values";

export const VOICE_AUDIO_LIMITS = {
  sampleRate: 16_000,
  channels: 1,
  bitsPerSample: 16,
  maximumSeconds: 120,
  maximumWavBytes: 3_840_044,
} as const;

export interface VoiceTranscriptionInput {
  audio: Uint8Array;
}

export interface VoiceTranscriptionResult {
  text: string;
}

/**
 * The local speech recognition models. Saved in `voice-preference.json`; never rename one.
 * Dictation is English with Parakeet only. A saved model that is not in this list reads as Parakeet.
 */
export const VOICE_MODEL_IDS = ["parakeet-tdt-0.6b-v3"] as const;
export type VoiceModelId = (typeof VOICE_MODEL_IDS)[number];
export const DEFAULT_VOICE_MODEL_ID: VoiceModelId = "parakeet-tdt-0.6b-v3";

export interface VoiceModelInfo {
  id: VoiceModelId;
  /** The product name. It is not translated. */
  name: string;
  /** The download size of all files. */
  bytes: number;
}

export const VOICE_MODELS: readonly VoiceModelInfo[] = [
  {
    id: "parakeet-tdt-0.6b-v3",
    name: "Parakeet TDT 0.6B v3",
    bytes: 670_478_772,
  },
];

export interface VoiceSettings {
  modelId: VoiceModelId;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  modelId: DEFAULT_VOICE_MODEL_ID,
};

export type VoiceModelPhase = "missing" | "downloading" | "ready" | "error";

export interface VoiceModelStatus {
  modelId: VoiceModelId;
  phase: VoiceModelPhase;
  progress: number | null;
  message: string | null;
}

export interface VoiceModelRequest {
  modelId: VoiceModelId;
}

export function isVoiceModelId(value: unknown): value is VoiceModelId {
  return isOneOf(VOICE_MODEL_IDS, value);
}
