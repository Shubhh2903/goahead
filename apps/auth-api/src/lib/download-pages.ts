import { ANDROID_APK_AVAILABLE } from "./android-apk";
import { DOWNLOAD_PLATFORM_ORDER, type DownloadPlatform } from "./download-platforms";
import { faqStructuredData, type LandingQuestion } from "./landing-faq";
import { OPENBOT_ANDROID_APK_LINK, OPENBOT_DOWNLOAD_LINKS, OPENBOT_DOWNLOAD_PAGE_LINKS } from "./landing-links";
import { MOBILE_APP_ORDER, MOBILE_APPS, type MobilePlatform } from "./mobile-apps";
import { OPENBOT_SITE_URL, OPENBOT_X_HANDLE, type PageSocialImage, pageSocialImageMeta } from "./site-metadata";
import { OPENBOT_SOFTWARE_APPLICATION } from "./software-application";

export const DOWNLOAD_PAGES_UPDATED_AT = "2026-10-15";

export type DownloadPagePlatform = DownloadPlatform | MobilePlatform;

export const DOWNLOAD_PAGE_ORDER: readonly DownloadPagePlatform[] = [...DOWNLOAD_PLATFORM_ORDER, ...MOBILE_APP_ORDER];

export interface DownloadInstaller {
  label: string;
  shortLabel: string;
  detail: string;
  href: string;
  external?: boolean;
}

interface DownloadSpec {
  label: string;
  value: string;
}

export interface DownloadStep {
  text: string;
  code?: string;
}

interface DownloadPageSection {
  title: string;
  steps: readonly DownloadStep[];
}

export interface DownloadPageContent {
  platform: DownloadPagePlatform;
  name: string;
  title: string;
  description: string;
  heading: string;
  intro: string;
  installers: readonly DownloadInstaller[];
  specs: readonly DownloadSpec[];
  installSteps: readonly DownloadStep[];
  extraSections: readonly DownloadPageSection[];
  notes: readonly string[];
  faq: readonly LandingQuestion[];
  operatingSystem: string;
}

const PROVIDERS_ANSWER =
  "Codex, Claude Code, Gemini, Grok, OpenCode, Cursor, Cline, Muse Code and Pi, and Inception's Mercury models. You can also run any agent that speaks the Agent Client Protocol, such as Goose or Qwen Code, connect any OpenAI-compatible endpoint, and use local models in Ollama or LM Studio.";
const FREE_ANSWER =
  "Yes, for personal and other noncommercial use. The app costs $0, with no locked features. You pay only your AI provider, through the plan or API key you already have. Commercial use needs a license.";
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

const COMPUTER_STEP: DownloadStep = {
  text: "Install GoAhead on the Mac, Windows or Linux computer that runs your agents, and sign in to your GoAhead account.",
};
const GENERATE_CODE_STEP: DownloadStep = {
  text: "On the computer, open Settings, then Mobile Connect, and select Generate QR code. The code expires after two minutes and works for one sign-in.",
};
const PHONE_NOTES = [
  "Your chats and files stay on the computer that runs your agents. The phone connects to it over an encrypted connection, directly between your devices when it can, and no cloud stores your chats or files.",
  "You set up no VPN or tunnel. Remote access needs a GoAhead account.",
  "The computer must be on and running GoAhead for the phone to reach your agents.",
  "To remove a phone, open Settings, then Mobile Connect, on the computer and disconnect it. Its access stops at once.",
];
const PHONE_COMPUTER_QUESTION: LandingQuestion = {
  question: "Do I need a computer to use the mobile app?",
  answer:
    "Yes. The app controls the agents that run in GoAhead on your Mac, Windows or Linux computer, or on a server that runs GoAhead. Your chats and files stay there.",
};
const PHONE_FREE_ANSWER =
  "Yes. The app costs $0. You pay only your AI provider, through the plan or API key you already have.";

const ANDROID_APK = {
  installer: {
    label: "Download the APK",
    shortLabel: "APK",
    detail: "For a phone with no Google Play",
    href: OPENBOT_ANDROID_APK_LINK,
  },
  section: {
    title: "Install from the APK",
    steps: [
      {
        text: "Use the APK when your phone has no Google Play. On the phone, open this page in the browser and select Download the APK.",
      },
      {
        text: "Open the downloaded file. Android asks you to let the browser install apps: allow it, then select Install.",
      },
      { text: "Open GoAhead and connect it to your computer with the QR code, as the steps above show." },
    ],
  },
  notes: [
    "The APK is the build that Google Play has, with the same signature.",
    "With the APK, the app tells you when a new version is ready. Download the APK from this page again and install it over the app. You keep your sign-in.",
    "Notifications come through Google's push service. A phone with no Google Play services gets none.",
  ],
  question: {
    question: "Can I install GoAhead for Android without Google Play?",
    answer:
      "Yes. Download the APK from this page and open it on your phone. It is the build that Google Play has, and it is free.",
  },
} satisfies {
  installer: DownloadInstaller;
  section: DownloadPageSection;
  notes: readonly string[];
  question: LandingQuestion;
};

function providersQuestion(system: string): LandingQuestion {
  return {
    question: `Which AI agents can I run on ${system}?`,
    answer: PROVIDERS_ANSWER,
  };
}

