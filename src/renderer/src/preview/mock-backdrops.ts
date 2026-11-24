import type { ChatBackdropState } from "@openbot/contracts/chat-backdrop";
import type { BackdropsDesktopApi } from "@openbot/contracts/ipc";

/** No backdrop, and no uploads: the preview has no file dialog to upload from. */
export function createMockBackdrops(): BackdropsDesktopApi {
  let state: ChatBackdropState = { choice: null, uploads: [] };
  return {
    getState: async () => structuredClone(state),
    setChoice: async (choice) => {
      state = { ...state, choice };
      return structuredClone(state);
    },
    upload: async () => ({ status: "cancelled" }),
    remove: async (id) => {
      state = {
        choice: state.choice === `upload:${id}` ? null : state.choice,
        uploads: state.uploads.filter((item) => item.id !== id),
      };
      return structuredClone(state);
    },
  };
}
