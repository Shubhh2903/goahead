/**
 * How the list orders the chats in each section. Neither order changes the saved `agentOrder`. The
 * phone keeps the choice; it is not synced.
 * - `manual`: the saved order of the layout.
 * - `recent`: each section shows its chats by last activity, the most recent first.
 */
export type MobileChatOrder = "manual" | "recent";

export const MOBILE_CHAT_ORDERS = ["manual", "recent"] as const satisfies readonly MobileChatOrder[];

/** The saved value of a chat order. A value that no order uses is `manual`. */
export function parseMobileChatOrder(value: unknown): MobileChatOrder {
  return MOBILE_CHAT_ORDERS.find((order) => order === value) ?? "manual";
}
