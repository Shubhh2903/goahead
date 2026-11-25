import { Effect, Schema } from "effect";
import { androidApkRelease, androidApkVersion } from "../lib/android-apk";
import { OPENBOT_DOWNLOAD_PAGE_LINKS, OPENBOT_LINKS } from "../lib/landing-links";

const RELEASES_BASE_URL = "https://github.com/Shubhh2903/goahead/releases";
const MANIFEST = "latest-mac.yml";

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

export function androidApkResponse(): Response {
  const version = androidApkVersion();
  if (version === undefined) return new Response("Not found", { status: 404 });
  return redirect(androidApkRelease(version).url);
}

function fallbackToReleases(reason: string): Response {
  console.warn(`latest-download: serving the releases page for macos (${reason})`);
  return redirect(OPENBOT_LINKS.releases);
}

class DownloadManifestError extends Schema.TaggedError<DownloadManifestError>()("DownloadManifestError", {}) {}

const latestDownload = Effect.fn("LatestDownload.resolve")(function* (fetcher: typeof fetch) {
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      fetcher(`${RELEASES_BASE_URL}/latest/download/${MANIFEST}`, {
        headers: { accept: "text/yaml, text/plain" },
        signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
      }),
    catch: () => new DownloadManifestError({}),
  });
  if (!response.ok) return fallbackToReleases(`manifest status ${response.status}`);
  const manifest = yield* Effect.tryPromise({
    try: () => response.text(),
    catch: () => new DownloadManifestError({}),
  });
  const installer = findInstaller(manifest);
  if (!installer) return fallbackToReleases("no arm64 asset in the manifest");
  return redirect(`${RELEASES_BASE_URL}/latest/download/${encodeURIComponent(installer)}`);
});

export function latestDownloadResponse(fetcher: typeof fetch = fetch) {
  return latestDownload(fetcher).pipe(
    Effect.catch(() => Effect.sync(() => fallbackToReleases("the manifest request failed"))),
  );
}

export function downloadRouteResponse(
  platform: string,
  arch: string | null,
  fetcher: typeof fetch = fetch,
): Effect.Effect<Response> {
  if (platform === "android") return Effect.succeed(androidApkResponse());
  if (platform === "macos" && arch !== "x64") return latestDownloadResponse(fetcher);
  if (isUnavailableDownloadPlatform(platform)) return Effect.succeed(redirect(OPENBOT_DOWNLOAD_PAGE_LINKS[platform]));
  return Effect.succeed(new Response("Not found", { status: 404 }));
}
