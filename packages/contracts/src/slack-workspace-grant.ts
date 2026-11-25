import { createHostGrantKeyPair, type HostGrantKind, openHostGrant, sealHostGrant } from "./host-grant";
import { isDynamicRecord, isString } from "./runtime-values";

export { isRawP256PublicKey } from "./host-grant";

export const SLACK_WORKSPACE_GRANT_VERSION = 2;

const KIND: HostGrantKind = { version: SLACK_WORKSPACE_GRANT_VERSION, info: "openbot-slack-workspace-grant-v2" };

/** The token of the person who installed the app, so the host can read and reply as them. */
export interface SlackUserGrant {
  token: string;
  /** The Slack user id of the person. */
  id: string;
}

/**
 * What the GoAhead app's OAuth install gives the host: the bot token for one workspace, and the user
 * token of the person who installed it. `user` is null when the install gave no user token. The
 * sealed form has no `user` key then, which is also what a Worker from before the user token wrote,
 * so a host of any age opens a bot-only grant, and a host from before the user token drops `user`.
 */
export interface SlackWorkspaceGrant {
  botToken: string;
  botUserId: string;
  appId: string;
  workspaceId: string;
  workspaceName: string;
  user: SlackUserGrant | null;
}

export const createSlackWorkspaceKeyPair = createHostGrantKeyPair;

export function sealSlackWorkspaceGrant(
  hostPublicKey: string,
  nonce: string,
  grant: SlackWorkspaceGrant,
): Promise<string> {
  const { user, ...bot } = grant;
  return sealHostGrant(KIND, hostPublicKey, nonce, user ? { ...bot, user } : bot);
}

export function openSlackWorkspaceGrant(
  privateKey: CryptoKey,
  nonce: string,
  payload: string,
): Promise<SlackWorkspaceGrant> {
  return openHostGrant(KIND, privateKey, nonce, payload, decodeSlackWorkspaceGrant);
}

function decodeSlackWorkspaceGrant(grant: unknown): SlackWorkspaceGrant {
  if (
    !isDynamicRecord(grant) ||
    !isString(grant.botToken) ||
    !isString(grant.botUserId) ||
    !isString(grant.appId) ||
    !isString(grant.workspaceId) ||
    !isString(grant.workspaceName) ||
    (grant.user !== undefined && !isUserGrant(grant.user))
  ) {
    throw new Error("The Slack workspace grant is invalid.");
  }
  return {
    botToken: grant.botToken,
    botUserId: grant.botUserId,
    appId: grant.appId,
    workspaceId: grant.workspaceId,
    workspaceName: grant.workspaceName,
    user: grant.user ? { token: grant.user.token, id: grant.user.id } : null,
  };
}

function isUserGrant(value: unknown): value is SlackUserGrant {
  return isDynamicRecord(value) && isString(value.token) && isString(value.id);
}
