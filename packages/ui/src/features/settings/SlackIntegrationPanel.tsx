import { DISCORD_ORCHESTRATOR_AVATAR } from "@openbot/contracts/discord-app";
import type {
  MessagingConnection,
  MessagingPlatform,
  MessagingRole,
  SlackChannelChoice,
  SlackChannelOption,
  SlackQuietHours,
  SlackRoutingStatus,
} from "@openbot/contracts/ipc";
import { MESSAGING_LIMITS } from "@openbot/contracts/ipc";
import { SLACK_ORCHESTRATOR_AVATAR } from "@openbot/contracts/slack-app";
import type { AppMessages, AppTextKey } from "@openbot/i18n";
import {
  Button,
  buttonVariants,
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
  Lock,
  SettingsSection,
  Spinner,
  SwitchField,
  Text,
} from "@openbot/ui";
import {
  createEffect,
  createMemo,
  createSignal,
  createStore,
  createUniqueId,
  For,
  Match,
  Show,
  Switch,
} from "solid-js";
import { useText } from "../../text";
import { DiscordTile, SlackTile } from "./brand-marks";
import {
  type ChannelAgent,
  type ChannelAvatar,
  ChannelConnectChecklist,
  ChannelConnectionRow,
  ChannelDisconnectDialog,
  type ChannelOrchestratorChoice,
  type ChannelOrchestratorModels,
  ChannelOrchestratorSection,
  ChannelOrchestratorStep,
  ChannelPage,
  type ChannelState,
  type ChannelText,
  channelRowKind,
  pausedChannelState,
} from "./ChannelParts";
import {
  type IntegrationPageSlots,
  LogoTile,
  ReadFailedAlert,
  Stepper,
  UNKNOWN_STATUS,
  WizardDialog,
  type WizardLink,
} from "./IntegrationLayout";

export type SlackIntegrationAgent = ChannelAgent;

export type SlackOrchestratorChoice = ChannelOrchestratorChoice;

export type SlackOrchestratorModels = ChannelOrchestratorModels;

export interface DiscordAccessControl {
  allowed: (workspaceId: string) => readonly MessagingRole[] | null;
  loadRoles: (workspaceId: string) => Promise<readonly MessagingRole[]>;
  onSave: (workspaceId: string, roles: MessagingRole[]) => void;
  unsupported?: boolean | undefined;
}

export interface SlackIntegrationPanelProps extends IntegrationPageSlots {
  platform?: WorkspacePlatform | undefined;
  agents: SlackIntegrationAgent[];
  connections: MessagingConnection[];
  busy: boolean;
  models?: SlackOrchestratorModels | undefined;
  onConnectWorkspace: () => void;
  onDisconnectWorkspace: (workspaceId: string) => void;
  onDisconnectAll: () => void;
  onReconnect: (workspaceId: string) => void;
  onSetEnabled: (workspaceId: string, enabled: boolean) => void;
  onAddOrchestrator: (workspaceId: string, choice: SlackOrchestratorChoice | null) => void;
  /** Reads the channels the person is in, for the inbox picker. Without it and the save, no picker shows. */
  onListChannels?: ((workspaceId: string) => Promise<SlackChannelOption[]>) | undefined;
  onSetWatchedChannels?: ((workspaceId: string, channels: SlackChannelChoice[]) => void) | undefined;
  /** Changes the pause or the quiet hours of a workspace's sends. Without it, no Sending section shows. */
  onSetSendGuards?:
    | ((workspaceId: string, change: { paused?: boolean; quietHours?: SlackQuietHours | null }) => void)
    | undefined;
  /** Which computer answers people without GoAhead, per workspace id. A workspace without an entry shows no line. */
  routing?: Readonly<Record<string, SlackRoutingStatus>> | undefined;
  /** Makes another connected person's computer the default. Without it, no "Hand over…" shows. */
  onHandOverDefault?: ((workspaceId: string, slackUserId: string) => void) | undefined;
  hostName?: string | undefined;
  loadError?: string | null | undefined;
  onRetry?: (() => void) | undefined;
  access?: DiscordAccessControl | undefined;
}

export type WorkspacePlatform = Exclude<MessagingPlatform, "telegram" | "whatsapp">;

