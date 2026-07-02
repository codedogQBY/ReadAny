/**
 * Translation Providers
 * Supports AI (using existing AI config) and DeepL
 */

import { buildOpenAICompatibleUrl } from "../utils/api";
import type { TranslationProvider, TranslatorName } from "./types";

/** Get language display name */
function getLanguageName(code: string): string {
  const langMap: Record<string, string> = {
    "zh-CN": "Simplified Chinese",
    "zh-TW": "Traditional Chinese",
    ja: "Japanese",
    ko: "Korean",
    en: "English",
    fr: "French",
    de: "German",
    es: "Spanish",
    pt: "Portuguese",
    it: "Italian",
    ru: "Russian",
    ar: "Arabic",
    th: "Thai",
    vi: "Vietnamese",
    id: "Indonesian",
    tr: "Turkish",
    pl: "Polish",
    nl: "Dutch",
    sv: "Swedish",
    ug: "Uyghur",
  };
  return langMap[code] || code;
}

function isChineseLanguage(code: string): boolean {
  return code === "zh-CN" || code === "zh-TW" || code === "zh";
}

export function buildAITranslationPrompt(
  sourceLang: string,
  targetLang: string,
  options: { numbered?: boolean } = {},
): string {
  const targetLangName = getLanguageName(targetLang);
  const outputRule = options.numbered
    ? 'Output translations only, keep the same numbering format "N. translation". Do not add any explanation.'
    : "Only output the translation, no explanations or additional text.";
  const chineseRule = isChineseLanguage(targetLang)
    ? ` When translating to ${targetLangName}, if the source text is Classical/Literary Chinese or archaic Chinese, translate it into modern vernacular ${targetLangName}; for example, "学而不思则罔，思而不学则殆" should become a modern-language rendering of the meaning, not the original sentence. If a same-language literal translation would be identical, output a concise modern paraphrase. Do not mention source, author, title, background, citations, commentary, or analysis. For short Chinese words or single characters, output the most likely modern meaning in context instead of copying the source text.`
    : "";
  const conversionRule =
    isChineseLanguage(sourceLang) || isChineseLanguage(targetLang)
      ? " Important: Even if the source text appears similar to the target language (e.g. Traditional Chinese to Simplified Chinese), you must still perform the conversion."
      : "";

  return `You are a professional translator. Translate the following text to ${targetLangName}. ${outputRule}${chineseRule}${conversionRule}`;
}

/** AI Translation - uses OpenAI-compatible API */
export async function aiTranslate(
  texts: string[],
  sourceLang: string,
  targetLang: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  useExactRequestUrl = false,
): Promise<string[]> {
  const requestUrl = buildOpenAICompatibleUrl(
    baseUrl,
    "chat/completions",
    "https://api.openai.com",
    useExactRequestUrl,
  );
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  // For single text, use simple translation
  if (texts.length === 1) {
    const response = await fetch(requestUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: buildAITranslationPrompt(sourceLang, targetLang),
          },
          { role: "user", content: texts[0] },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`AI API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    return [data.choices[0]?.message?.content?.trim() || texts[0]];
  }

  // For multiple texts, translate individually
  return Promise.all(
    texts.map(async (text) => {
      try {
        const response = await fetch(requestUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: model || "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: buildAITranslationPrompt(sourceLang, targetLang),
              },
              { role: "user", content: text },
            ],
            temperature: 0.3,
            max_tokens: 2048,
          }),
        });
        if (!response.ok) {
          console.warn(`[aiTranslate] API error for text: ${response.status}`);
          return "";
        }
        const data = await response.json();
        return data.choices[0]?.message?.content?.trim() || "";
      } catch (err) {
        console.warn("[aiTranslate] Individual translation failed:", err);
        return "";
      }
    }),
  );
}

/**
 * AI Batch Translation — numbered paragraph format.
 * Sends multiple paragraphs in a single API call using numbering to keep
 * context coherent and parsing reliable. Falls back to individual calls
 * on parse failure.
 */
export async function aiTranslateBatch(
  texts: string[],
  sourceLang: string,
  targetLang: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  useExactRequestUrl = false,
): Promise<string[]> {
  // Single text — just delegate
  if (texts.length <= 1) {
    return aiTranslate(
      texts,
      sourceLang,
      targetLang,
      apiKey,
      baseUrl,
      model,
      useExactRequestUrl,
    );
  }

  const requestUrl = buildOpenAICompatibleUrl(
    baseUrl,
    "chat/completions",
    "https://api.openai.com",
    useExactRequestUrl,
  );
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  // Build numbered input
  const numberedInput = texts.map((t, i) => `${i + 1}. ${t}`).join("\n");

  try {
    const response = await fetch(requestUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: buildAITranslationPrompt(sourceLang, targetLang, { numbered: true }),
          },
          { role: "user", content: numberedInput },
        ],
        temperature: 0.3,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`AI API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    const content: string = data.choices[0]?.message?.content?.trim() || "";

    // Parse numbered output
    const parsed = parseNumberedTranslation(content, texts.length);
    if (parsed) return parsed;

    // Fallback: could not parse — translate individually
    console.warn("[aiTranslateBatch] Failed to parse numbered output, falling back to individual");
  } catch (err) {
    console.warn("[aiTranslateBatch] Batch request failed, falling back:", err);
  }

  // Fallback to individual
  return aiTranslate(
    texts,
    sourceLang,
    targetLang,
    apiKey,
    baseUrl,
    model,
    useExactRequestUrl,
  );
}

