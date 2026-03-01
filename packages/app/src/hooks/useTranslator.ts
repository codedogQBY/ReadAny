/**
 * useTranslator Hook
 * React hook for translation with caching
 * Uses AI config for translation (model, apiKey, baseUrl)
 */

import { useCallback, useState } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { getFromCache, storeInCache } from "@/lib/translation/cache";
import { aiTranslate, deeplTranslate } from "@/lib/translation/providers";
import type { TranslationTargetLang } from "@/types/translation";

export interface UseTranslatorOptions {
  sourceLang?: string;
  targetLang?: TranslationTargetLang;
}

export function useTranslator(options: UseTranslatorOptions = {}) {
  const { sourceLang = "AUTO", targetLang } = options;
  const translationConfig = useSettingsStore((s) => s.translationConfig);
  const aiConfig = useSettingsStore((s) => s.aiConfig);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const translate = useCallback(
    async (texts: string[]): Promise<string[]> => {
      // Filter out empty texts
      const textsToTranslate = texts.map((t) => t.trim()).filter((t) => t);
      if (textsToTranslate.length === 0) {
        return texts;
      }

      const targetLanguage = targetLang || translationConfig.targetLang;
      const providerId = translationConfig.provider.id;

      // Check cache first
      const cachedResults: string[] = [];
      const needsTranslation: { index: number; text: string }[] = [];
      textsToTranslate.forEach((text, index) => {
        const cached = getFromCache(text, sourceLang, targetLanguage, providerId);
        if (cached) {
          cachedResults[index] = cached;
        } else {
          needsTranslation.push({ index, text });
        }
      });

      if (needsTranslation.length === 0) {
        return textsToTranslate.map((_, i) => cachedResults[i] || "");
      }

      setLoading(true);
      setError(null);

      try {
        let translatedTexts: string[];

        if (providerId === "ai") {
          // Get endpoint config
          const endpointId = translationConfig.provider.endpointId || aiConfig.activeEndpointId;
          const endpoint = aiConfig.endpoints.find((e) => e.id === endpointId);
          const model = translationConfig.provider.model || aiConfig.activeModel;

          if (!endpoint?.apiKey) {
            throw new Error("AI endpoint not configured. Please set up AI settings first.");
          }

          translatedTexts = await aiTranslate(
            needsTranslation.map((n) => n.text),
            sourceLang,
            targetLanguage,
            endpoint.apiKey,
            endpoint.baseUrl,
            model,
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
          );
        } else {
          throw new Error(`Unknown translation provider: ${providerId}`);
        }

        // Store in cache
        needsTranslation.forEach(({ text }, i) => {
          if (translatedTexts[i]) {
            storeInCache(text, translatedTexts[i], sourceLang, targetLanguage, providerId);
          }
        });

        // Merge cached and new results
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