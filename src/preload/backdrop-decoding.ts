import { type ChatBackdropState, parseChatBackdropState } from "@openbot/contracts/chat-backdrop";

export function decodeChatBackdropState(value: unknown): ChatBackdropState {
  const state = parseChatBackdropState(value);
  if (!state) throw new Error("Invalid backdrop state response.");
  return state;
}
