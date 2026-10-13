import { VOICE_MODELS, type VoiceModelInfo, type VoiceModelStatus } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Badge,
  Button,
  Download,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Progress,
  RefreshCw,
  SettingsSection,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { For, Show } from "solid-js";
import type { SettingsVoiceStore } from "./settings-voice-store";

const MODEL_DESCRIPTION = {
  "parakeet-tdt-0.6b-v3": "settings.voice.model.parakeet.description",
} as const satisfies Record<VoiceModelInfo["id"], AppTextKey>;

interface SettingsVoiceTabProps {
  store: SettingsVoiceStore;
}

export function SettingsVoiceTab(props: SettingsVoiceTabProps) {
  const { t, format, errorMessage } = useText();
  const settings = () => props.store.state.settings;

  const statusText = (model: VoiceModelInfo, status: VoiceModelStatus | null) => {
    if (status?.phase === "downloading")
      return t("settings.voice.model.downloading", {
        received: format.fileSize(Math.round((model.bytes * (status.progress ?? 0)) / 100)),
        total: format.fileSize(model.bytes),
      });
    if (status?.phase === "error") return errorMessage(status.message, t("settings.voice.model.failed"));
    return t("settings.voice.model.size", { size: format.fileSize(model.bytes) });
  };

  return (
    <SettingsSection title={t("settings.voice.models.title")}>
      <ItemGroup class="settings-modal-card">
        <For each={VOICE_MODELS}>
          {(model) => {
            const status = () => props.store.state.statuses[model.id];
            const phase = () => status()?.phase;
            const inUse = () => settings()?.modelId === model.id;
            return (
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>{model.name}</ItemTitle>
                  <ItemDescription>{t(MODEL_DESCRIPTION[model.id])}</ItemDescription>
                  <ItemDescription aria-live="polite">{statusText(model, status())}</ItemDescription>
                  <Show when={phase() === "downloading"}>
                    <Progress
                      value={status()?.progress ?? 0}
                      aria-label={t("settings.voice.model.progressLabel", { name: model.name })}
                    />
                  </Show>
                </ItemContent>
                <ItemActions>
                  {/* The selected model is in use before its download too: dictation downloads it. */}
                  <Show when={inUse()}>
                    <Badge variant="secondary">{t("settings.voice.model.inUse")}</Badge>
                  </Show>
                  <Show when={phase() === "missing"}>
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      aria-label={t("settings.voice.model.downloadLabel", { name: model.name })}
                      onClick={() => props.store.download(model.id)}
                    >
                      <Download size={14} aria-hidden="true" />
                      {t("common.download")}
                    </Button>
                  </Show>
                  <Show when={phase() === "downloading"}>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      aria-label={t("settings.voice.model.cancelLabel", { name: model.name })}
                      onClick={() => props.store.cancel(model.id)}
                    >
                      {t("common.cancel")}
                    </Button>
                  </Show>
                  <Show when={phase() === "error"}>
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      aria-label={t("settings.voice.model.retryLabel", { name: model.name })}
                      onClick={() => props.store.download(model.id)}
                    >
                      <RefreshCw size={14} aria-hidden="true" />
                      {t("common.tryAgain")}
                    </Button>
                  </Show>
                  <Show when={phase() === "ready" && settings() && !inUse()}>
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      aria-label={t("settings.voice.model.useLabel", { name: model.name })}
                      onClick={() => props.store.useModel(model.id)}
                    >
                      {t("settings.voice.model.use")}
                    </Button>
                  </Show>
                </ItemActions>
              </Item>
            );
          }}
        </For>
      </ItemGroup>
    </SettingsSection>
  );
}
