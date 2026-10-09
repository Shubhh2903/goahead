import type {
  AgentModelId,
  AgentModelOption,
  AgentProviderId,
  AgentStatus,
  CustomAgentSummary,
  CustomProviderSummary,
  MessagingConnection,
  SlackChannelChoice,
  SlackChannelOption,
  SlackQuietHours,
  SlackRoutingStatus,
} from "@openbot/contracts/ipc";
import { MESSAGING_LIMITS } from "@openbot/contracts/ipc";
import { SLACK_ORCHESTRATOR_AVATAR } from "@openbot/contracts/slack-app";
import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  buttonVariants,
  Check,
  Checkbox,
  DropdownMenu,
  ExternalLink,
  Hash,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Link2Off,
  Lock,
  SettingsSection,
  Spinner,
  SwitchField,
  Text,
  TriangleAlert,
} from "@openbot/ui";
import { createEffect, createMemo, createSignal, createStore, For, Match, Show, Switch } from "solid-js";
import { ProviderModelPicker } from "../../components/ProviderModelPicker";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import {
  DetailHeader,
  type IntegrationStatus,
  LogoTile,
  SlackMark,
  Stepper,
  WizardDialog,
  type WizardLink,
} from "./IntegrationLayout";
import type { IntegrationAgent } from "./IntegrationsHub";

export type SlackIntegrationAgent = IntegrationAgent & { title: string };

/** The model of the Slack Orchestrator that the user picks in the connect dialog. */
export interface SlackOrchestratorChoice {
  provider: AgentProviderId;
  model: AgentModelId;
}

/** The catalog behind the model picker. Absent, the orchestrator starts on a new agent's default. */
export interface SlackOrchestratorModels {
  modelOptions: AgentModelOption[];
  agentStatus: AgentStatus;
  initial: SlackOrchestratorChoice | null;
  customProviders?: readonly CustomProviderSummary[];
  customAgents?: readonly CustomAgentSummary[];
}

export interface SlackIntegrationPanelProps {
  /** Every agent on this computer. */
  agents: SlackIntegrationAgent[];
  /** The connected Slack workspaces. */
  connections: MessagingConnection[];
  /** True while an action runs. Every button waits for it. */
  busy: boolean;
  models?: SlackOrchestratorModels | undefined;
  onConnectWorkspace: () => void;
  onDisconnectWorkspace: (workspaceId: string) => void;
  onReconnect: (workspaceId: string) => void;
  onSetEnabled: (workspaceId: string, enabled: boolean) => void;
  onAddOrchestrator: (workspaceId: string, choice: SlackOrchestratorChoice | null) => void;
  /** Reads the channels the person is in, for the inbox picker. Without it and the save, no picker shows. */
  onListChannels?: (workspaceId: string) => Promise<SlackChannelOption[]>;
  onSetWatchedChannels?: (workspaceId: string, channels: SlackChannelChoice[]) => void;
  /** Changes the pause or the quiet hours of a workspace's sends. Without it, no Sending section shows. */
  onSetSendGuards?: (workspaceId: string, change: { paused?: boolean; quietHours?: SlackQuietHours | null }) => void;
  /** Which computer answers people without GoAhead, per workspace id. A workspace without an entry shows no line. */
  routing?: Readonly<Record<string, SlackRoutingStatus>>;
  /** Makes another connected person's computer the default. Without it, no "Hand over…" shows. */
  onHandOverDefault?: (workspaceId: string, slackUserId: string) => void;
}

/** What a workspace row can do. */
type RowKind = "live" | "setup" | "paused" | "attention";

function rowKind(connection: MessagingConnection): RowKind {
  switch (connection.state) {
    case "connected":
      return "live";
    case "paused":
      return "paused";
    case "connecting":
    case "reconnecting":
    case "rate_limited":
      return "setup";
    default:
      return "attention";
  }
}