const STATE_HELP: Record<WorkspacePlatform, Partial<Record<MessagingConnection["state"], AppTextKey>>> = {
  slack: {
    invalid_token: "messaging.help.invalid_token",
    secret_storage_unavailable: "messaging.help.secret_storage_unavailable",
    relay_unavailable: "messaging.help.relay_unavailable",
    not_linked: "messaging.help.not_linked",
  },
  discord: {
    invalid_token: "messaging.discordHelp.invalid_token",
    secret_storage_unavailable: "messaging.discordHelp.secret_storage_unavailable",
    relay_unavailable: "messaging.discordHelp.relay_unavailable",
    not_linked: "messaging.discordHelp.not_linked",
  },
};

const SLACK_TEXT = {
  title: "connector.slack.title",
  description: "connector.slack.description",
  statusConnected: "connector.slack.statusConnected",
  statusAttention: "connector.slack.statusAttention",
  summaryConnected: "connector.slack.summaryConnected",
  summaryNoAgent: "connector.slack.summaryNoAgent",
  attentionTitle: "connector.slack.attentionTitle",
  attentionDescription: "connector.slack.attentionDescription",
  connect: "connector.slack.connect",
  addAgent: "connector.slack.addAgent",
  workspaceTitle: "connector.slack.workspaceTitle",
  workspaceDescription: "connector.slack.workspaceDescription",
  disconnect: "connector.slack.disconnectWorkspace",
  missingScopes: "connector.slack.missingScopes",
  retryAt: "connector.slack.retryAt",
  reconnect: "connector.slack.reconnect",
  pause: "connector.slack.pause",
  resume: "connector.slack.resume",
  rowAction: "connector.slack.rowAction",
  orchestratorTitle: "connector.slack.orchestratorTitle",
  orchestratorDescription: "connector.slack.orchestratorDescription",
  orchestratorNone: "connector.slack.orchestratorNone",
  orchestratorNoneDescription: "connector.slack.orchestratorNoneDescription",
  note: "connector.slack.inviteNote",
  stepWorkspace: "connector.slack.stepWorkspace",
  stepAgent: "connector.slack.stepAgent",
  connectTitle: "connector.slack.connectTitle",
  connectDescription: "connector.slack.connectDescription",
  connectStepBrowser: "connector.slack.connectStepBrowser",
  connectStepAllow: "connector.slack.connectStepAllow",
  connectStepReturn: "connector.slack.connectStepReturn",
  connectInApp: "connector.slack.connectInSlack",
  connectWaiting: "connector.slack.connectWaiting",
  agentStepTitle: "connector.slack.agentStepTitle",
  agentStepDescription: "connector.slack.agentStepDescription",
  orchestratorName: "connector.slack.orchestratorName",
  orchestratorRole: "connector.slack.orchestratorRole",
  orchestratorDoesReceive: "connector.slack.orchestratorDoesReceive",
  orchestratorDoesDelegate: "connector.slack.orchestratorDoesDelegate",
  orchestratorDoesAnswer: "connector.slack.orchestratorDoesAnswer",
  orchestratorModel: "connector.slack.orchestratorModel",
  doneTitle: "connector.slack.doneTitle",
  doneDescription: "connector.slack.doneDescription",
  done: "connector.slack.done",
  disconnectTitle: "connector.slack.disconnectTitle",
  disconnectDescription: "connector.slack.disconnectDescription",
  disconnectDescriptionHost: "connector.slack.disconnectDescriptionHost",
  disconnectEffect: "connector.slack.disconnectEffect",
  removeEffectKept: "connector.slack.removeEffectKept",
  removeEffectDeleted: "connector.slack.removeEffectDeleted",
  keep: "connector.slack.keep",
  close: "connector.slack.close",
  addWorkspace: "connector.slack.addWorkspace",
  limitReached: "connector.slack.limitReached",
  summaryMany: "connector.slack.summaryMany",
  disconnectAllTitle: "connector.slack.disconnectAllTitle",
  disconnectAllSummary: "connector.slack.disconnectAllSummary",
  disconnectAllSummaryOrchestrator: "connector.slack.disconnectAllSummaryOrchestrator",
} as const satisfies ChannelText & Record<string, keyof AppMessages>;

