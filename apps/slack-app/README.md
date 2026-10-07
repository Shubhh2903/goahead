# GoAhead Slack app

Slack CLI projects for the one GoAhead Slack app. A workspace installs it through
`POST /v2/slack/authorize`, and the workspace is linked to the GoAhead server that connected it.
People mention @GoAhead or send it a direct message, and the Slack Orchestrator agent on that server
asks the right agent and answers. No code runs here: each directory holds only the manifest.

| Directory | App | App ID | Home team | Redirect URL |
| --- | --- | --- | --- | --- |
| `production` | `GoAhead` | `A0C5H5C95NH` | `openbotdev` (`T0C5B1XG542`) | `https://api.openbot.run/v2/slack/callback` |
| `development` | `GoAhead (dev)` | `A0C5G5XGS83` | `openbotdev` (`T0C5B1XG542`) | `https://goahead-dev-api.multicodegenius.com/v2/slack/callback` |
| `internal` | `GoAhead` | `A0C860EFP6C` | Multi Code Genius | `https://goahead-api.multicodegenius.com/v2/slack/callback` |

`.slack/apps.json` links each directory to its app. Run the Slack CLI from inside a directory.

The `internal` app is the company's own app on its own servers (see
`docs/goahead-internal-release.md`). It sends events and button presses to
`https://goahead-signal.multicodegenius.com/v1/slack/events`. A Slack app has one request URL: when
`A0C860EFP6C` uses the internal servers, `bun run dev:slack` needs another Slack app for development.
`internal` has no `.slack/apps.json`; give the app with `--app A0C860EFP6C`.

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

## Apply the production manifest

The repository changed the production manifest after it was last applied: user scopes, user events,
and the bot scope `mpim:write`. A person with admin access to `A0C5H5C95NH` applies it. No agent and
no CI job does this step.

1. Check first: `bun run test:desktop -- packages/contracts/src/slack-app.test.ts` passes, and the
   production manifest points at `signal.openbot.run` and `api.openbot.run`, not at the dev tunnel.
2. Make sure that Signal at `https://signal.openbot.run` serves `/v1/slack/events` with this branch's
   user event routing. Slack checks the request URL when you apply.
3. Apply: `cd apps/slack-app/production`, then `slack manifest validate --app A0C5H5C95NH` and
   `slack manifest sync --app A0C5H5C95NH`. Or paste `manifest.json` in the app's settings page >
   App Manifest.
4. Existing installs keep their old tokens. Each workspace must connect again from GoAhead
   (Settings > Connectors > Slack) to get the user scopes, the user events and `mpim:write`.
5. Verify with a release build in a test workspace:
   - Settings > Connectors > Slack shows "Connected as @name" and no missing scope.
   - A direct message to the person shows in the local inbox ("what is new in Slack?" in the direct
     message with GoAhead lists it).
   - A send that the person asks for goes out as them; a send that someone else asks for goes out from
     the GoAhead app after approval.

### Slack review and the Marketplace

Turning on distribution needs no Slack review. But Slack gives apps that are distributed outside the
Marketplace only 1 request per minute, of at most 15 messages, for `conversations.history` and
`conversations.replies` (see `LAUNCH.md`). The local inbox fills from events, so GoAhead works with this
limit; a newly picked channel gets only its newest 15 messages. Marketplace approval removes the limit.
`LAUNCH.md` lists the Marketplace steps and links.

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
