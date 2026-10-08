-- New table only. The Worker that runs before this deploy does not read it.
-- One row for each person who connected their own GoAhead to a Slack workspace. Signal sends that
-- person's requests and private messages to this host. `slack_workspace_routes` keeps the
-- workspace's default host, which answers people without GoAhead.
CREATE TABLE slack_person_routes (
  team_id TEXT NOT NULL,
  slack_user_id TEXT NOT NULL,
  host_id TEXT NOT NULL REFERENCES remote_hosts(host_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connected_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, slack_user_id)
);

CREATE INDEX slack_person_routes_host ON slack_person_routes(host_id);
