/**
 * The service events the main process relays to the renderer. They live here rather than in
 * the entry point because every one of them is the same three lines around a different channel, and
 * because they are the part of the entry point most likely to be edited by two agents at once.
 *
 * Every dependency is a **function**, never a nullable value. These are built at module scope, before
 * `app.whenReady()` has constructed anything, so `getHostService()` and `hostService` behave
 * differently at run time - and `() => HostService | null` and `HostService | null` both type-check
 * at every call site, so `tsc` cannot tell you which one you passed. A function-typed field makes
 * the wrong one an error. Each of them now reads one `ApplicationServices` handle rather than its
 * own module-scope `let`.
 *
 * `showMainWindow` is injected rather than imported so that this module stays reachable from a test
 * without pulling in `main-window.ts` and, through it, the whole window and menu surface.
 */

import {
  type AgentEvent,
  type BrowserDisplayState,
  type GoogleMailNotice,
  IPC_ENDPOINTS,
  LOCAL_SERVER_ID,
  type VoiceModelStatus,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import type { AppFormat, AppTranslate } from "@openbot/i18n";
import { notificationForAgentEvent, notificationForUsageLimit } from "@openbot/team-client/agent-notifications";
import { BrowserWindow, Notification } from "electron";
import type { AgentService } from "../backend/agent-service";
import type { TokenBudgetAlert } from "./agent-token-budget";
import type { HostAnalytics } from "./analytics";
import { showRetainedNotification } from "./desktop-notifications";
import type { HostService } from "./host-service";
import { withLocalHostSummary } from "./ipc/team-handlers";
import { decodeAgentSummaries } from "./remote-agent-decoding";
import type { RemoteServerManager } from "./remote-server-manager";
import { sendToRenderer } from "./renderer-ipc";

export interface RendererForwarderDependencies {
  getMainWindow: () => BrowserWindow | null;
  getAgentService: () => Pick<AgentService, "listAgents"> | null;
  getHostService: () => HostService | null;
  getHostAnalytics: () => HostAnalytics | null;
  getRemoteServerManager: () => Pick<RemoteServerManager, "list" | "request"> | null;
  showMainWindow: (window: BrowserWindow) => void;
  /** The language every desktop notification is written in, read at the moment one is raised. */
  getTranslate: () => AppTranslate;
  /** The dates and numbers of a desktop notification, in the same language. */
  getFormat: () => AppFormat;
  /** The Settings switch for every desktop notification, read at the moment one is raised. */
  desktopNotificationsEnabled: () => boolean;
}

/**
 * Returns the forwarders as an object so the entry point can destructure it and keep every
 * `service.on("event", forwardX)` registration exactly as it was.
 */
export function createRendererForwarders({
  getMainWindow,
  getAgentService,
  getHostService,
  getHostAnalytics,
  getRemoteServerManager,
  showMainWindow,
  getTranslate,
  getFormat,
  desktopNotificationsEnabled,
}: RendererForwarderDependencies) {
  function forwardAgentEvent(serverId: string, event: AgentEvent, bufferedLive = false): void {
    if (serverId === LOCAL_SERVER_ID) getHostAnalytics()?.handleAgentEvent(event);
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(
      window,
      IPC_ENDPOINTS.agent.scopedEvent,
      bufferedLive ? { serverId, event, bufferedLive } : { serverId, event },
    );
    void notifyAgentEvent(serverId, event).catch(() => undefined);
  }

  async function notifyAgentEvent(serverId: string, event: AgentEvent): Promise<void> {
    if (
      event.type !== "turn-completed" &&
      event.type !== "prompt" &&
      event.type !== "approval" &&
      event.type !== "usage-limit-reached"
    )
      return;
    if (event.type === "turn-completed" && event.status !== "completed" && event.status !== "failed") return;
    // Like Discord, nothing pops up while the user is looking at the app. The level is read again
    // after the lookup, with the rest, because the user can change it while the lookup runs.
    const notifyLevel = () => {
      const window = getMainWindow();
      const server = getRemoteServerManager()
        ?.list()
        .find((candidate) => candidate.id === serverId);
      if (!window || window.isDestroyed() || window.isFocused() || !server || server.notificationsMuted) return null;
      if (!desktopNotificationsEnabled() || server.notificationLevel === "nothing") return null;
      return server.notificationLevel;
    };
    const initialLevel = notifyLevel();
    if (!initialLevel || !Notification.isSupported()) return;
    // Skip the remote agent lookup for an event the level already rules out.
    if (initialLevel === "needs-me" && event.type === "turn-completed") return;
    const agents =
      serverId === LOCAL_SERVER_ID
        ? (getAgentService()?.listAgents() ?? [])
        : ((await getRemoteServerManager()?.request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummaries)) ?? []);
    const level = notifyLevel();
    const content = !level
      ? null
      : event.type === "usage-limit-reached"
        ? notificationForUsageLimit(event, agents, getTranslate(), getFormat(), level)
        : notificationForAgentEvent(event, agents, getTranslate(), level);
    if (!content) return;
    const notification = new Notification({ title: content.title, body: content.body });
    notification.on("click", () => {
      // Re-read the window because it can change after the notification is shown.
      const current = getMainWindow();
      if (!current || current.isDestroyed()) return;
      showMainWindow(current);
      sendToRenderer(current, IPC_ENDPOINTS.notifications.opened, {
        serverId,
        agentId: content.agentId,
        threadId: content.threadId,
      });
    });
    showRetainedNotification(notification);
  }

  /**
   * A macOS notification about this computer: the Google connection or a token budget. Like the agent
   * notifications, none while the window has focus, and none while this computer's notifications are
   * muted or off.
   */
  function notifyLocal(content: { title: string; body: string }, agentId: string | null): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed() || window.isFocused()) return;
    if (!desktopNotificationsEnabled() || !Notification.isSupported()) return;
    const local = getRemoteServerManager()
      ?.list()
      .find((candidate) => candidate.id === LOCAL_SERVER_ID);
    if (local?.notificationsMuted || local?.notificationLevel === "nothing") return;
    const notification = new Notification({ title: content.title, body: content.body });
    notification.on("click", () => {
      const current = getMainWindow();
      if (!current || current.isDestroyed()) return;
      showMainWindow(current);
      if (agentId) {
        sendToRenderer(current, IPC_ENDPOINTS.notifications.opened, {
          serverId: LOCAL_SERVER_ID,
          agentId,
          threadId: null,
        });
      }
    });
    showRetainedNotification(notification);
  }

  /** An agent passed 80% or 100% of its weekly token budget. A click opens the agent. */
  function notifyTokenBudget(alert: TokenBudgetAlert): void {
    const translate = getTranslate();
    const format = getFormat();
    const tokens = (value: number) => format.number(value, { notation: "compact", maximumFractionDigits: 1 });
    notifyLocal(
      {
        title: translate("notification.tokenBudget.title", { name: alert.agent.name, percent: alert.level }),
        body: translate("notification.tokenBudget.body", {
          used: tokens(alert.usedTokens),
          budget: tokens(alert.budgetTokens),
        }),
      },
      alert.agent.id,
    );
  }

  /** One mail notice. A click opens the agent of the notice: the agent that handles mail. */
  function notifyGoogleMail(notice: GoogleMailNotice): void {
    const translate = getTranslate();
    const title =
      notice.kind === "meeting"
        ? translate("notification.google.meetingTitle", { from: notice.from })
        : translate("notification.google.importantTitle", { from: notice.from });
    // A notice from Gmail's signals only has no summary: the subject stands in.
    notifyLocal({ title, body: notice.summary || notice.subject }, notice.agentId);
  }

  function notifyGoogleSignInExpired(): void {
    const translate = getTranslate();
    notifyLocal(
      { title: translate("notification.google.expiredTitle"), body: translate("notification.google.expiredBody") },
      null,
    );
  }

  function forwardBrowserDisplayState(state: BrowserDisplayState): void {
    for (const window of BrowserWindow.getAllWindows()) {
      sendToRenderer(window, IPC_ENDPOINTS.browser.displayState, state);
    }
  }

  function forwardUpdateStatus(status: import("@openbot/contracts/ipc").UpdateStatus): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.update.event, status);
  }

  function forwardUpdatePreference(preference: import("@openbot/contracts/ipc").UpdatePreference): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.update.preference, preference);
  }

  function forwardVoiceModelStatus(status: VoiceModelStatus): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.voice.modelStatus, status);
  }

  function forwardProviderRuntimeStatus(snapshot: import("@openbot/contracts/ipc").ProviderRuntimeSnapshot): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.providerRuntimes.event, snapshot);
  }

  function forwardGitHubConnectorStatus(status: import("@openbot/contracts/ipc").GitHubConnectorStatus): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.githubConnector.changed, status);
  }

  function forwardRoutineFlowsChanged(change: import("@openbot/contracts/ipc").RoutineFlowsChanged): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.routineFlows.changed, change);
  }

  function forwardGoogleConnectorStatus(status: import("@openbot/contracts/ipc").GoogleConnectorStatus): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.googleConnector.changed, status);
  }

  function forwardGoogleMailNotices(notices: GoogleMailNotice[]): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.googleConnector.noticesChanged, notices);
  }

  function forwardOnePasswordConnectorStatus(
    status: import("@openbot/contracts/ipc").OnePasswordConnectorStatus,
  ): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.onePasswordConnector.changed, status);
  }

  function forwardBitwardenConnectorStatus(status: import("@openbot/contracts/ipc").BitwardenConnectorStatus): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.bitwardenConnector.changed, status);
  }

  function forwardMessagingThreadsChanged(change: import("@openbot/contracts/ipc").MessagingThreadsChanged): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.messaging.threadsChanged, change);
  }

  function forwardMessagingInboxChanged(change: import("@openbot/contracts/ipc").MessagingInboxChanged): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.messaging.inboxChanged, change);
  }

  function forwardSlackClientChanged(change: import("@openbot/contracts/ipc").SlackClientChanged): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.slackClient.changed, change);
  }

  function forwardHandoffsChanged(change: import("@openbot/contracts/ipc").AgentHandoffsChanged): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.handoffs.changed, change);
  }

  function forwardHostStatus(status: import("@openbot/contracts/ipc").HostStatus): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.host.event, status);
    const remoteServers = getRemoteServerManager();
    if (remoteServers) {
      sendToRenderer(window, IPC_ENDPOINTS.servers.event, withLocalHostSummary(remoteServers.list(), status));
    }
  }

  function forwardRemoteDesktopSessions(sessions: import("@openbot/contracts/ipc").RemoteDesktopSession[]): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.remoteDesktop.event, sessions);
  }

  function forwardServers(servers: import("@openbot/contracts/ipc").ServerSummary[]): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    const host = getHostService();
    sendToRenderer(
      window,
      IPC_ENDPOINTS.servers.event,
      host ? withLocalHostSummary(servers, host.getStatus()) : servers,
    );
  }

  function forwardTeamPresence(
    serverId: string,
    snapshot: import("@openbot/contracts/ipc").TeamPresenceSnapshot,
  ): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.servers.scopedPresence, { serverId, snapshot });
  }

  function forwardDirectMessage(
    serverId: string,
    event: import("@openbot/contracts/ipc").DirectMessageRealtimeEvent,
  ): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.servers.scopedDirectMessage, { serverId, event });
  }

  function forwardDirectTyping(
    serverId: string,
    event: import("@openbot/contracts/ipc").DirectTypingRealtimeEvent,
  ): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.servers.scopedDirectTyping, { serverId, event });
  }

  return {
    forwardAgentEvent,
    forwardBrowserDisplayState,
    forwardUpdateStatus,
    forwardUpdatePreference,
    forwardVoiceModelStatus,
    forwardProviderRuntimeStatus,
    forwardGitHubConnectorStatus,
    forwardRoutineFlowsChanged,
    forwardGoogleConnectorStatus,
    forwardGoogleMailNotices,
    notifyTokenBudget,
    forwardOnePasswordConnectorStatus,
    forwardBitwardenConnectorStatus,
    forwardMessagingThreadsChanged,
    forwardMessagingInboxChanged,
    forwardSlackClientChanged,
    forwardHandoffsChanged,
    forwardHostStatus,
    forwardRemoteDesktopSessions,
    forwardServers,
    forwardTeamPresence,
    forwardDirectMessage,
    forwardDirectTyping,
    notifyGoogleMail,
    notifyGoogleSignInExpired,
  };
}
