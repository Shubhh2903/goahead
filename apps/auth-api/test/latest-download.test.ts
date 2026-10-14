import { describe, expect, it, vi } from "vitest";
import { OPENBOT_LINKS } from "../src/lib/landing-links";
import { downloadRouteResponse } from "../src/server/latest-download";

const RELEASES = "https://github.com/Shubhh2903/goahead/releases/latest/download";

function manifestFetcher(body: string, status = 200) {
  return vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status }));
}

describe("latest download", () => {
  it.each([null, "arm64"])("redirects an Apple silicon Mac (arch %s) to the GoAhead arm64 DMG", async (arch) => {
    // `release:local` keeps the DMG out of latest-mac.yml, so the manifest lists only the ZIP.
    const fetcher = manifestFetcher(
      "version: 0.36.0\nfiles:\n  - url: GoAhead-0.36.0-arm64.zip\n    sha512: x\npath: GoAhead-0.36.0-arm64.zip\n",
    );

    const response = await downloadRouteResponse("macos", arch, fetcher);

    expect(fetcher).toHaveBeenCalledWith(`${RELEASES}/latest-mac.yml`, {
      headers: { accept: "text/yaml, text/plain" },
      signal: expect.any(AbortSignal),
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${RELEASES}/GoAhead-0.36.0-arm64.dmg`);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    ["macos", "x64", "/download/macos"],
    ["windows", null, "/download/windows"],
    ["linux", null, "/download/linux"],
    ["linux", "arm64", "/download/linux"],
  ] as const)("sends %s (arch %s) to the page that says it is not available yet", async (platform, arch, page) => {
    const fetcher = vi.fn<typeof fetch>();

    const response = await downloadRouteResponse(platform, arch, fetcher);

    expect(fetcher).not.toHaveBeenCalled();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(page);
  });

  it("answers 404 for an unknown system", async () => {
    const response = await downloadRouteResponse("solaris", null, vi.fn<typeof fetch>());

    expect(response.status).toBe(404);
  });

  it.each([
    ["Not found", 404],
    ["files:\n  - url: checksums.txt", 200],
    // An Intel asset is never served to an Apple silicon Mac.
    ["files:\n  - url: GoAhead-0.36.0-x64.zip", 200],
  ] as const)("falls back to the Releases page when no arm64 installer can be resolved", async (body, status) => {
    const response = await downloadRouteResponse("macos", null, manifestFetcher(body, status));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(OPENBOT_LINKS.releases);
  });
});
