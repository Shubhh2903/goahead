import type { VoiceModelId, VoiceModelStatus, VoiceSettings } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { createEffect, createStore } from "solid-js";
import { voicePort } from "./voice-port";

interface SettingsVoiceState {
  /** One status for each model in `VOICE_MODELS`, or null before main answers. */
  statuses: Record<VoiceModelId, VoiceModelStatus | null>;
  settings: VoiceSettings | null;
}

const EMPTY_STATUSES: SettingsVoiceState["statuses"] = { "parakeet-tdt-0.6b-v3": null };

type FailureKey =
  | "settings.voice.loadFailed"
  | "settings.voice.saveFailed"
  | "settings.voice.downloadFailed"
  | "settings.voice.cancelFailed";

/**
 * The Voice tab's view of the dictation models and settings. It is created by the settings dialog,
 * so a download that runs keeps its row while another tab is open.
 */
export function createSettingsVoiceStore(active: () => boolean) {
  const [state, setState] = createStore<SettingsVoiceState>({ statuses: { ...EMPTY_STATUSES }, settings: null });
  const setStatus = (status: VoiceModelStatus) =>
    setState((draft) => {
      draft.statuses[status.modelId] = status;
    });

  // The tab listens only while it is open, and reads every status again each time it opens.
  createEffect(active, (isActive) => {
    if (!isActive) return;
    const stop = voicePort().voice.onModelStatus(setStatus);
    void Promise.all([voicePort().voice.getModelStatuses(), voicePort().voice.getSettings()])
      .then(([statuses, settings]) => {
        for (const status of statuses) setStatus(status);
        setState((draft) => {
          draft.settings = settings;
        });
      })
      .catch((error: unknown) => fail(error, "settings.voice.loadFailed"));
    return stop;
  });

  function fail(error: unknown, fallback: FailureKey): void {
    const { t, errorMessage } = currentText();
    toast.error(errorMessage(error, t(fallback)));
  }

  function download(modelId: VoiceModelId): void {
    // Progress arrives as status events; the answer is the status when the download ends.
    void voicePort()
      .voice.downloadModel({ modelId })
      .then(setStatus)
      .catch((error: unknown) => fail(error, "settings.voice.downloadFailed"));
  }

  function cancel(modelId: VoiceModelId): void {
    void voicePort()
      .voice.cancelModelDownload({ modelId })
      .then(setStatus)
      .catch((error: unknown) => fail(error, "settings.voice.cancelFailed"));
  }

  function save(patch: Partial<VoiceSettings>): void {
    const current = state.settings;
    if (!current) return;
    const next = { ...current, ...patch };
    setState((draft) => {
      draft.settings = next;
    });
    void voicePort()
      .voice.setSettings(next)
      .then((saved) =>
        setState((draft) => {
          draft.settings = saved;
        }),
      )
      .catch((error: unknown) => {
        setState((draft) => {
          draft.settings = current;
        });
        fail(error, "settings.voice.saveFailed");
      });
  }

  return {
    state,
    download,
    cancel,
    useModel: (modelId: VoiceModelId) => save({ modelId }),
  };
}

export type SettingsVoiceStore = ReturnType<typeof createSettingsVoiceStore>;