const DISCORD_TEXT = {
  title: "connector.discord.title",
  description: "connector.discord.description",
  statusConnected: "connector.discord.statusConnected",
  statusAttention: "connector.discord.statusAttention",
  summaryConnected: "connector.discord.summaryConnected",
  summaryNoAgent: "connector.discord.summaryNoAgent",
  attentionTitle: "connector.discord.attentionTitle",
  attentionDescription: "connector.discord.attentionDescription",
  connect: "connector.discord.connect",
  addAgent: "connector.discord.addAgent",
  workspaceTitle: "connector.discord.workspaceTitle",
  workspaceDescription: "connector.discord.workspaceDescription",
  disconnect: "connector.discord.disconnectWorkspace",
  missingScopes: "connector.discord.missingScopes",
  retryAt: "connector.discord.retryAt",
  reconnect: "connector.discord.reconnect",
  pause: "connector.discord.pause",
  resume: "connector.discord.resume",
  rowAction: "connector.discord.rowAction",
  orchestratorTitle: "connector.discord.orchestratorTitle",
  orchestratorDescription: "connector.discord.orchestratorDescription",
  orchestratorNone: "connector.discord.orchestratorNone",
  orchestratorNoneDescription: "connector.discord.orchestratorNoneDescription",
  note: "connector.discord.channelsNote",
  stepWorkspace: "connector.discord.stepWorkspace",
  stepAgent: "connector.discord.stepAgent",
  connectTitle: "connector.discord.connectTitle",
  connectDescription: "connector.discord.connectDescription",
  connectStepBrowser: "connector.discord.connectStepBrowser",
  connectStepAllow: "connector.discord.connectStepAllow",
  connectStepReturn: "connector.discord.connectStepReturn",
  connectInApp: "connector.discord.connectInDiscord",
  connectWaiting: "connector.discord.connectWaiting",
  agentStepTitle: "connector.discord.agentStepTitle",
  agentStepDescription: "connector.discord.agentStepDescription",
  orchestratorName: "connector.discord.orchestratorName",
  orchestratorRole: "connector.discord.orchestratorRole",
  orchestratorDoesReceive: "connector.discord.orchestratorDoesReceive",
  orchestratorDoesDelegate: "connector.discord.orchestratorDoesDelegate",
  orchestratorDoesAnswer: "connector.discord.orchestratorDoesAnswer",
  orchestratorModel: "connector.discord.orchestratorModel",
  doneTitle: "connector.discord.doneTitle",
  doneDescription: "connector.discord.doneDescription",
  done: "connector.discord.done",
  disconnectTitle: "connector.discord.disconnectTitle",
  disconnectDescription: "connector.discord.disconnectDescription",
  disconnectDescriptionHost: "connector.discord.disconnectDescriptionHost",
  disconnectEffect: "connector.discord.disconnectEffect",
  removeEffectKept: "connector.discord.removeEffectKept",
  removeEffectDeleted: "connector.discord.removeEffectDeleted",
  keep: "connector.discord.keep",
  close: "connector.discord.close",
  addWorkspace: "connector.discord.addWorkspace",
  limitReached: "connector.discord.limitReached",
  summaryMany: "connector.discord.summaryMany",
  disconnectAllTitle: "connector.discord.disconnectAllTitle",
  disconnectAllSummary: "connector.discord.disconnectAllSummary",
  disconnectAllSummaryOrchestrator: "connector.discord.disconnectAllSummaryOrchestrator",
} as const satisfies Record<keyof typeof SLACK_TEXT, keyof AppMessages>;

export function messagingPlatformText(platform: WorkspacePlatform = "slack") {
  return platform === "discord" ? DISCORD_TEXT : SLACK_TEXT;
}

const ORCHESTRATOR_AVATAR = {
  slack: SLACK_ORCHESTRATOR_AVATAR,
  discord: DISCORD_ORCHESTRATOR_AVATAR,
} as const satisfies Record<WorkspacePlatform, ChannelAvatar>;

export function MessagingMark(props: { platform?: WorkspacePlatform | undefined }) {
  return (
    <Show when={props.platform === "discord"} fallback={<SlackTile />}>
      <DiscordTile />
    </Show>
  );
}

export function slackOrchestrator<Agent extends { id: string }>(
  connection: MessagingConnection,
  agents: readonly Agent[],
): Agent | null {
  return agents.find((agent) => agent.id === connection.orchestratorAgentId) ?? null;
}

export function messagingStateUnknown(props: {
  connections: readonly MessagingConnection[];
  loadError?: string | null | undefined;
}): boolean {
  return Boolean(props.loadError) && props.connections.length === 0;
}

