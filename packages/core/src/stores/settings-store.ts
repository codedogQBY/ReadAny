import { create } from "zustand";
import type { AIConfig, AIEndpoint, ReadSettings } from "../types";
import type { TranslationConfig, TranslationTargetLang } from "../types/translation";
import {
  buildProviderModelsUrl,
  providerSupportsExactRequestUrl,
  providerRequiresApiKey,
} from "../utils";
import { logAIEndpointDebug, summarizeDebugText } from "../ai/request-debug";
import { getEndpointFetch } from "../ai/llm-provider";
import { withPersist } from "./persist";

export interface SettingsState {
  readSettings: ReadSettings;
  translationConfig: TranslationConfig;
  aiConfig: AIConfig;
  settingsUpdatedAt: number;
  hasCompletedOnboarding: boolean;
  showOnboardingGuide: boolean;
  _hasHydrated: boolean;

  // Actions
  completeOnboarding: () => void;
  setShowOnboardingGuide: (show: boolean) => void;
  updateReadSettings: (updates: Partial<ReadSettings>) => void;
  updateTranslationConfig: (updates: Partial<TranslationConfig>) => void;
  updateAIConfig: (
    updates: Partial<Pick<AIConfig, "temperature" | "maxTokens" | "slidingWindowSize">>,
  ) => void;

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
  fixedLayoutZoom: 1,
  pageMargin: 40,
  paragraphSpacing: 16,
  showTopTitleProgress: true,
  showBottomTimeBattery: true,
  volumeButtonsPageTurn: false,
  defaultHighlightColor: "yellow",
  followSystemFontScale: false,
};

const defaultTranslationConfig: TranslationConfig = {
  provider: { id: "microsoft", name: "微软翻译 (免费)" },
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

const defaultAIConfig: AIConfig = {
  endpoints: [defaultEndpoint],
  activeEndpointId: "default",
  activeModel: "",
  temperature: 0.7,
  maxTokens: 8192,
  slidingWindowSize: 8,
};

function migrateSettingsState(state: SettingsState): SettingsState {
  if (state.aiConfig.maxTokens !== 4096) return state;
  return {
    ...state,
    aiConfig: {
      ...state.aiConfig,
      maxTokens: defaultAIConfig.maxTokens,
    },
  };
}

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
  // 使用跨域适配fetch，和AI对话逻辑一致
  const endpointFetch = getEndpointFetch(endpoint);
  const response = await endpointFetch(requestUrl, {
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
    const contentType = response.headers.get("content-type") || "";
    logAIEndpointDebug("error", endpoint, {
      action: "fetch-models",
      method: "GET",
      requestUrl,
      status: response.status,
      statusText: response.statusText,
      contentType,
      responseLength: rawBody.length,
      responseBodyPreview: summarizeDebugText(rawBody),
    });
    const lookedLikeHtml = /^\s*<(!doctype|html)/i.test(rawBody) || contentType.includes("html");
    throw new Error(
      lookedLikeHtml
        ? "The endpoint returned an HTML page instead of JSON. Make sure the base URL starts with http:// or https:// and points to the API root, not a console/dashboard page."
        : "The endpoint did not return JSON. Make sure the base URL starts with http:// or https:// and points to the API root, not a console page.",
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
  } catch (err) {
    console.warn("[Settings] Failed to fetch DeepSeek models, using fallback:", err);
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
  // 使用跨域适配fetch，和AI对话逻辑一致
  const endpointFetch = getEndpointFetch(endpoint);
  const response = await endpointFetch(requestUrl);
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
  // 使用跨域适配fetch，和AI对话逻辑一致
  const endpointFetch = getEndpointFetch(endpoint);
  const response = await endpointFetch(requestUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch LM Studio models: ${response.status} ${response.statusText}`,
    );
  }
  const data = await response.json();
  return (data.data || [])
    .map((m: { id: string }) => m.id)
    .sort((a: string, b: string) => a.localeCompare(b));
}

export const useSettingsStore = create<SettingsState>()(
  withPersist("settings", (set, get, _api) => ({
    readSettings: defaultReadSettings,
    translationConfig: defaultTranslationConfig,
    aiConfig: defaultAIConfig,
    settingsUpdatedAt: 0,
    hasCompletedOnboarding: false,
    showOnboardingGuide: true,
    _hasHydrated: false,

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
            activeModel: state.aiConfig.activeEndpointId === id ? "" : state.aiConfig.activeModel,
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
      }),
  }), undefined, migrateSettingsState),
);
