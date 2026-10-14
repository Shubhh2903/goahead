# Google connector setup

The Gmail and Google Calendar connector signs in with a Google OAuth client of type "Desktop app".
This note tells the developer how to make the client and give it to a build. Each step is done once.

## 1. Make the Google Cloud project

1. Open https://console.cloud.google.com/ and make a project, for example `goahead-desktop`.
2. Go to **APIs & Services > Library**. Enable the **Gmail API** and the **Google Calendar API**.

A project that other apps already use has one consent screen for all its clients. Branding, scopes
and test users that you set here apply to those clients too, and the test-user cap is shared. Use a
new project when you can.

## 2. Set the consent screen

1. Go to **Google Auth Platform > Branding** (older consoles: **OAuth consent screen**).
2. User type: **External**. Publishing status: **Testing**.
3. App name `GoAhead`, a support email, and a developer contact email.
4. **Data access > Add or remove scopes**: add these four scopes:
   - `openid`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/calendar.events`
5. **Audience > Test users**: add each Google account that will connect. Personal `@gmail.com`
   accounts are allowed.

Limits of the Testing status:

- Google shows an "unverified app" screen at sign-in. The user clicks **Advanced**, then the link
  at the bottom of the warning to continue to the app (Google may change the wording).
- Google ends each sign-in after 7 days. GoAhead then shows "Sign in again" and sends one macOS
  notification.
- At most 100 test users, for the lifetime of the project. A removed test user still counts. The
  whole project shares this cap.

Google verification and a CASA security assessment remove these limits. They are not done yet.

## 3. Make the Desktop OAuth client

1. Go to **Google Auth Platform > Clients > Create client**.
2. Application type: **Desktop app**. Name: `GoAhead desktop`.
3. Copy the client ID and the client secret.

A Desktop client accepts any `http://127.0.0.1:<port>/<path>` redirect, so the loopback listener of
GoAhead needs no redirect setting.

## 4. Give the client to the build

Copy `.env.google.example` to `.env.google` in the repository root (git ignores it) and set:

```
OPENBOT_GOOGLE_CLIENT_ID=<the client ID>
OPENBOT_GOOGLE_CLIENT_SECRET=<the client secret>
```

A value in the shell wins over the file. `electron.vite.config.ts` writes both values into the main
bundle at build time (`bun run dev` and the release build), so set them on the computer that builds
a release. With no values, the build offers no Google connection. Google says that the secret of a
Desktop client is not confidential; it still stays out of the repository.

## Development only

| Variable | Effect |
| --- | --- |
| `OPENBOT_DEV_GOOGLE_API_ORIGIN` | Sends every Google call to a fake Google on `http://127.0.0.1:<port>`. A packaged build ignores it. |
| `OPENBOT_DEV_GMAIL_WATCH_INTERVAL_MS` | Polls Gmail at this interval (1000 ms or more) instead of every 2 minutes. A packaged build ignores it. |

`bun run smoke:google-connector` sets both, with the fake Google of `src/main/google-test-server.ts`.
It starts the dev app. Run it on the developer's computer, not in CI.