const STATE_HELP: Partial<Record<MessagingConnection["state"], AppTextKey>> = {
  invalid_token: "messaging.help.invalid_token",
  secret_storage_unavailable: "messaging.help.secret_storage_unavailable",
  relay_unavailable: "messaging.help.relay_unavailable",
};

/** The orchestrator agent of a workspace, when it still exists. */
export function slackOrchestrator<Agent extends { id: string }>(
  connection: MessagingConnection,
  agents: readonly Agent[],
): Agent | null {
  return agents.find((agent) => agent.id === connection.orchestratorAgentId) ?? null;
}

/** The state of the whole Slack integration, for the page header and the Connectors list. */
export function slackIntegrationState(
  connections: readonly MessagingConnection[],
  agents: readonly { id: string }[],
): { status: IntegrationStatus; label: AppTextKey; attention: number } {
  const attention = connections.filter(
    (connection) => rowKind(connection) === "attention" || !slackOrchestrator(connection, agents),
  ).length;
  if (attention > 0) return { status: "attention", label: "connector.slack.statusAttention", attention };
  if (connections.length === 0) return { status: "idle", label: "connector.slack.statusNotSetUp", attention };
  return { status: "connected", label: "connector.slack.statusConnected", attention };
}

/**
 * Server settings > Connectors > Slack. A workspace installs the one OpenBot app, and its Slack
 * Orchestrator agent receives every request, asks the team and answers. The connect dialog does both
 * steps. No token reaches this component.
 */
