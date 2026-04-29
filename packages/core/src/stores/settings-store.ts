import { create } from "zustand";
import { logAIEndpointDebug, summarizeDebugText } from "../ai/request-debug";
import type { AIConfig, AIEndpoint, ReadSettings } from "../types";
import type { SocraticSettings } from "../types/chat";
import type { TranslationConfig, TranslationTargetLang } from "../types/translation";
import {
  buildProviderModelsUrl,
  providerRequiresApiKey,
  providerSupportsExactRequestUrl,
} from "../utils";
import { withPersist } from "./persist";

export interface BookMiniReviewData {
  bookId: string;
  content: string;
  generatedAt: number;
  rating?: number;
  source?: "douban" | "openlibrary" | "ai";
}

export interface ReviewItemData {
  id: string;
  bookId: string;
  chapterId: string;
  chapterTitle: string;
  scheduledDate: number;
  completedDate?: number;
  quality?: string;
  status: string;
  reviewCount: number;
  nextReviewDate?: number;
  notes?: string;
}

export interface ReviewSettingsData {
  enabled: boolean;
  algorithm: "ebbinghaus" | "ai_guided" | "hybrid";
  intervals: number[];
  autoAdjust: boolean;
  showBadges: boolean;
  items?: Record<string, ReviewItemData>;
}

export interface SettingsState {
  readSettings: ReadSettings;
  translationConfig: TranslationConfig;
  aiConfig: AIConfig;
  settingsUpdatedAt: number;
  hasCompletedOnboarding: boolean;
  showOnboardingGuide: boolean;
  _hasHydrated: boolean;
  bookMiniReviews: Record<string, BookMiniReviewData>;
  reviewSettings: ReviewSettingsData;

  // Actions
  completeOnboarding: () => void;
  setShowOnboardingGuide: (show: boolean) => void;
  updateReadSettings: (updates: Partial<ReadSettings>) => void;
  updateTranslationConfig: (updates: Partial<TranslationConfig>) => void;
  updateAIConfig: (updates: Partial<AIConfig>) => void;
  updateSocraticSettings: (updates: Partial<SocraticSettings>) => void;
  setBookMiniReviews: (reviews: Record<string, BookMiniReviewData>) => void;
  updateReviewSettings: (updates: Partial<ReviewSettingsData>) => void;

  // Endpoint management
  addEndpoint: (endpoint: AIEndpoint) => void;
  updateEndpoint: (id: string, updates: Partial<AIEndpoint>) => void;
  removeEndpoint: (id: string) => void;
  setActiveEndpoint: (id: string) => void;
  setActiveModel: (model: string) => void;

  // Helpers
  getActiveEndpoint: () => AIEndpoint | undefined;
  fetchModels: (endpointId: string) => Promise<string[]>;

  setTranslationLang: (lang: TranslationTargetLang) => void;
  resetToDefaults: () => void;
}

const defaultReadSettings: ReadSettings = {
  fontSize: 16,
  lineHeight: 1.6,
  fontTheme: "system",
  viewMode: "paginated",
  paginatedLayout: "double",
  pageMargin: 40,
  paragraphSpacing: 16,
  showTopTitleProgress: true,
  showBottomTimeBattery: true,
  volumeButtonsPageTurn: false,
};

const defaultTranslationConfig: TranslationConfig = {
  provider: { id: "ai", name: "AI 翻译" },
  targetLang: "zh-CN",
};

const defaultEndpoint: AIEndpoint = {
  id: "default",
  name: "OpenAI",
  provider: "openai",
  apiKey: "",
  baseUrl: "https://api.openai.com",
  useExactRequestUrl: false,
  models: [],
  modelsFetched: false,
};

const defaultSocraticSettings: SocraticSettings = {
  enabled: false,
  mode: "socratic",
  knowledgeScope: "current_chapter",
  questionComplexity: "medium",
  enablePreheating: true,
  preheatingStrategy: "smart",
  enableWebSearch: false,
  userProfile: undefined,
};

const defaultAIConfig: AIConfig = {
  endpoints: [defaultEndpoint],
  activeEndpointId: "default",
  activeModel: "",
  temperature: 0.7,
  maxTokens: 4096,
  slidingWindowSize: 8,
  customPrompt: undefined,
  chatMode: "standard",
  socraticSettings: defaultSocraticSettings,
  webSearchCache: {},
};

/**
 * Fetch available models from an AI provider endpoint.
 * Supports OpenAI-compatible (/v1/models), Anthropic, and Google Gemini.
 */