export function slackIntegrationState(
  connections: readonly MessagingConnection[],
  agents: readonly { id: string }[],
  platform: WorkspacePlatform = "slack",
  loadError?: string | null,
): ChannelState {
  if (messagingStateUnknown({ connections, loadError })) return { ...UNKNOWN_STATUS, attention: 0 };
  const text = messagingPlatformText(platform);
  const attention = connections.filter(
    (connection) => channelRowKind(connection) === "attention" || !slackOrchestrator(connection, agents),
  ).length;
  if (attention > 0) return { status: "attention", label: text.statusAttention, attention };
  if (connections.length === 0) return { status: "idle", label: "marketplace.app.notConnected", attention };
  return pausedChannelState(connections) ?? { status: "connected", label: text.statusConnected, attention };
}

type DialogTarget = { kind: "new"; before: ReadonlySet<string> } | { kind: "existing"; workspaceId: string };

export function SlackIntegrationPanel(props: SlackIntegrationPanelProps) {
  const { t, format } = useText();
  const [target, setTarget] = createSignal<DialogTarget | null>(null);
  const [disconnecting, setDisconnecting] = createSignal<MessagingConnection | null>(null);
  const [picking, setPicking] = createSignal<MessagingConnection | null>(null);
  const slack = () => (props.platform ?? "slack") === "slack";
  const [choosingRoles, setChoosingRoles] = createSignal<MessagingConnection | null>(null);
  const text = () => messagingPlatformText(props.platform);
  const avatar = () => ORCHESTRATOR_AVATAR[props.platform ?? "slack"];
  const state = () => slackIntegrationState(props.connections, props.agents, props.platform, props.loadError);
  const access = () => (props.platform === "discord" ? props.access : undefined);
  const needsAgent = () => props.connections.find((connection) => !slackOrchestrator(connection, props.agents)) ?? null;
  const atLimit = () => props.connections.length >= MESSAGING_LIMITS.connections;
  const openNew = () =>
    setTarget({ kind: "new", before: new Set(props.connections.map((connection) => connection.workspaceId)) });
  const openAddAgent = () => {
    const connection = needsAgent();
    if (connection) setTarget({ kind: "existing", workspaceId: connection.workspaceId });
  };
  const dialogConnection = () => {
    const current = target();
    if (!current) return null;
    const found =
      current.kind === "existing"
        ? props.connections.find((connection) => connection.workspaceId === current.workspaceId)
        : props.connections.find((connection) => !current.before.has(connection.workspaceId));
    return found ?? null;
  };
  const orchestrators = () => [
    ...new Map(
      props.connections.flatMap((connection) => {
        const agent = slackOrchestrator(connection, props.agents);
        return agent ? [[agent.id, agent] as const] : [];
      }),
    ).values(),
  ];
  const disconnectDeletesOrchestrator = () => {
    const connection = disconnecting();
    const agent = connection ? slackOrchestrator(connection, props.agents) : null;
    return (
      agent !== null &&
      !props.connections.some(
        (other) => other.workspaceId !== connection?.workspaceId && other.orchestratorAgentId === agent.id,
      )
    );
  };
  const disconnectAllSummary = () =>
    t(orchestrators().length > 0 ? text().disconnectAllSummaryOrchestrator : text().disconnectAllSummary);
  const note = (connection: MessagingConnection) => {
    // The saved access cannot be decrypted here: only Disconnect, then a new connect, helps.
    if (slack() && connection.credentials === "unreadable") return t("connector.slack.accessUnreadable");
    if (connection.missingScopes.length > 0)
      return t(text().missingScopes, { scopes: format.list(connection.missingScopes) });
    if (connection.retryAt)
      return t(text().retryAt, {
        time: format.date(new Date(connection.retryAt), { hour: "numeric", minute: "2-digit" }),
      });
    const help = STATE_HELP[props.platform ?? "slack"][connection.state];
    if (help) return t(help);
    if (slack() && connection.userName) return t("connector.slack.connectedAs", { name: connection.userName });
    if (slack() && !connection.userId && channelRowKind(connection) === "live")
      return t("connector.slack.connectAsYou");
    return t(text().workspaceDescription);
  };
  const disconnectingName = () => disconnecting()?.workspaceName ?? "";
  const disconnectDescription = () =>
    props.hostName
      ? t(text().disconnectDescriptionHost, { workspace: disconnectingName(), host: props.hostName })
      : t(text().disconnectDescription, { workspace: disconnectingName() });

  return (
    <ChannelPage
      text={text()}
      logo={<MessagingMark platform={props.platform} />}
      state={state()}
      connections={props.connections}
      unknown={messagingStateUnknown(props)}
      busy={props.busy}
      loadError={props.loadError}
      onRetry={props.onRetry}
      onConnect={openNew}
      headerAction={
        <Show when={orchestrators().length > 0 && needsAgent()}>
          <Button type="button" size="sm" disabled={props.busy} onClick={openAddAgent}>
            {t(text().addAgent)}
          </Button>
        </Show>
      }
      disconnectAllSummary={disconnectAllSummary()}
      onDisconnectAll={props.onDisconnectAll}
      tagline={props.tagline}
      intro={props.intro}
      details={props.details}
      sections={
        <>
          <SettingsSection
            title={t(text().workspaceTitle)}
            actions={
              <Button type="button" size="sm" variant="outline" disabled={props.busy || atLimit()} onClick={openNew}>
                {t(text().addWorkspace)}
              </Button>
            }
          >
            <ItemGroup class="settings-modal-card">
              <For each={props.connections}>
                {(connection) => (
                  <ChannelConnectionRow
                    text={text()}
                    logo={<MessagingMark platform={props.platform} />}
                    connection={connection}
                    note={note(connection)}
                    busy={props.busy}
                    onReconnect={() => props.onReconnect(connection.workspaceId)}
                    onSetEnabled={(enabled) => props.onSetEnabled(connection.workspaceId, enabled)}
                    onDisconnect={() => setDisconnecting(connection)}
                  />
                )}
              </For>
              <Show when={slack()}>
                <For each={props.connections}>
                  {(connection) => (
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
                  )}
                </For>
              </Show>
              <Show when={atLimit()}>
                <Text class="integration-card-note" variant="caption" tone="muted">
                  {t(text().limitReached, { count: MESSAGING_LIMITS.connections })}
                </Text>
              </Show>
            </ItemGroup>
          </SettingsSection>

          <ChannelOrchestratorSection
            text={text()}
            avatar={avatar()}
            agents={orchestrators()}
            busy={props.busy}
            onAddAgent={openAddAgent}
          />

          {/* Sends go out as the person or as the app; the person limits both. */}
          <Show when={slack() && props.onSetSendGuards}>
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
          <Show when={slack() && props.onListChannels && props.onSetWatchedChannels}>
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

          <Show when={access()}>
            {(control) => (
              <SettingsSection
                title={t("connector.discord.accessTitle")}
                description={t("connector.discord.accessDescription")}
              >
                <ItemGroup class="settings-modal-card">
                  <For each={props.connections}>
                    {(connection) => (
                      <AccessRow
                        connection={connection}
                        access={control()}
                        hostName={props.hostName}
                        busy={props.busy}
                        onChoose={() => setChoosingRoles(connection)}
                      />
                    )}
                  </For>
                </ItemGroup>
              </SettingsSection>
            )}
          </Show>
        </>
      }
    >
      <SlackConnectDialog
        platform={props.platform}
        open={target() !== null}
        connection={dialogConnection()}
        agents={props.agents}
        busy={props.busy}
        models={props.models}
        onConnectWorkspace={props.onConnectWorkspace}
        onAddOrchestrator={props.onAddOrchestrator}
        onClose={() => setTarget(null)}
      />
      <Show when={access()}>
        {(control) => (
          <RolesDialog
            connection={choosingRoles()}
            access={control()}
            busy={props.busy}
            onClose={() => setChoosingRoles(null)}
          />
        )}
      </Show>
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
      <ChannelDisconnectDialog
        text={text()}
        logo={<MessagingMark platform={props.platform} />}
        connection={disconnecting()}
        title={t(text().disconnectTitle, { workspace: disconnectingName() })}
        description={disconnectDescription()}
        effect={t(text().disconnectEffect, { workspace: disconnectingName() })}
        deletesOrchestrator={disconnectDeletesOrchestrator()}
        onConfirm={(workspaceId) => {
          setDisconnecting(null);
          props.onDisconnectWorkspace(workspaceId);
        }}
        onClose={() => setDisconnecting(null)}
      />
    </ChannelPage>
  );
}

