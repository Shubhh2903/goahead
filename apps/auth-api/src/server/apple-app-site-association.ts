import type { WorkerBindings } from "./types";

export type AppleAppLinkBindings = Pick<WorkerBindings, "APPLE_DESKTOP_APP_ID" | "APPLE_MOBILE_APP_ID">;

interface AppleAppLinkDetail {
  appID: string;
  paths: string[];
}

/** The apps that open this site's links. Each env sets its own app IDs in `wrangler.jsonc`. */
export function createAppleAppSiteAssociation(bindings: AppleAppLinkBindings) {
  const details: AppleAppLinkDetail[] = [];
  const desktopAppId = bindings.APPLE_DESKTOP_APP_ID?.trim();
  if (desktopAppId) details.push({ appID: desktopAppId, paths: ["/join"] });
  const mobileAppId = bindings.APPLE_MOBILE_APP_ID?.trim();
  // The mobile app opens a shared agent's preview; the desktop reads that page in the browser.
  if (mobileAppId) details.push({ appID: mobileAppId, paths: ["/join", "/agents/*"] });
  return { applinks: { apps: [], details } };
}

export function createAppleAppSiteAssociationResponse(bindings: AppleAppLinkBindings): Response {
  return new Response(JSON.stringify(createAppleAppSiteAssociation(bindings)), {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
