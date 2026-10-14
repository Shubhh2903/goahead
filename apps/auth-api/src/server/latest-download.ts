import { OPENBOT_DOWNLOAD_PAGE_LINKS, OPENBOT_LINKS } from "../lib/landing-links";

/**
 * GoAhead publishes one desktop installer: the macOS Apple silicon (arm64) DMG. `release:local`
 * uploads `GoAhead-<version>-arm64.dmg`, `GoAhead-<version>-arm64.zip` and `latest-mac.yml`.
 * The DMG is stapled after the build, so `latest-mac.yml` lists only the ZIP (`dmg.writeUpdateInfo:
 * false`). The DMG has the same name with the `.dmg` extension.
 */
const RELEASES_BASE_URL = "https://github.com/Shubhh2903/goahead/releases";
const MANIFEST = "latest-mac.yml";

/** The systems that have a download page. Any request for them that is not the Apple silicon DMG gets the page. */
const UNAVAILABLE_DOWNLOAD_PLATFORMS = ["linux", "macos", "windows"] as const;
type UnavailableDownloadPlatform = (typeof UNAVAILABLE_DOWNLOAD_PLATFORMS)[number];

function isUnavailableDownloadPlatform(value: string): value is UnavailableDownloadPlatform {
  return UNAVAILABLE_DOWNLOAD_PLATFORMS.some((platform) => platform === value);
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      "cache-control": "no-store",
      location,
    },
  });
}

/** The arm64 DMG name, from the arm64 DMG or ZIP that the manifest lists. */
function findInstaller(manifest: string): string | undefined {
  const assetLines = manifest.matchAll(/^\s*-\s+url:\s*["']?([^\s"']+)["']?\s*$/gim);
  for (const match of assetLines) {
    const asset = match[1];
    if (!asset || !/^[a-z0-9][a-z0-9._+-]+$/i.test(asset)) continue;
    const lower = asset.toLowerCase();
    if (!lower.includes("arm64")) continue;
    if (lower.endsWith(".dmg")) return asset;
    if (lower.endsWith(".zip")) return `${asset.slice(0, -".zip".length)}.dmg`;
  }
  return undefined;
}

/**
 * The releases page is a working answer but not the one that was asked for, so each fallback says
 * why. Written to the Worker log rather than to analytics: a server event has no session, and the
 * landing reports are defined on sessions. The reason only, never a URL or a response body.
 */
function fallbackToReleases(reason: string): Response {
  console.warn(`latest-download: serving the releases page for macos (${reason})`);
  return redirect(OPENBOT_LINKS.releases);
}

/** The Apple silicon DMG of the latest release. */
export async function latestDownloadResponse(fetcher: typeof fetch = fetch): Promise<Response> {
  try {
    const response = await fetcher(`${RELEASES_BASE_URL}/latest/download/${MANIFEST}`, {
      headers: { accept: "text/yaml, text/plain" },
      // A slow release host must not hold the Worker request open; the releases page is the answer.
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return fallbackToReleases(`manifest status ${response.status}`);

    const installer = findInstaller(await response.text());
    if (!installer) return fallbackToReleases("no arm64 asset in the manifest");

    return redirect(`${RELEASES_BASE_URL}/latest/download/${encodeURIComponent(installer)}`);
  } catch {
    return fallbackToReleases("the manifest request failed");
  }
}

/**
 * The answer to `/download/<platform>/latest?arch=<arch>`. macOS without `?arch=x64` gets the
 * Apple silicon DMG. An Intel Mac, Windows and Linux have no installer yet, so they get the download
 * page of their system, which says so. They never get an installer for another system.
 */
export function downloadRouteResponse(
  platform: string,
  arch: string | null,
  fetcher: typeof fetch = fetch,
): Promise<Response> | Response {
  if (platform === "macos" && arch !== "x64") return latestDownloadResponse(fetcher);
  if (isUnavailableDownloadPlatform(platform)) return redirect(OPENBOT_DOWNLOAD_PAGE_LINKS[platform]);
  return new Response("Not found", { status: 404 });
}