async function fetchModelsFromEndpoint(endpoint: AIEndpoint): Promise<string[]> {
  if (providerRequiresApiKey(endpoint.provider) && !endpoint.apiKey) return [];
  if (endpoint.useExactRequestUrl && providerSupportsExactRequestUrl(endpoint.provider)) {
    throw new Error(
      "Exact request URL mode cannot infer the model list automatically. Add models manually.",
    );
  }

  switch (endpoint.provider) {
    case "anthropic":
      return fetchAnthropicModels(endpoint);
    case "google":
      return fetchGoogleModels(endpoint);
    case "deepseek":
      return fetchDeepSeekModels(endpoint);
    case "ollama":
      return fetchOllamaModels(endpoint);
    case "lmstudio":
      return fetchLMStudioModels(endpoint);
    case "openai":
    default:
      return fetchOpenAIModels(endpoint);
  }
}

/** OpenAI-compatible /v1/models */
async function fetchOpenAIModels(endpoint: AIEndpoint): Promise<string[]> {
  const requestUrl = buildProviderModelsUrl(
    endpoint.provider,
    endpoint.baseUrl,
    endpoint.apiKey,
    endpoint.useExactRequestUrl,
  );
  if (!requestUrl) return [];
  logAIEndpointDebug("request", endpoint, {
    action: "fetch-models",
    method: "GET",
    requestUrl,
  });
  const response = await fetch(requestUrl, {
    headers: { Authorization: `Bearer ${endpoint.apiKey}` },
  });
  if (!response.ok) {
    const errorBody = await response.text();
    logAIEndpointDebug("error", endpoint, {
      action: "fetch-models",
      method: "GET",
      requestUrl,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get("content-type"),
      responseLength: errorBody.length,
      responseBodyPreview: summarizeDebugText(errorBody),
    });
    throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
  }
  const rawBody = await response.text();
  let data: { data?: Array<{ id: string }> };

  try {
    data = JSON.parse(rawBody);
  } catch {
    logAIEndpointDebug("error", endpoint, {
      action: "fetch-models",
      method: "GET",
      requestUrl,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get("content-type"),
      responseLength: rawBody.length,
      responseBodyPreview: summarizeDebugText(rawBody),
    });
    throw new Error(
      "The endpoint did not return JSON. Check whether the base URL points to the API root instead of a console page.",
    );
  }

  if (!Array.isArray(data.data)) {
    logAIEndpointDebug("error", endpoint, {
      action: "fetch-models",
      method: "GET",
      requestUrl,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get("content-type"),
      responseLength: rawBody.length,
      responseBodyPreview: summarizeDebugText(rawBody),
    });
    throw new Error(
      "The endpoint returned an unexpected models response. Check whether the base URL points to the OpenAI-compatible API root.",
    );
  }

  const models = data.data
    .map((m: { id: string }) => m.id)
    .sort((a: string, b: string) => a.localeCompare(b));
  logAIEndpointDebug("response", endpoint, {
    action: "fetch-models",
    method: "GET",
    requestUrl,
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get("content-type"),
    responseLength: rawBody.length,
    modelCount: models.length,
  });
  return models;
}

