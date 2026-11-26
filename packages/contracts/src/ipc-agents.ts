import { type AgentProviderRef, isAgentProviderRef } from "./agent-providers";
import { INPUT_LIMITS } from "./input-limits";
import { isAgentAdditionalFolders } from "./ipc-agent-folders";
import {
  type AgentModelId,
  type AgentReasoningEffort,
  type AvatarColor,
  type AvatarHue,
  isAgentModel,
  isAvatarColor,
  isAvatarHue,
  isAvatarSeed,
  isReasoningEffort,
} from "./ipc-agent-identity";
import {
  type AgentSessionSettingOverrides,
  isAgentSessionSettingOverrides,
  isAgentSessionSettingResets,
} from "./ipc-agent-session-settings";
import {
  type AgentProviderId,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  isAgentProvider,
  isProviderAccountId,
} from "./ipc-agent-status";
import { isAgentTaskLimit } from "./ipc-agent-tasks";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isBrowserProfileId } from "./ipc-browser-profiles";
import { isHiddenAt } from "./ipc-hidden-agents";
import { type BusyMessageMode, isBusyMessageMode } from "./ipc-queue";
import type { SidebarLayoutSnapshot } from "./ipc-sidebar-layout";
import { type DynamicRecord, isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

export const AGENT_ACCESS_MODES = ["full", "workspace"] as const;
export type AgentAccess = (typeof AGENT_ACCESS_MODES)[number];
export const DEFAULT_AGENT_ACCESS: AgentAccess = "full";

export function isAgentAccess(value: unknown): value is AgentAccess {
  return isOneOf(AGENT_ACCESS_MODES, value);
}

export function agentComputerUseEnabled(agent: { computerUse?: boolean | undefined }): boolean {
  return agent.computerUse !== false;
}

export function agentMemoryEnabled(agent: { memory?: boolean | undefined }): boolean {
  return agent.memory !== false;
}

export const AGENT_DEFAULT_KEYS = ["allowAutomation", "allowNewChat", "quickAcknowledgement"] as const;
export type AgentDefaultKey = (typeof AGENT_DEFAULT_KEYS)[number];
export type AgentDefaults = Record<AgentDefaultKey, boolean> & {
  planStartAfterMs: number | null;
  automationRunsPerHour: number;
  commitCoAuthor: boolean;
};

export const OPENBOT_COMMIT_TRAILER = "Co-authored-by: GoAhead <335604065+openbotgit[bot]@users.noreply.github.com>";

export const DEFAULT_PLAN_START_AFTER_MS = 10_000;
export const MIN_PLAN_START_AFTER_MS = 5_000;
export const MAX_PLAN_START_AFTER_MS = 2_147_483_647;

export const DEFAULT_AUTOMATION_RUNS_PER_HOUR = 30;
export const MIN_AUTOMATION_RUNS_PER_HOUR = 1;
export const MAX_AUTOMATION_RUNS_PER_HOUR = 10_000;

export const DEFAULT_AGENT_DEFAULTS: AgentDefaults = {
  allowAutomation: false,
  allowNewChat: false,
  quickAcknowledgement: false,
  planStartAfterMs: DEFAULT_PLAN_START_AFTER_MS,
  automationRunsPerHour: DEFAULT_AUTOMATION_RUNS_PER_HOUR,
  commitCoAuthor: true,
};

export function isAutomationRunsPerHour(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= MIN_AUTOMATION_RUNS_PER_HOUR &&
    value <= MAX_AUTOMATION_RUNS_PER_HOUR
  );
}

export function isPlanStartAfterMs(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value % 1_000 === 0 &&
      value >= MIN_PLAN_START_AFTER_MS &&
      value <= MAX_PLAN_START_AFTER_MS)
  );
}

export function isAgentDefaults(value: unknown): value is AgentDefaults {
  return (
    isDynamicRecord(value) &&
    AGENT_DEFAULT_KEYS.every((key) => isBoolean(value[key])) &&
    isPlanStartAfterMs(value.planStartAfterMs) &&
    isAutomationRunsPerHour(value.automationRunsPerHour) &&
    isBoolean(value.commitCoAuthor)
  );
}

export function agentAutomationAllowed(
  agent: { allowAutomation?: boolean | undefined },
  defaults: AgentDefaults,
): boolean {
  return agent.allowAutomation ?? defaults.allowAutomation;
}

