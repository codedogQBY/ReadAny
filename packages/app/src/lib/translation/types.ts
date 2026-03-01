/**
 * Translation Types for internal use
 */

import type { TranslatorName, TranslationTargetLang } from "@/types/translation";

// Re-export for convenience
export type { TranslatorName, TranslationTargetLang } from "@/types/translation";

// Internal provider interface (includes translate method)
export interface TranslationProvider {
  name: TranslatorName;
  label: string;
  translate: (
    texts: string[],
    sourceLang: string,
    targetLang: string,
    config: { apiKey?: string; baseUrl?: string; model?: string },
  ) => Promise<string[]>;
}

export interface UseTranslatorOptions {
  provider?: TranslatorName;
  sourceLang?: string;
  targetLang?: TranslationTargetLang | string;
}

export const ErrorCodes = {
  UNAUTHORIZED: "Unauthorized",
  API_ERROR: "API Error",
  QUOTA_EXCEEDED: "Quota Exceeded",
  NETWORK_ERROR: "Network Error",
} as const;