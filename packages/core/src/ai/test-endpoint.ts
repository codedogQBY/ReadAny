import type { AIEndpoint } from "../types";
import { getDefaultBaseUrl, providerRequiresApiKey } from "../utils";
import {
  buildOpenAICompatibleUrl,
  buildProviderModelsUrl,
  providerSupportsExactRequestUrl,
  resolveProviderBaseUrl,
} from "../utils/api";
import { logAIEndpointDebug, summarizeDebugText } from "./request-debug";

const OPENAI_COMPATIBLE_TEST_PROMPT = "Reply with exactly OK.";
const ANTHROPIC_FALLBACK_MODELS = [
  "claude-sonnet-4-20250514",
  "claude-opus-4-20250514",
  "claude-3-7-sonnet-20250219",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-haiku-20241022",
];
const GOOGLE_FALLBACK_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
];
const DEEPSEEK_FALLBACK_MODELS = ["deepseek-chat", "deepseek-reasoner"];

export interface EndpointTestResult {
  modelCount?: number;
  testedModel?: string;
  requestUrl: string;
}

interface EndpointTestOptions {
  model?: string;
}

function getEndpointBaseUrl(endpoint: AIEndpoint): string {
  return (endpoint.baseUrl || getDefaultBaseUrl(endpoint.provider) || "").trim();
}

function assertConfigured(endpoint: AIEndpoint, baseUrl: string): void {
  if (!baseUrl) {
    throw new Error("Base URL is required.");
  }

  if (providerRequiresApiKey(endpoint.provider) && !endpoint.apiKey) {
    throw new Error(`API key not set for endpoint "${endpoint.name}".`);
  }
}

function normalizeGoogleModel(model: string): string {
  return model.replace(/^models\//, "");
}

async function parseErrorBody(response: Response): Promise<string> {
  const text = await response.text();
  return text || `${response.status} ${response.statusText}`;
}

async function fetchJson(
  url: string,
  init?: RequestInit,
  debug?: {
    endpoint: AIEndpoint;
    action: string;
    model?: string;
  },
): Promise<any> {
  if (debug) {
    logAIEndpointDebug("request", debug.endpoint, {
      action: debug.action,
      method: init?.method || "GET",
      requestUrl: url,
      model: debug.model,
    });
  }

  const response = await fetch(url, init);
  if (!response.ok) {
    const errorBody = await parseErrorBody(response);
    if (debug) {
      logAIEndpointDebug("error", debug.endpoint, {
        action: debug.action,
        method: init?.method || "GET",
        requestUrl: url,
        model: debug.model,
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get("content-type"),
        responseLength: errorBody.length,
        responseBodyPreview: summarizeDebugText(errorBody),
      });
    }
    throw new Error(`${response.status} ${response.statusText}: ${errorBody}`);
  }
  if (debug) {
    logAIEndpointDebug("response", debug.endpoint, {
      action: debug.action,
      method: init?.method || "GET",
      requestUrl: url,
      model: debug.model,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get("content-type"),
    });
  }
  return response.json();
}

async function listOpenAICompatibleModels(endpoint: AIEndpoint): Promise<string[]> {
  const requestUrl = buildProviderModelsUrl(
    endpoint.provider,
    endpoint.baseUrl,
    endpoint.apiKey,
    endpoint.useExactRequestUrl,
  );
  if (!requestUrl) return [];
  const headers: Record<string, string> = {};
  if (endpoint.apiKey) {
    headers.Authorization = `Bearer ${endpoint.apiKey}`;
  }

  const data = await fetchJson(
    requestUrl,
    { headers },
    {
      endpoint,
      action: "list-models",
    },
  );
  return (data.data || [])
    .map((model: { id: string }) => model.id)
    .filter(Boolean)
    .sort((a: string, b: string) => a.localeCompare(b));
}

async function listAnthropicModels(endpoint: AIEndpoint): Promise<string[]> {
  const requestUrl = buildProviderModelsUrl(
    "anthropic",
    endpoint.baseUrl,
    endpoint.apiKey,
    endpoint.useExactRequestUrl,
  );

  try {
    const data = await fetchJson(
      requestUrl,
      {
        headers: {
          "x-api-key": endpoint.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
      },
      {
        endpoint,
        action: "list-models",
      },
    );

    return (data.data || [])
      .map((model: { id: string }) => model.id)
      .filter(Boolean)
      .sort((a: string, b: string) => a.localeCompare(b));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("404") || message.includes("405")) {
      return [...ANTHROPIC_FALLBACK_MODELS];
    }
    throw error;
  }
}

async function listGoogleModels(endpoint: AIEndpoint): Promise<string[]> {
  const requestUrl = buildProviderModelsUrl(
    "google",
    endpoint.baseUrl,
    endpoint.apiKey,
    endpoint.useExactRequestUrl,
  );

  try {
    const data = await fetchJson(requestUrl, undefined, {
      endpoint,
      action: "list-models",
    });
    return (data.models || [])
      .filter((model: { supportedGenerationMethods?: string[] }) =>
        model.supportedGenerationMethods?.includes("generateContent"),
      )
      .map((model: { name: string }) => normalizeGoogleModel(model.name))
      .filter(Boolean)
      .sort((a: string, b: string) => a.localeCompare(b));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("403") || message.includes("404")) {
      return [...GOOGLE_FALLBACK_MODELS];
    }
    throw error;
  }
}

