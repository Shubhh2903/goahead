import {
  type ChatBackdropState,
  type ChatBackdropUploadResult,
  parseChatBackdropState,
} from "@openbot/contracts/chat-backdrop";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";

export function decodeChatBackdropState(value: unknown): ChatBackdropState {
  const state = parseChatBackdropState(value);
  if (!state) throw new Error("Invalid backdrop state response.");
  return state;
}

export function decodeChatBackdropUploadResult(value: unknown): ChatBackdropUploadResult {
  if (!isDynamicRecord(value)) throw new Error("Invalid backdrop upload response.");
  if (value.status === "cancelled") return { status: "cancelled" };
  if (value.status === "refused" && (value.reason === "type" || value.reason === "size")) {
    return { status: "refused", reason: value.reason };
  }
  if (value.status === "added") return { status: "added", state: decodeChatBackdropState(value.state) };
  throw new Error("Invalid backdrop upload response.");
}
