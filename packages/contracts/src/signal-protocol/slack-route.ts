export const SLACK_ROUTE_AUDIENCE = "openbot-slack-route";

export const SLACK_EVENTS_PATH = "/v1/slack/events";

export const SLACK_ROUTE_TTL_SECONDS = 5 * 60;

export const SLACK_ROUTE_TEAMS_LIMIT = 32;

// The most routed people that one default entry lists.
export const SLACK_ROUTE_ROUTED_USERS_LIMIT = 256;

export interface SlackRouteClaims {
  aud: typeof SLACK_ROUTE_AUDIENCE;
  hid: string;
  teams: SlackRouteTeam[];
  iat: number;
  exp: number;
}

export interface SlackRouteTeam {
  id: string;
  appId: string;
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