export function SlackIntegrationPanel(props: SlackIntegrationPanelProps) {
  const { t } = useText();
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [disconnecting, setDisconnecting] = createSignal<MessagingConnection | null>(null);
  const [picking, setPicking] = createSignal<MessagingConnection | null>(null);
  const state = () => slackIntegrationState(props.connections, props.agents);
  const first = () => props.connections[0] ?? null;
  /** Until the first workspace has its orchestrator, the header offers the next step of the dialog. */
  const setUpDone = () => {
    const connection = first();
    return connection !== null && slackOrchestrator(connection, props.agents) !== null;
  };

  return (
    <div class="slack-integration">
      <DetailHeader
        logo={<SlackMark />}
        name={t("connector.slack.title")}
        status={state().status}
        statusLabel={t(state().label)}
        subtitle={t("connector.slack.description")}
        actions={
          <Show when={!setUpDone()}>
            <Button type="button" size="sm" disabled={props.busy} onClick={() => setDialogOpen(true)}>
              {first() ? t("connector.slack.addAgent") : t("connector.slack.connect")}
            </Button>
          </Show>
        }
      />

      <Show when={state().attention > 0}>
        <Alert tone="warning" role="alert">
          <AlertIcon>
            <TriangleAlert />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>{t("connector.slack.attentionTitle", { count: state().attention })}</AlertTitle>
            <AlertDescription>{t("connector.slack.attentionDescription")}</AlertDescription>
          </AlertContent>
        </Alert>
      </Show>

      {/* Not set up, the header holds the only step: Connect Slack. */}
      <Show when={props.connections.length > 0}>
        <SettingsSection title={t("connector.slack.workspaceTitle")}>
          <ItemGroup class="settings-modal-card">
            <For each={props.connections}>
              {(connection) => (
                <>
                  <WorkspaceRow
                    connection={connection}
                    busy={props.busy}
                    onReconnect={() => props.onReconnect(connection.workspaceId)}
                    onSetEnabled={(enabled) => props.onSetEnabled(connection.workspaceId, enabled)}
                    onDisconnect={() => setDisconnecting(connection)}
                  />
                  <Show when={props.routing?.[connection.workspaceId]}>
                    {(routing) => (
                      <DefaultRow
                        routing={routing()}
                        busy={props.busy}
                        onHandOver={
                          props.onHandOverDefault
                            ? (slackUserId) => props.onHandOverDefault?.(connection.workspaceId, slackUserId)
                            : undefined
                        }
                      />
                    )}
                  </Show>
                </>
              )}
            </For>
          </ItemGroup>
        </SettingsSection>
      </Show>

      <For each={props.connections}>
        {(connection) => (
          <SettingsSection
            title={t("connector.slack.orchestratorTitle")}
            description={t("connector.slack.orchestratorDescription")}
          >
            <ItemGroup class="settings-modal-card">
              <Show
                when={slackOrchestrator(connection, props.agents)}
                fallback={
                  <Item class="settings-modal-row">
                    <ItemMedia>
                      <OrchestratorFace />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{t("connector.slack.orchestratorNone")}</ItemTitle>
                      <ItemDescription>{t("connector.slack.orchestratorNoneDescription")}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button type="button" size="sm" disabled={props.busy} onClick={() => setDialogOpen(true)}>
                        {t("connector.slack.addAgent")}
                      </Button>
                    </ItemActions>
                  </Item>
                }
              >
                {(agent) => (
                  <Item class="settings-modal-row">
                    <ItemMedia>
                      <span class="integrations-agent-face" data-size="md">
                        <AgentAvatar agent={agent()} motion="idle" />
                      </span>
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{agent().name}</ItemTitle>
                      <ItemDescription>{agent().title}</ItemDescription>
                    </ItemContent>
                  </Item>
                )}
              </Show>
            </ItemGroup>
            <Text class="slack-integration-note" variant="caption" tone="muted">
              {t("connector.slack.inviteNote")}
            </Text>
          </SettingsSection>
        )}
      </For>

      {/* Sends go out as the person or as the app; the person limits both. */}
      <Show when={props.onSetSendGuards}>
        {(onSet) => (
          <For each={props.connections.filter((connection) => connection.userId)}>
            {(connection) => (
              <SendGuardsSection
                connection={connection}
                busy={props.busy}
                onChange={(change) => onSet()(connection.workspaceId, change)}
              />
            )}
          </For>
        )}
      </Show>

      {/* The inbox reads Slack as the person, so it needs their connection. */}
      <Show when={props.onListChannels && props.onSetWatchedChannels}>
        <For each={props.connections.filter((connection) => connection.userId)}>
          {(connection) => (
            <SettingsSection
              title={t("connector.slack.inboxTitle")}
              description={t("connector.slack.inboxDescription")}
            >
              <ItemGroup class="settings-modal-card">
                <InboxRow connection={connection} busy={props.busy} onChoose={() => setPicking(connection)} />
              </ItemGroup>
            </SettingsSection>
          )}
        </For>
      </Show>

      <SlackConnectDialog
        open={dialogOpen()}
        connection={first()}
        agents={props.agents}
        busy={props.busy}
        models={props.models}
        onConnectWorkspace={props.onConnectWorkspace}
        onAddOrchestrator={props.onAddOrchestrator}
        onClose={() => setDialogOpen(false)}
      />
      <Show when={props.onListChannels}>
        {(load) => (
          <ChannelPickerDialog
            connection={picking()}
            load={load()}
            onSave={(workspaceId, channels) => {
              setPicking(null);
              props.onSetWatchedChannels?.(workspaceId, channels);
            }}
            onClose={() => setPicking(null)}
          />
        )}
      </Show>
      <DisconnectDialog
        connection={disconnecting()}
        onConfirm={(workspaceId) => {
          setDisconnecting(null);
          props.onDisconnectWorkspace(workspaceId);
        }}
        onClose={() => setDisconnecting(null)}
      />
    </div>
  );
}

function OrchestratorFace(props: { size?: "md" | "lg" }) {
  return (
    <span class="integrations-agent-face" data-size={props.size ?? "md"}>
      <AgentAvatar
        seed={SLACK_ORCHESTRATOR_AVATAR.avatarSeed}
        hue={SLACK_ORCHESTRATOR_AVATAR.avatarHue}
        motion="idle"
      />
    </span>
  );
}

