/**
 * Translation service — supports OpenAI and DeepL providers
 * Full implementation with actual API calls
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

/** Get the display name for a language code */
export function getLanguageName(code: TranslationTargetLang): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.name || code;
}

/** Get the native name for a language code */
export function getLanguageNativeName(code: TranslationTargetLang): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.nativeName || code;
}

/** Translate text using configured provider */
export async function translate(
  text: string,
  config: TranslationConfig,
): Promise<TranslationResult> {
  const providerId = config.provider.id;

  if (providerId === "openai" || config.provider.apiKey) {
    // Use OpenAI for translation if we have an API key
    return translateWithOpenAI(text, config);
  }

  if (providerId === "deepl") {
    return translateWithDeepL(text, config);
  }

  // Fallback: return empty translation
  return {
    originalText: text,
    translatedText: "",
    targetLang: config.targetLang,
  };
}

/** Translate multiple texts in batch */
export async function translateBatch(
  texts: string[],
  config: TranslationConfig,
): Promise<TranslationResult[]> {
  // For OpenAI, we can batch texts into a single request
  if (config.provider.id === "openai" || config.provider.apiKey) {
    return translateBatchWithOpenAI(texts, config);
  }

  // For DeepL, translate individually (their API supports batch too)
  return Promise.all(texts.map((text) => translate(text, config)));
}

/** Translate using OpenAI Chat Completions */
async function translateWithOpenAI(
  text: string,
  config: TranslationConfig,
): Promise<TranslationResult> {
  const targetLangName = getLanguageName(config.targetLang);
  const apiKey = config.provider.apiKey;
  const baseUrl = config.provider.baseUrl || "https://api.openai.com/v1";

  if (!apiKey) {
    throw new Error("OpenAI API key is required for translation");
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a professional translator. Translate the following text to ${targetLangName}. Only output the translation, no explanations or additional text.`,
        },
        {
          role: "user",
          content: text,
        },
      ],
      temperature: 0.3,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Translation API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  const translatedText = data.choices[0]?.message?.content?.trim() || "";

  return {
    originalText: text,
    translatedText,
    targetLang: config.targetLang,
  };
}

/** Batch translate using OpenAI */
async function translateBatchWithOpenAI(
  texts: string[],
  config: TranslationConfig,
): Promise<TranslationResult[]> {
  if (texts.length === 0) return [];
  if (texts.length === 1) return [await translateWithOpenAI(texts[0], config)];

  const targetLangName = getLanguageName(config.targetLang);
  const apiKey = config.provider.apiKey;
  const baseUrl = config.provider.baseUrl || "https://api.openai.com/v1";

  if (!apiKey) {
    throw new Error("OpenAI API key is required for translation");
  }

  // Combine texts with delimiters for batch processing
  const delimiter = "\n---SEPARATOR---\n";
  const combinedText = texts.join(delimiter);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a professional translator. Translate each of the following text segments to ${targetLangName}. The segments are separated by "---SEPARATOR---". Output your translations in the same order, separated by the same delimiter. Only output translations, no explanations.`,
        },
        {
          role: "user",
          content: combinedText,
        },
      ],
      temperature: 0.3,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    // Fallback to individual translations
    return Promise.all(texts.map((text) => translateWithOpenAI(text, config)));
  }

  const data = await response.json();
  const translatedCombined = data.choices[0]?.message?.content?.trim() || "";
  const translatedTexts = translatedCombined.split(/---SEPARATOR---/);

  return texts.map((text, i) => ({
    originalText: text,
    translatedText: translatedTexts[i]?.trim() || "",
    targetLang: config.targetLang,
  }));
}

/** Translate using DeepL API */
async function translateWithDeepL(
  text: string,
  config: TranslationConfig,
): Promise<TranslationResult> {
  const apiKey = config.provider.apiKey;
  if (!apiKey) {
    throw new Error("DeepL API key is required for translation");
  }

  const baseUrl = config.provider.baseUrl || "https://api-free.deepl.com/v2";

  const response = await fetch(`${baseUrl}/translate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `DeepL-Auth-Key ${apiKey}`,
    },
    body: new URLSearchParams({
      text,
      target_lang: config.targetLang.toUpperCase().replace("-", "_"),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`DeepL API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  const translatedText = data.translations?.[0]?.text || "";

  return {
    originalText: text,
    translatedText,
    targetLang: config.targetLang,
  };
}
