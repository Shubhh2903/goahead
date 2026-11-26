import type { ChatBackdropState } from "@openbot/contracts/chat-backdrop";
import type { BackdropsDesktopApi } from "@openbot/contracts/ipc";

/** No backdrop, and no uploads from GoAhead v0.40 or v0.41. */
export function createMockBackdrops(): BackdropsDesktopApi {
  let state: ChatBackdropState = { choice: null, uploads: [] };
  return {
    getState: async () => structuredClone(state),
    setChoice: async (choice) => {
      state = { ...state, choice };
      return structuredClone(state);
    },
    remove: async (id) => {
      state = {
        choice: state.choice === `upload:${id}` ? null : state.choice,
        uploads: state.uploads.filter((item) => item.id !== id),
      };
      return structuredClone(state);
    },
  };
}
