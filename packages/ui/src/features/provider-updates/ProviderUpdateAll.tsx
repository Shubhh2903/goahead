import type { AgentProviderId } from "@openbot/contracts/ipc";
import { Button, Text } from "@openbot/ui";
import { createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import {
  type ProviderUpdateAllResult,
  type ProviderUpdateCandidate,
  providersToUpdate,
  updateAllProviders,
} from "./provider-update";

export interface ProviderUpdateAllProps {
  options: readonly ProviderUpdateCandidate[];
  /** The action of one row's Update button. Without it there is no "Update all". */
  onUpdateProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  disabled?: boolean | undefined;
}

/**
 * "Update all": starts the update of each provider that has one, and then says for each provider
 * whether its update started. Shown only while one or more providers have an update.
 */
export function ProviderUpdateAll(props: ProviderUpdateAllProps) {
  const { t, errorMessage } = useText();
  const [running, setRunning] = createSignal(false);
  const [results, setResults] = createSignal<readonly ProviderUpdateAllResult[]>([]);
  const updates = () => providersToUpdate(props.options);
  const updateAll = async () => {
    const update = props.onUpdateProvider;
    if (!update || running()) return;
    setRunning(true);
    setResults([]);
    try {
      setResults(await updateAllProviders(updates(), update));
    } finally {
      setRunning(false);
    }
  };
  return (
    <>
      <Show when={props.onUpdateProvider && updates().length > 0}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={running()}
          disabled={props.disabled}
          onClick={() => void updateAll()}
        >
          {t("provider.settings.updateAll")}
        </Button>
      </Show>
      <Show when={results().length > 0}>
        <div role="status">
          <For each={results()}>
            {(result) => (
              <Text tone="muted" variant="caption">
                {result.error === null
                  ? t("provider.settings.updateAllStarted", { name: result.name })
                  : t("provider.settings.updateAllFailed", {
                      name: result.name,
                      reason: errorMessage(result.error, t("update.provider.startFailed")),
                    })}
              </Text>
            )}
          </For>
        </div>
      </Show>
    </>
  );
}
