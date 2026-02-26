/** User tier and quota types */

export type UserTier = "free" | "pro" | "premium";

export type QuotaType = "ai_messages" | "vectorize" | "translation";

export interface Quota {
  type: QuotaType;
  used: number;
  limit: number;
  resetAt: number; // timestamp
  period: "daily" | "monthly";
}

export interface UserProfile {
  id: string;
  tier: UserTier;
  quotas: Quota[];
  createdAt: number;
}

export interface TranslationProvider {
  id: string;
  name: string;
  apiKey?: string;
  baseUrl?: string;
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
  | "hi"
  | "th"
  | "vi"
  | "id"
  | "ms"
  | "tr"
  | "pl"
  | "nl"
  | "sv"
  | "da";

export interface TranslationConfig {
  provider: TranslationProvider;
  targetLang: TranslationTargetLang;
  showOriginal: boolean;
  autoTranslate: boolean;
}
