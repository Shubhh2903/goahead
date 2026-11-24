import { parseSidebarChatOrder, type SidebarChatOrder } from "@openbot/ui/features/sidebar/sidebar-types";

/** The chat order is a choice of this computer, for every server, like the sidebar width. */
export const SIDEBAR_CHAT_ORDER_STORAGE_KEY = "openbot:sidebar-chat-order:v1";

type SidebarChatOrderStorage = Pick<Storage, "getItem" | "setItem">;

export function readSidebarChatOrder(storage: SidebarChatOrderStorage = window.localStorage): SidebarChatOrder {
  try {
    return parseSidebarChatOrder(storage.getItem(SIDEBAR_CHAT_ORDER_STORAGE_KEY));
  } catch {
    return "manual";
  }
}

export function writeSidebarChatOrder(
  order: SidebarChatOrder,
  storage: SidebarChatOrderStorage = window.localStorage,
): void {
  try {
    storage.setItem(SIDEBAR_CHAT_ORDER_STORAGE_KEY, order);
  } catch {
    // A UI preference must not block navigation when browser storage is unavailable.
  }
}
