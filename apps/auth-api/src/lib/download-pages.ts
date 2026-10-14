// The /download pages: one per operating system, and a hub that lists them. Each statement here
// comes from the release configuration, README.md or docs/TROUBLESHOOTING.md. Keep it to what the
// released app does, because these pages are what a search engine shows for "GoAhead for Linux".
// GoAhead publishes only the macOS Apple silicon installer (`release:local`). The Windows and Linux
// pages say that their system is not available yet and offer no installer.

import type { DownloadPlatform } from "./download-platforms";
import { LANDING_FAQ, type LandingQuestion } from "./landing-faq";
import { OPENBOT_DOWNLOAD_LINKS, OPENBOT_DOWNLOAD_PAGE_LINKS } from "./landing-links";
import {
  OPENBOT_SITE_URL,
  OPENBOT_SOCIAL_IMAGE_ALT,
  OPENBOT_SOCIAL_IMAGE_META,
  OPENBOT_SOCIAL_IMAGE_URL,
  OPENBOT_SOFTWARE_APPLICATION,
  OPENBOT_X_HANDLE,
} from "./site-metadata";

/** The sitemap date of the four pages. Change it when their text changes. */
export const DOWNLOAD_PAGES_UPDATED_AT = "2026-10-14";

export interface DownloadInstaller {
  /** The button text where the system is not on screen, such as a list of every installer. */
  label: string;
  /** The button text inside a card or panel that already names the system. */
  shortLabel: string;
  /** Which computer the file is for, for a reader who has to choose between two. */
  detail: string;
  href: string;
}

/** One line of the spec sheet: what the computer needs, or what the download is. */
interface DownloadSpec {
  label: string;
  value: string;
}

/** One instruction. `code` is a command to copy, shown under the text. */
export interface DownloadStep {
  text: string;
  code?: string;
}

interface DownloadPageSection {
  title: string;
  steps: readonly DownloadStep[];
}

export interface DownloadPageContent {
  platform: DownloadPlatform;
  /** The name a reader uses for the system, which the headings and the breadcrumb show. */
  name: string;
  title: string;
  description: string;
  heading: string;
  intro: string;
  installers: readonly DownloadInstaller[];
  specs: readonly DownloadSpec[];
  installSteps: readonly DownloadStep[];
  /** Optional steps for one situation, such as a distribution that needs a security profile. */
  extraSections: readonly DownloadPageSection[];
  notes: readonly string[];
  faq: readonly LandingQuestion[];
  /** schema.org `operatingSystem` for this page's installer. A page with no installer uses the site's. */
  operatingSystem: string;
}

const PROVIDERS_ANSWER = LANDING_FAQ.find((entry) => entry.question === "Which AI models can GoAhead use?")?.answer;
const FREE_ANSWER =
  "Yes. The app costs $0, with no locked features, and needs no account. You pay only your AI provider, through the plan or API key you already have.";
const CONNECT_STEP: DownloadStep = {
  text: "Connect a provider, such as Codex with your ChatGPT plan or Claude Code with your Claude plan. Then describe the agent you want in one prompt and save it.",
};
const UPDATES_NOTE = "GoAhead checks for new versions and updates itself.";
const NETWORK_NOTE = "The AI provider you choose needs an internet connection. A local model needs none.";
const UPDATES_SPEC: DownloadSpec = { label: "Updates", value: "Automatic" };
const NOT_AVAILABLE_SPEC: DownloadSpec = { label: "Status", value: "Not available yet" };
const MAC_INSTEAD_SPEC: DownloadSpec = { label: "Available now", value: "macOS on Apple silicon" };
const MAC_INSTEAD_NOTE =
  "Today GoAhead runs only on a Mac with Apple silicon (M1 or newer) and macOS 13 or newer. The download page for macOS has the installer.";

function providersQuestion(system: string): LandingQuestion {
  return {
    question: `Which AI agents can I run on ${system}?`,
    answer:
      PROVIDERS_ANSWER ??
      "Codex, Claude Code, Gemini, Grok and OpenCode, and any OpenAI-compatible endpoint, also one on your own computer.",
  };
}

