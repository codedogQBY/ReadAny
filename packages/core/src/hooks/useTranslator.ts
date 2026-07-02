/**
 * useTranslator Hook
 * React hook for translation with caching
 * Uses AI config for translation (model, apiKey, baseUrl)
 */

import { useCallback, useState } from "react";
import { useSettingsStore } from "../stores/settings-store";
import { getFromCache, storeInCache } from "../translation/cache";
import { aiTranslate, deeplTranslate, microsoftTranslate } from "../translation/providers";
import type { AIConfig } from "../types";
import type { TranslationConfig, TranslationTargetLang } from "../types/translation";
import { providerRequiresApiKey } from "../utils";

export interface UseTranslatorOptions {
  sourceLang?: string;
  targetLang?: TranslationTargetLang;
  aiConfig?: AIConfig;
  translationConfig?: TranslationConfig;
}

export function useTranslator(options: UseTranslatorOptions = {}) {
  const {
    sourceLang = "AUTO",
    targetLang,
    aiConfig: aiConfigOverride,
    translationConfig: translationConfigOverride,
  } = options;
  const translationConfigFromStore = useSettingsStore((s) => s.translationConfig);
  const aiConfigFromStore = useSettingsStore((s) => s.aiConfig);
  const translationConfig = translationConfigOverride || translationConfigFromStore;
  const aiConfig = aiConfigOverride || aiConfigFromStore;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const translate = useCallback(
    async (texts: string[]): Promise<string[]> => {
      const textsToTranslate = texts.map((t) => t.trim()).filter((t) => t);
      if (textsToTranslate.length === 0) {
        return texts;
      }

      const targetLanguage = targetLang || translationConfig.targetLang;
      const providerId = translationConfig.provider.id;

      const cachedResults: string[] = [];
      const needsTranslation: { index: number; text: string }[] = [];
      await Promise.all(
        textsToTranslate.map(async (text, index) => {
          const cached = await getFromCache(text, sourceLang, targetLanguage, providerId);
          if (cached) {
            cachedResults[index] = cached;
          } else {
            needsTranslation.push({ index, text });
          }
        }),
      );

      if (needsTranslation.length === 0) {
        return textsToTranslate.map((_, i) => cachedResults[i] || "");
      }

      setLoading(true);
      setError(null);

      try {
        let translatedTexts: string[];

        if (providerId === "ai") {
          const endpointId = translationConfig.provider.endpointId || aiConfig.activeEndpointId;
          const endpoint = aiConfig.endpoints.find((e) => e.id === endpointId);
          const model = translationConfig.provider.model || aiConfig.activeModel;

          if (!endpoint || (providerRequiresApiKey(endpoint.provider) && !endpoint.apiKey)) {
            throw new Error("AI endpoint not configured. Please set up AI settings first.");
          }

          translatedTexts = await aiTranslate(
            needsTranslation.map((n) => n.text),
            sourceLang,
            targetLanguage,
            endpoint.apiKey,
            endpoint.baseUrl,
            model,
            endpoint.useExactRequestUrl || false,
          );
        } else if (providerId === "deepl") {
          const apiKey = translationConfig.provider.apiKey;
          if (!apiKey) {
            throw new Error("DeepL API key is required");
          }
          translatedTexts = await deeplTranslate(
            needsTranslation.map((n) => n.text),
            sourceLang,
            targetLanguage,
            apiKey,
            translationConfig.provider.baseUrl,
          );
        } else if (providerId === "microsoft") {
          translatedTexts = await microsoftTranslate(
            needsTranslation.map((n) => n.text),
            sourceLang,
            targetLanguage,
          );
        } else {
          throw new Error(`Unknown translation provider: ${providerId}`);
        }

        await Promise.all(
          needsTranslation.map(async ({ text }, i) => {
            if (translatedTexts[i]) {
              await storeInCache(text, translatedTexts[i], sourceLang, targetLanguage, providerId);
            }
          }),
        );

        const results = [...textsToTranslate];
        cachedResults.forEach((cached, i) => {
          if (cached) results[i] = cached;
        });
        needsTranslation.forEach(({ index }, i) => {
          results[index] = translatedTexts[i] || "";
        });

        setLoading(false);
        return results;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        setLoading(false);
        throw err;
      }
    },
    [sourceLang, targetLang, translationConfig, aiConfig],
  );

  return {
    translate,
    loading,
    error,
    provider: translationConfig.provider.id,
    targetLang: translationConfig.targetLang,
  };
}