export const DOWNLOAD_PAGES: Record<DownloadPagePlatform, DownloadPageContent> = {
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
            text: "On Ubuntu 24.04 or 26.04 with systemd, install GoAhead as an always-on server of your account, then sign in with an email code:",
            code: "curl -fsSL https://raw.githubusercontent.com/Shubhh2903/goahead/master/scripts/install-server.sh | sudo bash\nsudo openbot login",
          },
          { text: "Then use it from the desktop app, the mobile app or goahead.multicodegenius.com/app." },
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
  ios: {
    platform: "ios",
    name: "iPhone",
    title: "Download GoAhead for iPhone: your AI agents on your phone",
    description:
      "Get GoAhead for iPhone on the App Store. Chat with the AI agents on your computer, follow their work and send files from anywhere.",
    heading: "GoAhead for iPhone",
    intro:
      "Chat with the agents on your computer from anywhere, follow their progress and send them files. Get the app on the App Store.",
    installers: [
      {
        label: "Download on the App Store",
        shortLabel: "App Store",
        detail: "For an iPhone with iOS 16.4 or later",
        href: MOBILE_APPS.ios.href,
        external: true,
      },
    ],
    specs: [
      { label: "System", value: "iOS 16.4 or later" },
      { label: "Store", value: "App Store" },
      { label: "Needs", value: "GoAhead on a computer" },
      { label: "Updates", value: "Through the App Store" },
    ],
    installSteps: [
      COMPUTER_STEP,
      { text: "On your iPhone, install GoAhead from the App Store." },
      GENERATE_CODE_STEP,
      { text: "Open GoAhead on your iPhone, choose Scan QR code and point the camera at the code." },
    ],
    extraSections: [],
    notes: PHONE_NOTES,
    faq: [{ question: "Is GoAhead for iPhone free?", answer: PHONE_FREE_ANSWER }, PHONE_COMPUTER_QUESTION],
    operatingSystem: "iOS 16.4 or later",
  },
  android: {
    platform: "android",
    name: "Android",
    title: "Download GoAhead for Android: your AI agents on your phone",
    description: ANDROID_APK_AVAILABLE
      ? "Get GoAhead for Android on Google Play or as an APK. Chat with the AI agents on your computer, follow their work and send files from anywhere."
      : "Get GoAhead for Android on Google Play. Chat with the AI agents on your computer, follow their work and send files from anywhere.",
    heading: "GoAhead for Android",
    intro: ANDROID_APK_AVAILABLE
      ? "Chat with the agents on your computer from anywhere, follow their progress and send them files. Get the app on Google Play, or download the APK."
      : "Chat with the agents on your computer from anywhere, follow their progress and send them files. Get the app on Google Play.",
    installers: [
      {
        label: "Get it on Google Play",
        shortLabel: "Google Play",
        detail: "For a phone with Android 7.0 or later",
        href: MOBILE_APPS.android.href,
        external: true,
      },
      ...(ANDROID_APK_AVAILABLE ? [ANDROID_APK.installer] : []),
    ],
    specs: [
      { label: "System", value: "Android 7.0 or later" },
      { label: "Store", value: ANDROID_APK_AVAILABLE ? "Google Play, or an APK" : "Google Play" },
      { label: "Needs", value: "GoAhead on a computer" },
      { label: "Updates", value: ANDROID_APK_AVAILABLE ? "Google Play, or a new APK" : "Through Google Play" },
    ],
    installSteps: [
      COMPUTER_STEP,
      { text: "On your phone, install GoAhead from Google Play." },
      GENERATE_CODE_STEP,
      { text: "Open GoAhead on your phone, choose Scan QR code and point the camera at the code." },
    ],
    extraSections: ANDROID_APK_AVAILABLE ? [ANDROID_APK.section] : [],
    notes: [
      ...PHONE_NOTES,
      "The app does not ask for access to all your photos and videos. You choose photos and files with the system picker.",
      ...(ANDROID_APK_AVAILABLE ? ANDROID_APK.notes : []),
    ],
    faq: [
      { question: "Is GoAhead for Android free?", answer: PHONE_FREE_ANSWER },
      PHONE_COMPUTER_QUESTION,
      ...(ANDROID_APK_AVAILABLE ? [ANDROID_APK.question] : []),
    ],
    operatingSystem: "Android 7.0 or later",
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

const DOWNLOAD_SOCIAL_IMAGE: PageSocialImage = {
  path: "/social/download.jpg",
  alt: "Teamwork. Now installing. GoAhead agents around a glass ring",
};

export function downloadPagePath(platform: DownloadPagePlatform | "hub"): string {
  return OPENBOT_DOWNLOAD_PAGE_LINKS[platform];
}

export function downloadPageUrl(platform: DownloadPagePlatform | "hub", siteUrl: string = OPENBOT_SITE_URL): string {
  return new URL(downloadPagePath(platform), siteUrl).toString();
}

function breadcrumbData(platform: DownloadPagePlatform | "hub", siteUrl: string) {
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

export function downloadPageHead(platform: DownloadPagePlatform | "hub", siteUrl: string) {
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
  const image = pageSocialImageMeta(DOWNLOAD_SOCIAL_IMAGE, siteUrl);

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
      ...image.openGraph,
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: OPENBOT_X_HANDLE },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      ...image.twitter,
      { "script:ld+json": application },
      { "script:ld+json": breadcrumbData(platform, siteUrl) },
      ...(page ? [{ "script:ld+json": faqStructuredData(page.faq) }] : []),
    ],
    links: [{ rel: "canonical", href: url }],
  };
}
