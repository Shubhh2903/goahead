import { PRODUCT_IDENTITY } from "@openbot/contracts/product-identity";
import { faqStructuredData, type LandingQuestion } from "./landing-faq";
import { OPENBOT_DOWNLOAD_LINKS } from "./landing-links";

export const OPENBOT_SITE_URL = `${PRODUCT_IDENTITY.siteOrigin}/`;
export const OPENBOT_SITE_TITLE = "GoAhead: Run a team of AI agents on your computer";
export const OPENBOT_SITE_DESCRIPTION =
  "A free desktop app that runs AI agents as a team on your own computer, with the ChatGPT, Claude, Gemini or Grok plan you already pay for, or your own model.";
export const OPENBOT_SOCIAL_IMAGE_URL = `${OPENBOT_SITE_URL}openbot-social.png`;
export const OPENBOT_X_HANDLE = "@SLilawala";
const OPENBOT_X_URL = "https://x.com/SLilawala";
const OPENBOT_REPOSITORY_URL = "https://github.com/Shubhh2903/goahead";
const OPENBOT_LICENSE_URL = "https://polyformproject.org/licenses/noncommercial/1.0.0/";
const OPENBOT_ORGANIZATION_ID = `${OPENBOT_SITE_URL}#organization`;
const OPENBOT_WEBSITE_ID = `${OPENBOT_SITE_URL}#website`;
const OPENBOT_APPLICATION_ID = `${OPENBOT_SITE_URL}#app`;
export const OPENBOT_LOGO_URL = `${OPENBOT_SITE_URL}icon-512x512.png`;
export const OPENBOT_SOCIAL_IMAGE_ALT = "Meet GoAhead on a dark grid background";

export const OPENBOT_SOCIAL_IMAGE_META = [
  { property: "og:image", content: OPENBOT_SOCIAL_IMAGE_URL },
  { property: "og:image:type", content: "image/png" },
  { property: "og:image:width", content: "1600" },
  { property: "og:image:height", content: "900" },
  { property: "og:image:alt", content: OPENBOT_SOCIAL_IMAGE_ALT },
] as const;

export const OPENBOT_SOCIAL_IMAGE_TAGS = {
  openGraph: OPENBOT_SOCIAL_IMAGE_META,
  twitter: [
    { name: "twitter:image", content: OPENBOT_SOCIAL_IMAGE_URL },
    { name: "twitter:image:alt", content: OPENBOT_SOCIAL_IMAGE_ALT },
  ],
} as const;

export interface PageSocialImage {
  path: string;
  alt: string;
}

export const OPENBOT_LEGAL_SOCIAL_IMAGE: PageSocialImage = {
  path: "/social/legal.jpg",
  alt: "Plain terms. No surprises. GoAhead agents beside a paper map",
};

export function pageSocialImageMeta(image: PageSocialImage, siteUrl: string) {
  const url = new URL(image.path, siteUrl).toString();
  return {
    openGraph: [
      { property: "og:image", content: url },
      { property: "og:image:type", content: "image/jpeg" },
      { property: "og:image:width", content: "1600" },
      { property: "og:image:height", content: "900" },
      { property: "og:image:alt", content: image.alt },
    ],
    twitter: [
      { name: "twitter:image", content: url },
      { name: "twitter:image:alt", content: image.alt },
    ],
  } as const;
}

const OPENBOT_PRODUCTION_HOSTS = new Set([
  new URL(PRODUCT_IDENTITY.siteOrigin).host,
  new URL(PRODUCT_IDENTITY.controlPlaneOrigin).host,
]);

export function siteUrlForPage(pageUrl: URL): string {
  return OPENBOT_PRODUCTION_HOSTS.has(pageUrl.hostname) ? OPENBOT_SITE_URL : `${pageUrl.origin}/`;
}

export interface OpenBotApplicationFacts {
  version: string;
  screenshot: string;
}

