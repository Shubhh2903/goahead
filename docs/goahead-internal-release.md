# GoAhead internal release

This guide sets up the company's own GoAhead servers on `multicodegenius.com` and makes the first
signed macOS release. GoAhead is for internal company use. The build identity and the server
addresses come from `packages/contracts/src/product-identity.ts`.

**[Human]** marks a step that a person does outside the repository: in a web console, on a server,
or with an account that only the company has. No agent or CI job does these steps.

| Part | Address | Runs on |
| --- | --- | --- |
| Account service | `https://goahead-api.multicodegenius.com` | Cloudflare Worker + D1 + R2 (`env.goahead` in `apps/auth-api/wrangler.jsonc`) |
| Website (links) | `https://goahead.multicodegenius.com` | The same Worker |
| Signal | `goahead-signal.multicodegenius.com` | Docker Compose on a Linux server (`remote/compose.yaml`) |
| TURN | `goahead-turn.multicodegenius.com` | coturn, on the same server |
| Slack app | `A0C860EFP6C` | `apps/slack-app/internal/manifest.json` |

## 1. DNS **[Human]**

The `multicodegenius.com` zone is on Cloudflare.

- `goahead-api` and `goahead`: no record is needed. The Worker deploy makes both custom domains.
- `goahead-signal` on **Render** (chosen, section 4b): the `CNAME` that Render shows for the custom
  domain, in **DNS only** mode. (On Cloud Run, section 4a, the record that domain mapping shows.)
- Only with a Linux server (section 4): `goahead-signal` and `goahead-turn` as `A` records to the
  server's static public IPv4 address, in **DNS only** mode. Do not turn on the Cloudflare proxy.
- A Cloudflare API token with DNS edit access to the zone, for the Signal certificates
  (`CLOUDFLARE_DNS_API_TOKEN`).

## 2. Keys and secrets

