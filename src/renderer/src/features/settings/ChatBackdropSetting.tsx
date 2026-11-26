import {
  customBackdropChoice,
  customBackdropId,
  isChatBackdropScene,
} from "@openbot/ui/features/conversation/chat-backdrop";
import { ChatBackdropSelect } from "@openbot/ui/features/settings/ChatBackdropSelect";
import { useText } from "@openbot/ui/text";
import { createSignal } from "solid-js";
import { actionToast } from "../../action-toast";
import { setChatBackdrop, useChatBackdrop } from "../../chat-backdrop-preference";
import {
  addCustomBackdrop,
  CUSTOM_BACKDROP_UPLOAD_TYPES,
  customBackdropKind,
  removeCustomBackdrop,
  useCustomBackdrops,
} from "../../custom-backdrops";
import { useChatBackdropState } from "../backdrop/backdrop-state";

export function ChatBackdropSetting(props: { mount?: HTMLElement | undefined }) {
  const { t } = useText();
  const choice = useChatBackdrop();
  // A built-in scene that GoAhead v0.40/v0.41 saved shows as the current choice until one is chosen
  // here. An old upload has no option in this list, so it shows as "None".
  const legacy = useChatBackdropState();
  const shownChoice = () => {
    const current = choice();
    if (current !== null) return current;
    const old = legacy().choice;
    return isChatBackdropScene(old) ? old : null;
  };
  const custom = useCustomBackdrops();
  const [busy, setBusy] = createSignal(false);

  const upload = async (file: File) => {
    const kind = customBackdropKind(file.type, file.size);
    if (kind !== "image" && kind !== "video") {
      actionToast.error(t("settings.chatBackdrop.uploadRefused"));
      return;
    }
    setBusy(true);
    try {
      const id = await addCustomBackdrop({
        name: file.name,
        mimeType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      setChatBackdrop(customBackdropChoice(id));
    } catch {
      actionToast.error(t("settings.chatBackdrop.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await removeCustomBackdrop(id);
      const current = choice();
      if (current !== null && customBackdropId(current) === id) setChatBackdrop(null);
    } catch {
      actionToast.error(t("settings.chatBackdrop.removeFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ChatBackdropSelect
      value={shownChoice()}
      onChange={setChatBackdrop}
      custom={custom()}
      accept={CUSTOM_BACKDROP_UPLOAD_TYPES.join(",")}
      onUpload={(file) => void upload(file)}
      onRemove={(id) => void remove(id)}
      busy={busy()}
      mount={props.mount}
    />
  );
}