/** Parse "1. xxx\n2. yyy\n..." format into an array */
function parseNumberedTranslation(content: string, expectedCount: number): string[] | null {
  const lines = content.split("\n").filter((l) => l.trim());
  const result: string[] = new Array(expectedCount).fill("");

  for (const line of lines) {
    const match = line.match(/^(\d+)\.\s*(.+)/);
    if (match) {
      const idx = Number.parseInt(match[1], 10) - 1;
      if (idx >= 0 && idx < expectedCount) {
        result[idx] = match[2].trim();
      }
    }
  }

  // Verify we got enough translations (at least 60%)
  const filled = result.filter((r) => r).length;
  if (filled < expectedCount * 0.6) return null;

  return result;
}

/** DeepL Translation */
const DEFAULT_DEEPL_BASE_URL = "https://api-free.deepl.com/v2";

type DeepLBackendMode = "deepl" | "deeplx";

interface ResolvedDeepLConfig {
  mode: DeepLBackendMode;
  requestBaseUrl: string;
  apiKey?: string;
  exactTranslateUrl?: string;
}

export function normalizeDeepLBaseUrl(baseUrl?: string): string {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return DEFAULT_DEEPL_BASE_URL;
  }

  const withoutTrailingSlash = trimmed.replace(/\/+$/, "");
  return withoutTrailingSlash.replace(/\/translate$/i, "");
}

export function getDeepLUrl(baseUrl: string | undefined, path: "translate" | "usage"): string {
  return `${normalizeDeepLBaseUrl(baseUrl)}/${path}`;
}

function isOfficialDeepLHost(hostname: string): boolean {
  return hostname === "api.deepl.com" || hostname === "api-free.deepl.com" || hostname.endsWith(".deepl.com");
}

function resolveDeepLConfig(baseUrl: string | undefined, apiKey: string): ResolvedDeepLConfig {
  const rawBaseUrl = baseUrl?.trim();
  const normalizedBaseUrl = normalizeDeepLBaseUrl(rawBaseUrl);
  const url = new URL(normalizedBaseUrl);
  const rawPathSegments = (rawBaseUrl ? new URL(rawBaseUrl) : url).pathname.split("/").filter(Boolean);
  const pathSegments = [...rawPathSegments];
  const hasTranslateSuffix = (rawBaseUrl || "").replace(/\/+$/, "").endsWith("/translate");
  const exactTranslateUrl = hasTranslateSuffix ? (rawBaseUrl || "").replace(/\/+$/, "") : undefined;
  if (hasTranslateSuffix) {
    pathSegments.pop();
  }
  const lastPathSegment = pathSegments[pathSegments.length - 1];
  const isOfficial = isOfficialDeepLHost(url.hostname) || lastPathSegment === "v2";

  if (isOfficial) {
    return {
      mode: "deepl",
      requestBaseUrl: normalizedBaseUrl,
      apiKey,
      exactTranslateUrl,
    };
  }

  const remainingSegments = [...pathSegments];
  let resolvedApiKey = apiKey.trim();

  if (remainingSegments.length > 0) {
    const lastSegment = remainingSegments[remainingSegments.length - 1] || "";
    if (!resolvedApiKey || lastSegment === resolvedApiKey) {
      resolvedApiKey = resolvedApiKey || lastSegment;
      remainingSegments.pop();
    }
  }

  return {
    mode: "deeplx",
    requestBaseUrl: `${url.origin}${remainingSegments.length ? `/${remainingSegments.join("/")}` : ""}`,
    apiKey: resolvedApiKey || undefined,
    exactTranslateUrl,
  };
}

function extractDeepLXTranslation(data: any): string | null {
  const candidate = typeof data?.data === "string" ? data.data : typeof data?.translation === "string" ? data.translation : null;
  if (!candidate) {
    return null;
  }

  if (/^https:\/\/linux\.do\/t\/topic\/111737\/?$/i.test(candidate.trim())) {
    throw new Error(
      "DeepLX endpoint returned the Linux.do announcement link instead of a translation. Please refresh the DeepLX Connect URL or API key.",
    );
  }

  return candidate;
}

