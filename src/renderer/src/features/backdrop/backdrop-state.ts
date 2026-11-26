import type { ChatBackdropState } from "@openbot/contracts/chat-backdrop";
import { createSignal } from "solid-js";
import { backdropPort } from "./backdrop-port";

/**
 * The backdrop that GoAhead v0.40 or v0.41 saved on this computer, as main keeps it. It is read
 * from main once. New backdrops are the renderer's custom backdrops.
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

/**
 * Clears the GoAhead v0.40/v0.41 choice once the user chooses a backdrop in this version, so it does
 * not show again under "None". The uploaded files stay where main keeps them.
 */
export function clearLegacyBackdropChoice(): void {
  const port = backdropPort();
  if (!port || backdropState().choice === null) return;
  setBackdropState((current) => ({ ...current, choice: null }));
  port.setChoice(null).then(setBackdropState, () => undefined);
}
