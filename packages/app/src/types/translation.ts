/**
 * Translation Types
 */

export type TranslatorName = "ai" | "deepl";

export interface TranslationProvider {
  id: TranslatorName;
  name: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  endpointId?: string; // For AI translation, which endpoint to use
}

export type TranslationTargetLang =
  | "zh-CN"
  | "zh-TW"
  | "ja"
  | "ko"
  | "en"
  | "fr"
  | "de"
  | "es"
  | "pt"
  | "it"
  | "ru"
  | "ar"
  | "th"
  | "vi"
  | "id"
  | "tr"
  | "pl"
  | "nl"
  | "sv";

export interface TranslationConfig {
  provider: TranslationProvider;
  targetLang: TranslationTargetLang;
}

export const TRANSLATOR_PROVIDERS: Array<{ id: TranslatorName; name: string }> = [
  { id: "ai", name: "AI 翻译" },
  { id: "deepl", name: "DeepL" },
];

export const TRANSLATOR_LANGS: Record<TranslationTargetLang, string> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  ja: "日本語",
  ko: "한국어",
  en: "English",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  pt: "Português",
  it: "Italiano",
  ru: "Русский",
  ar: "العربية",
  th: "ไทย",
  vi: "Tiếng Việt",
  id: "Bahasa Indonesia",
  tr: "Türkçe",
  pl: "Polski",
  nl: "Nederlands",
  sv: "Svenska",
};