Make the ticket key pair with the command in
[Self-hosted remote access, step 1](self-hosting.md#1-make-the-keys). Use the key ID
`goahead-remote-1`, the same value as `REMOTE_TICKET_KEY_ID` in `env.goahead`.

Make a second ES256 key pair the same way for Slack route tickets, with the key ID
`goahead-slack-route-1`. Add its public key to `REMOTE_TICKET_PUBLIC_JWKS`, next to the ticket key:
Signal checks route tickets with the same key set.

Make each other secret with `openssl rand -base64 48`.

| Secret | Where |
| --- | --- |
| `REMOTE_TICKET_PRIVATE_JWK`, `REMOTE_TICKET_PUBLIC_JWKS` | Worker |
| `REMOTE_AUTH_WEBHOOK_SECRET` | Worker and Signal. Use the same value on both. |
| `SKILLS_ADMIN_TOKEN`, `SITE_REPORT_HASH_SECRET` | Worker |
| `EMAIL_SMTP_PASSWORD` | Worker. Sign-in sends a one-time code by email. |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | Worker. From the Slack app `A0C860EFP6C` > Basic Information. |
| `SLACK_STATE_SECRET` | Worker. At least 32 bytes. |
| `SLACK_ROUTE_PRIVATE_JWK`, `SLACK_ROUTE_KEY_ID` | Worker. The Slack route key pair. |
| `REMOTE_SESSION_SECRET`, `TURN_SHARED_SECRET`, `REMOTE_METRICS_TOKEN` | Signal |
| `SLACK_SIGNING_SECRET` | Signal, as `A0C860EFP6C:<signing secret>`. From the Slack app > Basic Information. |
| `SLACK_APP_TOKEN` | Signal, as `A0C860EFP6C:<xapp-…>`. An app-level token with the `authorizations:read` scope; see [section 5](#5-slack-app-human). Signal uses it to find which connected people may see a message. |

Keep every private key and secret in a password manager. With the private JWK, a person can open
each host that uses these servers.

## 3. Account service **[Human]**

1. Sign in and make the storage. Copy the D1 database ID that `d1 create` prints.

   ```sh
   bun install --frozen-lockfile
   cd apps/auth-api
   bunx wrangler login
   bunx wrangler d1 create goahead-auth
   bunx wrangler r2 bucket create goahead-avatars
   bunx wrangler r2 bucket create goahead-skills
   bunx wrangler r2 bucket create goahead-sites
   ```

2. In `apps/auth-api/wrangler.jsonc`, `env.goahead`, replace each `REPLACE_` value:
   `database_id`, and the SMTP host, user name and sender address.

3. Put the Worker secrets in `apps/auth-api/.env.goahead`. Git ignores this file.

   ```sh
   EMAIL_SMTP_PASSWORD=...
   SKILLS_ADMIN_TOKEN=...
   SITE_REPORT_HASH_SECRET=...
   REMOTE_TICKET_PRIVATE_JWK='{"kty":"EC",...}'
   REMOTE_TICKET_PUBLIC_JWKS='{"keys":[...]}'
   REMOTE_AUTH_WEBHOOK_SECRET=...
   SLACK_CLIENT_ID=...
   SLACK_CLIENT_SECRET=...
   SLACK_STATE_SECRET=...
   SLACK_ROUTE_PRIVATE_JWK='{"kty":"EC",...}'
   SLACK_ROUTE_KEY_ID=goahead-slack-route-1
   ```

4. Deploy. The script puts the secrets, applies the D1 migrations **before** it deploys the
   Worker, then builds and deploys:

   ```sh
   bunx dotenvx run -f .env.goahead -- bun ../../scripts/deploy-auth-api.ts --env goahead
   ```

5. Check. Each command must return `200`:

   ```sh
   curl -fsS https://goahead-api.multicodegenius.com/health/live
   curl -fsS https://goahead-api.multicodegenius.com/.well-known/jwks.json
   ```

For each later Worker change, run step 4 again. D1 migrations must stay backward compatible with
the Worker that runs during the deploy (`apps/auth-api/AGENTS.md`).

## 4b. Signal on Render, free plan (chosen) **[Human]**

The cheapest option. `render.yaml` at the repository root describes the service.

**Limits to know:**

- A free service sleeps after 15 minutes without an incoming HTTP request or WebSocket message, and
  waking takes up to a minute. A monitor calls `/health/live` every 10 minutes (step 5) to keep it
  awake. The desktops also ping Signal every 30 seconds, but those are protocol pings, and it is not
  confirmed that Render counts them.
- The workspace gets 750 free instance hours a month. Signal alone uses about 744, so keep it the
  only free service in that Render workspace.
- Render can restart a free instance. Signal then forgets its routes until the desktops reconnect,
  which they do by themselves. A Slack event in that gap gets no answer, and Slack sends it again.
- No UDP, so no TURN (as on Cloud Run): Slack features work; remote desktop between strict networks
  can fail.

**Steps:**

1. Render dashboard > New > Blueprint, and select this repository (Render needs read access to it).
   Render reads `render.yaml`.
2. Set the five secrets that the file marks `sync: false`: `REMOTE_SESSION_SECRET`,
   `REMOTE_AUTH_WEBHOOK_SECRET` (the same value as the Worker's), `TURN_SHARED_SECRET` (any strong
   value; unused without TURN), `REMOTE_METRICS_TOKEN`, and `SLACK_SIGNING_SECRET` as
   `A0C860EFP6C:<signing secret>`. Also set `SLACK_APP_TOKEN` as `A0C860EFP6C:<xapp-…>`
   (section 5, step 1). If `render.yaml` does not list it, add it as an environment variable in the
   dashboard.
3. Deploy. Check `curl -fsS https://goahead-signal.onrender.com/health/ready` (use the `onrender.com`
   address Render shows).
4. Custom domain: Render > the service > Settings > Custom Domains > `goahead-signal.multicodegenius.com`.
   Add the `CNAME` it shows in Cloudflare, **DNS only**. Wait for the certificate, then check
   `https://goahead-signal.multicodegenius.com/health/ready`.
5. Keep it awake: create a free HTTP monitor (UptimeRobot every 5 minutes, or cron-job.org every 10
   minutes) for `https://goahead-signal.multicodegenius.com/health/live`. It also tells you when
   Signal is down. Do not use a GitHub Actions schedule: in a private repository it uses more than
   the free monthly minutes.

**Not checked yet:** a deploy on Render with this Blueprint, and whether Render's free plan accepts the
custom domain with TLS on this account.

## 4a. Signal on Google Cloud Run (needs one instance always on) **[Human]**

Cloud Run runs the Signal container. It gives the HTTPS certificate and the domain, so there is no
Nginx, no ACME and no Docker Compose.

**Limits to know:**

- Signal keeps its routes and sockets in memory. Run **exactly one instance**: `--min-instances=1
  --max-instances=1`. Never let it scale to zero or to two.
- Cloud Run ends a WebSocket after the request timeout, at most 60 minutes. Set `--timeout=3600`.
  The desktop's Slack ingress reconnects with a new ticket after a close (`src/main/slack-ingress.ts`),
  so this is a short gap, and Slack retries an event that got no answer.
- Cloud Run has no UDP, so there is **no TURN** (coturn). Slack features do not need TURN. Remote
  desktop and team connections between strict networks can fail without it; add a TURN service
  later if the team needs them.
- Cloud Run sends traffic to one port. Signal's main server also answers `/health/live` and
  `/health/ready`, so it takes that port, and the separate health server moves out of the way.

**Steps:**

1. In a Google Cloud project, turn on Cloud Run, Artifact Registry, Cloud Build and Secret Manager.
2. Put each secret in Secret Manager: `REMOTE_SESSION_SECRET`, `REMOTE_AUTH_WEBHOOK_SECRET` (the same
   value as the Worker's), `TURN_SHARED_SECRET` (any strong value; unused without TURN),
   `REMOTE_METRICS_TOKEN`, and `SLACK_SIGNING_SECRET` as `A0C860EFP6C:<signing secret>`.
3. Build the image from the repository root (the Dockerfile copies workspace packages):

   ```sh
   gcloud builds submit --config remote/api/cloudbuild.yaml \
     --substitutions _IMAGE=<region>-docker.pkg.dev/<project>/goahead/signal:<version> .
   ```

4. Deploy:

   ```sh
   gcloud run deploy goahead-signal \
     --image <region>-docker.pkg.dev/<project>/goahead/signal:<version> \
     --region <region> --allow-unauthenticated \
     --min-instances 1 --max-instances 1 --timeout 3600 --concurrency 1000 --cpu-boost --no-cpu-throttling \
     --port 8080 \
     --set-env-vars REMOTE_TLS_DISABLED=true,REMOTE_SIGNAL_PORT=8080,REMOTE_HEALTH_PORT=8081,REMOTE_TRUST_PROXY=true,\
   REMOTE_CONTROL_PLANE_URL=https://goahead-api.multicodegenius.com,\
   REMOTE_TICKET_JWKS_URL=https://goahead-api.multicodegenius.com/.well-known/jwks.json,\
   TURN_HOST=goahead-turn.multicodegenius.com \
   --set-secrets REMOTE_SESSION_SECRET=REMOTE_SESSION_SECRET:latest,REMOTE_AUTH_WEBHOOK_SECRET=REMOTE_AUTH_WEBHOOK_SECRET:latest,\
   TURN_SHARED_SECRET=TURN_SHARED_SECRET:latest,REMOTE_METRICS_TOKEN=REMOTE_METRICS_TOKEN:latest,SLACK_SIGNING_SECRET=SLACK_SIGNING_SECRET:latest
   ```

   `--no-cpu-throttling` keeps the sockets served between requests. `TURN_HOST` is required by the
   configuration even without TURN; no client reaches it.
5. Map the domain: Cloud Run > Manage custom domains > `goahead-signal.multicodegenius.com`. Add the
   DNS record it shows in Cloudflare (DNS only). Wait for the certificate.
6. Check: `curl -fsS https://goahead-signal.multicodegenius.com/health/ready`.

**Not checked yet:** a deploy to Cloud Run with this exact command. Confirm that `/health/ready` on
port 8080 answers before the domain mapping, and that one desktop keeps its Slack ingress connected
across a 60-minute cut.

## 4. Signal and TURN on a Linux server (alternative) **[Human]**

The server needs Linux with Docker Engine and Docker Compose, a static public IPv4 address, and these
open ports: TCP 443, TCP/UDP 3478, TCP 5349 and UDP 49152-65535.

1. Clone the repository on the server. Copy `remote/.env.example` to `remote/.env.goahead` (Git
   ignores it) and set:

   - `SIGNAL_DOMAIN=goahead-signal.multicodegenius.com`
   - `TURN_DOMAIN=goahead-turn.multicodegenius.com`
   - `TURN_PUBLIC_IP=<the server's public IPv4 address>`
   - `ACME_EMAIL=<an address for certificate notices>`
   - `CLOUDFLARE_DNS_API_TOKEN=<the DNS token from section 1>`
   - `REMOTE_TICKET_JWKS_URL=https://goahead-api.multicodegenius.com/.well-known/jwks.json`
   - `REMOTE_CONTROL_PLANE_URL=https://goahead-api.multicodegenius.com`
   - `REMOTE_AUTH_WEBHOOK_SECRET`, `REMOTE_SESSION_SECRET`, `TURN_SHARED_SECRET`,
     `REMOTE_METRICS_TOKEN`, `SLACK_SIGNING_SECRET` from section 2.

2. If Nginx already uses port 443 on the server, also set the reverse proxy values in
   [the Signal production requirements](../remote/README.md#production-requirements). Then install
   `remote/nginx/goahead-signal.multicodegenius.com.conf` (not `signal.openbot.run.conf`) and the
   two `openbot-remote-nginx-reload.*` units.

3. Start the services and check Signal:

   ```sh
   docker compose -f remote/compose.yaml --env-file remote/.env.goahead up -d --build
   curl -fsS https://goahead-signal.multicodegenius.com/health/ready
   ```

## 5. Slack app **[Human]**

Signal must answer first: Slack checks the request URL when you apply the manifest.

1. Make the app-level token for Signal: the app settings > Basic Information > App-Level Tokens >
   Generate Token and Scopes, with the one scope `authorizations:read`. Set it on Signal as
   `SLACK_APP_TOKEN=A0C860EFP6C:<xapp-…>` (on Render: the service > Environment) and deploy Signal
   again. The manifest does not change. Without this token, Signal cannot route message events:
   direct messages to GoAhead get no answer, and no inbox receives messages. Mentions of @GoAhead
   still work.

2. Apply `apps/slack-app/internal/manifest.json` to `A0C860EFP6C`:

   ```sh
   cd apps/slack-app/internal
   slack manifest validate --app A0C860EFP6C
   slack manifest sync --app A0C860EFP6C
   ```

   Or paste the file in the app settings > App Manifest.

3. A Slack app has one request URL. After this step, `bun run dev:slack` no longer reaches this app.
   For development, make a second Slack app from `apps/slack-app/development/manifest.json`.

4. Each person connects the workspace again in GoAhead (Settings > Connectors > Slack), so the new
   servers link the workspace. More than one person in a workspace can connect. Each person after
   the first must give their own Slack access in the install; without it, the connect fails with
   `slack_user_access_required` ("Connect Slack again and allow GoAhead to act as you. Another
   person already connected this workspace.").
   The first person who connects the workspace has the **default** computer: it answers people
   who do not use GoAhead. Its owner can move the default to another connected person with
   "Hand over…".

### Update an existing install to several people per workspace **[Human]**

Do the steps in this order. The old Signal refuses an auth event type that it does not know, and it
reads a route ticket that has only a person route as "this host owns the workspace".

1. D1: apply migration `0026_slack_person_routes` only. It only adds a table; the workspace routes
   stay as they are. The running Worker does not read the new table. In `apps/auth-api`:

   ```sh
   bunx wrangler d1 migrations apply DB --remote --env goahead
   ```

2. Signal: set `SLACK_APP_TOKEN` (step 1 above) and deploy the new Signal.
3. Worker: deploy (section 3, step 4). The script applies the migrations again; it finds none to
   apply.
4. GoAhead: release the new app (section 7). **Each person connects Slack again once** after the
   update, so that their computer receives their own messages. Until a person connects again,
   mentions of @GoAhead and direct messages to GoAhead go to the default computer, but that person's
   inbox does not receive new messages.

### Update an existing install to the Slack client **[Human]**

The Slack client (v0.35.0) needs two more user scopes and four more user events. The three
manifests and `SLACK_USER_SCOPES` (`packages/contracts/src/slack-app.ts`) have them:

- User scopes: `files:write` (attach files) and `reactions:read` (show reactions).
- User events: `reaction_added`, `reaction_removed`, `member_joined_channel` and `channel_left`.

The auth-api Worker builds the Slack authorize URL from `SLACK_USER_SCOPES`
(`apps/auth-api/src/server/slack-app.ts`), so it must be deployed again. Signal and D1 do not
change. Do the steps in this order:

1. Apply the updated manifests, as in step 2 of section 5: `apps/slack-app/internal/manifest.json`
   to `A0C860EFP6C`, and `apps/slack-app/development/manifest.json` to the development app. For the
   production app, see `apps/slack-app/README.md`. Do this first: Slack refuses a `user_scope` that
   the app's manifest does not have.
2. Deploy the auth-api Worker (section 3, step 4). Until then, a new connect asks for the old
   scopes.
3. Release GoAhead v0.35.0 (section 7).
4. **Each person connects Slack again once** (Settings > Connectors > Slack) after installing
   v0.35.0, so that their user token gets the new scopes. Until then, attaching a file fails and
   reactions made in Slack do not reach GoAhead. Edits and deletes made in Slack still reach
   GoAhead: they come as `message_changed` and `message_deleted` in the `message.*` events that the
   token already has. **Not confirmed:** whether `conversations.history` returns reactions without
   `reactions:read`, so whether reactions show in the client before the reconnect. Not tested
   against Slack.

The first start of v0.35.0 runs database migration 29. It copies the messages of the local Slack
inbox into the Slack client cache and keeps the old inbox table.

## 6. Apple Developer **[Human]**

1. In the company's Apple Developer account, make:
   - a **Developer ID Application** certificate, exported as a `.p12` file with a password;
   - a **Developer ID Installer** certificate, exported the same way;
   - an **app-specific password** for the Apple ID that notarizes;
   - note the **Team ID** (10 characters).
2. On the company Apple silicon Mac that builds releases, import both certificates (with their
   private keys) into the login keychain. `security find-identity -v` must list
   "Developer ID Application: … (S29HD2MDR4)" and "Developer ID Installer: … (S29HD2MDR4)".
3. Copy `.env.release.example` to `.env.release` at the repository root (git ignores it) and set
   `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` (`S29HD2MDR4`). No GitHub secret is
   needed: GoAhead has no GitHub Actions workflows.

## 6b. Phone app (GoAhead) **[Human]**

The phone app in `apps/mobile` uses the bundle id `com.multicodegenius.goahead.mobile`, the Apple
team `S29HD2MDR4`, the link scheme `goahead://` and the universal links of
`goahead.multicodegenius.com`. It is a new app, not an update of the OpenBot phone app: install it,
then scan the QR code of the GoAhead desktop once (Settings > Mobile). Settings and the session of
the OpenBot phone app do not move to it.

1. In the Apple Developer account (team `S29HD2MDR4`), Identifiers, make two App IDs:
   - `com.multicodegenius.goahead.mobile` with **Associated Domains**, **App Groups** and **Push
     Notifications**;
   - `com.multicodegenius.goahead.mobile.ExpoWidgetsTarget` (the Live Activity widget) with **App
     Groups** and **Push Notifications**.
2. Make the App Group `group.com.multicodegenius.goahead.mobile` and add it to both App IDs.
3. In App Store Connect, make a new app record for the bundle id
   `com.multicodegenius.goahead.mobile`, and a TestFlight group.
4. In App Store Connect > Users and Access > Integrations, make a team API key with the App Manager
   role. The `beta` lane of `apps/mobile/fastlane/Fastfile` reads `ASC_KEY_ID`, `ASC_ISSUER_ID`,
   `ASC_PRIVATE_KEY` (the full `.p8` text) and `IPA_PATH`.
5. In `apps/mobile`, run `bunx eas-cli@latest init` with the company's Expo account. It makes a new
   EAS project and writes `extra.eas.projectId` and `owner` to `app.json`. The OpenBot EAS project
   values are removed. If you use EAS Update, also run `bunx eas-cli@latest update:configure` to
   write `updates.url`. Commit the changes in `app.json`. Then let EAS make the distribution
   certificate and the provisioning profiles of both targets on the first build.
6. Deploy the account service again (section 3). The `goahead` env serves
   `/.well-known/apple-app-site-association` for `S29HD2MDR4.com.multicodegenius.goahead.mobile`
   (`APPLE_MOBILE_APP_ID` in `apps/auth-api/wrangler.jsonc`), with the paths `/join` and
   `/agents/*`. Check it: `curl https://goahead.multicodegenius.com/.well-known/apple-app-site-association`.
7. Optional, for Live Activity pushes: make an APNs key (`.p8`) in Keys, and put `APNS_PRIVATE_KEY`
   (the PEM text) and `APNS_KEY_ID` in `apps/auth-api/.env.goahead`. `APNS_TEAM_ID` (`S29HD2MDR4`)
   and `APNS_TOPIC` (`com.multicodegenius.goahead.mobile`) are set in the `goahead` env of
   `wrangler.jsonc`. Deploy again. Without the key, the relay stays off.

## 7. Release

Releases are built on the release Mac, for Apple silicon (arm64) only. No GitHub Actions workflow
runs. Intel Macs are not supported from the release after v0.33.0: they get no update offer and must
stay on the last Intel build.

1. Check that `changelog.d/` has the notes of every change (`scripts/check-release-notes.ts`).
2. Run the `release-upgrade-safety` audit (`.agents/skills/release-upgrade-safety/SKILL.md`).
3. Bump the version: `bun run release:minor`. Commit it as `release: prepare vX.Y.Z` on `master`
   and push.
4. Run `bun run release:preflight`. It checks the branch, the version, the notes and the local
   signing and notarization credentials.
5. **[Human]** Tag and push: `git tag -a vX.Y.Z -m "GoAhead vX.Y.Z" && git push origin vX.Y.Z`.
6. **[Human]** Run `bun run release:local`. It builds, signs and notarizes the app and the DMG,
   staples both, verifies them, and publishes the GitHub release as the latest release. Use
   `bun run release:local -- --dry-run` first to check without a build. See
   [Local release](RELEASING.md#local-release).

## 8. Check the release **[Human]**

- [ ] `https://goahead-api.multicodegenius.com/health/live` and
      `https://goahead-signal.multicodegenius.com/health/ready` return `200`.
- [ ] The DMG opens with no Gatekeeper warning: `spctl --assess --type open --context
      context:primary-signature -v GoAhead-*.dmg` says `accepted` and
      `xcrun stapler validate GoAhead-*.dmg` says `The validate action worked!`. `release:local` runs
      the same checks; a release made before this check (v0.31.0) has an unsigned DMG.
- [ ] The app is named GoAhead in the Dock and in the menu bar.
- [ ] Sign-in sends the one-time code from the company's email address.
- [ ] Server settings > General: give this computer a server name and save it **before** connecting
      Slack. Without a name the computer has no host ID, and Slack connect says "GoAhead cannot
      receive Slack events on this computer".
- [ ] Settings > Connectors > Slack connects the workspace, and shows "Connected as @name".
- [ ] A direct message to GoAhead in Slack gets an answer.
- [ ] A second person in the same workspace connects Slack on their own computer. A direct message
      to GoAhead from each person is answered by that person's computer, and a message from a person
      without GoAhead is answered by the default computer.
- [ ] A second computer joins a server with an invitation link.
- [ ] Nothing reaches `openbot.run`: check with a network monitor, such as Little Snitch, for a few
      minutes of use.