function AccessRow(props: {
  connection: MessagingConnection;
  access: DiscordAccessControl;
  hostName?: string | undefined;
  busy: boolean;
  onChoose: () => void;
}) {
  const { t, format } = useText();
  const allowed = () => props.access.allowed(props.connection.workspaceId);
  const everyone = () => props.access.unsupported === true || allowed()?.length === 0;
  const summary = () => {
    const roles = allowed();
    if (everyone()) return t("connector.discord.accessEveryone");
    if (roles === null) return t("connector.discord.accessLoading");
    return t("connector.discord.accessRoles", { roles: format.list(roles.map((role) => role.name)) });
  };
  const choose = () => t("connector.discord.accessChoose");
  return (
    <Item class="settings-modal-row">
      <ItemMedia>
        <LogoTile>
          <MessagingMark platform="discord" />
        </LogoTile>
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{props.connection.workspaceName}</ItemTitle>
        <ItemDescription>{summary()}</ItemDescription>
        <Switch>
          <Match when={props.access.unsupported}>
            <ItemDescription>{t("connector.discord.accessHostUpdate", { host: props.hostName ?? "" })}</ItemDescription>
          </Match>
          <Match when={everyone()}>
            <ItemDescription>{t("connector.discord.accessEveryoneDescription")}</ItemDescription>
          </Match>
        </Switch>
      </ItemContent>
      <Show when={!props.access.unsupported}>
        <ItemActions>
          <Show when={allowed() === null}>
            <Spinner size="sm" />
          </Show>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={props.busy || allowed() === null}
            aria-label={t("connector.discord.rowAction", { action: choose(), name: props.connection.workspaceName })}
            onClick={props.onChoose}
          >
            {choose()}
          </Button>
        </ItemActions>
      </Show>
    </Item>
  );
}

