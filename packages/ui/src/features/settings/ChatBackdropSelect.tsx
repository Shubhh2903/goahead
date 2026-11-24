import {
  CHAT_BACKDROP_SCENES,
  type ChatBackdropChoice,
  type ChatBackdropUpload,
  isChatBackdropChoice,
  isChatBackdropScene,
  uploadBackdropChoice,
  uploadBackdropId,
} from "@openbot/contracts/chat-backdrop";
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo, Show } from "solid-js";
import { useText } from "../../text";
import { CHAT_BACKDROP_LABEL } from "../conversation/chat-backdrop";

type Option = ChatBackdropChoice | "none";

export interface ChatBackdropSelectProps {
  value: ChatBackdropChoice | null;
  onChange: (value: ChatBackdropChoice | null) => void;
  /** The images and videos that the user uploaded on this computer, oldest first. */
  uploads: readonly ChatBackdropUpload[];
  /** Opens the file picker. The platform checks the file; the control only asks for one. */
  onUpload: () => void;
  onRemove: (id: string) => void;
  busy?: boolean;
  /** The dialog element the popover portals into, as the other Settings selects receive it. */
  mount?: HTMLElement | undefined;
}

/** The "Backdrop" row control in Settings: None, the built-in scenes and the uploads, plus Upload and Remove. */
export function ChatBackdropSelect(props: ChatBackdropSelectProps): JSX.Element {
  const { t } = useText();
  // A new array on each change of the list only: Kobalte loops when it gets a new array on each read.
  const options = createMemo<Option[]>(() => [
    "none",
    ...CHAT_BACKDROP_SCENES,
    ...props.uploads.map((upload) => uploadBackdropChoice(upload.id)),
  ]);
  const names = createMemo(() => new Map(props.uploads.map((upload) => [upload.id, upload.name])));
  const label = (option: Option | undefined) => {
    if (option === undefined || option === "none") return t("settings.chatBackdrop.none");
    if (isChatBackdropScene(option)) return t(CHAT_BACKDROP_LABEL[option]);
    return names().get(uploadBackdropId(option) ?? "") ?? t("settings.chatBackdrop.none");
  };
  // A saved choice whose upload is gone shows as None, which is what the window shows.
  const value = (): Option => {
    const current = props.value;
    return current !== null && options().includes(current) ? current : "none";
  };
  const selectedUploadId = () => {
    const current = value();
    return current === "none" ? null : uploadBackdropId(current);
  };
  return (
    <div class="settings-backdrop-control">
      <Show when={selectedUploadId()}>
        {(id) => (
          <Button variant="ghost" size="sm" type="button" disabled={props.busy} onClick={() => props.onRemove(id())}>
            {t("common.remove")}
          </Button>
        )}
      </Show>
      <Button variant="outline" size="sm" type="button" disabled={props.busy} onClick={() => props.onUpload()}>
        {t("settings.chatBackdrop.upload")}
      </Button>
      <Select<Option>
        class="settings-modal-select"
        options={options()}
        value={value()}
        onChange={(option) =>
          option && props.onChange(option !== "none" && isChatBackdropChoice(option) ? option : null)
        }
        placement="bottom-end"
        itemComponent={(itemProps) => <SelectItem item={itemProps.item}>{label(itemProps.item.rawValue)}</SelectItem>}
      >
        <SelectTrigger size="sm" aria-label={t("settings.chatBackdrop.title")}>
          <SelectValue<Option>>{(state) => label(state.selectedOption())}</SelectValue>
        </SelectTrigger>
        <SelectContent mount={props.mount} />
      </Select>
    </div>
  );
}
