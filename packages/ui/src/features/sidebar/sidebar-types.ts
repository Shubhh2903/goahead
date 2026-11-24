import type {
  AvatarHue,
  ChannelSummary,
  DirectThreadSummary,
  MessagingThreadSummary,
  SidebarLayoutAction,
  SidebarLayoutSnapshot,
  TeamPresenceMember,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import type { JSX } from "@solidjs/web";
import type { AvatarMood } from "../../bloub-avatar";
import type { AgentProfile } from "../../data";
import type { ServerMenuProps } from "../servers/ServerMenu";
import type { SidebarPinnedItem } from "./sidebar-pins";

/**
 * What the sidebar is, as data. These live apart from `Sidebar.tsx` because
 * nine of this feature's modules - the drag engine, the filtering, the scope
 * and every store - name one of these types and none of them render anything.
 * Reading them from the entry component made the pure logic depend on the whole
 * view to borrow a name.
 */
/**
 * What the main area shows for the chat picked in the list: its conversation, or its routines. The
 * list itself is the same in both.
 */
export type SidebarView = "agents" | "routines";

/**
 * How the list orders the chats in the sections. Pins and "Needs you" come first in each order, and
 * none of them changes the saved `agentOrder`.
 * - `manual`: the saved order of the layout.
 * - `recent`: each section shows its chats by last activity, the most recent first. Chats do not
 *   drag in this order, because the order is not manual.
 */
export type SidebarChatOrder = "manual" | "recent";

export const SIDEBAR_CHAT_ORDERS = ["manual", "recent"] as const satisfies readonly SidebarChatOrder[];

/** The name of each order, in the sidebar menu. */
export const SIDEBAR_CHAT_ORDER_LABEL = {
  manual: "sidebar.order.manual",
  recent: "sidebar.order.recent",
} as const satisfies Record<SidebarChatOrder, AppTextKey>;

/** True when the order sorts the chats of each section itself, so a chat cannot keep a dropped place. */
export function sidebarChatOrderSortsSections(order: SidebarChatOrder | undefined): boolean {
  return order === "recent";
}

/** The saved value of a chat order. A value that no order uses, such as one from a newer version, is `manual`. */
export function parseSidebarChatOrder(value: unknown): SidebarChatOrder {
  return SIDEBAR_CHAT_ORDERS.find((order) => order === value) ?? "manual";
}

/** The fields of a chat that its last activity comes from. */
type SidebarChatActivitySource =
  | { kind: "agent"; agent: { updatedAt?: string | null } }
  | { kind: "channel"; channel: { createdAt: string; lastMessage: { at: string } | null } };

/** When a chat last had activity, in epoch milliseconds. A chat with no usable time counts as 0. */
export function sidebarChatActivity(chat: SidebarChatActivitySource): number {
  const at = chat.kind === "agent" ? chat.agent.updatedAt : (chat.channel.lastMessage?.at ?? chat.channel.createdAt);
  const time = at ? Date.parse(at) : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

/** The chats by last activity, the most recent first. Chats with the same time keep their order. */
export function sortSidebarChatsByRecent<T extends SidebarChatActivitySource>(chats: T[]): T[] {
  return [...chats].sort((left, right) => sidebarChatActivity(right) - sidebarChatActivity(left));
}

export interface SidebarProps {
  /** The switch over the list is shown only when the caller handles `onViewChange`. */
  view?: SidebarView;
  onViewChange?: ((view: SidebarView) => void) | undefined;
  deleteSupported?: boolean;
  marketplaceSupported?: boolean;
  channels?: ChannelSummary[];
  deletedChannels?: ChannelSummary[];
  activeChannelId?: string | null;
  onSelectChannel?: (channelId: string) => void;
  showingArchivedChannels?: boolean;
  onToggleArchivedChannels?: (() => void) | undefined;
  onCreateChannel?: (() => void) | undefined;
  /** Marks every agent chat and channel read. The free-area menu offers it while `hasUnread` is set. */
  onMarkAllRead?: (() => void) | undefined;
  hasUnread?: boolean;
  onEditChannel?: (channelId: string) => void;
  onDeleteChannel?: ((channelId: string) => Promise<void>) | undefined;
  serverName: string;
  onOpenServerSettings?: (trigger: HTMLElement) => void;
  /** The desktop server menu. Without it, the server name opens the server settings. */
  serverMenu?: Omit<ServerMenuProps, "serverName" | "compact">;
  agents: AgentProfile[];
  activeAgentId: string;
  /** Slack conversations, newest first. Each one shows as a row under the agent that answers it. */
  messagingThreads?: MessagingThreadSummary[];
  activeMessagingThreadId?: string | null;
  onSelectMessagingThread?: (threadId: string) => void;
  /** Hides Slack conversations from the sidebar. Nothing is deleted; a newer message shows one again. */
  onHideMessagingThreads?: (threadIds: string[]) => Promise<void>;
  /** The person's local Slack inbox, as the first row under the agent that holds it. */
  messagingInbox?: { agentId: string; unreadCount: number } | null;
  messagingInboxActive?: boolean;
  onSelectMessagingInbox?: () => void;
  showPeople?: boolean;
  people: TeamPresenceMember[];
  directThreads: DirectThreadSummary[];
  activeDirectMemberId: string | null;
  agentStates: Record<string, SidebarAgentState>;
  /** The face each agent wears, from `computeAgentAvatarMoods`. A missing entry rests. */
  agentMoods: Record<string, AvatarMood>;
  layout: SidebarLayoutSnapshot;
  layoutMutable?: boolean;
  /** This device's chat order. Missing means `manual`. */
  chatOrder?: SidebarChatOrder | undefined;
  /** The "Sort chats" menu is shown only when the caller handles it. */
  onChatOrderChange?: ((order: SidebarChatOrder) => void) | undefined;
  collapsedSectionIds: string[];
  onMutateLayout: (action: SidebarLayoutAction) => Promise<void>;
  /**
   * The host keeps folders in folders (the `nest` action and `parentId`). Without it, the folders are one
   * flat list, as on a joined host.
   */
  foldersSupported?: boolean | undefined;
  onToggleSection: (sectionId: string) => void;
  pinnedItems: SidebarPinnedItem[];
  peopleOrder: string[];
  onPin: (item: SidebarPinnedItem) => void;
  onUnpin: (item: SidebarPinnedItem) => void;
  onReorderPinned: (items: SidebarPinnedItem[]) => void;
  onReorderPeople: (memberIds: string[]) => void;
  onSelectAgent: (agentId: string) => void;
  onSelectPerson: (memberId: string) => void;
  onPreloadDirectConversation?: () => void;
  /** Whether this server currently accepts new agents. Desktop keeps the default enabled. */
  createSupported?: boolean;
  onCreateAgent: () => void;
  onEditAgent: (agentId: string) => void;
  duplicateSupported?: boolean;
  duplicatingAgentIds?: ReadonlySet<string>;
  onDuplicateAgent?: (agentId: string) => Promise<void>;
  onDeleteAgent: (agentId: string) => Promise<void>;
  compact: boolean;
  /** A card under the chat list, such as an announcement. The compact sidebar has no room for it. */
  footer?: JSX.Element;
  onExpand: () => void;
  onOpenMarketplace: () => void;
  /** Opens the usage report of the active server. Without it, the topbar shows no usage button. */
  onOpenUsage?: ((trigger: HTMLElement) => void) | undefined;
  emptyAction?:
    | {
        label: string;
        avatarSeed: string;
        avatarHue: AvatarHue | null;
        onSelect: () => void;
      }
    | undefined;
}

export type SidebarRoutinePhase = "running" | "queued" | "failed";

/** What an agent waits for: an answer to its question, an approval, or the user in the browser. */
export type SidebarWaitReason = "question" | "approval" | "takeover";

export type SidebarAgentState =
  /** `detail` is the question or the command, for the row tooltip. `null` when there is none. */
  | { kind: "waiting"; reason: SidebarWaitReason; detail: string | null }
  | { kind: "working" }
  | { kind: "responded" }
  | { kind: "unread"; count: number }
  | { kind: "routine"; phase: SidebarRoutinePhase; count: number }
  /** The provider plan is spent, so the queue waits. `resetsAt` is in epoch seconds, `null` when unknown. */
  | { kind: "limited"; resetsAt: number | null };

/** A pin paired with the chat it names, so the pinned strip renders the same two kinds the list does. */
export type ResolvedPinnedItem = { ref: SidebarPinnedItem; chat: SidebarChatItem };

/**
 * A row inside a section. Agents and channels share the sidebar layout - one order, one set of
 * section assignments - so the list, the grouping and the drag pipeline carry them as one type and
 * only the row component asks which kind it has.
 */
export type SidebarChatItem =
  | { kind: "agent"; id: string; agent: AgentProfile }
  | { kind: "channel"; id: string; channel: ChannelSummary };