function RolesDialog(props: {
  connection: MessagingConnection | null;
  access: DiscordAccessControl;
  busy: boolean;
  onClose: () => void;
}) {
  const { t, errorMessage } = useText();
  const id = createUniqueId();
  const [view, setView] = createStore<{
    status: "loading" | "ready" | "failed";
    roles: MessagingRole[];
    saved: MessagingRole[];
    selected: string[];
    error: string;
  }>({ status: "loading", roles: [], saved: [], selected: [], error: "" });
  let reads = 0;
  const load = (workspaceId: string) => {
    const read = ++reads;
    setView((draft) => {
      draft.status = "loading";
      draft.error = "";
    });
    void props.access.loadRoles(workspaceId).then(
      (roles) => {
        if (read !== reads) return;
        setView((draft) => {
          draft.status = "ready";
          draft.roles = roles.map((role) => ({ ...role }));
        });
      },
      (error: unknown) => {
        if (read !== reads) return;
        setView((draft) => {
          draft.status = "failed";
          draft.error = errorMessage(error, t("connector.discord.accessLoadFailed"));
        });
      },
    );
  };
  createEffect(
    () => props.connection?.workspaceId,
    (workspaceId) => {
      reads += 1;
      if (!workspaceId) return;
      const saved = props.access.allowed(workspaceId) ?? [];
      setView((draft) => {
        draft.roles = [];
        draft.saved = saved.map((role) => ({ ...role }));
        draft.selected = saved.map((role) => role.id);
      });
      load(workspaceId);
    },
  );
  const options = () => [
    ...view.roles.map((role) => ({ role, deleted: false })),
    ...view.saved
      .filter((role) => !view.roles.some((current) => current.id === role.id))
      .map((role) => ({ role, deleted: true })),
  ];
  const atCap = () => view.selected.length >= MESSAGING_LIMITS.allowedRoles;
  const toggle = (roleId: string, checked: boolean) =>
    setView((draft) => {
      draft.selected = checked
        ? [...draft.selected.filter((selected) => selected !== roleId), roleId]
        : draft.selected.filter((selected) => selected !== roleId);
    });
  const save = (workspaceId: string) => {
    const roles = options()
      .map((option) => option.role)
      .filter((role) => view.selected.includes(role.id))
      .map((role) => ({ id: role.id, name: role.name }));
    props.onClose();
    props.access.onSave(workspaceId, roles);
  };
  return (
    <WizardDialog
      open={props.connection !== null}
      closeLabel={t("connector.discord.close")}
      onClose={props.onClose}
      logo={<DiscordTile />}
      link="connected"
      title={t("connector.discord.accessDialogTitle", { workspace: props.connection?.workspaceName ?? "" })}
      description={t("connector.discord.accessDialogDescription")}
      footer={
        <>
          <Button type="button" size="sm" variant="ghost" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          <Show when={props.connection}>
            {(connection) => (
              <Button
                type="button"
                size="sm"
                disabled={view.status !== "ready" || props.busy}
                onClick={() => save(connection().workspaceId)}
              >
                {t("connector.discord.accessSave")}
              </Button>
            )}
          </Show>
        </>
      }
    >
      <Switch
        fallback={
          <ul class="discord-roles" aria-label={t("connector.discord.accessTitle")}>
            <For each={options()}>
              {(option) => {
                const checked = () => view.selected.includes(option.role.id);
                return (
                  <li>
                    <label class="discord-role-row" for={`${id}-${option.role.id}`}>
                      <Checkbox
                        id={`${id}-${option.role.id}`}
                        checked={checked()}
                        disabled={!checked() && atCap()}
                        onChange={(event) => toggle(option.role.id, event.currentTarget.checked)}
                      />
                      <Text variant="body-sm" class="discord-role-name">
                        {option.deleted
                          ? t("connector.discord.accessRoleDeleted", { role: option.role.name })
                          : option.role.name}
                      </Text>
                    </label>
                  </li>
                );
              }}
            </For>
          </ul>
        }
      >
        <Match when={view.status === "loading"}>
          <div class="channel-waiting" aria-live="polite">
            <Spinner size="sm" />
            <Text variant="caption" tone="muted">
              {t("connector.discord.accessLoading")}
            </Text>
          </div>
        </Match>
        <Match when={view.status === "failed"}>
          <ReadFailedAlert
            message={view.error}
            onRetry={() => {
              const workspaceId = props.connection?.workspaceId;
              if (workspaceId) load(workspaceId);
            }}
          />
        </Match>
        <Match when={options().length === 0}>
          <Text variant="body-sm" tone="muted" role="status">
            {t("connector.discord.accessNoRoles")}
          </Text>
        </Match>
      </Switch>
    </WizardDialog>
  );
}