async function listOllamaModels(endpoint: AIEndpoint): Promise<string[]> {
  const requestUrl = buildProviderModelsUrl(
    "ollama",
    endpoint.baseUrl,
    endpoint.apiKey,
    endpoint.useExactRequestUrl,
  );
  const data = await fetchJson(requestUrl, undefined, {
    endpoint,
    action: "list-models",
  });
  return (data.models || [])
    .map((model: { name: string }) => model.name)
    .filter(Boolean)
    .sort((a: string, b: string) => a.localeCompare(b));
}

async function listLMStudioModels(endpoint: AIEndpoint): Promise<string[]> {
  const requestUrl = buildProviderModelsUrl(
    "lmstudio",
    endpoint.baseUrl,
    endpoint.apiKey,
    endpoint.useExactRequestUrl,
  );
  const data = await fetchJson(requestUrl, undefined, {
    endpoint,
    action: "list-models",
  });
  return (data.data || [])
    .map((model: { id: string }) => model.id)
    .filter(Boolean)
    .sort((a: string, b: string) => a.localeCompare(b));
}

async function listEndpointModels(endpoint: AIEndpoint): Promise<string[]> {
  switch (endpoint.provider) {
    case "anthropic":
      return listAnthropicModels(endpoint);
    case "google":
      return listGoogleModels(endpoint);
    case "ollama":
      return listOllamaModels(endpoint);
    case "lmstudio":
      return listLMStudioModels(endpoint);
    case "deepseek":
      try {
        return await listOpenAICompatibleModels(endpoint);
      } catch {
        return [...DEEPSEEK_FALLBACK_MODELS];
      }
    default:
      return listOpenAICompatibleModels(endpoint);
  }
}

async function resolveTestModel(
  endpoint: AIEndpoint,
  preferredModel?: string,
): Promise<{
  model?: string;
  modelCount?: number;
}> {
  const chosenModel = preferredModel?.trim();
  if (chosenModel) {
    return { model: chosenModel };
  }

  if (endpoint.models.length > 0) {
    return {
      model: endpoint.models[0],
      modelCount: endpoint.models.length,
    };
  }

  const models = await listEndpointModels(endpoint);
  if (models.length > 0) {
    return {
      model: models[0],
      modelCount: models.length,
    };
  }

  return { modelCount: 0 };
}

export function getAIEndpointRequestPreview(endpoint: AIEndpoint, preferredModel?: string): string {
  const baseUrl = getEndpointBaseUrl(endpoint);
  if (!baseUrl) return "";

  const chosenModel = preferredModel?.trim() || endpoint.models[0] || "{model}";

  switch (endpoint.provider) {
    case "anthropic":
      return `${resolveProviderBaseUrl("anthropic", baseUrl, endpoint.useExactRequestUrl)}/messages`;
    case "google":
      return `${resolveProviderBaseUrl("google", baseUrl, endpoint.useExactRequestUrl)}/v1beta/models/${normalizeGoogleModel(chosenModel)}:generateContent?key=***`;
    default:
      return buildOpenAICompatibleUrl(
        baseUrl,
        "chat/completions",
        "https://api.openai.com",
        endpoint.useExactRequestUrl,
      );
  }
}

