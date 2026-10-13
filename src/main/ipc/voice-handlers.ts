// The local speech recognition model (Parakeet), its settings, and dictation.

import type { VoiceModelStatus, VoiceSettings, VoiceTranscriptionResult } from "@openbot/contracts/ipc";
import type { VoiceTranscriptionService } from "../voice-transcription-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { parseVoiceModelRequest, parseVoiceSettings, parseVoiceTranscription } from "./voice-inputs";

export interface VoiceIpcDependencies {
  voice: VoiceTranscriptionService;
}

export function voiceIpcHandlers({ voice }: VoiceIpcDependencies): Pick<IpcGroupHandlers, "voice"> {
  return {
    voice: {
      getModelStatus: handler((): Promise<VoiceModelStatus> => voice.getModelStatus()),
      getModelStatuses: handler((): Promise<VoiceModelStatus[]> => voice.getModelStatuses()),
      prepareModel: handler((): Promise<VoiceModelStatus> => voice.prepareModel()),
      downloadModel: payloadHandler(
        parseVoiceModelRequest,
        ({ modelId }): Promise<VoiceModelStatus> => voice.downloadModel(modelId),
      ),
      cancelModelDownload: payloadHandler(
        parseVoiceModelRequest,
        ({ modelId }): Promise<VoiceModelStatus> => voice.cancelModelDownload(modelId),
      ),
      getSettings: handler((): VoiceSettings => voice.getSettings()),
      setSettings: payloadHandler(
        parseVoiceSettings,
        (settings): Promise<VoiceSettings> => voice.setSettings(settings),
      ),
      transcribe: payloadHandler(
        parseVoiceTranscription,
        (transcription): Promise<VoiceTranscriptionResult> => voice.transcribe(transcription.audio),
      ),
    },
  };
}
