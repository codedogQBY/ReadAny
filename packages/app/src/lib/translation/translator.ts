/**
 * Translation service — supports multiple providers and 22 target languages
 */
import type { TranslationConfig, TranslationTargetLang } from "@/types";

export const SUPPORTED_LANGUAGES: Array<{
  code: TranslationTargetLang;
  name: string;
  nativeName: string;
}> = [
  { code: "zh-CN", name: "Chinese (Simplified)", nativeName: "简体中文" },
  { code: "zh-TW", name: "Chinese (Traditional)", nativeName: "繁體中文" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "en", name: "English", nativeName: "English" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "ru", name: "Russian", nativeName: "Русский" },
  { code: "ar", name: "Arabic", nativeName: "العربية" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
  { code: "th", name: "Thai", nativeName: "ไทย" },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt" },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia" },
  { code: "ms", name: "Malay", nativeName: "Bahasa Melayu" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe" },
  { code: "pl", name: "Polish", nativeName: "Polski" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands" },
  { code: "sv", name: "Swedish", nativeName: "Svenska" },
  { code: "da", name: "Danish", nativeName: "Dansk" },
];

export interface TranslationResult {
  originalText: string;
  translatedText: string;
  targetLang: TranslationTargetLang;
  confidence?: number;
}

/** Translate text using configured provider */
export async function translate(
  text: string,
  config: TranslationConfig,
): Promise<TranslationResult> {
  // TODO: Call translation API based on provider
  void text;
  void config;
  return {
    originalText: text,
    translatedText: "", // TODO: actual translation
    targetLang: config.targetLang,
  };
}

/** Translate multiple texts in batch */
export async function translateBatch(
  texts: string[],
  config: TranslationConfig,
): Promise<TranslationResult[]> {
  // TODO: Batch translation with rate limiting
  return texts.map((text) => ({
    originalText: text,
    translatedText: "",
    targetLang: config.targetLang,
  }));
}