function WorkspaceRow(props: {
  connection: MessagingConnection;
  busy: boolean;
  onReconnect: () => void;
  onSetEnabled: (enabled: boolean) => void;
  onDisconnect: () => void;
}) {
  const { t, format } = useText();
  const kind = () => rowKind(props.connection);
  // The saved access cannot be decrypted here: only Disconnect, then a new connect, helps.
  const unreadable = () => props.connection.credentials === "unreadable";
  const note = () => {
    const current = props.connection;
    if (unreadable()) return t("connector.slack.accessUnreadable");
    if (current.missingScopes.length > 0)
      return t("connector.slack.missingScopes", { scopes: format.list(current.missingScopes) });
    if (current.retryAt)
      return t("connector.slack.retryAt", {
        time: format.date(new Date(current.retryAt), { hour: "numeric", minute: "2-digit" }),
      });
    const help = STATE_HELP[current.state];
    if (help) return t(help);
    if (current.userName) return t("connector.slack.connectedAs", { name: current.userName });
    if (!current.userId && kind() === "live") return t("connector.slack.connectAsYou");
    return t("connector.slack.workspaceDescription");
  };
  const label = (action: string) => t("connector.slack.rowAction", { action, name: props.connection.workspaceName });
  const action = (text: string, onClick: () => void) => (
    <Button type="button" size="sm" variant="outline" disabled={props.busy} aria-label={label(text)} onClick={onClick}>
      {text}
    </Button>
  );
  return (
    <Item class="settings-modal-row" data-status={kind()}>
      <ItemMedia>
        <LogoTile>
          <SlackMark />
        </LogoTile>
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{props.connection.workspaceName}</ItemTitle>
        <ItemDescription>{note()}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Switch>
          <Match when={!unreadable() && kind() === "attention"}>
            {action(t("connector.slack.reconnect"), props.onReconnect)}
          </Match>
          <Match when={!unreadable() && kind() === "paused"}>
            {action(t("connector.slack.resume"), () => props.onSetEnabled(true))}
          </Match>
        </Switch>
        <Button
          type="button"
          size="sm"
          variant="destructive-ghost"
          disabled={props.busy}
          aria-label={label(t("connector.slack.disconnectWorkspace"))}
          onClick={props.onDisconnect}
        >
          {t("connector.slack.disconnectWorkspace")}
        </Button>
      </ItemActions>
    </Item>
  );
}

/**
 * Whether this computer answers the people of the workspace who do not use GoAhead. The default's owner
 * can hand it to another connected person.
 */
function DefaultRow(props: {
  routing: SlackRoutingStatus;
  busy: boolean;
  onHandOver: ((slackUserId: string) => void) | undefined;
}) {
  const { t } = useText();
  const canHandOver = () => props.routing.isDefault && props.routing.people.length > 0 && props.onHandOver;
  return (
    <Item class="settings-modal-row">
      <ItemContent>
        <ItemDescription>
          {props.routing.isDefault ? t("connector.slack.defaultOn") : t("connector.slack.defaultOff")}
        </ItemDescription>
      </ItemContent>
      <Show when={canHandOver()}>
        {(handOver) => (
          <ItemActions>
            <DropdownMenu.Root placement="bottom-end" gutter={4}>
              <DropdownMenu.Trigger
                class={buttonVariants({ variant: "outline", size: "sm" })}
                disabled={props.busy}
                title={t("connector.slack.handOverTitle")}
              >
                {t("connector.slack.handOver")}
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content aria-label={t("connector.slack.handOverTitle")}>
                  <For each={props.routing.people}>
                    {(person) => (
                      <DropdownMenu.Item onSelect={() => handOver()(person.slackUserId)}>
                        {person.displayName}
                      </DropdownMenu.Item>
                    )}
                  </For>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </ItemActions>
        )}
      </Show>
    </Item>
  );
}

/** 0 connects the workspace, 1 adds the orchestrator, and 2 is done. */
type ConnectStep = 0 | 1 | 2;

/**
 * Connects Slack in two steps. Both end outside the dialog (the browser, then main), so the step
 * follows the first workspace's state: no workspace is step 1, a workspace with no orchestrator is
 * step 2, and one with an orchestrator is done.
 */