type ConnectStep = 0 | 1 | 2;

export function SlackConnectDialog(props: {
  platform?: WorkspacePlatform | undefined;
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
  const text = () => messagingPlatformText(props.platform);
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
        return { title: t(text().connectTitle), description: t(text().connectDescription) };
      case 1:
        return {
          title: t(text().agentStepTitle),
          description: t(text().agentStepDescription, { workspace: workspace() }),
        };
      case 2:
        return {
          title: t(text().doneTitle, { workspace: workspace() }),
          description: t(text().doneDescription),
        };
    }
  };
  const steps = () => [t(text().stepWorkspace), t(text().stepAgent)];
  return (
    <WizardDialog
      open={props.open}
      closeLabel={t(text().close)}
      onClose={props.onClose}
      logo={<MessagingMark platform={props.platform} />}
      link={link()}
      title={copy().title}
      description={copy().description}
      stepper={<Stepper steps={steps()} current={step()} label={t(text().connect)} />}
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
              {t(text().connectInApp)}
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
                {t(text().addAgent)}
              </Button>
            )}
          </Match>
          <Match when={step() === 2}>
            <Button type="button" size="sm" onClick={props.onClose}>
              {t(text().done)}
            </Button>
          </Match>
        </Switch>
      }
    >
      <Switch>
        <Match when={step() === 0}>
          <ChannelConnectChecklist text={text()} waiting={waiting()} />
        </Match>
        <Match when={step() === 1}>
          <ChannelOrchestratorStep
            text={text()}
            avatar={ORCHESTRATOR_AVATAR[props.platform ?? "slack"]}
            models={props.models}
            choice={choice()}
            busy={props.busy}
            onChoose={setChoice}
          />
        </Match>
      </Switch>
    </WizardDialog>
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
      logo={<MessagingMark platform="slack" />}
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
    <SettingsSection title={t("connector.slack.sendingTitle")} description={t("connector.slack.sendingDescription")}>
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
          {t("connector.slack.sentInLastHour", { count: guards().sentLastHour })}
        </Text>
      </ItemGroup>
    </SettingsSection>
  );
}
