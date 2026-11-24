import { ChatBackdropSelect } from "@openbot/ui/features/settings/ChatBackdropSelect";
import { createSignal } from "solid-js";
import { actionToast } from "../../action-toast";
import { useI18n } from "../../i18n-context";
import { chooseChatBackdrop, removeChatBackdrop, uploadChatBackdrop, useChatBackdropState } from "./backdrop-state";

/** The "Backdrop" row of Settings > General. Main keeps the choice and the uploads on this computer. */
export function ChatBackdropSetting(props: { mount?: HTMLElement | undefined }) {
  const i18n = useI18n();
  const state = useChatBackdropState();
  const [busy, setBusy] = createSignal(false);

  const run = async (
    action: () => Promise<void>,
    failed: "settings.chatBackdrop.saveFailed" | "settings.chatBackdrop.removeFailed",
  ) => {
    setBusy(true);
    try {
      await action();
    } catch {
      actionToast.error(i18n.t(failed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ChatBackdropSelect
      value={state().choice}
      uploads={state().uploads}
      busy={busy()}
      mount={props.mount}
      onChange={(choice) => void run(() => chooseChatBackdrop(choice), "settings.chatBackdrop.saveFailed")}
      onUpload={() =>
        void run(async () => {
          const result = await uploadChatBackdrop();
          if (result.status !== "refused") return;
          actionToast.error(
            i18n.t(
              result.reason === "size"
                ? "settings.chatBackdrop.uploadRefusedSize"
                : "settings.chatBackdrop.uploadRefusedType",
            ),
          );
        }, "settings.chatBackdrop.saveFailed")
      }
      onRemove={(id) => void run(() => removeChatBackdrop(id), "settings.chatBackdrop.removeFailed")}
    />
  );
}