export function SlackConnectDialog(props: {
  open: boolean;
  connection: MessagingConnection | null;
  agents: readonly { id: string }[];
  busy: boolean;
  models?: SlackOrchestratorModels | undefined;
  onConnectWorkspace: () => void;
  onAddOrchestrator: (workspaceId: string, choice: SlackOrchestratorChoice | null) => void;
  onClose: () => void;
}) {
  const { t } = useText();
  const [waiting, setWaiting] = createSignal(false);
  const [choice, setChoice] = createSignal<SlackOrchestratorChoice | null>(null);
  createEffect(
    () => props.open,
    (open) => {
      if (!open) return;
      setWaiting(false);
      setChoice(props.models?.initial ?? null);
    },
  );
  const step = (): ConnectStep => {
    const connection = props.connection;
    if (!connection) return 0;
    return slackOrchestrator(connection, props.agents) ? 2 : 1;
  };
  const link = (): WizardLink => (step() === 2 ? "connected" : "connecting");
  const workspace = () => props.connection?.workspaceName ?? "";
  const copy = () => {
    switch (step()) {
      case 0:
        return { title: t("connector.slack.connectTitle"), description: t("connector.slack.connectDescription") };
      case 1:
        return {
          title: t("connector.slack.agentStepTitle"),
          description: t("connector.slack.agentStepDescription", { workspace: workspace() }),
        };
      case 2:
        return {
          title: t("connector.slack.doneTitle", { workspace: workspace() }),
          description: t("connector.slack.doneDescription"),
        };
    }
  };
  const steps = () => [t("connector.slack.stepWorkspace"), t("connector.slack.stepAgent")];
  return (
    <WizardDialog
      open={props.open}
      closeLabel={t("connector.slack.close")}
      onClose={props.onClose}
      logo={<SlackMark />}
      link={link()}
      title={copy().title}
      description={copy().description}
      stepper={<Stepper steps={steps()} current={step()} label={t("connector.slack.connect")} />}
      footer={
        <Switch>
          <Match when={step() === 0}>
            <Button
              type="button"
              size="sm"
              loading={props.busy}
              onClick={() => {
                setWaiting(true);
                props.onConnectWorkspace();
              }}
            >
              <ExternalLink size={14} aria-hidden="true" />
              {t("connector.slack.connectInSlack")}
            </Button>
          </Match>
          <Match when={step() === 1 && props.connection}>
            {(connection) => (
              <Button
                type="button"
                size="sm"
                loading={props.busy}
                onClick={() => props.onAddOrchestrator(connection().workspaceId, choice())}
              >
                {t("connector.slack.addAgent")}
              </Button>
            )}
          </Match>
          <Match when={step() === 2}>
            <Button type="button" size="sm" onClick={props.onClose}>
              {t("connector.slack.done")}
            </Button>
          </Match>
        </Switch>
      }
    >
      <Switch>
        <Match when={step() === 0}>
          <Show
            when={waiting()}
            fallback={
              <ol class="slack-checklist">
                <li>
                  <span class="slack-checklist-dot" aria-hidden="true" />
                  {t("connector.slack.connectStepBrowser")}
                </li>
                <li>
                  <span class="slack-checklist-dot" aria-hidden="true" />
                  {t("connector.slack.connectStepAllow")}
                </li>
                <li>
                  <span class="slack-checklist-dot" aria-hidden="true" />
                  {t("connector.slack.connectStepReturn")}
                </li>
              </ol>
            }
          >
            <div class="slack-waiting" aria-live="polite">
              <Spinner size="sm" />
              <Text variant="caption" tone="muted">
                {t("connector.slack.connectWaiting")}
              </Text>
            </div>
          </Show>
        </Match>
        <Match when={step() === 1}>
          <div class="slack-orchestrator-card">
            <OrchestratorFace size="lg" />
            <div class="slack-integration-stack">
              <Text as="span" variant="label">
                {t("connector.slack.orchestratorName")}
              </Text>
              <Text as="span" variant="caption" tone="muted">
                {t("connector.slack.orchestratorRole")}
              </Text>
            </div>
          </div>
          <ol class="slack-checklist">
            <li data-state="done">
              <Check size={14} aria-hidden="true" />
              {t("connector.slack.orchestratorDoesReceive")}
            </li>
            <li data-state="done">
              <Check size={14} aria-hidden="true" />
              {t("connector.slack.orchestratorDoesDelegate")}
            </li>
            <li data-state="done">
              <Check size={14} aria-hidden="true" />
              {t("connector.slack.orchestratorDoesAnswer")}
            </li>
          </ol>
          <Show when={props.models}>
            {(models) => (
              <Show when={choice()}>
                {(current) => (
                  <div class="slack-orchestrator-model">
                    <Text as="span" variant="label-sm">
                      {t("connector.slack.orchestratorModel")}
                    </Text>
                    <ProviderModelPicker
                      variant="field"
                      ariaLabel={t("connector.slack.orchestratorModel")}
                      provider={current().provider}
                      value={current().model}
                      modelOptions={models().modelOptions}
                      agentStatus={models().agentStatus}
                      customProviders={models().customProviders}
                      customAgents={models().customAgents}
                      disabled={props.busy}
                      onChange={(model, provider) => setChoice({ provider, model })}
                    />
                  </div>
                )}
              </Show>
            )}
          </Show>
        </Match>
      </Switch>
    </WizardDialog>
  );
}

