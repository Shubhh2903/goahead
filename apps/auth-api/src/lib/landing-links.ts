export const EXTERNAL_LINK_REL = "noopener noreferrer";

/**
 * The installer that each download button starts. GoAhead ships only the macOS Apple silicon DMG.
 * `/download/windows/latest`, `/download/linux/latest` and `?arch=x64` still answer, with the page
 * of their system, so an old link does not break.
 */
export const OPENBOT_DOWNLOAD_LINKS = {
  macos: "/download/macos/latest",
} as const;

/** The pages that describe each installer: requirements, install steps and known limits. */
export const OPENBOT_DOWNLOAD_PAGE_LINKS = {
  hub: "/download",
  macos: "/download/macos",
  windows: "/download/windows",
  linux: "/download/linux",
} as const;

export const OPENBOT_LINKS = {
  contact: "https://x.com/SLilawala",
  download: "#download",
  /** The same anchor from a page that is not the landing page. */
  downloadFromOtherPage: "/#download",
  news: "/news",
  guides: "/guides",
  plugins: "/plugins",
  changelog: "/changelog",
  releases: "https://github.com/Shubhh2903/goahead/releases",
  repository: "https://github.com/Shubhh2903/goahead",
  license: "https://github.com/Shubhh2903/goahead/blob/master/LICENSE",
  privacy: "https://github.com/Shubhh2903/goahead/blob/master/PRIVACY.md",
  documentation: "https://github.com/Shubhh2903/goahead#readme",
  troubleshooting: "https://github.com/Shubhh2903/goahead/blob/master/docs/TROUBLESHOOTING.md",
  selfHostedServer: "https://github.com/Shubhh2903/goahead/blob/master/docs/self-hosted-server.md",
  architecture: "https://github.com/Shubhh2903/goahead#architecture",
  contributing: "https://github.com/Shubhh2903/goahead/blob/master/CONTRIBUTING.md",
  codex: "https://learn.chatgpt.com/docs/app-server",
  claude: "https://code.claude.com/docs/en/overview",
  anthropicAgents: "https://www.anthropic.com/engineering/building-effective-agents",
} as const;

/**
 * One entry in a footer column. An internal entry carries a route, not a string,
 * so the footer can render it as a client navigation. It also fixes a link that
 * only worked on one page: "#download" on its own finds nothing on /news, because
 * there is no download section there for it to scroll to.
 */
export type FooterLink =
  | { readonly label: string; readonly external: true; readonly href: string }
  | {
      readonly label: string;
      readonly external: false;
      readonly to: "/" | "/download" | "/news" | "/guides" | "/plugins" | "/changelog" | "/compare";
      readonly hash?: string;
    }
  | { readonly label: string; readonly external: false; readonly to: "/compare/$slug"; readonly slug: string };

export interface FooterColumn {
  readonly title: string;
  readonly links: readonly FooterLink[];
}

export const FOOTER_COLUMNS: readonly FooterColumn[] = [
  {
    title: "Product",
    links: [
      { label: "Download", external: false, to: "/download" },
      { label: "News", external: false, to: "/news" },
      { label: "Guides", external: false, to: "/guides" },
      { label: "Plugins", external: false, to: "/plugins" },
      { label: "Changelog", external: false, to: "/changelog" },
      { label: "Source code", external: true, href: OPENBOT_LINKS.repository },
      { label: "License", external: true, href: OPENBOT_LINKS.license },
      { label: "Privacy", external: true, href: OPENBOT_LINKS.privacy },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Documentation", external: true, href: OPENBOT_LINKS.documentation },
      { label: "Troubleshooting", external: true, href: OPENBOT_LINKS.troubleshooting },
      { label: "Self-hosted server", external: true, href: OPENBOT_LINKS.selfHostedServer },
      { label: "Architecture", external: true, href: OPENBOT_LINKS.architecture },
      { label: "Contributing", external: true, href: OPENBOT_LINKS.contributing },
      { label: "Codex", external: true, href: OPENBOT_LINKS.codex },
      { label: "Claude Code", external: true, href: OPENBOT_LINKS.claude },
    ],
  },
  {
    title: "Compare",
    links: [
      { label: "GoAhead vs ChatGPT dots", external: false, to: "/compare/$slug", slug: "chatgpt-dots" },
      { label: "GoAhead vs Grok Bot", external: false, to: "/compare/$slug", slug: "grok-bot" },
      { label: "GoAhead vs Muse", external: false, to: "/compare/$slug", slug: "muse" },
      { label: "GoAhead vs Hermes Agent", external: false, to: "/compare/$slug", slug: "hermes-agent" },
      { label: "GoAhead vs OpenClaw", external: false, to: "/compare/$slug", slug: "openclaw" },
      { label: "GoAhead vs Manus", external: false, to: "/compare/$slug", slug: "manus" },
      { label: "GoAhead vs Claude Cowork", external: false, to: "/compare/$slug", slug: "claude-cowork" },
      { label: "GoAhead vs Devin", external: false, to: "/compare/$slug", slug: "devin" },
      { label: "Best AI agent apps", external: false, to: "/compare/$slug", slug: "best-ai-agent-apps" },
      { label: "All comparisons", external: false, to: "/compare" },
    ],
  },
];
