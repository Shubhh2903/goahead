// The Google OAuth client that the built-in Gmail and Google Calendar connection signs in with.
//
// The client type is "Desktop app". Google says that the secret of a Desktop client is not
// confidential, but it still stays out of the repository: `electron.vite.config.ts` writes both
// values into the main bundle at build time, from the shell or from `.env.google` (git ignores it).
// docs/google-connector-setup.md tells how to create the client.

import { registerSecretValue } from "@openbot/logging";

export interface GoogleOAuthClient {
  clientId: string;
  clientSecret: string;
}

export interface GoogleEndpoints {
  authorize: string;
  token: string;
  revoke: string;
  /** Gmail v1 base, without a trailing slash. */
  gmail: string;
  /** Calendar v3 base, without a trailing slash. */
  calendar: string;
}

export const GOOGLE_PRODUCTION_ENDPOINTS: GoogleEndpoints = {
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  gmail: "https://gmail.googleapis.com/gmail/v1",
  calendar: "https://www.googleapis.com/calendar/v3",
};

/**
 * Each expression is replaced by its value at build time (`define` in `electron.vite.config.ts`),
 * so the packaged app does not read the environment for these. A test passes its own values.
 */
const BUILT_CLIENT = {
  clientId: process.env.OPENBOT_GOOGLE_CLIENT_ID,
  clientSecret: process.env.OPENBOT_GOOGLE_CLIENT_SECRET,
};

const CLIENT_ID_PATTERN = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/u;

/** The client of this build, or null: the connection is then not offered. */
export function googleOAuthClient(
  values: { clientId?: string | undefined; clientSecret?: string | undefined } = BUILT_CLIENT,
): GoogleOAuthClient | null {
  const clientId = values.clientId?.trim() ?? "";
  const clientSecret = values.clientSecret?.trim() ?? "";
  if (!CLIENT_ID_PATTERN.test(clientId) || clientSecret.length < 8) return null;
  registerSecretValue(clientSecret);
  return { clientId, clientSecret };
}

/**
 * The production addresses, or, in a development build only, a fake Google on this computer
 * (`OPENBOT_DEV_GOOGLE_API_ORIGIN`, such as `http://127.0.0.1:4567`). Any other origin is ignored.
 */
export function googleEndpoints(developmentOrigin: string | null): GoogleEndpoints {
  if (!developmentOrigin) return GOOGLE_PRODUCTION_ENDPOINTS;
  let origin: URL;
  try {
    origin = new URL(developmentOrigin);
  } catch {
    return GOOGLE_PRODUCTION_ENDPOINTS;
  }
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1") return GOOGLE_PRODUCTION_ENDPOINTS;
  const base = origin.origin;
  return {
    authorize: `${base}/o/oauth2/v2/auth`,
    token: `${base}/token`,
    revoke: `${base}/revoke`,
    gmail: `${base}/gmail/v1`,
    calendar: `${base}/calendar/v3`,
  };
}