function DisconnectDialog(props: {
  connection: MessagingConnection | null;
  onConfirm: (workspaceId: string) => void;
  onClose: () => void;
}) {
  const { t } = useText();
  const workspace = () => props.connection?.workspaceName ?? "";
  return (
    <WizardDialog
      open={props.connection !== null}
      closeLabel={t("connector.slack.close")}
      onClose={props.onClose}
      logo={<SlackMark />}
      link="broken"
      title={t("connector.slack.disconnectTitle", { workspace: workspace() })}
      description={t("connector.slack.disconnectDescription", { workspace: workspace() })}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={props.onClose}>
            {t("connector.slack.keep")}
          </Button>
          <Show when={props.connection}>
            {(connection) => (
              <Button
                type="button"
                variant="destructive"
                data-cuelume-tap="close"
                data-cuelume-emphasis="strong"
                onClick={() => props.onConfirm(connection().workspaceId)}
              >
                <Link2Off aria-hidden="true" />
                {t("connector.slack.disconnectWorkspace")}
              </Button>
            )}
          </Show>
        </>
      }
    >
      <ul class="slack-effects">
        <li data-tone="danger">
          <span class="slack-effect-icon" aria-hidden="true">
            <Link2Off />
          </span>
          {t("connector.slack.disconnectEffect", { workspace: workspace() })}
        </li>
        <Show when={props.connection?.userId}>
          <li data-tone="danger">
            <span class="slack-effect-icon" aria-hidden="true">
              <Link2Off />
            </span>
            {t("connector.slack.disconnectEffectUser")}
          </li>
          <li data-tone="danger">
            <span class="slack-effect-icon" aria-hidden="true">
              <Link2Off />
            </span>
            {t("connector.slack.disconnectEffectInbox")}
          </li>
        </Show>
        <li data-tone="success">
          <span class="slack-effect-icon" aria-hidden="true">
            <Check />
          </span>
          {t("connector.slack.removeEffectKept")}
        </li>
      </ul>
    </WizardDialog>
  );
}

function InboxRow(props: { connection: MessagingConnection; busy: boolean; onChoose: () => void }) {
  const { t, format } = useText();
  const summary = () => {
    const channels = props.connection.watchedChannels;
    if (channels.length === 0) return t("connector.slack.inboxChannelsNone");
    return t("connector.slack.inboxChannels", {
      count: channels.length,
      names: format.list(channels.map((channel) => `#${channel.name}`)),
    });
  };
  return (
    <Item class="settings-modal-row">
      <ItemMedia>
        <LogoTile>
          <Hash />
        </LogoTile>
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{summary()}</ItemTitle>
      </ItemContent>
      <ItemActions>
        <Button type="button" size="sm" variant="outline" disabled={props.busy} onClick={props.onChoose}>
          {t("connector.slack.chooseChannels")}
        </Button>
      </ItemActions>
    </Item>
  );
}

