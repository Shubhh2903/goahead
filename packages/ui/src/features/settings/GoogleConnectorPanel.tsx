import type { GoogleConnectorStatus } from "@openbot/contracts/ipc";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  LogIn,
  Mail,
  OctagonX,
  SettingsSection,
  Spinner,
  Text,
} from "@openbot/ui";
import { Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { AgentSelect } from "./AgentSelect";
import { DangerZone, DetailHeader, type IntegrationStatus } from "./IntegrationLayout";

export interface GoogleConnectorPanelProps {
  status: GoogleConnectorStatus;
  /** True while an action runs. Every button waits for it. */
  busy: boolean;
  /** The agents of this computer, for "Agent that handles mail". */
  agents: Array<{ id: string; name: string }>;
  onConnect: () => void;
  onCancel: () => void;
  onDisconnect: () => void;
  onSelectMailAgent: (agentId: string) => void;
}

/** The status pill of each state. The Connectors list and this page both read it. */
export const GOOGLE_CONNECTOR_STATUS = {
  disconnected: { status: "idle", label: "connector.google.statusNotSetUp" },
  pending: { status: "idle", label: "connector.google.statusConnecting" },
  connected: { status: "connected", label: "connector.google.statusConnected" },
  "reauth-required": { status: "attention", label: "connector.google.statusReauth" },
} as const satisfies Record<GoogleConnectorStatus["state"], { status: IntegrationStatus; label: string }>;

/**
 * The Gmail and Google Calendar page of one GoAhead computer. The tokens never reach this
 * component: the status holds the account email and the state only.
 */
export function GoogleConnectorPanel(props: GoogleConnectorPanelProps) {
  const { t, sourceText } = useText();
  const header = () => GOOGLE_CONNECTOR_STATUS[props.status.state];
  // A picked agent that was deleted handles no mail: the panel shows the same hint as no pick.
  const pickedAgentExists = () => props.agents.some((agent) => agent.id === props.status.mailAgentId);

  return (
    <div class="google-connector">
      <DetailHeader
        logo={<Mail aria-hidden="true" />}
        name={t("connector.google.title")}
        status={header().status}
        statusLabel={t(header().label)}
        subtitle={t("connector.google.description")}
      />

      <Show when={props.status.error}>
        {(message) => (
          <Alert tone="danger" role="alert">
            <AlertIcon>
              <OctagonX />
            </AlertIcon>
            <AlertContent>
              <AlertTitle>{t("connector.google.actionFailed")}</AlertTitle>
              <AlertDescription>{sourceText(message())}</AlertDescription>
            </AlertContent>
          </Alert>
        )}
      </Show>

      <Switch>
        <Match when={props.status.state === "pending"}>
          <SettingsSection title={t("connector.google.pendingTitle")}>
            <ItemGroup class="settings-modal-card">
              <Item class="settings-modal-row">
                <Spinner size="sm" role="presentation" aria-hidden="true" />
                <ItemContent>
                  <ItemTitle>{t("connector.google.pendingDescription")}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <Button type="button" size="sm" variant="outline" onClick={() => props.onCancel()}>
                    {t("connector.google.cancel")}
                  </Button>
                </ItemActions>
              </Item>
            </ItemGroup>
          </SettingsSection>
        </Match>
        <Match when={props.status.state === "connected" || props.status.state === "reauth-required"}>
          <SettingsSection title={t("connector.google.accountTitle")}>
            <ItemGroup class="settings-modal-card">
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>{props.status.email ?? ""}</ItemTitle>
                  <ItemDescription>
                    {props.status.state === "connected"
                      ? t("connector.google.connectedDescription")
                      : t("connector.google.reauthDescription")}
                  </ItemDescription>
                </ItemContent>
                <Show when={props.status.state === "reauth-required"}>
                  <ItemActions>
                    <Button type="button" size="sm" disabled={props.busy} onClick={() => props.onConnect()}>
                      <LogIn aria-hidden="true" />
                      {t("connector.google.signInAgain")}
                    </Button>
                  </ItemActions>
                </Show>
              </Item>
            </ItemGroup>
          </SettingsSection>
          <SettingsSection title={t("connector.google.mailAgentTitle")}>
            <ItemGroup class="settings-modal-card">
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemDescription>{t("connector.google.mailAgentDescription")}</ItemDescription>
                  <Show when={!pickedAgentExists()}>
                    <ItemDescription>{t("connector.google.mailAgentNone")}</ItemDescription>
                  </Show>
                </ItemContent>
                <ItemActions>
                  <AgentSelect
                    agents={props.agents}
                    value={pickedAgentExists() ? (props.status.mailAgentId ?? "") : ""}
                    label={t("connector.google.mailAgentTitle")}
                    onChange={(agentId) => props.onSelectMailAgent(agentId)}
                  />
                </ItemActions>
              </Item>
            </ItemGroup>
          </SettingsSection>
          <DangerZone
            title={t("connector.google.disconnectTitle")}
            description={t("connector.google.disconnectSummary")}
            action={t("connector.google.disconnect")}
            busy={props.busy}
            onAction={() => props.onDisconnect()}
          />
        </Match>
        <Match when={props.status.state === "disconnected"}>
          <Text variant="body-sm" tone="muted">
            {t("connector.google.howItWorks")}
          </Text>
          <Button type="button" disabled={props.busy || !props.status.available} onClick={() => props.onConnect()}>
            <LogIn aria-hidden="true" />
            {t("connector.google.connect")}
          </Button>
        </Match>
      </Switch>
    </div>
  );
}
