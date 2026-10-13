/**
 * What a story needs to mount the real agent chat: the app providers it reads and a complete set of
 * `Conversation` props. `Conversation.stories.tsx` and `VoiceInput.stories.tsx` build on these.
 */

import type { AvatarImageInput, UpdateAgentInput } from "@openbot/contracts/ipc";
import type { ParentProps } from "solid-js";
import { fn } from "storybook/test";
import { AuthProvider } from "../src/features/account/account-context";
import type { Conversation } from "../src/features/conversation/Conversation";
import { SetupProvider } from "../src/features/onboarding/onboarding-context";
import { ServersProvider } from "../src/features/servers/servers-context";
import { SettingsProvider } from "../src/features/settings/settings-context";
import { UsageProvider } from "../src/features/usage/usage-context";
import { PlatformProvider } from "../src/platform";
import {
  STORY_AGENT_STATUS,
  STORY_AGENTS,
  STORY_MODELS,
  STORY_PRESENCE,
  STORY_REMOTE_DESKTOP_SESSION,
  STORY_SERVERS,
} from "./fixtures";

/**
 * The domains `ConversationView` and its panels read through `use*()`, nested in the order
 * `app-providers.tsx` uses. Each one talks to the mocked `window.openbot` the story installs.
 */
export function StoryAppProviders(props: ParentProps) {
  return (
    <PlatformProvider>
      <AuthProvider>
        <SetupProvider>
          <SettingsProvider>
            <ServersProvider>
              <UsageProvider>{props.children}</UsageProvider>
            </ServersProvider>
          </SettingsProvider>
        </SetupProvider>
      </AuthProvider>
    </PlatformProvider>
  );
}

/** `Conversation` props with no messages. A story adds the messages it shows. */
export const CONVERSATION_STORY_ARGS: Parameters<typeof Conversation>[0] = {
  agentStatus: STORY_AGENT_STATUS,
  agent: STORY_AGENTS[0],
  agents: STORY_AGENTS,
  modelOptions: STORY_MODELS,
  messages: [],
  unreadCount: 0,
  firstUnreadMessageId: null,
  loaded: true,
  activeTurnId: null,
  globalOverlayOpen: false,
  settingsRequest: null,
  messageFocusRequest: null,
  queue: undefined,
  browserTabs: [],
  activeBrowserTabId: null,
  browserVisibilitySuspended: false,
  browserControlState: { sessions: [] },
  server: STORY_SERVERS[0],
  presence: STORY_PRESENCE,
  currentUserEmail: "person@example.com",
  isOwnSender: (senderId) => senderId === "member-self",
  remoteDesktopSessionActive: Boolean(STORY_REMOTE_DESKTOP_SESSION),
  remoteDesktopVisible: false,
  prompt: undefined,
  approval: undefined,
  browserTakeover: undefined,
  onSelectAgent: fn(),
  onUpdateAgent: async (_agentId: string, _updates: Omit<UpdateAgentInput, "agentId">) => undefined,
  onSetAgentAvatar: async (_agentId: string, _image: AvatarImageInput | null) => undefined,
  onSendMessage: async (_body: string, _attachmentDraftIds: string[], _replyToMessageId: string | null) => ({
    messageId: `storybook-sent-${Date.now()}`,
  }),
  onMarkRead: async () => undefined,
  onTypingChange: fn(),
  onAnswerPrompt: async (_answers: Record<string, string[]>) => true,
  onRespondToApproval: async (_decision: "accept" | "decline") => true,
  onRespondToBrowserTakeover: async (_decision: "complete" | "cancel") => true,
  onCancelQueuedMessage: fn(),
  onSteerQueuedMessage: fn(),
  onUpdateQueuedMessage: async (
    _deliveryId: string,
    _text: string,
    _keepAttachmentIds: string[],
    _attachmentDraftIds: string[],
  ) => true,
  onReorderQueue: fn(),
  onActivateBrowserTab: fn(),
  onCloseBrowserTab: fn(),
  onOpenRemoteDesktop: async (_serverId: string, _trigger: HTMLElement) => undefined,
  onStop: fn(),
};
