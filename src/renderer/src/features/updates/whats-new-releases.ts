import changelogUrl from "../../../../../CHANGELOG.md?url&no-inline";
import { parseWhatsNewChangelog } from "./whats-new-changelog";

/**
 * Each retry reads the asset again. The URL points into the installed app, not a remote service:
 * the build bundles GoAhead's `CHANGELOG.md`, so the notes need no network and send no data.
 */
export async function loadWhatsNewReleases(signal: AbortSignal) {
  const response = await fetch(changelogUrl, { signal });
  if (!response.ok) throw new Error("Release notes are unavailable.");
  return parseWhatsNewChangelog(await response.text());
}
