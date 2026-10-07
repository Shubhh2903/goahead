// The OpenBot Slack app: one app for every workspace. `apps/slack-app/*/manifest.json` must list the
// same bot scopes, user scopes and events.

/**
 * What OpenBot asks from a workspace. The Worker requests them in the OAuth install, and the host
 * compares them with what `auth.test` reports, so a missing one shows in the UI.
 */
export const SLACK_BOT_SCOPES = [
  "app_mentions:read",
  "channels:history",
  "channels:join",
  "channels:read",
  "chat:write",
  "files:read",
  "files:write",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "im:write",
  "mpim:history",
  "reactions:write",
  "users:read",
] as const;

/**
 * What OpenBot asks from the person who installs the app, so it can read what they can see and
 * reply as them. The Worker requests them as `user_scope` in the same install, and the host compares
 * them with what `auth.test` reports for the user token.
 */
export const SLACK_USER_SCOPES = [
  "channels:history",
  "channels:read",
  "chat:write",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "im:write",
  "mpim:history",
  "mpim:read",
  "reactions:write",
  "users:read",
] as const;

/** The avatar of the Slack Orchestrator agent that OpenBot adds, so the dialog shows the agent it creates. */
export const SLACK_ORCHESTRATOR_AVATAR = { avatarSeed: "slack-orchestrator", avatarHue: 280 } as const;
