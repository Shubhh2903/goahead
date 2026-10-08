// The Slack route: how a Slack request finds the host that answers it.
//
// The OpenBot Slack app has one request URL for every workspace that installs it,
// `https://signal.openbot.run/v1/slack/events`. Signal checks Slack's signature, reads the workspace
// ID (`team_id`) from the body, and passes the request to the `ingress` socket that holds a route
// ticket for that workspace.
//
// The route ticket is an ES256 JWT that `apps/auth-api` mints for a host that proves its machine
// token. It names only the workspaces that the account service links to that host, so a host cannot
// claim another host's workspace. It is signed with its own key, not the ticket key, and it expires:
// the host asks for a new one each time its `ingress` socket connects.

export const SLACK_ROUTE_AUDIENCE = "openbot-slack-route";

export const SLACK_EVENTS_PATH = "/v1/slack/events";

// How long a route ticket stays valid. Signal checks it only when an `ingress` socket connects, and
// the host asks for one just before it connects.
export const SLACK_ROUTE_TTL_SECONDS = 5 * 60;

// The most workspaces one host can link.
export const SLACK_ROUTE_TEAMS_LIMIT = 32;

// The most routed people that one default entry lists.
export const SLACK_ROUTE_ROUTED_USERS_LIMIT = 256;

export interface SlackRouteClaims {
  aud: typeof SLACK_ROUTE_AUDIENCE;
  // The remote host that receives the requests.
  hid: string;
  // The Slack workspaces linked to that host.
  teams: SlackRouteTeam[];
  iat: number;
  exp: number;
}

export interface SlackRouteTeam {
  // The Slack workspace ID.
  id: string;
  // The OpenBot Slack app installed there. Signal routes each app's requests on their own.
  appId: string;
  // When the account service linked the workspace to the host, in milliseconds. Signal keeps a
  // workspace with its newest link, so a host that lost the workspace cannot take it back with an
  // older ticket.
  linkedAt: number;
  // True when this host is the workspace's default computer: it answers people of the workspace
  // without their own route. Absent in tickets made before multi-user Slack, where the host is then
  // the default. Read it with `isDefaultSlackRoute`.
  isDefault?: boolean;
  // The people of this workspace whose requests go to this host. Absent in older tickets.
  users?: SlackRouteUser[];
  // On a default entry: the Slack user IDs of every person in the workspace who has an own route
  // (on any host). Signal sends their requests only to their own host, never to the default. Absent
  // in older tickets.
  routedUsers?: string[];
}

export interface SlackRouteUser {
  // The Slack user ID (`U…` or `W…`).
  id: string;
  // When the account service linked this person to the host, in milliseconds.
  linkedAt: number;
}

// True when the ticket entry makes this host the workspace's default computer. An entry without
// `isDefault` keeps the meaning it had before multi-user Slack: the host owns the workspace route.
export function isDefaultSlackRoute(team: SlackRouteTeam): boolean {
  return team.isDefault !== false;
}

// The `block_id` of a draft's actions block carries the draft owner's Slack user ID, so Signal can
// send a button click to the owner's host. The button value stays the opaque token.
export const SLACK_OWNER_BLOCK_PREFIX = "goahead-owner:";

const SLACK_USER_ID = /^[UW][A-Z0-9]{2,}$/;

export function slackOwnerBlockId(slackUserId: string): string {
  return `${SLACK_OWNER_BLOCK_PREFIX}${slackUserId}`;
}

// The draft owner's Slack user ID, or null when the block ID is not an owner block ID.
export function slackOwnerFromBlockId(blockId: unknown): string | null {
  if (typeof blockId !== "string" || !blockId.startsWith(SLACK_OWNER_BLOCK_PREFIX)) return null;
  const id = blockId.slice(SLACK_OWNER_BLOCK_PREFIX.length);
  return SLACK_USER_ID.test(id) ? id : null;
}
