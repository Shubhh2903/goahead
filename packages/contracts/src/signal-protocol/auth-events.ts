export type RemoteAuthEvent =
  | { type: "remote-auth-changed"; hostId: string; authEpoch: number }
  | { type: "remote-session-ended"; hostId: string; sessionId: string }
  | { type: "account-servers-changed"; userId: string }
  | { type: "account-profile-changed"; userId: string }
  | { type: "slack-route-revoked"; appId: string; teamId: string; through: number }
  // One person's route in a Slack workspace was removed or moved to another host. Signal drops that
  // person's route when its link is from `through` (milliseconds) or before, and refuses route
  // tickets with such a link. The workspace's default route does not change.
  | { type: "slack-person-route-revoked"; appId: string; teamId: string; userId: string; through: number }
  | { type: "telegram-route-revoked"; botId: string; chatId: string; through: number }
  | { type: "discord-route-revoked"; guildId: string; through: number }
  | { type: "webhook-route-revoked"; routeId: string; through: number };
