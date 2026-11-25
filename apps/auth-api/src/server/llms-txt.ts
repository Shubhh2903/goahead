import { COMPARISONS } from "../content/compare";
import { OPENBOT_PLANS } from "../content/compare/comparison";
import { PROVIDER_PAGES } from "../content/providers";
import { ANDROID_APK_AVAILABLE } from "../lib/android-apk";
import { CHANGELOG_DESCRIPTION, changelogUrl } from "../lib/changelog";
import { CONTENT_COLLECTIONS } from "../lib/content";
import { articleUrl, type CollectionId, collectionIndexUrl } from "../lib/content-collection";
import {
  OPENBOT_ANDROID_APK_LINK,
  OPENBOT_DOWNLOAD_LINKS,
  OPENBOT_DOWNLOAD_PAGE_LINKS,
  OPENBOT_LINKS,
} from "../lib/landing-links";
import { PLUGINS_DESCRIPTION, pluginIndexUrl } from "../lib/plugins";
import { OPENBOT_SITE_DESCRIPTION, OPENBOT_SITE_URL } from "../lib/site-metadata";
import { FEED_CACHE_CONTROL } from "./content-feed";

function referenceAnswer(collection: CollectionId, slug: string): string | undefined {
  if (collection === "compare") return COMPARISONS[slug]?.answer;
  if (collection === "providers") return PROVIDER_PAGES[slug]?.answer;
  return undefined;
}

function absolute(path: string): string {
  return new URL(path, OPENBOT_SITE_URL).href;
}

function llmsTxt(): string {
  const lines = [
    "# GoAhead",
    "",
    `> ${OPENBOT_SITE_DESCRIPTION}`,
    "",
    "GoAhead is a desktop app for macOS on Apple silicon. Versions for Intel Macs, Windows and Linux are not available yet. Each agent has its own workspace, thread and history, and keeps them when you change its provider or restart the app. Agents can give work to other agents, and can move to a backup model on another provider when a plan reaches its limit. Agents also answer in Slack, Discord and Telegram. Chats, files and workspaces stay on your computer; GoAhead has no server that holds them. The app is free for noncommercial use. iPhone and Android apps connect to GoAhead on your own computer.",
    "",
    `Each article below also has its text as Markdown, at its URL with \`.md\` added. [llms-full.txt](${absolute("/llms-full.txt")}) holds all of them in one file.`,
    "",
    "## Models and plans",
    "",
    "GoAhead sells no model. Each agent uses a plan or a key you already have:",
    "",
    ...OPENBOT_PLANS.map((plan) => `- ${plan.name}: ${plan.plan}`),
    "",
    "## Download",
    "",
    `System requirements and install steps: [macOS](${absolute(OPENBOT_DOWNLOAD_PAGE_LINKS.macos)}), [iPhone](${absolute(OPENBOT_DOWNLOAD_PAGE_LINKS.ios)}), [Android](${absolute(OPENBOT_DOWNLOAD_PAGE_LINKS.android)}).`,
    "",
    `- [macOS](${absolute(OPENBOT_DOWNLOAD_LINKS.macos)}): macOS 13 or later, Apple silicon`,
    ...(ANDROID_APK_AVAILABLE
      ? [
          `- [Android APK](${absolute(OPENBOT_ANDROID_APK_LINK)}): Android 7.0 or later, for a phone with no Google Play`,
        ]
      : []),
    `- [Source code](${OPENBOT_LINKS.repository}): PolyForm Noncommercial 1.0.0`,
    "",
  ];

  for (const collection of CONTENT_COLLECTIONS) {
    lines.push(
      `## ${collection.name}`,
      "",
      `${collection.indexDescription} [All](${collectionIndexUrl(collection)})`,
      "",
    );
    for (const article of collection.articles) {
      const answer = referenceAnswer(collection.id, article.slug);
      lines.push(`- [${article.title}](${articleUrl(collection, article.slug)}): ${answer ?? article.description}`);
    }
    lines.push("");
  }

  lines.push(
    "## Optional",
    "",
    `- [Marketplace apps](${pluginIndexUrl()}): ${PLUGINS_DESCRIPTION}`,
    `- [Changelog](${changelogUrl()}): ${CHANGELOG_DESCRIPTION}`,
    "",
  );
  return lines.join("\n");
}

export function llmsTxtResponse(): Response {
  return new Response(llmsTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": FEED_CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
