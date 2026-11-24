import { chatBackdropUploadUrl, isChatBackdropScene, uploadBackdropId } from "@openbot/contracts/chat-backdrop";
import { ChatBackdrop } from "@openbot/ui/features/conversation/ChatBackdrop";
import { CustomBackdrop } from "@openbot/ui/features/conversation/CustomBackdrop";
import { createEffect, Show } from "solid-js";
import { useChatBackdropState } from "./backdrop-state";

/**
 * The backdrop behind the whole window: a built-in scene, or an image or video that the user
 * uploaded. While one shows, the window surfaces are clear tints (`backdrop.css`). With no choice,
 * as on a profile from before backdrops, nothing renders and the window looks as it did.
 */
export function WindowBackdrop() {
  const state = useChatBackdropState();
  const scene = () => {
    const choice = state().choice;
    return isChatBackdropScene(choice) ? choice : null;
  };
  const upload = () => {
    const choice = state().choice;
    const id = choice === null ? null : uploadBackdropId(choice);
    return id === null ? null : (state().uploads.find((item) => item.id === id) ?? null);
  };
  createEffect(
    () => scene() !== null || upload() !== null,
    (active) => {
      if (!active) return;
      document.documentElement.toggleAttribute("data-openbot-window-glass", true);
      return () => document.documentElement.toggleAttribute("data-openbot-window-glass", false);
    },
  );
  return (
    <Show
      when={scene()}
      fallback={
        <Show when={upload()}>
          {(current) => <CustomBackdrop kind={current().kind} url={chatBackdropUploadUrl(current().id)} />}
        </Show>
      }
    >
      {(current) => <ChatBackdrop scene={current()} />}
    </Show>
  );
}
