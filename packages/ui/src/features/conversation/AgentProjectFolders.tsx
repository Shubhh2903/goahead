import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentProjectFolderState } from "@openbot/contracts/ipc";
import { Badge, Button, Input, SettingsSection, Text } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";

export interface AgentProjectFoldersProps {
  folders: readonly AgentProjectFolderState[];
  /** True while a change is saved. */
  busy?: boolean;
  error?: string | null;
  /** Opens the folder picker. The application owns it, so a path is always one the user picked. */
  onAdd: () => void;
  onRename: (folderId: string, name: string) => void;
  onRemove: (folderId: string) => void;
}

/** The folders on this computer that an agent works in, besides its workspace. */
export function AgentProjectFolders(props: AgentProjectFoldersProps) {
  const { t } = useText();
  const commitName = (folder: AgentProjectFolderState, input: HTMLInputElement) => {
    const name = input.value.trim();
    if (!name || name === folder.name) {
      input.value = folder.name;
      return;
    }
    props.onRename(folder.id, name);
  };
  return (
    <SettingsSection
      class="agent-project-folders"
      title={t("agentSettings.projectFolders.title")}
      description={t("agentSettings.projectFolders.description")}
      actions={
        <Show when={props.folders.length < INPUT_LIMITS.agentProjectFolders}>
          <Button variant="outline" size="sm" type="button" disabled={props.busy} onClick={() => props.onAdd()}>
            {t("agentSettings.projectFolders.add")}
          </Button>
        </Show>
      }
    >
      <Show when={props.folders.length > 0}>
        <ul class="agent-project-folder-list">
          <For each={props.folders} keyed={(folder) => folder.id}>
            {(folder) => (
              <li class="agent-project-folder">
                <div class="agent-project-folder-name">
                  <Input
                    size="sm"
                    defaultValue={folder().name}
                    maxlength={INPUT_LIMITS.projectFolderName}
                    aria-label={t("agentSettings.projectFolders.nameLabel", { path: folder().path })}
                    disabled={props.busy}
                    onBlur={(event) => commitName(folder(), event.currentTarget)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                  <Show when={folder().missing}>
                    <Badge variant="ghost">{t("agentSettings.projectFolders.missing")}</Badge>
                  </Show>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    aria-label={t("agentSettings.projectFolders.removeLabel", { name: folder().name })}
                    disabled={props.busy}
                    onClick={() => props.onRemove(folder().id)}
                  >
                    {t("agentSettings.projectFolders.remove")}
                  </Button>
                </div>
                <Text as="p" class="agent-project-folder-path" variant="caption" tone="muted">
                  {folder().path}
                </Text>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={props.error}>
        {(message) => (
          <p class="agent-settings-save-error" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </SettingsSection>
  );
}
