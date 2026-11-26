import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { MOBILE_CHAT_ORDERS, type MobileChatOrder } from "@/features/workspace/model/sidebar-layout";
import { writesInOrder } from "@/shared/lib/writes-in-order";

const key = "openbot.mobile.chatOrder.v1";
/** GoAhead v0.40-v0.41 kept the choice ("manual" or "recent") here. Read only, until the next save. */
const goAheadKey = "goahead.mobile.chat-order.v1";

/** "manual" when the person never chose, as in GoAhead v0.41, so an upgrade does not reorder the chats. */
export const useChatOrderPreference = create<{ order: MobileChatOrder; ready: boolean }>(() => ({
  order: "manual",
  ready: false,
}));

export async function loadChatOrderPreference(): Promise<void> {
  if (useChatOrderPreference.getState().ready) return;
  try {
    const stored = (await SecureStore.getItemAsync(key)) ?? (await SecureStore.getItemAsync(goAheadKey));
    const order = MOBILE_CHAT_ORDERS.find((candidate) => candidate === stored);
    if (order && !useChatOrderPreference.getState().ready) useChatOrderPreference.setState({ order });
  } finally {
    useChatOrderPreference.setState({ ready: true });
  }
}

const write = writesInOrder(key);

export function saveChatOrderPreference(order: MobileChatOrder): Promise<void> {
  useChatOrderPreference.setState({ order, ready: true });
  return write(() => order);
}