/** Anthropic — list models via /models API */
async function fetchAnthropicModels(endpoint: AIEndpoint): Promise<string[]> {
  const requestUrl = buildProviderModelsUrl(
    "anthropic",
    endpoint.baseUrl,
    endpoint.apiKey,
    endpoint.useExactRequestUrl,
  );
  const response = await fetch(requestUrl, {
    headers: {
      "x-api-key": endpoint.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
  });
  if (!response.ok) {
    if (response.status === 404 || response.status === 405) {
      return [
        "claude-sonnet-4-20250514",
        "claude-opus-4-20250514",
        "claude-3-7-sonnet-20250219",
        "claude-3-5-sonnet-20241022",
        "claude-3-5-haiku-20241022",
        "claude-3-opus-20240229",
        "claude-3-haiku-20240307",
      ];
    }
    throw new Error(`Failed to fetch Anthropic models: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return (data.data || [])
    .map((m: { id: string }) => m.id)
    .sort((a: string, b: string) => a.localeCompare(b));
}

/** Google Gemini — list models via generativelanguage API */
async function fetchGoogleModels(endpoint: AIEndpoint): Promise<string[]> {
  const requestUrl = buildProviderModelsUrl(
    "google",
    endpoint.baseUrl,
    endpoint.apiKey,
    endpoint.useExactRequestUrl,
  );
  const response = await fetch(requestUrl);
  if (!response.ok) {
    if (response.status === 404 || response.status === 403) {
      return [
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite",
        "gemini-1.5-pro",
        "gemini-1.5-flash",
      ];
    }
    throw new Error(`Failed to fetch Google models: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return (data.models || [])
    .filter((m: { name: string; supportedGenerationMethods?: string[] }) =>
      m.supportedGenerationMethods?.includes("generateContent"),
    )
    .map((m: { name: string }) => m.name.replace("models/", ""))
    .sort((a: string, b: string) => a.localeCompare(b));
}

/** DeepSeek — uses OpenAI-compatible /models endpoint with fallback */
async function fetchDeepSeekModels(endpoint: AIEndpoint): Promise<string[]> {
  const requestUrl = buildProviderModelsUrl(
    "deepseek",
    endpoint.baseUrl,
    endpoint.apiKey,
    endpoint.useExactRequestUrl,
  );
  try {
    const response = await fetch(requestUrl, {
      headers: { Authorization: `Bearer ${endpoint.apiKey}` },
    });
    if (response.ok) {
      const data = await response.json();
      const models = (data.data || [])
        .map((m: { id: string }) => m.id)
        .sort((a: string, b: string) => a.localeCompare(b));
      if (models.length > 0) return models;
    }
  } catch {
    // Fall through to fallback
  }
  return ["deepseek-chat", "deepseek-reasoner"];
}

async function fetchOllamaModels(endpoint: AIEndpoint): Promise<string[]> {
  const requestUrl = buildProviderModelsUrl(
    "ollama",
    endpoint.baseUrl,
    endpoint.apiKey,
    endpoint.useExactRequestUrl,
  );
  const response = await fetch(requestUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch Ollama models: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return (data.models || [])
    .map((m: { name: string }) => m.name)
    .sort((a: string, b: string) => a.localeCompare(b));
}

async function fetchLMStudioModels(endpoint: AIEndpoint): Promise<string[]> {
  const requestUrl = buildProviderModelsUrl(
    "lmstudio",
    endpoint.baseUrl,
    endpoint.apiKey,
    endpoint.useExactRequestUrl,
  );
  const response = await fetch(requestUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch LM Studio models: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return (data.data || [])
    .map((m: { id: string }) => m.id)
    .sort((a: string, b: string) => a.localeCompare(b));
}

export const useSettingsStore = create<SettingsState>()(
  withPersist(
    "settings",
    (set, get, _api) => ({
      readSettings: defaultReadSettings,
      translationConfig: defaultTranslationConfig,
      aiConfig: defaultAIConfig,
      settingsUpdatedAt: 0,
      hasCompletedOnboarding: false,
      showOnboardingGuide: true,
      _hasHydrated: false,
      bookMiniReviews: {},
      reviewSettings: {
        enabled: true,
        algorithm: "hybrid",
        intervals: [],
        autoAdjust: true,
        showBadges: false,
      },

      completeOnboarding: () => set({ hasCompletedOnboarding: true }),
      setShowOnboardingGuide: (show: boolean) => set({ showOnboardingGuide: show }),

      updateReadSettings: (updates) =>
        set((state) => ({
          readSettings: { ...state.readSettings, ...updates },
          settingsUpdatedAt: Date.now(),
        })),

      updateTranslationConfig: (updates) =>
        set((state) => ({
          translationConfig: { ...state.translationConfig, ...updates },
          settingsUpdatedAt: Date.now(),
        })),

      updateAIConfig: (updates) =>
        set((state) => {
          const newAIConfig = { ...state.aiConfig, ...updates };
          if (updates.chatMode === "socratic") {
            newAIConfig.socraticSettings = {
              ...(newAIConfig.socraticSettings || defaultSocraticSettings),
              enabled: true,
            };
          }
          return { aiConfig: newAIConfig };
        }),

      updateSocraticSettings: (updates) =>
        set((state) => ({
          aiConfig: {
            ...state.aiConfig,
            socraticSettings: {
              ...(state.aiConfig.socraticSettings || defaultSocraticSettings),
              ...updates,
            },
          },
        })),

      // --- Endpoint management ---

      addEndpoint: (endpoint) =>
        set((state) => ({
          aiConfig: {
            ...state.aiConfig,
            endpoints: [...state.aiConfig.endpoints, endpoint],
          },
        })),

      updateEndpoint: (id, updates) =>
        set((state) => ({
          aiConfig: {
            ...state.aiConfig,
            endpoints: state.aiConfig.endpoints.map((ep) =>
              ep.id === id ? { ...ep, ...updates } : ep,
            ),
          },
        })),

      removeEndpoint: (id) =>
        set((state) => {
          const newEndpoints = state.aiConfig.endpoints.filter((ep) => ep.id !== id);
          const newActiveId =
            state.aiConfig.activeEndpointId === id
              ? newEndpoints[0]?.id || ""
              : state.aiConfig.activeEndpointId;
          return {
            aiConfig: {
              ...state.aiConfig,
              endpoints: newEndpoints,
              activeEndpointId: newActiveId,
              activeModel: state.aiConfig.activeEndpointId === id ? "" : state.aiConfig.activeModel,
            },
          };
        }),

      setActiveEndpoint: (id) =>
        set((state) => ({
          aiConfig: {
            ...state.aiConfig,
            activeEndpointId: id,
            activeModel: "",
          },
        })),

      setActiveModel: (model) =>
        set((state) => ({
          aiConfig: { ...state.aiConfig, activeModel: model },
        })),

      setBookMiniReviews: (reviews) => set({ bookMiniReviews: reviews }),

      updateReviewSettings: (updates) =>
        set((state) => ({
          reviewSettings: { ...state.reviewSettings, ...updates },
        })),

      getActiveEndpoint: () => {
        const state = get();
        return state.aiConfig.endpoints.find((ep) => ep.id === state.aiConfig.activeEndpointId);
      },

      fetchModels: async (endpointId) => {
        const state = get();
        const endpoint = state.aiConfig.endpoints.find((ep) => ep.id === endpointId);
        if (!endpoint) return [];

        set((s) => ({
          aiConfig: {
            ...s.aiConfig,
            endpoints: s.aiConfig.endpoints.map((ep) =>
              ep.id === endpointId ? { ...ep, modelsFetching: true } : ep,
            ),
          },
        }));

        try {
          const models = await fetchModelsFromEndpoint(endpoint);
          set((s) => ({
            aiConfig: {
              ...s.aiConfig,
              endpoints: s.aiConfig.endpoints.map((ep) =>
                ep.id === endpointId
                  ? { ...ep, models, modelsFetched: true, modelsFetching: false }
                  : ep,
              ),
            },
          }));
          return models;
        } catch (err) {
          console.error("Failed to fetch models:", err);
          set((s) => ({
            aiConfig: {
              ...s.aiConfig,
              endpoints: s.aiConfig.endpoints.map((ep) =>
                ep.id === endpointId ? { ...ep, modelsFetching: false } : ep,
              ),
            },
          }));
          throw err;
        }
      },

      setTranslationLang: (lang) =>
        set((state) => ({
          translationConfig: { ...state.translationConfig, targetLang: lang },
        })),

      resetToDefaults: () =>
        set({
          readSettings: defaultReadSettings,
          translationConfig: defaultTranslationConfig,
          aiConfig: defaultAIConfig,
          bookMiniReviews: {},
          reviewSettings: {
            enabled: true,
            algorithm: "hybrid",
            intervals: [],
            autoAdjust: true,
            showBadges: false,
          },
        }),
    }),
    undefined,
    (persisted: SettingsState): SettingsState => {
      if (!persisted.aiConfig) {
        persisted.aiConfig = defaultAIConfig;
      } else {
        if (!persisted.aiConfig.socraticSettings) {
          persisted.aiConfig.socraticSettings = defaultSocraticSettings;
        }
        if (
          !Array.isArray(persisted.aiConfig.endpoints) ||
          persisted.aiConfig.endpoints.length === 0
        ) {
          persisted.aiConfig.endpoints = defaultAIConfig.endpoints;
        }
        if (!persisted.aiConfig.activeEndpointId) {
          persisted.aiConfig.activeEndpointId = defaultAIConfig.activeEndpointId;
        }
        if (typeof persisted.aiConfig.chatMode !== "string") {
          persisted.aiConfig.chatMode = defaultAIConfig.chatMode;
        }
        if (typeof persisted.aiConfig.activeModel !== "string") {
          persisted.aiConfig.activeModel = defaultAIConfig.activeModel;
        }
        if (typeof persisted.aiConfig.temperature !== "number") {
          persisted.aiConfig.temperature = defaultAIConfig.temperature;
        }
        if (typeof persisted.aiConfig.maxTokens !== "number") {
          persisted.aiConfig.maxTokens = defaultAIConfig.maxTokens;
        }
        if (typeof persisted.aiConfig.slidingWindowSize !== "number") {
          persisted.aiConfig.slidingWindowSize = defaultAIConfig.slidingWindowSize;
        }
        if (!persisted.aiConfig.webSearchCache) {
          persisted.aiConfig.webSearchCache = defaultAIConfig.webSearchCache;
        }
      }
      if (!persisted.bookMiniReviews || typeof persisted.bookMiniReviews !== "object") {
        persisted.bookMiniReviews = {};
      }
      if (!persisted.reviewSettings || typeof persisted.reviewSettings !== "object") {
        persisted.reviewSettings = {
          enabled: true,
          algorithm: "hybrid",
          intervals: [],
          autoAdjust: true,
          showBadges: false,
        };
      }
      return persisted;
    },
  ),
);
