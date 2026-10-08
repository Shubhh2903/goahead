import type {
  SlackChannelChoice,
  SlackChannelOption,
  SlackOverview,
  SlackQuietHours,
  SlackRoutingStatus,
} from "@openbot/contracts/ipc";
import type {
  SlackOrchestratorChoice,
  SlackOrchestratorModels,
} from "@openbot/ui/features/settings/SlackIntegrationPanel";
import { currentText } from "@openbot/ui/text";
import { createSignal, onCleanup } from "solid-js";
import { actionToast } from "../../action-toast";
import { type SlackConnectorPort, slackConnectorPort } from "./slack-connector-port";

/** How often the Slack page reads the connections while it shows: a connection changes on its own. */
const POLL_MS = 3_000;

export interface SlackConnectorController {
  /** Null until the first read. */
  overview: () => SlackOverview | null;
  busy: () => boolean;
  /** Reads the connections now and then every few seconds. Call the result to stop. */
  watch: () => () => void;
  connectWorkspace: () => void;
  disconnectWorkspace: (workspaceId: string) => void;
  reconnect: (workspaceId: string) => void;
  setEnabled: (workspaceId: string, enabled: boolean) => void;
  /** The catalog for the orchestrator's model picker, or undefined to start on a new agent's default. */
  models: () => SlackOrchestratorModels | undefined;
  addOrchestrator: (workspaceId: string, choice: SlackOrchestratorChoice | null) => void;
  /** The channels the person is in, for the inbox picker. The picker shows a failure itself. */
  listChannels: (workspaceId: string) => Promise<SlackChannelOption[]>;
  setWatchedChannels: (workspaceId: string, channels: SlackChannelChoice[]) => void;
  setSendGuards: (workspaceId: string, change: { paused?: boolean; quietHours?: SlackQuietHours | null }) => void;
  /** Which computer answers people without GoAhead, per workspace connected as the person. */
  routing: () => Readonly<Record<string, SlackRoutingStatus>>;
  handOverDefault: (workspaceId: string, slackUserId: string) => void;
}

/**
 * The Slack workspaces of this computer, for Server settings > Connectors. Main sends no event for a
 * connection, and the install ends in the browser, so a page that shows the state calls `watch`.
 */
export function createSlackConnector(
  port: () => SlackConnectorPort = slackConnectorPort,
  models: () => SlackOrchestratorModels | undefined = () => undefined,
  /** Called with the sidebar section that main put the new orchestrator in. */
  onOrchestratorSection: (sectionId: string) => void = () => undefined,
): SlackConnectorController {
  const [overview, setOverview] = createSignal<SlackOverview | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [routing, setRouting] = createSignal<Readonly<Record<string, SlackRoutingStatus>>>({});
  /** The workspaces whose routing was asked for. The account service is asked once per page, not per poll. */
  const routingAsked = new Set<string>();
  let disposed = false;
  /** Each read replaces the one before it, so a slow answer never overwrites a newer one. */
  let reads = 0;

  const putRouting = (workspaceId: string, status: SlackRoutingStatus) => {
    if (!disposed) setRouting((current) => ({ ...current, [workspaceId]: status }));
  };

  // The routing lives in the account service. Only a workspace connected as the person has a route of
  // its own. A failed read shows no line and asks again on the next page.
  const readRouting = (next: SlackOverview) => {
    for (const connection of next.connections) {
      if (!connection.userId || routingAsked.has(connection.workspaceId)) continue;
      const { workspaceId } = connection;
      routingAsked.add(workspaceId);
      void port()
        .messaging.getSlackRouting({ workspaceId })
        .then((status) => putRouting(workspaceId, status))
        .catch(() => routingAsked.delete(workspaceId));
    }
  };

  // A failed read keeps the last overview. The next poll or action reads again.
  const reload = () => {
    const read = ++reads;
    void port()
      .messaging.getSlackOverview()
      .then((next) => {
        if (disposed || read !== reads) return;
        setOverview(next);
        readRouting(next);
      })
      .catch(() => undefined);
  };
  onCleanup(() => {
    disposed = true;
  });

  const run = (action: () => Promise<unknown>) => {
    if (busy()) return;
    setBusy(true);
    void action()
      .catch((error: unknown) => {
        const { t, errorMessage } = currentText();
        actionToast.error(t("connector.slack.actionFailed"), {
          description: errorMessage(error, t("connector.slack.actionFailed")),
        });
      })
      .finally(() => {
        if (disposed) return;
        setBusy(false);
        reload();
      });
  };
  const messaging = () => port().messaging;

  return {
    overview,
    busy,
    watch: () => {
      routingAsked.clear();
      reload();
      const timer = setInterval(reload, POLL_MS);
      return () => clearInterval(timer);
    },
    connectWorkspace: () => run(() => messaging().connectSlackWorkspace()),
    disconnectWorkspace: (workspaceId) => run(() => messaging().disconnectSlackWorkspace({ workspaceId })),
    reconnect: (workspaceId) => run(() => messaging().reconnectSlackWorkspace({ workspaceId })),
    setEnabled: (workspaceId, enabled) => run(() => messaging().setSlackEnabled({ workspaceId, enabled })),
    models,
    listChannels: (workspaceId) =>
      messaging()
        .listSlackChannels({ workspaceId })
        .then((list) => list.channels),
    setWatchedChannels: (workspaceId, channels) =>
      run(() => messaging().setSlackWatchedChannels({ workspaceId, channels })),
    setSendGuards: (workspaceId, change) => run(() => messaging().setSlackSendGuards({ workspaceId, ...change })),
    routing,
    handOverDefault: (workspaceId, slackUserId) =>
      run(async () => putRouting(workspaceId, await messaging().handOverSlackDefault({ workspaceId, slackUserId }))),
    addOrchestrator: (workspaceId, choice) =>
      run(async () => {
        const { sectionId } = await messaging().addSlackOrchestrator({ workspaceId, ...(choice ?? {}) });
        if (sectionId) onOrchestratorSection(sectionId);
      }),
  };
}
