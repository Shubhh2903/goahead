import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLocale, translateFor } from "./index";
import { createTranslate } from "./message";

describe("resolveLocale", () => {
  it("draws in English for every system locale while the app is English only", () => {
    expect(resolveLocale("system", "en-GB")).toBe("en");
    expect(resolveLocale("system", "fr-FR")).toBe("en");
    expect(resolveLocale("system", "ja-JP")).toBe("en");
    expect(resolveLocale("system", "fi-FI")).toBe("en");
  });

  it("reads a saved French, Japanese, Portuguese or Turkish preference as English", () => {
    expect(resolveLocale("fr", "ja-JP")).toBe("en");
    expect(resolveLocale("ja", "en-US")).toBe("en");
    expect(resolveLocale("pt", "en-US")).toBe("en");
    expect(resolveLocale("tr", "en-US")).toBe("en");
    expect(resolveLocale("en", "ja-JP")).toBe("en");
  });
});

describe("translateFor", () => {
  it("returns the translation for the locale", () => {
    expect(translateFor("fr")("menu.stopAllAgents")).toBe("Arrêter tous les agents");
    expect(translateFor("ja")("menu.stopAllAgents")).toBe("すべてのエージェントを停止");
    expect(translateFor("pt")("menu.stopAllAgents")).toBe("Parar todos os agentes");
    expect(translateFor("tr")("menu.stopAllAgents")).toBe("Tüm ajanları durdur");
    expect(translateFor("en")("menu.stopAllAgents")).toBe("Stop all agents");
  });

  it("uses translated plural forms", () => {
    expect(translateFor("fr")("provider.endpointCount", { count: 1 })).toBe("1 point de terminaison");
    expect(translateFor("fr")("provider.endpointCount", { count: 2 })).toBe("2 points de terminaison");
    expect(translateFor("pt")("provider.endpointCount", { count: 0 })).toBe("0 endpoint");
    expect(translateFor("pt")("provider.endpointCount", { count: 2 })).toBe("2 endpoints");
  });
});

describe("createTranslate", () => {
  const source = {
    greeting: "Hello {name}",
    replies: { one: "{count} reply", other: "{count} replies" },
  } as const;

  it("falls back to the English source when a catalog has not translated a key", () => {
    // A catalog from a newer build can be missing a key this build added. English is readable;
    // an empty string is not.
    const translate = createTranslate({
      source,
      translation: { greeting: "こんにちは {name}" },
      locale: "ja",
      sourceLocale: "en",
    });
    expect(translate("replies", { count: 2 })).toBe("2 replies");
    // English text, so English plural rules. Japanese has one form for every count, and choosing
    // by the language that was asked for rather than by the language of the text renders
    // "1 replies".
    expect(translate("replies", { count: 1 })).toBe("1 reply");
  });

  it("picks the plural form the locale asks for", () => {
    const english = createTranslate({ source, locale: "en", sourceLocale: "en" });
    expect(english("replies", { count: 1 })).toBe("1 reply");
    expect(english("replies", { count: 5 })).toBe("5 replies");
  });

  it("uses the single form in a language without a plural distinction", () => {
    const japanese = createTranslate({
      source,
      translation: { greeting: "こんにちは {name}", replies: { other: "{count} 件の返信" } },
      locale: "ja",
      sourceLocale: "en",
    });
    expect(japanese("replies", { count: 1 })).toBe("1 件の返信");
    expect(japanese("replies", { count: 5 })).toBe("5 件の返信");
  });

  it("renders readable text for a locale tag Intl rejects", () => {
    const broken = createTranslate({ source, locale: "not a locale", sourceLocale: "en" });
    expect(broken("replies", { count: 2 })).toBe("2 replies");
  });
});

describe("plural forms without Intl.PluralRules", () => {
  // Hermes, which runs the mobile app, may not ship Intl.PluralRules. Without the built-in rules a
  // plural message would throw and blank the screen.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the built-in rule for each translated language", () => {
    vi.stubGlobal("Intl", { ...Intl, PluralRules: undefined });
    const source = { replies: { one: "{count} reply", other: "{count} replies" } } as const;
    const english = createTranslate({ source, locale: "en", sourceLocale: "en" });
    expect(english("replies", { count: 1 })).toBe("1 reply");
    expect(english("replies", { count: 0 })).toBe("0 replies");

    const french = createTranslate({
      source,
      translation: { replies: { one: "{count} réponse", other: "{count} réponses" } },
      locale: "fr",
      sourceLocale: "en",
    });
    expect(french("replies", { count: 0 })).toBe("0 réponse");
    expect(french("replies", { count: 2 })).toBe("2 réponses");

    const japanese = createTranslate({
      source,
      translation: { replies: { one: "wrong", other: "{count} 件の返信" } },
      locale: "ja",
      sourceLocale: "en",
    });
    expect(japanese("replies", { count: 1 })).toBe("1 件の返信");

    const portuguese = createTranslate({
      source,
      translation: { replies: { one: "{count} resposta", many: "{count} de respostas", other: "{count} respostas" } },
      locale: "pt",
      sourceLocale: "en",
    });
    expect(portuguese("replies", { count: 0 })).toBe("0 resposta");
    expect(portuguese("replies", { count: -1 })).toBe("-1 resposta");
    expect(portuguese("replies", { count: 1.5 })).toBe("1.5 resposta");
    expect(portuguese("replies", { count: 2 })).toBe("2 respostas");
    expect(portuguese("replies", { count: 1_000_000 })).toBe("1000000 de respostas");

    const turkish = createTranslate({
      source,
      translation: { replies: { one: "{count} yanıt", other: "{count} yanıt" } },
      locale: "tr",
      sourceLocale: "en",
    });
    expect(turkish("replies", { count: 1 })).toBe("1 yanıt");
    expect(turkish("replies", { count: 2 })).toBe("2 yanıt");
  });
});
