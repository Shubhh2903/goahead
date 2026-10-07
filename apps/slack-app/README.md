# GoAhead Slack app

Slack CLI projects for the one GoAhead Slack app. A workspace installs it through
`POST /v2/slack/authorize`, and the workspace is linked to the GoAhead server that connected it.
People mention @GoAhead or send it a direct message, and the Slack Orchestrator agent on that server
asks the right agent and answers. No code runs here: each directory holds only the manifest.

| Directory | App | App ID | Home team | Redirect URL |
| --- | --- | --- | --- | --- |
| `production` | `GoAhead` | `A0C5H5C95NH` | `openbotdev` (`T0C5B1XG542`) | `https://api.openbot.run/v2/slack/callback` |
| `development` | `GoAhead (dev)` | `A0C5G5XGS83` | `openbotdev` (`T0C5B1XG542`) | `https://goahead-dev-api.multicodegenius.com/v2/slack/callback` |

`.slack/apps.json` links each directory to its app. Run the Slack CLI from inside a directory.

The production app sends events and button presses to `https://signal.openbot.run/v1/slack/events`. The development app sends them to `https://goahead-dev.multicodegenius.com/v1/slack/events`, the named Cloudflare tunnel that `bun run dev:slack` runs (see `docs/messaging.md`).

## Apply a manifest

The manifest uses only normal bot and user scopes, so Slack does not need to approve anything. Signal must
serve `/v1/slack/events` first: Slack checks the request URL.

```sh
cd apps/slack-app/production
slack manifest validate --app A0C5H5C95NH
slack manifest sync --app A0C5H5C95NH
```

Do the same in `development` with `--app A0C5G5XGS83`. Keep the bot scopes the same as
`SLACK_BOT_SCOPES`, and the user scopes the same as `SLACK_USER_SCOPES`, in
`packages/contracts/src/slack-app.ts`. The user scopes let the server read what the person who
installed the app can see, and reply as them after they approve.

## Manual settings

The manifest cannot set these. Use `slack app settings --app <id>`:

- **Basic Information**: copy the client ID, the client secret and the signing secret.
  - The Worker gets `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`.
  - Signal gets `SLACK_SIGNING_SECRET` as `<app ID>:<signing secret>`, one entry for each app.
  - Use the development app's values for the test Worker and for `bun run dev:slack` only.
- **Basic Information**: set the app icon.
- **Manage Distribution**: turn on distribution. When it is on, any workspace can install the app.
  See `LAUNCH.md` for when to do this.

Do not install the app in its home team from the settings page. Workspaces install it through GoAhead.
