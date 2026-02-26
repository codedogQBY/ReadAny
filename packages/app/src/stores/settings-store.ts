import type {
  AIConfig,
  AIModel,
  ReadSettings,
  TranslationConfig,
  TranslationTargetLang,
} from "@/types";
/**
 * Settings store — global reading settings, AI config, translation config
 */
import { create } from "zustand";

export interface SettingsState {
  readSettings: ReadSettings;
  translationConfig: TranslationConfig;
  aiConfig: AIConfig;

  // Actions
  updateReadSettings: (updates: Partial<ReadSettings>) => void;
  updateTranslationConfig: (updates: Partial<TranslationConfig>) => void;
  updateAIConfig: (updates: Partial<AIConfig>) => void;
  setAIModel: (model: AIModel) => void;
  setAPIKey: (key: string) => void;
  setTranslationLang: (lang: TranslationTargetLang) => void;
  resetToDefaults: () => void;
}

const defaultReadSettings: ReadSettings = {
  fontSize: 16,
  lineHeight: 1.6,
  fontFamily: "serif",
  theme: "light",
  viewMode: "paginated",
  pageMargin: 40,
  paragraphSpacing: 16,
  autoSaveInterval: 30000,
  enableTranslation: false,
  translationTargetLang: "zh-CN",
  showOriginalText: true,
};

const defaultTranslationConfig: TranslationConfig = {
  provider: { id: "default", name: "Default" },
  targetLang: "zh-CN",
  showOriginal: true,
  autoTranslate: false,
};

const defaultAIConfig: AIConfig = {
  model: "gpt-4o",
  apiKey: "",
  temperature: 0.7,
  maxTokens: 4096,
  slidingWindowSize: 8,
};

export const useSettingsStore = create<SettingsState>((set) => ({
  readSettings: defaultReadSettings,
  translationConfig: defaultTranslationConfig,
  aiConfig: defaultAIConfig,

  updateReadSettings: (updates) =>
    set((state) => ({
      readSettings: { ...state.readSettings, ...updates },
    })),

  updateTranslationConfig: (updates) =>
    set((state) => ({
      translationConfig: { ...state.translationConfig, ...updates },
    })),

  updateAIConfig: (updates) =>
    set((state) => ({
      aiConfig: { ...state.aiConfig, ...updates },
    })),

  setAIModel: (model) => set((state) => ({ aiConfig: { ...state.aiConfig, model } })),

  setAPIKey: (key) => set((state) => ({ aiConfig: { ...state.aiConfig, apiKey: key } })),

  setTranslationLang: (lang) =>
    set((state) => ({
      readSettings: { ...state.readSettings, translationTargetLang: lang },
      translationConfig: { ...state.translationConfig, targetLang: lang },
    })),

  resetToDefaults: () =>
    set({
      readSettings: defaultReadSettings,
      translationConfig: defaultTranslationConfig,
      aiConfig: defaultAIConfig,
    }),
}));
