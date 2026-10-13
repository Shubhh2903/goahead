import { APP_LANGUAGES, type AppLanguage } from "@openbot/contracts/app-language";

/**
 * The rows of the language selector.
 *
 * The identifiers come from the contract. The picker offers only the languages that the interface
 * draws in (`OFFERED_LANGUAGES`). Offering more would be a promise the build cannot keep: choosing one would leave the
 * whole interface in English with no way to tell why.
 *
 * `"system"` follows the language of the computer. It is the default, so a fresh install reads in
 * the user's language before anyone opens Settings, and an explicit choice is only the override.
 */
export interface AppLanguageOption {
  readonly id: AppLanguage;
  /** The language's own name for itself. Unused for `"system"`: `LanguageSelect` translates that row. */
  readonly label: string;
  /** The `lang` attribute, so a screen reader speaks the native name in the right voice. */
  readonly lang?: string;
}

const LABELS: Record<AppLanguage, AppLanguageOption> = {
  system: { id: "system", label: "System default" },
  en: { id: "en", label: "English", lang: "en" },
  fr: { id: "fr", label: "Français", lang: "fr" },
  ja: { id: "ja", label: "日本語", lang: "ja" },
  pt: { id: "pt", label: "Português (Brasil)", lang: "pt-BR" },
  tr: { id: "tr", label: "Türkçe", lang: "tr" },
};

/**
 * The languages the selector offers. GoAhead is English only for now: French, Japanese, Portuguese
 * and Turkish stay valid saved values (`APP_LANGUAGES`), but the selector does not offer them.
 */
const OFFERED_LANGUAGES: readonly AppLanguage[] = ["system", "en"];

/** System first, then the offered languages, in the order of `APP_LANGUAGES`. */
export const APP_LANGUAGE_OPTIONS: readonly AppLanguageOption[] = APP_LANGUAGES.filter((id) =>
  OFFERED_LANGUAGES.includes(id),
).map((id) => LABELS[id]);

/**
 * The option for a saved identifier. A saved language that the selector does not offer shows as
 * English, because the interface draws in English for it. The selector must not be blank.
 */
export function appLanguageOption(id: AppLanguage): AppLanguageOption {
  if (!OFFERED_LANGUAGES.includes(id)) return LABELS.en;
  return LABELS[id] ?? LABELS.system;
}

export type { AppLanguage };
