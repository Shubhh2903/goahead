import { Button, ChevronLeft, Mail } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { SlackMark } from "@openbot/ui/features/settings/brand-marks";
import { GOOGLE_CONNECTOR_STATUS, GoogleConnectorPanel } from "@openbot/ui/features/settings/GoogleConnectorPanel";
import { IntegrationsHub, type IntegrationsHubRow } from "@openbot/ui/features/settings/IntegrationsHub";
import {
  SlackIntegrationPanel,
  slackIntegrationState,
  slackOrchestrator,
} from "@openbot/ui/features/settings/SlackIntegrationPanel";
import { useText } from "@openbot/ui/text";
import { createSignal, Match, onSettled, Show, Switch } from "solid-js";
import { type GoogleConnectorController, googlePanelProps } from "./google-connector";
import type { SlackConnectorController } from "./slack-connector";

type View = "hub" | "google" | "slack";

export function ConnectorsPanel(props: {
  google?: GoogleConnectorController | undefined;
  slack?: SlackConnectorController | undefined;
  agents: AgentProfile[];
}) {
  const { t } = useText();
  const [view, setView] = createSignal<View>("hub");
  onSettled(() => props.slack?.watch());

  const googleRow = (google: GoogleConnectorController): IntegrationsHubRow => {
    const status = google.status();
    const header = GOOGLE_CONNECTOR_STATUS[status.state];
    return {
      id: "google",
      name: t("connector.google.title"),
      logo: <Mail aria-hidden="true" />,
      status: header.status,
      statusLabel: t(header.label),
      summary:
        status.state === "connected"
          ? (status.email ?? "")
          : status.state === "reauth-required"
            ? t("connector.google.reauthDescription")
            : t("connector.google.description"),
      onOpen: () => setView("google"),
    };
  };
  const slackRow = (slack: SlackConnectorController): IntegrationsHubRow => {
    const connections = slack.overview()?.connections ?? [];
    const state = slackIntegrationState(connections, props.agents);
    const [connection] = connections;
    const orchestrator = connection ? slackOrchestrator(connection, props.agents) : null;
    const workspace = connection?.workspaceName;
    return {
      id: "slack",
      name: t("connector.slack.title"),
      logo: <SlackMark />,
      status: state.status,
      statusLabel: t(state.label),
      summary:
        state.attention > 0
          ? t("connector.slack.attentionTitle", { count: state.attention })
          : workspace === undefined
            ? t("connector.slack.description")
            : orchestrator
              ? t("connector.slack.summaryConnected", { workspace })
              : t("connector.slack.summaryNoAgent", { workspace }),
      agents: orchestrator ? [orchestrator] : [],
      onOpen: () => setView("slack"),
    };
  };
  const rows = () => {
    const list: IntegrationsHubRow[] = [];
    if (props.slack) list.push(slackRow(props.slack));
    if (props.google) list.push(googleRow(props.google));
    return list;
  };

  const Back = () => (
    <Button type="button" size="sm" variant="ghost" class="integrations-back" onClick={() => setView("hub")}>
      <ChevronLeft aria-hidden="true" />
      {t("connector.hub.back")}
    </Button>
  );

  return (
    <Switch fallback={<IntegrationsHub rows={rows()} />}>
      <Match when={view() === "google" && props.google}>
        {(google) => (
          <div class="integrations-hub">
            <Back />
            <GoogleConnectorPanel
              {...googlePanelProps(google(), () => props.agents.map((agent) => ({ id: agent.id, name: agent.name })))}
            />
          </div>
        )}
      </Match>
      <Match when={view() === "slack" && props.slack}>
        {(slack) => (
          <div class="integrations-hub">
            <Back />
            <Show when={slack().overview()}>
              {(overview) => (
                <SlackIntegrationPanel
                  agents={props.agents}
                  connections={overview().connections}
                  busy={slack().busy()}
                  models={slack().models()}
                  onConnectWorkspace={slack().connectWorkspace}
                  onDisconnectWorkspace={slack().disconnectWorkspace}
                  onDisconnectAll={slack().disconnectAll}
                  onReconnect={slack().reconnect}
                  onSetEnabled={slack().setEnabled}
                  onAddOrchestrator={slack().addOrchestrator}
                  onListChannels={slack().listChannels}
                  onSetWatchedChannels={slack().setWatchedChannels}
                  onSetSendGuards={slack().setSendGuards}
                  routing={slack().routing()}
                  onHandOverDefault={slack().handOverDefault}
                />
              )}
            </Show>
          </div>
        )}
      </Match>
    </Switch>
  );
}
