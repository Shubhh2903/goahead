import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseWhatsNewChangelog } from "./whats-new-changelog";
import {
  claimWhatsNewVersion,
  readWhatsNewVersion,
  releaseVersion,
  selectWhatsNewReleases,
  WHATS_NEW_VERSION_KEY,
} from "./whats-new-history";

const CHANGELOG = `# Changelog

## [Unreleased]

### Added

- Not released yet.

## [0.36.1] - 2026-10-14

### Fixed

- The message box stays at the bottom of the chat again. Before, it moved up in a
  short conversation.

## [0.36.0] - 2026-10-13

### Added

- See your routines on a canvas. Open an agent in **Routines** to see them.
- **Connect Slack again after you upgrade.** GoAhead needs a new
  [Slack permission](https://api.slack.com/scopes).

### Removed

- The \`legacy\` view.

### Internal

- Not for users.

## [0.36.0-beta.1] - 2026-10-12

### Added

- A prerelease item.

## [0.9.0] - 2026-01-01

### Fixed

- An old fix.
`;

describe("release history", () => {
  it("reads released versions, groups and steps after the upgrade from the changelog", () => {
    const releases = parseWhatsNewChangelog(CHANGELOG);
    expect(releases.map((release) => release.version)).toEqual(["0.36.1", "0.36.0", "0.9.0"]);
    expect(releases[0]?.groups).toEqual([
      {
        type: "fixed",
        items: ["The message box stays at the bottom of the chat again. Before, it moved up in a short conversation."],
      },
    ]);
    expect(releases[1]).toEqual({
      version: "0.36.0",
      date: "2026-10-13",
      notices: ["Connect Slack again after you upgrade. GoAhead needs a new Slack permission."],
      groups: [
        { type: "added", items: ["See your routines on a canvas. Open an agent in Routines to see them."] },
        { type: "changed", items: ["The legacy view."] },
      ],
    });
  });

  it("parses GoAhead's own CHANGELOG.md", () => {
    const releases = parseWhatsNewChangelog(readFileSync("CHANGELOG.md", "utf8"));
    expect(releases.find((release) => release.version === "0.35.0")?.groups.length).toBeGreaterThan(0);
  });

  it("selects only released notes between installed versions in numeric order", () => {
    const releases = parseWhatsNewChangelog(CHANGELOG);
    expect(selectWhatsNewReleases(releases, "0.36.1", "0.35.0").map((release) => release.version)).toEqual([
      "0.36.1",
      "0.36.0",
    ]);
    expect(selectWhatsNewReleases(releases, "0.36.0", "0.10.0").map((release) => release.version)).toEqual(["0.36.0"]);
    expect(selectWhatsNewReleases(releases, "0.36.1", null).map((release) => release.version)).toEqual(["0.36.1"]);
    expect(releaseVersion("unavailable")).toBeNull();
    expect(releaseVersion("0.37.0-beta.1")).toBeNull();
  });

  it("keeps the highest consumed version and fails safely when storage is unavailable", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    };
    expect(readWhatsNewVersion(storage)).toBeNull();
    expect(claimWhatsNewVersion(storage, "0.36.1")).toBe(true);
    expect(claimWhatsNewVersion(storage, "0.36.0")).toBe(false);
    expect(claimWhatsNewVersion(storage, "0.36.1")).toBe(false);
    expect(data.get(WHATS_NEW_VERSION_KEY)).toBe("0.36.1");
    const unavailable = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(readWhatsNewVersion(unavailable)).toBeNull();
    expect(claimWhatsNewVersion(unavailable, "0.36.1")).toBe(false);
  });
});
