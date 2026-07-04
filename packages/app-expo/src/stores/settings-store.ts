/**
 * Settings store — global reading settings, AI config, translation config
 */
import type { AIConfig, AIEndpoint, ReadSettings } from "@readany/core/types";
import type { TranslationConfig, TranslationTargetLang } from "@readany/core/types/translation";
import { logAIEndpointDebug, summarizeDebugText } from "@readany/core/ai/request-debug";
import {
  buildProviderModelsUrl,
  providerRequiresApiKey,
  providerSupportsExactRequestUrl,
} from "@readany/core/utils/api";
import { create } from "zustand";
import { deleteSecure, loadSecure, saveSecure, withPersist } from "./persist";

export interface SettingsState {
  readSettings: ReadSettings;
  translationConfig: TranslationConfig;
  aiConfig: AIConfig;
  settingsUpdatedAt: number;
  hasCompletedOnboarding: boolean;
  showOnboardingGuide: boolean;
  _hasHydrated: boolean;
  _apiKeysLoaded: boolean;

  completeOnboarding: () => void;
  setShowOnboardingGuide: (show: boolean) => void;
  updateReadSettings: (updates: Partial<ReadSettings>) => void;
  updateTranslationConfig: (updates: Partial<TranslationConfig>) => void;
  updateAIConfig: (
    updates: Partial<Pick<AIConfig, "temperature" | "maxTokens" | "slidingWindowSize">>,
  ) => void;
  addEndpoint: (endpoint: AIEndpoint) => Promise<void>;
  updateEndpoint: (id: string, updates: Partial<AIEndpoint>) => Promise<void>;
  removeEndpoint: (id: string) => Promise<void>;
  setActiveEndpoint: (id: string) => void;
  setActiveModel: (model: string) => void;
  importAIConfig: (config: AIConfig) => Promise<void>;
  getActiveEndpoint: () => Promise<AIEndpoint | undefined>;
  getEndpointById: (id: string) => Promise<AIEndpoint | undefined>;
  fetchModels: (endpointId: string) => Promise<string[]>;
  setTranslationLang: (lang: TranslationTargetLang) => void;
  resetToDefaults: () => Promise<void>;
  loadApiKeys: () => Promise<void>;
}

const defaultReadSettings: ReadSettings = {
  fontSize: 16,
  lineHeight: 1.6,
  fontTheme: "classic",
  viewMode: "paginated",
  paginatedLayout: "double",
  pageMargin: 40,
  paragraphSpacing: 16,
  showTopTitleProgress: true,
  showBottomTimeBattery: true,
  volumeButtonsPageTurn: false,
  defaultHighlightColor: "yellow",
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

async function fetchModelsFromEndpoint(endpoint: AIEndpoint): Promise<string[]> {
  if (!endpoint.apiKey && endpoint.provider !== "ollama" && endpoint.provider !== "lmstudio") {
    return [];
  }
  if (endpoint.useExactRequestUrl && providerSupportsExactRequestUrl(endpoint.provider)) {
    throw new Error(
      "Exact request URL mode cannot infer the model list automatically. Add models manually.",
    );
  }

  switch (endpoint.provider) {
    case "anthropic":
      return await fetchAnthropicModels(endpoint);
    case "google":
      return await fetchGoogleModels(endpoint);
    case "deepseek":
      return await fetchDeepSeekModels(endpoint);
    case "ollama":
      return await fetchOllamaModels(endpoint);
    case "lmstudio":
      return await fetchLMStudioModels(endpoint);
    default:
      return await fetchOpenAIModels(endpoint);
  }
}

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
    throw new Error(`Failed to fetch Anthropic models: ${response.status}`);
  }
  const data = await response.json();
  return (data.data || [])
    .map((m: { id: string }) => m.id)
    .sort((a: string, b: string) => a.localeCompare(b));
}

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
    throw new Error(`Failed to fetch Google models: ${response.status}`);
  }
  const data = await response.json();
  return (data.models || [])
    .filter((m: { name: string; supportedGenerationMethods?: string[] }) =>
      m.supportedGenerationMethods?.includes("generateContent"),
    )
    .map((m: { name: string }) => m.name.replace("models/", ""))
    .sort((a: string, b: string) => a.localeCompare(b));
}

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
  try {
    const response = await fetch(
      buildProviderModelsUrl(
        "ollama",
        endpoint.baseUrl,
        endpoint.apiKey,
        endpoint.useExactRequestUrl,
      ),
    );
    if (response.ok) {
      const data = await response.json();
      return (data.models || [])
        .map((m: { name: string }) => m.name)
        .sort((a: string, b: string) => a.localeCompare(b));
    }
  } catch (error) {
    console.error("[fetchOllamaModels] Failed:", error);
  }
  return [];
}