export const DOWNLOAD_PAGES: Record<DownloadPlatform, DownloadPageContent> = {
  macos: {
    platform: "macos",
    name: "macOS",
    title: "Download GoAhead for Mac: AI agent app for macOS",
    description:
      "Download GoAhead for macOS 13 or later on Apple silicon. A free app that runs Codex, Claude Code, Gemini and Grok agents as a team on your Mac.",
    heading: "GoAhead for Mac",
    intro:
      "Run a team of AI agents on your Mac with the ChatGPT, Claude, Gemini or Grok plan you already pay for, or with your own model. Your chats and files stay on your Mac.",
    installers: [
      {
        label: "Download for Apple silicon",
        shortLabel: "Apple silicon",
        detail: "For a Mac with M1 or newer",
        href: OPENBOT_DOWNLOAD_LINKS.macos,
      },
    ],
    specs: [
      { label: "System", value: "macOS 13 Ventura or later" },
      { label: "Processor", value: "Apple silicon (M1 or newer)" },
      { label: "File", value: "DMG, notarized by Apple" },
      UPDATES_SPEC,
    ],
    installSteps: [
      {
        text: "Make sure that your Mac has Apple silicon: open the Apple menu and choose About This Mac. A “Chip” line means Apple silicon. A “Processor” line means Intel, which GoAhead does not support yet. Then download the DMG.",
      },
      { text: "Open the DMG and drag GoAhead to the Applications folder." },
      {
        text: "Open GoAhead from Applications. The app is signed by its developer and notarized by Apple, so macOS only asks you once to confirm that you want to open an app from the internet.",
      },
      CONNECT_STEP,
    ],
    extraSections: [],
    notes: [
      UPDATES_NOTE,
      NETWORK_NOTE,
      "Computer Use needs the Screen Recording and Accessibility permissions. macOS asks for them, and GoAhead does not go around the prompts.",
    ],
    faq: [
      { question: "Is GoAhead free on Mac?", answer: FREE_ANSWER },
      {
        question: "Does GoAhead run on an Intel Mac?",
        answer: "Not yet. GoAhead is available only for a Mac with Apple silicon (M1 or newer).",
      },
      providersQuestion("a Mac"),
    ],
    operatingSystem: "macOS 13 or later (Apple silicon)",
  },
  windows: {
    platform: "windows",
    name: "Windows",
    title: "GoAhead for Windows: not available yet",
    description:
      "GoAhead for Windows is not available yet. Today GoAhead runs on a Mac with Apple silicon, as a free app that runs Codex, Claude Code, Gemini and Grok agents as a team.",
    heading: "GoAhead for Windows",
    intro: "GoAhead for Windows is not available yet. Today you can run GoAhead on a Mac with Apple silicon.",
    installers: [],
    specs: [NOT_AVAILABLE_SPEC, MAC_INSTEAD_SPEC],
    installSteps: [],
    extraSections: [],
    notes: [MAC_INSTEAD_NOTE],
    faq: [
      {
        question: "Does GoAhead run on Windows?",
        answer: "Not yet. GoAhead is available only for a Mac with Apple silicon (M1 or newer).",
      },
    ],
    operatingSystem: OPENBOT_SOFTWARE_APPLICATION.operatingSystem,
  },
  linux: {
    platform: "linux",
    name: "Linux",
    title: "GoAhead for Linux: not available yet",
    description:
      "The GoAhead desktop app for Linux is not available yet. Today GoAhead runs on a Mac with Apple silicon, as a free app that runs Codex, Claude Code, Gemini and Grok agents as a team.",
    heading: "GoAhead for Linux",
    intro:
      "The GoAhead desktop app for Linux is not available yet. Today you can run GoAhead on a Mac with Apple silicon.",
    installers: [],
    specs: [NOT_AVAILABLE_SPEC, MAC_INSTEAD_SPEC],
    installSteps: [],
    extraSections: [
      {
        title: "A server with no screen",
        steps: [
          {
            text: "On Ubuntu 24.04 with systemd, install GoAhead as an always-on server of your account, then sign in with an email code:",
            code: "curl -fsSL https://raw.githubusercontent.com/Shubhh2903/goahead/master/scripts/install-server.sh | sudo bash\nsudo openbot login",
          },
          { text: "Then use it from the desktop app, the iPhone app or openbot.run/app." },
        ],
      },
    ],
    notes: [MAC_INSTEAD_NOTE],
    faq: [
      {
        question: "Does the GoAhead desktop app run on Linux?",
        answer:
          "Not yet. The desktop app is available only for a Mac with Apple silicon (M1 or newer). You can install GoAhead as a server on Ubuntu 24.04, as this page shows.",
      },
    ],
    operatingSystem: OPENBOT_SOFTWARE_APPLICATION.operatingSystem,
  },
};

export const DOWNLOAD_HUB = {
  title: "Download GoAhead for Mac",
  description:
    "Download GoAhead, the free app that runs AI agents as a team on your computer. For macOS 13 or later on Apple silicon.",
  heading: "Download GoAhead",
  intro:
    "Free for a Mac with Apple silicon. Versions for Intel Macs, Windows and Linux are not available yet. Choose a system below for its requirements and install steps.",
} as const;

export function downloadPagePath(platform: DownloadPlatform | "hub"): string {
  return OPENBOT_DOWNLOAD_PAGE_LINKS[platform];
}

export function downloadPageUrl(platform: DownloadPlatform | "hub", siteUrl: string = OPENBOT_SITE_URL): string {
  return new URL(downloadPagePath(platform), siteUrl).toString();
}

function breadcrumbData(platform: DownloadPlatform | "hub", siteUrl: string) {
  const trail = [
    { name: "GoAhead", url: siteUrl },
    { name: "Download", url: downloadPageUrl("hub", siteUrl) },
    ...(platform === "hub" ? [] : [{ name: DOWNLOAD_PAGES[platform].name, url: downloadPageUrl(platform, siteUrl) }]),
  ];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

function faqData(faq: readonly LandingQuestion[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
}

export function downloadPageHead(platform: DownloadPlatform | "hub", siteUrl: string) {
  const page = platform === "hub" ? undefined : DOWNLOAD_PAGES[platform];
  const title = page?.title ?? DOWNLOAD_HUB.title;
  const description = page?.description ?? DOWNLOAD_HUB.description;
  const url = downloadPageUrl(platform, siteUrl);
  const application =
    page && page.installers.length > 0
      ? {
          ...OPENBOT_SOFTWARE_APPLICATION,
          operatingSystem: page.operatingSystem,
          downloadUrl: page.installers.map((installer) => new URL(installer.href, siteUrl).toString()),
        }
      : OPENBOT_SOFTWARE_APPLICATION;

  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "GoAhead" },
      { property: "og:locale", content: "en_US" },
      { property: "og:url", content: url },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      ...OPENBOT_SOCIAL_IMAGE_META,
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: OPENBOT_X_HANDLE },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: OPENBOT_SOCIAL_IMAGE_URL },
      { name: "twitter:image:alt", content: OPENBOT_SOCIAL_IMAGE_ALT },
      { "script:ld+json": application },
      { "script:ld+json": breadcrumbData(platform, siteUrl) },
      ...(page ? [{ "script:ld+json": faqData(page.faq) }] : []),
    ],
    links: [{ rel: "canonical", href: url }],
  };
}
