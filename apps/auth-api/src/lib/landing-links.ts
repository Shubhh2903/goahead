import type { FooterColumnId, FooterTextId } from "./site-text";

export const EXTERNAL_LINK_REL = "noopener noreferrer";

export const OPENBOT_DOWNLOAD_LINKS = {
  macos: "/download/macos/latest",
  windows: "/download/windows/latest",
  linux: "/download/linux/latest",
} as const;

export const OPENBOT_ALTERNATE_DOWNLOAD_LINKS = {
  macos: "/download/macos/latest?arch=x64",
  linux: "/download/linux/latest?arch=arm64",
} as const;

export const OPENBOT_ANDROID_APK_LINK = "/download/android/latest";

export const OPENBOT_DOWNLOAD_PAGE_LINKS = {
  hub: "/download",
  macos: "/download/macos",
  windows: "/download/windows",
  linux: "/download/linux",
  ios: "/download/ios",
  android: "/download/android",
} as const;

export const OPENBOT_LINKS = {
  contact: "https://x.com/SLilawala",
  x: "https://x.com/SLilawala",
  download: "#download",
  news: "/news",
  guides: "/guides",
  marketplace: "/marketplace",
  changelog: "/changelog",
  releases: "https://github.com/Shubhh2903/goahead/releases",
  repository: "https://github.com/Shubhh2903/goahead",
  license: "https://github.com/Shubhh2903/goahead/blob/master/LICENSE",
  privacy: "https://github.com/Shubhh2903/goahead/blob/master/PRIVACY.md",
  documentation: "https://github.com/Shubhh2903/goahead#readme",
  troubleshooting: "https://github.com/Shubhh2903/goahead/blob/master/docs/TROUBLESHOOTING.md",
  selfHostedServer: "https://github.com/Shubhh2903/goahead/blob/master/docs/self-hosted-server.md",
  dockerDocumentation: "https://github.com/Shubhh2903/goahead/blob/master/docs/docker.md",
  dockerInstallUbuntu: "https://docs.docker.com/engine/install/ubuntu/",
  architecture: "https://github.com/Shubhh2903/goahead#architecture",
  contributing: "https://github.com/Shubhh2903/goahead/blob/master/CONTRIBUTING.md",
  codex: "https://learn.chatgpt.com/docs/app-server",
  claude: "https://code.claude.com/docs/en/overview",
  anthropicAgents: "https://www.anthropic.com/engineering/building-effective-agents",
} as const;

type FooterLabel = string | { readonly text: FooterTextId };

export type FooterLink =
  | { readonly label: FooterLabel; readonly external: true; readonly href: string }
  | {
      readonly label: FooterLabel;
      readonly external: false;
      readonly to:
        | "/"
        | "/download"
        | "/news"
        | "/guides"
        | "/marketplace"
        | "/changelog"
        | "/compare"
        | "/providers"
        | "/teams"
        | "/pricing"
        | "/brand"
        | "/contact";
      readonly hash?: string;
    }
  | {
      readonly label: FooterLabel;
      readonly external: false;
      readonly to: "/compare/$slug" | "/providers/$slug";
      readonly slug: string;
    };

export interface FooterColumn {
  readonly id: FooterColumnId;
  readonly links: readonly FooterLink[];
}

export const FOOTER_COLUMNS: readonly FooterColumn[] = [
  {
    id: "product",
    links: [
      { label: { text: "download" }, external: false, to: "/download" },
      { label: { text: "news" }, external: false, to: "/news" },
      { label: { text: "guides" }, external: false, to: "/guides" },
      { label: { text: "marketplace" }, external: false, to: "/marketplace" },
      { label: { text: "changelog" }, external: false, to: "/changelog" },
      { label: { text: "teams" }, external: false, to: "/teams" },
      { label: { text: "pricing" }, external: false, to: "/pricing" },
      { label: { text: "contact" }, external: false, to: "/contact" },
      { label: { text: "brand" }, external: false, to: "/brand" },
      { label: { text: "sourceCode" }, external: true, href: OPENBOT_LINKS.repository },
      { label: { text: "license" }, external: true, href: OPENBOT_LINKS.license },
    ],
  },
  {
    id: "resources",
    links: [
      { label: { text: "documentation" }, external: true, href: OPENBOT_LINKS.documentation },
      { label: { text: "troubleshooting" }, external: true, href: OPENBOT_LINKS.troubleshooting },
      { label: { text: "selfHosted" }, external: true, href: OPENBOT_LINKS.selfHostedServer },
      { label: { text: "architecture" }, external: true, href: OPENBOT_LINKS.architecture },
      { label: { text: "contributing" }, external: true, href: OPENBOT_LINKS.contributing },
      { label: "Codex", external: true, href: OPENBOT_LINKS.codex },
      { label: "Claude Code", external: true, href: OPENBOT_LINKS.claude },
    ],
  },
  {
    id: "providers",
    links: [
      { label: "Claude Code", external: false, to: "/providers/$slug", slug: "claude-code" },
      { label: "Codex", external: false, to: "/providers/$slug", slug: "codex" },
      { label: "Gemini", external: false, to: "/providers/$slug", slug: "gemini" },
      { label: "Grok", external: false, to: "/providers/$slug", slug: "grok" },
      { label: "Cursor", external: false, to: "/providers/$slug", slug: "cursor" },
      { label: "OpenCode", external: false, to: "/providers/$slug", slug: "opencode" },
      { label: "Cline", external: false, to: "/providers/$slug", slug: "cline" },
      { label: { text: "localModels" }, external: false, to: "/providers/$slug", slug: "local-models" },
      { label: { text: "allProviders" }, external: false, to: "/providers" },
    ],
  },
  {
    id: "compare",
    links: [
      { label: "GoAhead vs Grok Bot", external: false, to: "/compare/$slug", slug: "grok-bot" },
      { label: "GoAhead vs Hermes Agent", external: false, to: "/compare/$slug", slug: "hermes-agent" },
      { label: "GoAhead vs Muse", external: false, to: "/compare/$slug", slug: "muse" },
      { label: "GoAhead vs OpenClaw", external: false, to: "/compare/$slug", slug: "openclaw" },
      { label: "GoAhead vs Claude Cowork", external: false, to: "/compare/$slug", slug: "claude-cowork" },
      { label: "GoAhead vs ChatGPT dots", external: false, to: "/compare/$slug", slug: "chatgpt-dots" },
      { label: "GoAhead vs Manus", external: false, to: "/compare/$slug", slug: "manus" },
      { label: "GoAhead vs Devin", external: false, to: "/compare/$slug", slug: "devin" },
      { label: "GoAhead vs Paperclip", external: false, to: "/compare/$slug", slug: "paperclip" },
      { label: "GoAhead vs Viktor", external: false, to: "/compare/$slug", slug: "viktor" },
      { label: "GoAhead vs Instinct", external: false, to: "/compare/$slug", slug: "instinct" },
      { label: { text: "bestApps" }, external: false, to: "/compare/$slug", slug: "best-ai-agent-apps" },
      { label: { text: "allComparisons" }, external: false, to: "/compare" },
    ],
  },
];