export function agentNewChatAllowed(agent: { allowNewChat?: boolean | undefined }, defaults: AgentDefaults): boolean {
  return agent.allowNewChat ?? defaults.allowNewChat;
}

export function agentQuickAcknowledgementEnabled(
  agent: { quickAcknowledgement?: boolean | undefined },
  defaults: AgentDefaults,
): boolean {
  return agent.quickAcknowledgement ?? defaults.quickAcknowledgement;
}

/** Whether GoAhead may run a simple turn of this agent on a smaller model. Absent means off. */
export function agentAutoModelEnabled(agent: Pick<AgentSummary, "autoModel">): boolean {
  return agent.autoModel === true;
}

/**
 * Whether a turn whose every message comes from a teammate or a routine runs on the provider's
 * small model when the agent's own model is larger. Absent means on.
 */
export function agentDelegatedSmallModelEnabled(agent: Pick<AgentSummary, "delegatedSmallModel">): boolean {
  return agent.delegatedSmallModel !== false;
}

/**
 * The providers that take a model for one turn on the same session: Claude through `setModel`, and
 * Codex through `turn/start`. For the others the automatic model choice has no effect.
 */
export const AUTO_MODEL_PROVIDERS = ["claude", "codex"] as const satisfies readonly AgentProviderId[];

export function providerSupportsAutoModel(provider: AgentProviderId): boolean {
  return isOneOf(AUTO_MODEL_PROVIDERS, provider);
}

export function workspaceAccessEnforced(agent: { access?: AgentAccess | undefined }): boolean {
  return agent.access === "workspace";
}

export interface AgentModelChoice {
  provider: AgentProviderId;
  model: AgentModelId;
  providerAccountId?: string | undefined;
}

export const AGENT_BACKUP_MODEL_LIMIT = 8;

export interface AgentBackupModels {
  automatic: boolean;
  order: AgentModelChoice[];
}

export function isAgentModelChoice(value: unknown): value is AgentModelChoice {
  return (
    isDynamicRecord(value) &&
    isAgentProvider(value.provider) &&
    isAgentModel(value.model) &&
    (value.providerAccountId === undefined || isProviderAccountId(value.providerAccountId))
  );
}

export interface AgentUsageLimitReturn extends AgentModelChoice {
  reasoningEffort: AgentReasoningEffort;
  cause?: string | undefined;
  fastMode?: boolean | undefined;
  ultrafast?: boolean | undefined;
}

export function isAgentUsageLimitReturn(value: unknown): value is AgentUsageLimitReturn {
  return (
    isDynamicRecord(value) &&
    isAgentModelChoice(value) &&
    isReasoningEffort(value.reasoningEffort) &&
    (value.cause === undefined || isString(value.cause)) &&
    (value.fastMode === undefined || isBoolean(value.fastMode)) &&
    (value.ultrafast === undefined || isBoolean(value.ultrafast))
  );
}

export interface AgentPendingRuntime extends AgentModelChoice {
  reasoningEffort: AgentReasoningEffort;
}

export function isAgentPendingRuntime(value: unknown): value is AgentPendingRuntime {
  return isDynamicRecord(value) && isAgentModelChoice(value) && isReasoningEffort(value.reasoningEffort);
}

export function agentNextProviderAccountId(agent: {
  providerAccountId?: string | undefined;
  pendingRuntime?: AgentPendingRuntime | undefined;
}): string | undefined {
  return agent.pendingRuntime ? agent.pendingRuntime.providerAccountId : agent.providerAccountId;
}

export function isAgentBackupModels(value: unknown): value is AgentBackupModels {
  return (
    isDynamicRecord(value) &&
    isBoolean(value.automatic) &&
    Array.isArray(value.order) &&
    value.order.length <= AGENT_BACKUP_MODEL_LIMIT &&
    value.order.every(isAgentModelChoice)
  );
}

export function sameAgentModelChoice(left: AgentModelChoice, right: AgentModelChoice): boolean {
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    (left.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID) === (right.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID)
  );
}

export function isAgentMarketplaceSource(value: unknown): value is NonNullable<AgentSummary["marketplaceSource"]> {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.listingId) &&
    isIdentifier(value.versionId) &&
    isNumber(value.version) &&
    Number.isInteger(value.version) &&
    Array.isArray(value.skillIds) &&
    value.skillIds.length <= INPUT_LIMITS.agents &&
    value.skillIds.every(isIdentifier) &&
    Array.isArray(value.routineIds) &&
    value.routineIds.length <= INPUT_LIMITS.agentRoutines &&
    value.routineIds.every(isIdentifier)
  );
}