export function openBotSoftwareApplication(facts: OpenBotApplicationFacts) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": OPENBOT_APPLICATION_ID,
    name: "GoAhead",
    url: OPENBOT_SITE_URL,
    image: OPENBOT_SOCIAL_IMAGE_URL,
    description: OPENBOT_SITE_DESCRIPTION,
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: "AI agent app",
    operatingSystem: "macOS 13 or later (Apple silicon)",
    downloadUrl: new URL(OPENBOT_DOWNLOAD_LINKS.macos, OPENBOT_SITE_URL).toString(),
    featureList: [
      "Runs Codex, Claude Code, Gemini (Antigravity), Grok and OpenCode agents",
      "Uses your ChatGPT, Claude, Google AI Pro or Ultra, or Grok plan",
      "Any OpenAI-compatible model server, also one on your own computer",
      "Agents that work as a team and keep their workspace and history",
      "Chats, files and workspaces stay on your computer",
      "iPhone and Android apps that connect to your own computer",
      "Free for noncommercial use",
    ],
    isAccessibleForFree: true,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    softwareVersion: facts.version,
    screenshot: facts.screenshot,
    license: OPENBOT_LICENSE_URL,
    publisher: { "@id": OPENBOT_ORGANIZATION_ID },
    sameAs: [OPENBOT_REPOSITORY_URL],
  } as const;
}

export type OpenBotSoftwareApplication = ReturnType<typeof openBotSoftwareApplication>;

const OPENBOT_ORGANIZATION = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": OPENBOT_ORGANIZATION_ID,
  name: "GoAhead",
  url: OPENBOT_SITE_URL,
  logo: OPENBOT_LOGO_URL,
  sameAs: [OPENBOT_REPOSITORY_URL, OPENBOT_X_URL],
} as const;

const OPENBOT_WEBSITE = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": OPENBOT_WEBSITE_ID,
  name: "GoAhead",
  url: OPENBOT_SITE_URL,
  publisher: { "@id": OPENBOT_ORGANIZATION_ID },
} as const;

export const OPENBOT_SECURITY_HEADERS = {
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
} as const;

export function openBotRootHead(interLatinFont: string) {
  return {
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: OPENBOT_SITE_TITLE },
      { name: "description", content: OPENBOT_SITE_DESCRIPTION },
      { name: "application-name", content: "GoAhead" },
      { name: "color-scheme", content: "dark" },
      { name: "theme-color", content: "#1a1a1a" },
    ],
    links: [
      {
        rel: "preload",
        as: "font" as const,
        type: "font/woff2",
        href: interLatinFont,
        crossorigin: "anonymous" as const,
      },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", href: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
  };
}

const OPENBOT_HOME_SOCIAL_IMAGE: PageSocialImage = {
  path: "/social/home.jpg",
  alt: "Models come and go. Your team stays. GoAhead agents on a paper planet",
};

export interface HomePageHead {
  title: string;
  description: string;
  questions: readonly LandingQuestion[];
  path: string;
  openGraphLocale: string;
  alternates: readonly { hreflang: string; path: string }[];
}

export function openBotHomeHead(application: OpenBotSoftwareApplication, siteUrl: string, page: HomePageHead) {
  const image = pageSocialImageMeta(OPENBOT_HOME_SOCIAL_IMAGE, siteUrl);
  const url = new URL(page.path, OPENBOT_SITE_URL).toString();
  const [fallback] = page.alternates;
  return {
    meta: [
      { title: page.title },
      { name: "description", content: page.description },
      { "script:ld+json": application },
      { "script:ld+json": OPENBOT_ORGANIZATION },
      { "script:ld+json": OPENBOT_WEBSITE },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "GoAhead" },
      { property: "og:locale", content: page.openGraphLocale },
      { property: "og:url", content: url },
      { property: "og:title", content: page.title },
      { property: "og:description", content: page.description },
      ...image.openGraph,
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: OPENBOT_X_HANDLE },
      { name: "twitter:title", content: page.title },
      { name: "twitter:description", content: page.description },
      ...image.twitter,
      { "script:ld+json": faqStructuredData(page.questions) },
    ],
    links: [
      { rel: "canonical", href: url },
      ...page.alternates.map((alternate) => ({
        rel: "alternate",
        hreflang: alternate.hreflang,
        href: new URL(alternate.path, OPENBOT_SITE_URL).toString(),
      })),
      ...(fallback
        ? [{ rel: "alternate", hreflang: "x-default", href: new URL(fallback.path, OPENBOT_SITE_URL).toString() }]
        : []),
    ],
  };
}