function normalizeDeepLXLang(code: string, isSource: boolean): string {
  if (isSource && code === "AUTO") {
    return "auto";
  }

  const normalized = code.toUpperCase().replace("-", "_");
  if (normalized === "ZH_CN" || normalized === "ZH_TW") {
    return "ZH";
  }

  return normalized;
}

async function deeplTranslateOfficial(
  texts: string[],
  sourceLang: string,
  targetLang: string,
  apiKey: string,
  requestBaseUrl: string,
): Promise<string[]> {
  const params = new URLSearchParams();
  texts.forEach((text) => params.append("text", text));
  params.append("target_lang", targetLang.toUpperCase().replace("-", "_"));
  if (sourceLang !== "AUTO") {
    params.append("source_lang", sourceLang.toUpperCase());
  }

  const response = await fetch(`${requestBaseUrl}/translate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `DeepL-Auth-Key ${apiKey}`,
    },
    body: params,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`DeepL API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  return texts.map((_, i) => data.translations?.[i]?.text || texts[i]);
}

async function deeplTranslateDeepLX(
  texts: string[],
  sourceLang: string,
  targetLang: string,
  apiKey: string | undefined,
  requestBaseUrl: string,
  exactTranslateUrl?: string,
): Promise<string[]> {
  const normalizedSource = normalizeDeepLXLang(sourceLang, true);
  const normalizedTarget = normalizeDeepLXLang(targetLang, false);

  const results: string[] = [];
  const endpointCandidates = [exactTranslateUrl, `${requestBaseUrl}/translate`].filter(
    (value, index, array): value is string => Boolean(value) && array.indexOf(value) === index,
  );

  // DeepLX public endpoints generally accept one text per request.
  for (const text of texts) {
    let lastError: Error | null = null;

    for (const endpoint of endpointCandidates) {
      const translateUrl = new URL(endpoint);
      if (apiKey) {
        translateUrl.searchParams.set("token", apiKey);
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      const response = await fetch(translateUrl.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify({
          text,
          source_lang: normalizedSource,
          target_lang: normalizedTarget,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        lastError = new Error(`DeepLX API error (${response.status}): ${error}`);
        continue;
      }

      const data = await response.json();
      const translated = extractDeepLXTranslation(data);
      if (translated) {
        results.push(translated);
        lastError = null;
        break;
      }

      lastError = new Error("DeepLX API returned an unexpected response payload.");
    }

    if (lastError) {
      throw lastError;
    }
  }

  return results;
}

export async function testDeepLConnection(apiKey: string, baseUrl?: string): Promise<boolean> {
  await deeplTranslate(["Connection test"], "AUTO", "ZH", apiKey, baseUrl);
  return true;
}

export async function deeplTranslate(
  texts: string[],
  sourceLang: string,
  targetLang: string,
  apiKey: string,
  baseUrl?: string,
): Promise<string[]> {
  const resolvedConfig = resolveDeepLConfig(baseUrl, apiKey);

  if (resolvedConfig.mode === "deeplx") {
    if (!resolvedConfig.apiKey && !resolvedConfig.exactTranslateUrl) {
      throw new Error("DeepLX API key is required");
    }

    return deeplTranslateDeepLX(
      texts,
      sourceLang,
      targetLang,
      resolvedConfig.apiKey,
      resolvedConfig.requestBaseUrl,
      resolvedConfig.exactTranslateUrl,
    );
  }

  if (!resolvedConfig.apiKey) {
    throw new Error("DeepL API key is required");
  }

  return deeplTranslateOfficial(
    texts,
    sourceLang,
    targetLang,
    resolvedConfig.apiKey,
    resolvedConfig.requestBaseUrl,
  );
}

/** Provider interface for internal use */
interface InternalTranslationProvider {
  name: TranslatorName;
  label: string;
}

/** Available translators list */
export const TRANSLATOR_PROVIDERS: InternalTranslationProvider[] = [
  { name: "ai", label: "AI 翻译" },
  { name: "deepl", label: "DeepL" },
];

/** Get all available translators */
export function getTranslators(): InternalTranslationProvider[] {
  return TRANSLATOR_PROVIDERS;
}

/** Legacy exports for compatibility */
export const aiProvider: TranslationProvider = {
  name: "ai",
  label: "AI",
  translate: async (texts, sourceLang, targetLang, config) => {
    const { apiKey, baseUrl, model, useExactRequestUrl } = config as {
      apiKey?: string;
      baseUrl?: string;
      model?: string;
      useExactRequestUrl?: boolean;
    };
    return aiTranslate(
      texts,
      sourceLang,
      targetLang,
      apiKey || "",
      baseUrl || "",
      model || "",
      useExactRequestUrl || false,
    );
  },
};

export const deeplProvider: TranslationProvider = {
  name: "deepl",
  label: "DeepL",
  translate: async (texts, sourceLang, targetLang, config) => {
    const { apiKey, baseUrl } = config as { apiKey?: string; baseUrl?: string };
    return deeplTranslate(texts, sourceLang, targetLang, apiKey || "", baseUrl);
  },
};

// ─── Microsoft Edge Translate (Free, no API key required) ─────────────────────

let _msToken: string | null = null;
let _msTokenExpiry = 0;

/** Language code mapping: our codes → Microsoft API codes */
export function toMicrosoftLangCode(lang: string): string {
  const normalized = lang.trim().replace(/_/g, "-");
  const lower = normalized.toLowerCase();

  if (lower === "zh" || lower === "zh-cn" || lower === "zh-sg" || lower === "zh-hans") {
    return "zh-Hans";
  }
  if (lower === "zh-tw" || lower === "zh-hk" || lower === "zh-mo" || lower === "zh-hant") {
    return "zh-Hant";
  }

  return normalized;
}

/** Microsoft supported source languages (subset for validation) */
const MS_SUPPORTED_LANGS = new Set([
  "af", "am", "ar", "as", "az", "ba", "bg", "bn", "bo", "bs", "ca", "cs", "cy", "da", "de",
  "dv", "el", "en", "es", "et", "eu", "fa", "fi", "fil", "fj", "fo", "fr", "ga", "gl", "gu",
  "ha", "he", "hi", "hr", "ht", "hu", "hy", "id", "ig", "ikt", "is", "it", "iu", "ja", "ka",
  "kk", "km", "kn", "ko", "ku", "ky", "ln", "lo", "lt", "lv", "mg", "mi", "mk", "ml", "mn",
  "mr", "ms", "mt", "my", "nb", "ne", "nl", "no", "or", "pa", "pl", "ps", "pt", "ro", "ru",
  "rw", "sd", "si", "sk", "sl", "sm", "sn", "so", "sq", "sr", "st", "sv", "sw", "ta", "te",
  "th", "ti", "tk", "tl", "tn", "to", "tr", "tt", "ty", "ug", "uk", "ur", "uz", "vi", "xh",
  "yo", "yue", "zh-Hans", "zh-Hant", "zu",
]);

/** Get or refresh the free Microsoft Edge translate JWT token */
async function getMicrosoftToken(): Promise<string> {
  if (_msToken && Date.now() < _msTokenExpiry) return _msToken;

  const resp = await fetch("https://edge.microsoft.com/translate/auth");
  if (!resp.ok) {
    throw new Error(`Failed to get Microsoft translate token: ${resp.status}`);
  }
  _msToken = await resp.text();
  // Token valid ~10 min, refresh at 8 min
  _msTokenExpiry = Date.now() + 8 * 60 * 1000;
  return _msToken;
}

/**
 * Microsoft Edge Translate — free, no API key needed.
 * Supports batch (multiple texts in one request).
 */
export async function microsoftTranslate(
  texts: string[],
  sourceLang: string,
  targetLang: string,
): Promise<string[]> {
  const token = await getMicrosoftToken();
  const mappedSource = toMicrosoftLangCode(sourceLang);
  // If source lang is "auto"/"AUTO", empty, or not recognized by Microsoft, omit it for auto-detection
  const from = (!sourceLang || sourceLang.toLowerCase() === "auto" || !MS_SUPPORTED_LANGS.has(mappedSource)) ? "" : mappedSource;
  const to = toMicrosoftLangCode(targetLang);
  const params = new URLSearchParams({
    "api-version": "3.0",
    to,
  });
  if (from) {
    params.set("from", from);
  }

  const body = texts.map((t) => ({ Text: t }));

  const resp = await fetch(
    `https://api-edge.cognitive.microsofttranslator.com/translate?${params.toString()}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
  );

  if (!resp.ok) {
    // If 401, invalidate token for retry on next call
    if (resp.status === 401) {
      _msToken = null;
      _msTokenExpiry = 0;
    }
    const errText = await resp.text().catch(() => "");
    throw new Error(`Microsoft translate failed: ${resp.status} ${errText}`);
  }

  const result = (await resp.json()) as Array<{
    translations: Array<{ text: string }>;
  }>;

  return result.map((r) => r.translations?.[0]?.text ?? "");
}

export const microsoftProvider: TranslationProvider = {
  name: "microsoft",
  label: "微软翻译 (免费)",
  translate: async (texts, sourceLang, targetLang) => {
    return microsoftTranslate(texts, sourceLang, targetLang);
  },
};

/** Get a translator by name */
export function getTranslator(name: TranslatorName): TranslationProvider | undefined {
  if (name === "microsoft") return microsoftProvider;
  if (name === "ai") return aiProvider;
  if (name === "deepl") return deeplProvider;
  return undefined;
}
