import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier, isNullableBoundedString, isRequestId } from "./ipc-bounded-values";
import { type BrowserSecretRequest, isBrowserSecretRequest } from "./ipc-browser-secret";
import { isBoolean, isDynamicRecord, isOneOf } from "./runtime-values";

export type AgentApprovalKind = "command" | "file-change" | "permissions";

export interface AgentApprovalPermissions {
  fileSystem: {
    read: string[];
    write: string[];
  };
  network: boolean;
}

function isAgentApprovalPermissions(value: unknown): value is AgentApprovalPermissions {
  return (
    isDynamicRecord(value) &&
    isDynamicRecord(value.fileSystem) &&
    isPathList(value.fileSystem.read) &&
    isPathList(value.fileSystem.write) &&
    isBoolean(value.network)
  );
}

function isPathList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= INPUT_LIMITS.agents &&
    value.every((path) => isBoundedString(path, INPUT_LIMITS.path))
  );
}

export interface AgentApproval {
  requestId: string | number;
  agentId: string;
  threadId: string;
  turnId: string;
  kind: AgentApprovalKind;
  command: string | null;
  cwd: string | null;
  reason: string | null;
  grantRoot: string | null;
  permissions: AgentApprovalPermissions | null;
  /**
   * True when this copy does not show the whole request, so no client may allow it from this copy.
   * Only a local-only approval sets it on a full approval (an unreadable or too long mail).
   */
  truncated?: boolean;
}

export function isAgentApproval(value: unknown): value is AgentApproval {
  if (!isDynamicRecord(value)) return false;
  return (
    isRequestId(value.requestId) &&
    isIdentifier(value.agentId) &&
    isIdentifier(value.threadId) &&
    isIdentifier(value.turnId) &&
    isOneOf(["command", "file-change", "permissions"] as const, value.kind) &&
    isNullableBoundedString(value.command, INPUT_LIMITS.messageText) &&
    isNullableBoundedString(value.cwd, INPUT_LIMITS.path) &&
    isNullableBoundedString(value.reason, INPUT_LIMITS.messageText) &&
    isNullableBoundedString(value.grantRoot, INPUT_LIMITS.path) &&
    (value.truncated === undefined || isBoolean(value.truncated)) &&
    (value.permissions === null || isAgentApprovalPermissions(value.permissions))
  );
}

export interface ReadPendingApprovalInput {
  agentId: string;
  requestId: string | number;
}

export interface RespondToApprovalInput {
  requestId: string | number;
  decision: "accept" | "decline";
}

/**
 * An approval that only the person at the computer that runs the agent may see and answer, such as
 * sending a mail. The Team API, the phone and Slack drop it, and only a local answer is accepted.
 */
export const LOCAL_ONLY_APPROVAL_PREFIX = "local-only:";

export function localOnlyApprovalRequestId(key: string): string {
  return `${LOCAL_ONLY_APPROVAL_PREFIX}${key}`;
}

export function isLocalOnlyApprovalRequestId(requestId: string | number): boolean {
  return typeof requestId === "string" && requestId.startsWith(LOCAL_ONLY_APPROVAL_PREFIX);
}

/**
 * Which agents answer approvals without asking, and whether every agent does.
 *
 * This belongs to the computer that runs the agent, not to the approval, and is never carried over
 * the Team API: the released adapters freeze an approval response to `accept` or `decline`. A
 * remote host that has automation on answers its own approvals, so they never reach a client.
 */
export interface ApprovalAutomationPreference {
  defaultAutoApprove: boolean;
  autoApproveOverrides: Record<string, boolean>;
}

export const DEFAULT_APPROVAL_AUTOMATION_PREFERENCE: ApprovalAutomationPreference = {
  defaultAutoApprove: true,
  autoApproveOverrides: {},
};

export function isApprovalAutomationPreference(value: unknown): value is ApprovalAutomationPreference {
  if (!isDynamicRecord(value) || !isBoolean(value.defaultAutoApprove)) return false;
  if (!isDynamicRecord(value.autoApproveOverrides)) return false;
  const entries = Object.entries(value.autoApproveOverrides);
  return (
    entries.length <= INPUT_LIMITS.agents && entries.every(([id, enabled]) => isIdentifier(id) && isBoolean(enabled))
  );
}

export function agentAutoApprovalEnabled(preference: ApprovalAutomationPreference, agentId: string): boolean {
  if (!Object.hasOwn(preference.autoApproveOverrides, agentId)) return preference.defaultAutoApprove;
  return preference.autoApproveOverrides[agentId] === true;
}

export const BROWSER_TAKEOVER_REASONS = ["sign-in-blocked"] as const;
export type BrowserTakeoverReason = (typeof BROWSER_TAKEOVER_REASONS)[number];

export const BROWSER_VAULT_SKIP_REASONS = [
  "agent-script",
  "field-kind",
  "login-choice",
  "no-secret",
  "vault-unreadable",
] as const;
export type BrowserVaultSkipReason = (typeof BROWSER_VAULT_SKIP_REASONS)[number];

export interface BrowserTakeoverRequest {
  requestId: string | number;
  agentId: string;
  threadId: string;
  turnId: string;
  tabId: string;
  secret?: BrowserSecretRequest;
  reason?: BrowserTakeoverReason;
  vaultSkip?: BrowserVaultSkipReason;
}

export function isBrowserTakeoverRequest(value: unknown): value is BrowserTakeoverRequest {
  return (
    isDynamicRecord(value) &&
    isRequestId(value.requestId) &&
    isIdentifier(value.agentId) &&
    isIdentifier(value.threadId) &&
    isIdentifier(value.turnId) &&
    isIdentifier(value.tabId) &&
    (value.secret === undefined || isBrowserSecretRequest(value.secret)) &&
    (value.reason === undefined || isOneOf(BROWSER_TAKEOVER_REASONS, value.reason)) &&
    (value.vaultSkip === undefined || isOneOf(BROWSER_VAULT_SKIP_REASONS, value.vaultSkip))
  );
}

export interface RespondToBrowserTakeoverInput {
  requestId: string | number;
  decision: "complete" | "cancel";
}
