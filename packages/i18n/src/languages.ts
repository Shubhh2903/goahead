import { APP_LANGUAGES, type AppLanguage } from "@openbot/contracts/app-language";

export interface AppLanguageOption {
  readonly id: AppLanguage;
  readonly label: string;
  readonly lang?: string;
}

const LABELS: Record<AppLanguage, AppLanguageOption> = {
  system: { id: "system", label: "System default" },
  ar: { id: "ar", label: "العربية", lang: "ar" },
  de: { id: "de", label: "Deutsch", lang: "de" },
  es: { id: "es", label: "Español", lang: "es" },
  en: { id: "en", label: "English", lang: "en" },
  fr: { id: "fr", label: "Français", lang: "fr" },
  he: { id: "he", label: "עברית", lang: "he" },
  it: { id: "it", label: "Italiano", lang: "it" },
  ja: { id: "ja", label: "日本語", lang: "ja" },
  ko: { id: "ko", label: "한국어", lang: "ko" },
  nl: { id: "nl", label: "Nederlands", lang: "nl" },
  pl: { id: "pl", label: "Polski", lang: "pl" },
  pt: { id: "pt", label: "Português (Brasil)", lang: "pt-BR" },
  ru: { id: "ru", label: "Русский", lang: "ru" },
  tr: { id: "tr", label: "Türkçe", lang: "tr" },
  zh: { id: "zh", label: "简体中文", lang: "zh-CN" },
};

const OFFERED_LANGUAGES: readonly AppLanguage[] = APP_LANGUAGES;

export const APP_LANGUAGE_OPTIONS: readonly AppLanguageOption[] = APP_LANGUAGES.filter((id) =>
  OFFERED_LANGUAGES.includes(id),
).map((id) => LABELS[id]);
export function appLanguageOption(id: AppLanguage): AppLanguageOption {
  if (!OFFERED_LANGUAGES.includes(id)) return LABELS.en;
  return LABELS[id] ?? LABELS.system;
}

export type { AppLanguage };