/**
 * The context windows, in tokens, at which an agent can compact its conversation early. A smaller
 * window makes each model call read less context, and the agent keeps a summary of the rest. Absent
 * means `DEFAULT_COMPACT_WINDOW`. Only Claude reads the setting; Codex always compacts at
 * `DEFAULT_COMPACT_WINDOW`, or earlier on a small model window.
 *
 * The value is local: released Team API adapters project agents through a key list that does not
 * hold it, and an older build's agent loader reads a value it does not know as absent.
 */
export const AGENT_COMPACT_WINDOWS = [80_000, 120_000, 200_000] as const;
export type AgentCompactWindow = (typeof AGENT_COMPACT_WINDOWS)[number];

/** The context size, in tokens, at which an agent compacts when its settings name no window. */
export const DEFAULT_COMPACT_WINDOW = 120_000;

/** The weekly token budgets an agent can have. A budget only alerts; it never stops work. */
export const AGENT_WEEKLY_TOKEN_BUDGETS = [5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000] as const;
export type AgentWeeklyTokenBudget = (typeof AGENT_WEEKLY_TOKEN_BUDGETS)[number];

/**
 * The tool calls one turn may make before the host stops it and asks the person to continue. `0`
 * is Off. Absent means 40. The token limit of a turn is the call limit times 75,000.
 */
export const AGENT_TURN_LIMITS = [40, 100, 200, 0] as const;
export type AgentTurnLimit = (typeof AGENT_TURN_LIMITS)[number];

/** The tool calls a turn may make when the agent has no `turnLimit`. */
export const DEFAULT_TURN_LIMIT = 40 satisfies AgentTurnLimit;

export function isAgentTurnLimit(value: unknown): value is AgentTurnLimit {
  return isOneOf(AGENT_TURN_LIMITS, value);
}

export function isAgentCompactWindow(value: unknown): value is AgentCompactWindow {
  return isOneOf(AGENT_COMPACT_WINDOWS, value);
}

export function isAgentWeeklyTokenBudget(value: unknown): value is AgentWeeklyTokenBudget {
  return isOneOf(AGENT_WEEKLY_TOKEN_BUDGETS, value);
}

/** The MCP server ids an agent does not get, at most one per server the panel can hold. */
export function isDisabledMcpServerIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= INPUT_LIMITS.mcpServers && value.every(isIdentifier);
}

export interface AgentSummary {
  id: string;
  name: string;
  title: string;
  description: string;
  notifications: boolean;
  provider: AgentProviderId;
  model: AgentModelId;
  reasoningEffort: AgentReasoningEffort;
  sessionSettingOverrides?: AgentSessionSettingOverrides;
  sessionSettingResets?: string[];
  access?: AgentAccess;
  additionalFolders?: string[];
  excludedFolders?: string[];
  computerUse?: boolean;
  memory?: boolean;
  allowAutomation?: boolean;
  allowNewChat?: boolean;
  quickAcknowledgement?: boolean;
  ownBrowserSession?: boolean;
  browserProfileId?: string;
  fastMode?: boolean;
  ultrafast?: boolean;
  busyMessageMode?: BusyMessageMode;
  taskLimit?: number;
  providerAccountId?: string;
  backupModels?: AgentBackupModels;
  usageLimitReturn?: AgentUsageLimitReturn;
  pendingRuntime?: AgentPendingRuntime;
  pinnedAccountId?: string;
  hiddenAt?: string;
  /**
   * Folders on this computer that the user picked for this agent to work in. Local-only, like
   * `access`: the Team API agent allowlist does not carry it, so an agent read from a remote host has none.
   */
  projectFolders?: AgentProjectFolder[];
  /** Where Claude compacts the agent's conversation. Local-only, like `access`. Absent means the full window. */
  compactWindow?: AgentCompactWindow;
  /**
   * The MCP servers of the MCP panel that this agent does not get. Local-only, like `access`. Absent
   * means every enabled server, so a server added later reaches every agent, as before the setting.
   */
  disabledMcpServerIds?: string[];
  /** The weekly token budget that alerts the user. Local-only, like `access`. Absent means no budget. */
  weeklyTokenBudget?: AgentWeeklyTokenBudget;
  /** The tool calls a turn may make before it pauses. Local-only, like `access`. Absent means 40. */
  turnLimit?: AgentTurnLimit;
  /**
   * Whether a simple turn may run on the provider's small model. Local-only, like `access`. Absent
   * means off; see `agentAutoModelEnabled`.
   */
  autoModel?: boolean;
  /**
   * Whether a teammate or routine turn may run on the provider's small model. Local-only, like
   * `access`. Absent means on; see `agentDelegatedSmallModelEnabled`.
   */
  delegatedSmallModel?: boolean;
  threadId: string | null;
  workspacePath: string;
  preview: string;
  updatedAt: string | null;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  avatarColor?: AvatarColor | null;
  chatColor?: AvatarColor;
  avatarUrl: string | null;
  marketplaceSource?: {
    listingId: string;
    versionId: string;
    version: number;
    skillIds: string[];
    routineIds: string[];
  };
}

