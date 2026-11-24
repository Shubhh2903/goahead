import type { ChatBackdropChoice, ChatBackdropState, ChatBackdropUploadResult } from "@openbot/contracts/chat-backdrop";
import { createSignal } from "solid-js";
import { backdropPort } from "./backdrop-port";

/**
 * The backdrop of this computer, as main keeps it. One shared signal, so a change in Settings
 * reaches the window at once. It is read from main once; each change answers with the new state.
 */
const [backdropState, setBackdropState] = createSignal<ChatBackdropState>({ choice: null, uploads: [] });
let loading: Promise<void> | undefined;

function loadBackdropState(): void {
  const port = backdropPort();
  if (!port || loading) return;
  loading = port.getState().then(
    (state) => {
      setBackdropState(state);
    },
    () => {
      // A failed read shows no backdrop, and the next reader tries again.
      loading = undefined;
    },
  );
}

export function useChatBackdropState(): () => ChatBackdropState {
  loadBackdropState();
  return backdropState;
}

function requirePort() {
  const port = backdropPort();
  if (!port) throw new Error("Backdrops are not available here.");
  return port;
}

export async function chooseChatBackdrop(choice: ChatBackdropChoice | null): Promise<void> {
  setBackdropState(await requirePort().setChoice(choice));
}

/** Opens main's file dialog. Main checks the file; an added upload shows at once. */
export async function uploadChatBackdrop(): Promise<ChatBackdropUploadResult> {
  const result = await requirePort().upload();
  if (result.status === "added") setBackdropState(result.state);
  return result;
}

export async function removeChatBackdrop(id: string): Promise<void> {
  setBackdropState(await requirePort().remove(id));
}
