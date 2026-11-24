import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { type MobileChatOrder, parseMobileChatOrder } from "../../workspace/model/chat-order";

const key = "goahead.mobile.chat-order.v1";

/** This phone's own choice of chat order. It is not synced. */
export const useChatOrderPreference = create<{ order: MobileChatOrder; ready: boolean }>(() => ({
  order: "manual",
  ready: false,
}));

export async function loadChatOrderPreference(): Promise<void> {
  if (useChatOrderPreference.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(key);
    // A second startup read must not overwrite a change made in the chat menu.
    if (!useChatOrderPreference.getState().ready) {
      useChatOrderPreference.setState({ order: parseMobileChatOrder(stored) });
    }
  } finally {
    useChatOrderPreference.setState({ ready: true });
  }
}

export async function saveChatOrderPreference(order: MobileChatOrder): Promise<void> {
  // Apply at once, including when storage fails: the order then holds until the app closes.
  useChatOrderPreference.setState({ order });
  try {
    await SecureStore.setItemAsync(key, order);
  } catch {
    // A display preference must not block the chat list.
  }
}