export function isAgentSummary(value: unknown): value is AgentSummary {
  return isDynamicRecord(value) && isAgentProvider(value.provider) && hasAgentSummaryFields(value);
}

export type ClientAgentSummary = Omit<AgentSummary, "provider"> & { provider: AgentProviderRef };

export function isClientAgentSummary(value: unknown): value is ClientAgentSummary {
  return isDynamicRecord(value) && isAgentProviderRef(value.provider) && hasAgentSummaryFields(value);
}

function hasAgentSummaryFields(value: DynamicRecord): boolean {
  return (
    isIdentifier(value.id) &&
    isBoundedString(value.name, INPUT_LIMITS.agentName) &&
    isBoundedString(value.title, INPUT_LIMITS.agentTitle) &&
    isBoundedString(value.description, INPUT_LIMITS.agentDescription) &&
    isBoolean(value.notifications) &&
    isAgentModel(value.model) &&
    isReasoningEffort(value.reasoningEffort) &&
    (value.sessionSettingOverrides === undefined || isAgentSessionSettingOverrides(value.sessionSettingOverrides)) &&
    (value.sessionSettingResets === undefined || isAgentSessionSettingResets(value.sessionSettingResets)) &&
    (value.access === undefined || isAgentAccess(value.access)) &&
    (value.additionalFolders === undefined || isAgentAdditionalFolders(value.additionalFolders)) &&
    (value.excludedFolders === undefined || isAgentAdditionalFolders(value.excludedFolders)) &&
    (value.computerUse === undefined || isBoolean(value.computerUse)) &&
    (value.memory === undefined || isBoolean(value.memory)) &&
    (value.allowAutomation === undefined || isBoolean(value.allowAutomation)) &&
    (value.allowNewChat === undefined || isBoolean(value.allowNewChat)) &&
    (value.quickAcknowledgement === undefined || isBoolean(value.quickAcknowledgement)) &&
    (value.ownBrowserSession === undefined || isBoolean(value.ownBrowserSession)) &&
    (value.browserProfileId === undefined || isBrowserProfileId(value.browserProfileId)) &&
    (value.fastMode === undefined || isBoolean(value.fastMode)) &&
    (value.ultrafast === undefined || isBoolean(value.ultrafast)) &&
    (value.busyMessageMode === undefined || isBusyMessageMode(value.busyMessageMode)) &&
    (value.taskLimit === undefined || isAgentTaskLimit(value.taskLimit)) &&
    (value.providerAccountId === undefined || isProviderAccountId(value.providerAccountId)) &&
    (value.backupModels === undefined || isAgentBackupModels(value.backupModels)) &&
    (value.usageLimitReturn === undefined || isAgentUsageLimitReturn(value.usageLimitReturn)) &&
    (value.pendingRuntime === undefined || isAgentPendingRuntime(value.pendingRuntime)) &&
    (value.pinnedAccountId === undefined || isProviderAccountId(value.pinnedAccountId)) &&
    (value.hiddenAt === undefined || isHiddenAt(value.hiddenAt)) &&
    (value.projectFolders === undefined || isAgentProjectFolderList(value.projectFolders)) &&
    (value.compactWindow === undefined || isAgentCompactWindow(value.compactWindow)) &&
    (value.disabledMcpServerIds === undefined || isDisabledMcpServerIds(value.disabledMcpServerIds)) &&
    (value.weeklyTokenBudget === undefined || isAgentWeeklyTokenBudget(value.weeklyTokenBudget)) &&
    (value.turnLimit === undefined || isAgentTurnLimit(value.turnLimit)) &&
    (value.autoModel === undefined || isBoolean(value.autoModel)) &&
    (value.delegatedSmallModel === undefined || isBoolean(value.delegatedSmallModel)) &&
    (value.threadId === null || isIdentifier(value.threadId)) &&
    isBoundedString(value.workspacePath, INPUT_LIMITS.path) &&
    isBoundedString(value.preview, INPUT_LIMITS.messageText) &&
    (value.updatedAt === null || isBoundedString(value.updatedAt, 160)) &&
    isAvatarSeed(value.avatarSeed) &&
    (value.avatarHue === null || isAvatarHue(value.avatarHue)) &&
    (value.avatarColor === undefined || value.avatarColor === null || isAvatarColor(value.avatarColor)) &&
    (value.chatColor === undefined || isAvatarColor(value.chatColor)) &&
    (value.avatarUrl === null || isBoundedString(value.avatarUrl, INPUT_LIMITS.avatarUrl)) &&
    (value.marketplaceSource === undefined || isAgentMarketplaceSource(value.marketplaceSource))
  );
}