interface ChannelPickerState {
  status: "loading" | "ready" | "failed";
  options: SlackChannelOption[];
  selected: string[];
  query: string;
}

/**
 * Picks the channels of the local Slack inbox, from the channels the person is in. It opens with the
 * channels picked now, and saves the whole set.
 */
function ChannelPickerDialog(props: {
  connection: MessagingConnection | null;
  load: (workspaceId: string) => Promise<SlackChannelOption[]>;
  onSave: (workspaceId: string, channels: SlackChannelChoice[]) => void;
  onClose: () => void;
}) {
  const { t } = useText();
  const [state, setState] = createStore<ChannelPickerState>({
    status: "loading",
    options: [],
    selected: [],
    query: "",
  });
  let reads = 0;
  createEffect(
    () => props.connection,
    (connection) => {
      if (!connection) return;
      const read = ++reads;
      setState((draft) => {
        draft.status = "loading";
        draft.options = [];
        draft.selected = connection.watchedChannels.map((channel) => channel.channelId);
        draft.query = "";
      });
      void props
        .load(connection.workspaceId)
        .then((options) => {
          if (read !== reads) return;
          setState((draft) => {
            draft.options = options;
            draft.status = "ready";
          });
        })
        .catch(() => {
          if (read !== reads) return;
          setState((draft) => {
            draft.status = "failed";
          });
        });
    },
  );
  const visible = createMemo(() => {
    const query = state.query.trim().replace(/^#/u, "").toLowerCase();
    return query ? state.options.filter((option) => option.name.toLowerCase().includes(query)) : state.options;
  });
  const full = () => state.selected.length >= MESSAGING_LIMITS.watchedChannels;
  const toggle = (channelId: string, on: boolean) =>
    setState((draft) => {
      draft.selected = on
        ? [...new Set([...draft.selected, channelId])]
        : draft.selected.filter((selected) => selected !== channelId);
    });
  const save = () => {
    const connection = props.connection;
    if (!connection) return;
    const names = new Map(connection.watchedChannels.map((channel) => [channel.channelId, channel.name]));
    for (const option of state.options) names.set(option.channelId, option.name);
    props.onSave(
      connection.workspaceId,
      state.selected.map((channelId) => ({ channelId, name: names.get(channelId) ?? channelId })),
    );
  };
  return (
    <WizardDialog
      open={props.connection !== null}
      closeLabel={t("connector.slack.close")}
      onClose={props.onClose}
      logo={<SlackMark />}
      link="connected"
      title={t("connector.slack.channelsTitle")}
      description={t("connector.slack.channelsDescription")}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={props.onClose}>
            {t("connector.slack.channelsCancel")}
          </Button>
          <Button type="button" disabled={state.status !== "ready"} onClick={save}>
            {t("connector.slack.channelsSave")}
          </Button>
        </>
      }
    >
      <div class="slack-channel-picker">
        <Input
          type="search"
          aria-label={t("connector.slack.channelsSearch")}
          placeholder={t("connector.slack.channelsSearch")}
          value={state.query}
          onValueChange={(query) =>
            setState((draft) => {
              draft.query = query;
            })
          }
        />
        <Switch>
          <Match when={state.status === "loading"}>
            <Text variant="caption" tone="muted" role="status">
              <Spinner size="sm" /> {t("connector.slack.channelsLoading")}
            </Text>
          </Match>
          <Match when={state.status === "failed"}>
            <Text variant="caption" tone="muted" role="alert">
              {t("connector.slack.channelsFailed")}
            </Text>
          </Match>
          <Match when={state.status === "ready"}>
            <Show when={full()}>
              <Text variant="caption" tone="muted">
                {t("connector.slack.channelsLimit", { count: MESSAGING_LIMITS.watchedChannels })}
              </Text>
            </Show>
            <Show
              when={visible().length > 0}
              fallback={
                <Text variant="caption" tone="muted">
                  {t("connector.slack.channelsEmpty")}
                </Text>
              }
            >
              <ul class="slack-channel-options">
                <For each={visible()} keyed={(option) => option.channelId}>
                  {(option) => {
                    const checked = () => state.selected.includes(option().channelId);
                    const id = () => `slack-channel-${option().channelId}`;
                    return (
                      <li class="slack-channel-option">
                        <Checkbox
                          id={id()}
                          checked={checked()}
                          disabled={!checked() && full()}
                          onChange={(event) => toggle(option().channelId, event.currentTarget.checked)}
                        />
                        <label class="slack-channel-option-name" for={id()}>
                          #{option().name}
                        </label>
                        <Show when={option().isPrivate}>
                          <span class="slack-channel-option-private" title={t("connector.slack.channelPrivate")}>
                            <Lock aria-label={t("connector.slack.channelPrivate")} />
                          </span>
                        </Show>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </Show>
          </Match>
        </Switch>
      </div>
    </WizardDialog>
  );
}

const DEFAULT_QUIET_HOURS: SlackQuietHours = { start: "22:00", end: "08:00" };
const TIME_VALUE = /^([01]\d|2[0-3]):[0-5]\d$/u;

/** The pause switch, the quiet hours, and how many messages went out in the last hour. */
function SendGuardsSection(props: {
  connection: MessagingConnection;
  busy: boolean;
  onChange: (change: { paused?: boolean; quietHours?: SlackQuietHours | null }) => void;
}) {
  const { t } = useText();
  const guards = () => props.connection.sendGuards;
  const setTime = (edge: "start" | "end", value: string) => {
    const current = guards().quietHours;
    if (!current || !TIME_VALUE.test(value)) return;
    const next = { ...current, [edge]: value };
    if (next.start !== next.end) props.onChange({ quietHours: next });
  };
  return (
    <SettingsSection
      title={t("connector.slack.sendingTitle")}
      description={t("connector.slack.sendingDescription", { limit: guards().hourlyLimit })}
    >
      <ItemGroup class="settings-modal-card slack-send-guards">
        <SwitchField
          checked={guards().paused}
          disabled={props.busy}
          onChange={(paused: boolean) => props.onChange({ paused })}
          label={t("connector.slack.pauseTitle")}
          description={t("connector.slack.pauseDescription")}
        />
        <SwitchField
          checked={guards().quietHours !== null}
          disabled={props.busy}
          onChange={(on: boolean) => props.onChange({ quietHours: on ? DEFAULT_QUIET_HOURS : null })}
          label={t("connector.slack.quietTitle")}
          description={t("connector.slack.quietDescription")}
        />
        <Show when={guards().quietHours}>
          {(quietHours) => (
            <div class="slack-quiet-hours">
              <Input
                type="time"
                aria-label={t("connector.slack.quietStart")}
                value={quietHours().start}
                disabled={props.busy}
                onChange={(event: Event & { currentTarget: HTMLInputElement }) =>
                  setTime("start", event.currentTarget.value)
                }
              />
              <Text variant="caption" tone="muted">
                {t("connector.slack.quietUntil")}
              </Text>
              <Input
                type="time"
                aria-label={t("connector.slack.quietEnd")}
                value={quietHours().end}
                disabled={props.busy}
                onChange={(event: Event & { currentTarget: HTMLInputElement }) =>
                  setTime("end", event.currentTarget.value)
                }
              />
            </div>
          )}
        </Show>
        <Text class="slack-send-count" variant="caption" tone="muted" role="status">
          {t("connector.slack.sentLastHour", { count: guards().sentLastHour, limit: guards().hourlyLimit })}
        </Text>
      </ItemGroup>
    </SettingsSection>
  );
}
