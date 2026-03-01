import type {
  AIConfig,
  AIEndpoint,
  ReadSettings,
} from "@/types";
import type { TranslationConfig, TranslationTargetLang } from "@/types/translation";
/**
 * Settings store — global reading settings, AI config, translation config
 */
import { create } from "zustand";
import { withPersist } from "./persist";

export interface SettingsState {
  readSettings: ReadSettings;
  translationConfig: TranslationConfig;
  aiConfig: AIConfig;

  // Actions
  updateReadSettings: (updates: Partial<ReadSettings>) => void;
  updateTranslationConfig: (updates: Partial<TranslationConfig>) => void;
  updateAIConfig: (updates: Partial<Pick<AIConfig, "temperature" | "maxTokens" | "slidingWindowSize">>) => void;

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
  fontTheme: "classic",
  viewMode: "paginated",
  pageMargin: 40,
  paragraphSpacing: 16,
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
  baseUrl: "https://api.openai.com/v1",
  models: [],
  modelsFetched: false,
};

const defaultAIConfig: AIConfig = {
  endpoints: [defaultEndpoint],
  activeEndpointId: "default",
  activeModel: "",
  temperature: 0.7,
  maxTokens: 4096,
  slidingWindowSize: 8,
};

/**
 * Fetch available models from an AI provider endpoint.
 * Supports OpenAI-compatible (/v1/models), Anthropic, and Google Gemini.
 */
async function fetchModelsFromEndpoint(endpoint: AIEndpoint): Promise<string[]> {
  if (!endpoint.apiKey) return [];

  switch (endpoint.provider) {
    case "anthropic":
      return fetchAnthropicModels(endpoint);
    case "google":
      return fetchGoogleModels(endpoint);
    case "openai":
    default:
      return fetchOpenAIModels(endpoint);
  }
}

/** OpenAI-compatible /v1/models */
async function fetchOpenAIModels(endpoint: AIEndpoint): Promise<string[]> {
  if (!endpoint.baseUrl) return [];
  const baseUrl = endpoint.baseUrl.replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${endpoint.apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return (data.data || [])
    .map((m: { id: string }) => m.id)
    .sort((a: string, b: string) => a.localeCompare(b));
}

/** Anthropic — list models via /v1/models API */
async function fetchAnthropicModels(endpoint: AIEndpoint): Promise<string[]> {
  const baseUrl = (endpoint.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/v1/models`, {
    headers: {
      "x-api-key": endpoint.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
  });
  if (!response.ok) {
    // Fallback: return well-known models if API doesn't support listing
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
  const baseUrl = (endpoint.baseUrl || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/v1beta/models?key=${endpoint.apiKey}`);
  if (!response.ok) {
    // Fallback: return well-known models
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

export const useSettingsStore = create<SettingsState>()(
  withPersist("settings", (set, get, _api) => ({
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
          activeModel:
            state.aiConfig.activeEndpointId === id ? "" : state.aiConfig.activeModel,
        },
      };
    }),

  setActiveEndpoint: (id) =>
    set((state) => ({
      aiConfig: {
        ...state.aiConfig,
        activeEndpointId: id,
        activeModel: "", // reset model when switching endpoint
      },
    })),

  setActiveModel: (model) =>
    set((state) => ({
      aiConfig: { ...state.aiConfig, activeModel: model },
    })),

  getActiveEndpoint: () => {
    const state = get();
    return state.aiConfig.endpoints.find((ep) => ep.id === state.aiConfig.activeEndpointId);
  },

  fetchModels: async (endpointId) => {
    const state = get();
    const endpoint = state.aiConfig.endpoints.find((ep) => ep.id === endpointId);
    if (!endpoint) return [];

    // Mark as fetching
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
      return [];
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
    }),
})),
);