async function testAnthropic(endpoint: AIEndpoint, model: string): Promise<string> {
  const requestUrl = getAIEndpointRequestPreview(endpoint, model);
  const data = await fetchJson(
    requestUrl,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": endpoint.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4,
        temperature: 0,
        messages: [{ role: "user", content: OPENAI_COMPATIBLE_TEST_PROMPT }],
      }),
    },
    {
      endpoint,
      action: "test-connection",
      model,
    },
  );

  if (!data?.id) {
    throw new Error("Anthropic test request returned an unexpected response.");
  }

  return requestUrl;
}

async function testGoogle(endpoint: AIEndpoint, model: string): Promise<string> {
  const normalizedModel = normalizeGoogleModel(model);
  const requestUrl = `${resolveProviderBaseUrl("google", endpoint.baseUrl, endpoint.useExactRequestUrl)}/v1beta/models/${normalizedModel}:generateContent?key=${encodeURIComponent(endpoint.apiKey)}`;
  const data = await fetchJson(
    requestUrl,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: OPENAI_COMPATIBLE_TEST_PROMPT }],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 4,
        },
      }),
    },
    {
      endpoint,
      action: "test-connection",
      model: normalizedModel,
    },
  );

  if (!Array.isArray(data?.candidates) || data.candidates.length === 0) {
    throw new Error("Google test request returned no candidates.");
  }

  return getAIEndpointRequestPreview(endpoint, normalizedModel);
}

async function testOpenAICompatible(endpoint: AIEndpoint, model: string): Promise<string> {
  const requestUrl = getAIEndpointRequestPreview(endpoint, model);
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (endpoint.apiKey) {
    headers.Authorization = `Bearer ${endpoint.apiKey}`;
  }

  const data = await fetchJson(
    requestUrl,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: OPENAI_COMPATIBLE_TEST_PROMPT }],
        temperature: 0,
        max_tokens: 4,
      }),
    },
    {
      endpoint,
      action: "test-connection",
      model,
    },
  );

  if (!Array.isArray(data?.choices) || data.choices.length === 0) {
    throw new Error("Test request returned no choices.");
  }

  return requestUrl;
}

export async function testAIEndpoint(
  endpoint: AIEndpoint,
  options: EndpointTestOptions = {},
): Promise<EndpointTestResult> {
  const baseUrl = getEndpointBaseUrl(endpoint);
  assertConfigured(endpoint, baseUrl);
  if (
    endpoint.useExactRequestUrl &&
    providerSupportsExactRequestUrl(endpoint.provider) &&
    !options.model &&
    endpoint.models.length === 0
  ) {
    throw new Error(
      "Exact request URL mode requires a model name. Add one manually before testing.",
    );
  }

  const { model, modelCount } = await resolveTestModel(endpoint, options.model);
  if (!model) {
    throw new Error("No model available. Please fetch models or add one manually first.");
  }

  let requestUrl = getAIEndpointRequestPreview(endpoint, model);

  switch (endpoint.provider) {
    case "anthropic":
      requestUrl = await testAnthropic(endpoint, model);
      break;
    case "google":
      requestUrl = await testGoogle(endpoint, model);
      break;
    case "ollama":
      // Pre-check: verify the Ollama server is reachable before running the full test
      try {
        const tagsUrl = buildProviderModelsUrl(
          "ollama",
          endpoint.baseUrl,
          endpoint.apiKey,
          endpoint.useExactRequestUrl,
        );
        await fetchJson(tagsUrl, undefined, { endpoint, action: "ollama-ping" });
      } catch (pingErr) {
        const msg = pingErr instanceof Error ? pingErr.message : String(pingErr);
        throw new Error(
          `Cannot reach Ollama at ${endpoint.baseUrl || "http://localhost:11434"}. ` +
            `Make sure Ollama is running and set OLLAMA_ORIGINS=* if needed. (${msg})`,
        );
      }
      requestUrl = await testOpenAICompatible(endpoint, model);
      break;
    case "lmstudio":
      requestUrl = await testOpenAICompatible(endpoint, model);
      break;
    default:
      requestUrl = await testOpenAICompatible(endpoint, model);
      break;
  }

  return {
    modelCount,
    testedModel: model,
    requestUrl,
  };
}