/** One folder the user picked for an agent. `id` stays the same when the folder is renamed. */
export interface AgentProjectFolder {
  id: string;
  name: string;
  path: string;
}

/** A project folder as the settings panel shows it: `missing` is true when the folder no longer exists. */
export interface AgentProjectFolderState extends AgentProjectFolder {
  missing: boolean;
}

export interface RenameAgentProjectFolderInput {
  agentId: string;
  folderId: string;
  name: string;
}

export interface RemoveAgentProjectFolderInput {
  agentId: string;
  folderId: string;
}

/** A trimmed name of 1 to `projectFolderName` characters. */
export function isProjectFolderName(value: unknown): value is string {
  return (
    isString(value) && value.length > 0 && value.length <= INPUT_LIMITS.projectFolderName && value.trim() === value
  );
}

export function isAgentProjectFolder(value: unknown): value is AgentProjectFolder {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isProjectFolderName(value.name) &&
    isBoundedString(value.path, INPUT_LIMITS.path) &&
    value.path.length > 0
  );
}

function isAgentProjectFolderList(value: unknown): value is AgentProjectFolder[] {
  return Array.isArray(value) && value.length <= INPUT_LIMITS.agentProjectFolders && value.every(isAgentProjectFolder);
}

export function isAgentProjectFolderState(value: unknown): value is AgentProjectFolderState {
  return isDynamicRecord(value) && isBoolean(value.missing) && isAgentProjectFolder(value);
}

export interface CreateAgentInput {
  name: string;
  description: string;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  avatarColor?: AvatarColor | null;
  initialMessage: string;
  provider?: AgentProviderId;
  model?: AgentModelId;
  reasoningEffort?: AgentReasoningEffort;
  providerAccountId?: string;
  operationId?: string;
}

export interface UpdateAgentInput {
  agentId: string;
  name?: string;
  title?: string;
  description?: string;
  notifications?: boolean;
  provider?: AgentProviderId;
  model?: AgentModelId;
  reasoningEffort?: AgentReasoningEffort;
  access?: AgentAccess;
  computerUse?: boolean;
  memory?: boolean;
  allowAutomation?: boolean | null;
  allowNewChat?: boolean | null;
  quickAcknowledgement?: boolean | null;
  fastMode?: boolean;
  ultrafast?: boolean;
  busyMessageMode?: BusyMessageMode | null;
  taskLimit?: number | null;
  providerAccountId?: string | null;
  backupModels?: AgentBackupModels | null;
  leaveUsageLimit?: boolean;
  /** `null` returns the agent to the full window. */
  compactWindow?: AgentCompactWindow | null;
  /** The whole list; an empty list gives the agent every server again. */
  disabledMcpServerIds?: string[];
  /** `null` removes the budget. */
  weeklyTokenBudget?: AgentWeeklyTokenBudget | null;
  /** `null` returns the agent to the default limit. */
  turnLimit?: AgentTurnLimit | null;
  /** `false` returns the agent to its own model for every turn. */
  autoModel?: boolean;
  /** `null` returns the agent to the default: on. */
  delegatedSmallModel?: boolean | null;
  avatarSeed?: string;
  avatarHue?: AvatarHue | null;
  avatarColor?: AvatarColor | null;
  chatColor?: AvatarColor | null;
}

export interface DuplicateAgentResult {
  agent: ClientAgentSummary;
  layout: SidebarLayoutSnapshot;
}

export interface AvatarImageInput {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  bytes: Uint8Array;
}

export interface SetAgentAvatarInput {
  agentId: string;
  image: AvatarImageInput | null;
}