async function fetchLMStudioModels(endpoint: AIEndpoint): Promise<string[]> {
  try {
    const response = await fetch(
      buildProviderModelsUrl(
        "lmstudio",
        endpoint.baseUrl,
        endpoint.apiKey,
        endpoint.useExactRequestUrl,
      ),
    );
    if (response.ok) {
      const data = await response.json();
      return (data.data || [])
        .map((m: { id: string }) => m.id)
        .sort((a: string, b: string) => a.localeCompare(b));
    }
  } catch (error) {
    console.error("[fetchLMStudioModels] Failed:", error);
  }
  return [];
}

// Helper to get secure key for endpoint
const getApiKeyStorageKey = (endpointId: string) => `apikey_${endpointId}`;

function pickUsableEndpoint(endpoints: AIEndpoint[], activeEndpointId: string) {
  return (
    endpoints.find((endpoint) => endpoint.id === activeEndpointId) ||
    endpoints.find(
      (endpoint) => !providerRequiresApiKey(endpoint.provider) || Boolean(endpoint.apiKey),
    ) ||
    endpoints[0]
  );
}

function normalizeImportedAIConfig(importedConfig: AIConfig, currentConfig: AIConfig): AIConfig {
  const importedEndpoints = Array.isArray(importedConfig.endpoints)
    ? importedConfig.endpoints
        .filter((endpoint): endpoint is AIEndpoint => Boolean(endpoint?.id))
        .map((endpoint) => ({
          ...defaultEndpoint,
          ...endpoint,
          id: String(endpoint.id),
          name: endpoint.name || endpoint.provider || defaultEndpoint.name,
          apiKey: typeof endpoint.apiKey === "string" ? endpoint.apiKey : "",
          models: Array.isArray(endpoint.models)
            ? endpoint.models.filter((model): model is string => typeof model === "string")
            : [],
          modelsFetched: Boolean(endpoint.modelsFetched || endpoint.models?.length),
          modelsFetching: false,
        }))
    : [];

  const endpoints = importedEndpoints.length > 0 ? importedEndpoints : currentConfig.endpoints;
  const preferredEndpointId =
    typeof importedConfig.activeEndpointId === "string"
      ? importedConfig.activeEndpointId
      : currentConfig.activeEndpointId;
  const activeEndpoint = pickUsableEndpoint(endpoints, preferredEndpointId);
  const activeEndpointId = activeEndpoint?.id || "";

  let activeModel =
    typeof importedConfig.activeModel === "string"
      ? importedConfig.activeModel
      : currentConfig.activeModel;
  if (activeEndpoint && (!activeModel || !activeEndpoint.models.includes(activeModel))) {
    activeModel = activeEndpoint.models[0] || activeModel || "";
  }

  return {
    ...currentConfig,
    ...importedConfig,
    endpoints,
    activeEndpointId,
    activeModel,
    temperature:
      typeof importedConfig.temperature === "number"
        ? importedConfig.temperature
        : currentConfig.temperature,
    maxTokens:
      typeof importedConfig.maxTokens === "number"
        ? importedConfig.maxTokens
        : currentConfig.maxTokens,
    slidingWindowSize:
      typeof importedConfig.slidingWindowSize === "number"
        ? importedConfig.slidingWindowSize
        : currentConfig.slidingWindowSize,
  };
}

