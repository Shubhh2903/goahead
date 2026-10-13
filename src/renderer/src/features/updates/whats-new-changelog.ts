import type { WhatsNewGroupType, WhatsNewRelease } from "@openbot/ui/features/updates/whats-new";
import { releaseVersion } from "./whats-new-history";

// GoAhead's own release notes are the `CHANGELOG.md` that each release writes (see
// docs/RELEASING.md#release-notes). The dialog reads that file, so a release does not write its notes
// two times. The parser reads only the Markdown that the file uses: `## [x.y.z] - date` headings,
// `### Added` style groups, `-` bullets with indented continuation lines, and inline `**bold**`,
// `code` and [links](url). The public changelog page has its own parser in apps/auth-api.

const RELEASE_HEADING = /^## \[([^\]]+)\](?:\s+-\s+(\d{4}-\d{2}-\d{2}))?/;
const GROUP_HEADING = /^### (.+)$/;
const BULLET = /^- (.*)$/;
const CONTINUATION = /^ {2,}(\S.*)$/;
/** A bold run that ends a sentence is a step after the upgrade; a bold word such as a tab name is not. */
const NOTICE = /\*\*[^*]+[.!]\*\*/;
const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** The dialog has three groups. A removal or deprecation is a change; a security fix is a fix. */
const GROUP_TYPES: Partial<Record<string, WhatsNewGroupType>> = {
  added: "added",
  changed: "changed",
  removed: "changed",
  deprecated: "changed",
  fixed: "fixed",
  security: "fixed",
};

/** The dialog shows plain text, so the Markdown marks go and the text of a link stays. */
function plainText(markdown: string): string {
  return markdown.replace(INLINE, (_whole, code, strong, label) => code ?? strong ?? label ?? "").trim();
}

/**
 * Each released `x.y.z` version of the file, in file order (newest first). Unreleased notes,
 * prerelease versions and groups with no known name are left out.
 */
export function parseWhatsNewChangelog(markdown: string): WhatsNewRelease[] {
  const releases: { version: string; date: string; notices: string[]; groups: Map<WhatsNewGroupType, string[]> }[] = [];
  let release: (typeof releases)[number] | undefined;
  let items: string[] | undefined;
  let item: string | undefined;

  const closeItem = () => {
    if (release && items && item !== undefined) {
      if (NOTICE.test(item)) release.notices.push(plainText(item));
      else items.push(plainText(item));
    }
    item = undefined;
  };

  for (const line of markdown.split(/\r?\n/)) {
    const heading = RELEASE_HEADING.exec(line);
    if (heading) {
      closeItem();
      items = undefined;
      const version = releaseVersion(heading[1] ?? "");
      release = version === null ? undefined : { version, date: heading[2] ?? "", notices: [], groups: new Map() };
      if (release) releases.push(release);
      continue;
    }
    if (!release) continue;

    const groupHeading = GROUP_HEADING.exec(line);
    if (groupHeading) {
      closeItem();
      const type = GROUP_TYPES[(groupHeading[1] ?? "").trim().toLowerCase()];
      if (type === undefined) {
        items = undefined;
        continue;
      }
      items = release.groups.get(type) ?? [];
      release.groups.set(type, items);
      continue;
    }

    if (line.trim() === "") {
      closeItem();
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet && items) {
      closeItem();
      item = bullet[1] ?? "";
      continue;
    }
    const continuation = CONTINUATION.exec(line);
    if (item !== undefined && continuation) item = `${item} ${continuation[1]}`;
  }
  closeItem();

  return releases.map((entry) => ({
    version: entry.version,
    date: entry.date,
    notices: entry.notices,
    groups: (["added", "changed", "fixed"] as const)
      .map((type) => ({ type, items: entry.groups.get(type) ?? [] }))
      .filter((group) => group.items.length > 0),
  }));
}
