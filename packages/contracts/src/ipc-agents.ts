import { INPUT_LIMITS } from "./input-limits";
import {
  type AgentModelId,
  type AgentReasoningEffort,
  type AvatarHue,
  isAgentModel,
  isAvatarHue,
  isAvatarSeed,
  isReasoningEffort,
} from "./ipc-agent-identity";
import { type AgentProviderId, isAgentProvider } from "./ipc-agent-status";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import type { SidebarLayoutSnapshot } from "./ipc-sidebar-layout";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

/**
 * How far an agent may reach on this computer. `workspace` limits writes to the agent's workspace, the
 * shared folder and the temporary folders; `full` is the unrestricted access every agent had before the setting existed.
 */
export const AGENT_ACCESS_MODES = ["full", "workspace"] as const;
export type AgentAccess = (typeof AGENT_ACCESS_MODES)[number];
export const DEFAULT_AGENT_ACCESS: AgentAccess = "full";

export function isAgentAccess(value: unknown): value is AgentAccess {
  return isOneOf(AGENT_ACCESS_MODES, value);
}

/** Whether the agent may use Computer Use. Absent means on, as for every agent before the setting existed. */
export function agentComputerUseEnabled(agent: Pick<AgentSummary, "computerUse">): boolean {
  return agent.computerUse !== false;
}

export function agentAutomationAllowed(agent: Pick<AgentSummary, "allowAutomation">): boolean {
  return agent.allowAutomation === true;
}

/**
 * Whether this agent runs inside the workspace sandbox now. Every provider enforces it. Codex runs the
 * agent in its `workspace-write` sandbox. Claude runs Bash in its sandbox and asks before a file edit
 * outside the roots. Grok and OpenCode run the agent in a provider process of its own, inside an
 * operating system sandbox (`process-confinement.ts`); on Linux and Windows that process does not start.
 */
export function workspaceAccessEnforced(agent: Pick<AgentSummary, "access">): boolean {
  return agent.access === "workspace";
}

function isMarketplaceSource(value: unknown): value is NonNullable<AgentSummary["marketplaceSource"]> {
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

export interface AgentSummary {
  id: string;
  name: string;
  title: string;
  description: string;
  notifications: boolean;
  provider: AgentProviderId;
  model: AgentModelId;
  reasoningEffort: AgentReasoningEffort;
  /**
   * Local-only, like Auto approve: the Team API does not carry it, so an agent read from a remote host
   * has none. Absent means `DEFAULT_AGENT_ACCESS`.
   */
  access?: AgentAccess;
  /**
   * Whether the agent gets the Computer Use tools. Local-only, like `access`. Absent means on; see
   * `agentComputerUseEnabled`.
   */
  computerUse?: boolean;
  /**
   * Whether a local script can run this agent's routines through the automation server. Local-only,
   * like `access`. Absent means off; see `agentAutomationAllowed`.
   */
  allowAutomation?: boolean;
  /**
   * Folders on this computer that the user picked for this agent to work in. Local-only, like
   * `access`: the Team API agent allowlist does not carry it, so an agent read from a remote host has none.
   */
  projectFolders?: AgentProjectFolder[];
  threadId: string | null;
  workspacePath: string;
  preview: string;
  updatedAt: string | null;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
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
  if (!isDynamicRecord(value)) return false;
  return (
    isIdentifier(value.id) &&
    isBoundedString(value.name, INPUT_LIMITS.agentName) &&
    isBoundedString(value.title, INPUT_LIMITS.agentTitle) &&
    isBoundedString(value.description, INPUT_LIMITS.agentDescription) &&
    isBoolean(value.notifications) &&
    isAgentProvider(value.provider) &&
    isAgentModel(value.model) &&
    isReasoningEffort(value.reasoningEffort) &&
    (value.access === undefined || isAgentAccess(value.access)) &&
    (value.computerUse === undefined || isBoolean(value.computerUse)) &&
    (value.allowAutomation === undefined || isBoolean(value.allowAutomation)) &&
    (value.projectFolders === undefined || isAgentProjectFolderList(value.projectFolders)) &&
    (value.threadId === null || isIdentifier(value.threadId)) &&
    isBoundedString(value.workspacePath, INPUT_LIMITS.path) &&
    isBoundedString(value.preview, INPUT_LIMITS.messageText) &&
    (value.updatedAt === null || isBoundedString(value.updatedAt, 160)) &&
    isAvatarSeed(value.avatarSeed) &&
    (value.avatarHue === null || isAvatarHue(value.avatarHue)) &&
    (value.avatarUrl === null || isBoundedString(value.avatarUrl, INPUT_LIMITS.avatarUrl)) &&
    (value.marketplaceSource === undefined || isMarketplaceSource(value.marketplaceSource))
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
  initialMessage: string;
  /**
   * The provider and model the agent starts on, applied before the initial message is queued.
   * Absent, the backend picks its starting default. A provider change after the first message is
   * queued is rejected while work is active, so naming them here is the only way a chosen pair
   * survives creation.
   */
  provider?: AgentProviderId;
  model?: AgentModelId;
  reasoningEffort?: AgentReasoningEffort;
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
  allowAutomation?: boolean;
  avatarSeed?: string;
  avatarHue?: AvatarHue | null;
}

export interface DuplicateAgentResult {
  agent: AgentSummary;
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