export const useSettingsStore = create<SettingsState>()(
  withPersist("settings", (set, get, api) => {
    // Load API keys from secure storage and merge with current endpoints
    const loadApiKeys = async () => {
      const state = get();

      // 如果已经加载过，不再重复加载
      if (state._apiKeysLoaded) {
        return;
      }

      const endpointsWithKeys = await Promise.all(
        state.aiConfig.endpoints.map(async (ep) => {
          const apiKey = await loadSecure(getApiKeyStorageKey(ep.id));
          return { ...ep, apiKey: apiKey || "" };
        }),
      );

      set({
        aiConfig: { ...state.aiConfig, endpoints: endpointsWithKeys },
        _apiKeysLoaded: true,
      });
    };

    return {
      readSettings: defaultReadSettings,
      translationConfig: defaultTranslationConfig,
      aiConfig: defaultAIConfig,
      settingsUpdatedAt: 0,
      hasCompletedOnboarding: false,
      showOnboardingGuide: true,
      _hasHydrated: false,
      _apiKeysLoaded: false,

      loadApiKeys,

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

      addEndpoint: async (endpoint) => {
        // Save API key to secure storage
        if (endpoint.apiKey) {
          await saveSecure(getApiKeyStorageKey(endpoint.id), endpoint.apiKey);
        }
        // Add endpoint to state (apiKey will be loaded from secure storage)
        set((state) => ({
          aiConfig: {
            ...state.aiConfig,
            endpoints: [
              ...state.aiConfig.endpoints,
              { ...endpoint, apiKey: endpoint.apiKey || "" },
            ],
          },
        }));
      },

      updateEndpoint: async (id, updates) => {
        // If apiKey is being updated, save it to secure storage
        if (updates.apiKey !== undefined) {
          await saveSecure(getApiKeyStorageKey(id), updates.apiKey);
        }
        set((state) => ({
          aiConfig: {
            ...state.aiConfig,
            endpoints: state.aiConfig.endpoints.map((ep) =>
              ep.id === id ? { ...ep, ...updates } : ep,
            ),
          },
        }));
      },

      removeEndpoint: async (id) => {
        // Delete API key from secure storage
        await deleteSecure(getApiKeyStorageKey(id));
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
        });
      },

      setActiveEndpoint: (id) =>
        set((state) => ({
          aiConfig: {
            ...state.aiConfig,
            activeEndpointId: id,
          },
        })),

      setActiveModel: (model) =>
        set((state) => ({
          aiConfig: { ...state.aiConfig, activeModel: model },
        })),

      importAIConfig: async (config) => {
        const currentState = get();
        const normalizedConfig = normalizeImportedAIConfig(config, currentState.aiConfig);
        const importedEndpointIds = new Set(
          normalizedConfig.endpoints.map((endpoint) => endpoint.id),
        );

        await Promise.all([
          ...currentState.aiConfig.endpoints
            .filter((endpoint) => !importedEndpointIds.has(endpoint.id))
            .map((endpoint) => deleteSecure(getApiKeyStorageKey(endpoint.id))),
          ...normalizedConfig.endpoints.map((endpoint) =>
            endpoint.apiKey
              ? saveSecure(getApiKeyStorageKey(endpoint.id), endpoint.apiKey)
              : deleteSecure(getApiKeyStorageKey(endpoint.id)),
          ),
        ]);

        set({
          aiConfig: normalizedConfig,
          _apiKeysLoaded: true,
        });
      },

      getActiveEndpoint: async () => {
        const state = get();
        const ep = state.aiConfig.endpoints.find((ep) => ep.id === state.aiConfig.activeEndpointId);
        if (!ep) return undefined;
        // Load the actual API key from secure storage
        const apiKey = await loadSecure(getApiKeyStorageKey(ep.id));
        return { ...ep, apiKey: apiKey || "" };
      },

      getEndpointById: async (id: string) => {
        const state = get();
        const ep = state.aiConfig.endpoints.find((ep) => ep.id === id);
        if (!ep) return undefined;
        // Load the actual API key from secure storage
        const apiKey = await loadSecure(getApiKeyStorageKey(ep.id));
        return { ...ep, apiKey: apiKey || "" };
      },

      fetchModels: async (endpointId) => {
        const state = get();
        const endpoint = state.aiConfig.endpoints.find((ep) => ep.id === endpointId);
        if (!endpoint) return [];

        // Load the actual API key from secure storage
        const apiKey = await loadSecure(getApiKeyStorageKey(endpointId));
        const endpointWithKey = { ...endpoint, apiKey: apiKey || "" };

        set((s) => ({
          aiConfig: {
            ...s.aiConfig,
            endpoints: s.aiConfig.endpoints.map((ep) =>
              ep.id === endpointId ? { ...ep, modelsFetching: true } : ep,
            ),
          },
        }));

        try {
          const models = await fetchModelsFromEndpoint(endpointWithKey);
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

      resetToDefaults: async () => {
        // Delete all API keys from secure storage
        const state = get();
        await Promise.all(
          state.aiConfig.endpoints.map((ep) => deleteSecure(getApiKeyStorageKey(ep.id))),
        );
        set({
          readSettings: defaultReadSettings,
          translationConfig: defaultTranslationConfig,
          aiConfig: defaultAIConfig,
          _apiKeysLoaded: false,
        });
      },
    };
  }, undefined, migrateSettingsState),
);

// 在应用启动时加载 API keys
setTimeout(() => {
  if (useSettingsStore.getState()._hasHydrated) {
    void useSettingsStore.getState().loadApiKeys();
  }
}, 500);
