/**
 * API utilities for handling provider endpoints and base URLs.
 *
 * Key insight from cherry-studio:
 * Different AI providers have different URL patterns:
 * - OpenAI-style: need /v1 suffix (e.g., https://api.openai.com → https://api.openai.com/v1)
 * - Already versioned: already have version in path (e.g., https://openrouter.ai/api/v1/)
 * - Special paths: custom API paths (e.g., volces.com/api/v3)
 */

/**
 * Provider configuration with default base URL and path handling rules.
 */
export interface ProviderConfig {
  id: string;
  name: string;
  defaultBaseUrl: string;
  needsV1Suffix: boolean;
  placeholder: string;
  keyPlaceholder: string;
}

const OPTIONAL_API_KEY_PROVIDERS = new Set(["ollama", "lmstudio"]);

export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    defaultBaseUrl: "https://api.openai.com",
    needsV1Suffix: true,
    placeholder: "https://api.openai.com",
    keyPlaceholder: "sk-...",
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com",
    needsV1Suffix: true,
    placeholder: "https://api.deepseek.com",
    keyPlaceholder: "sk-...",
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    defaultBaseUrl: "https://api.anthropic.com",
    needsV1Suffix: false,
    placeholder: "https://api.anthropic.com",
    keyPlaceholder: "sk-ant-...",
  },
  google: {
    id: "google",
    name: "Google Gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    needsV1Suffix: false,
    placeholder: "https://generativelanguage.googleapis.com",
    keyPlaceholder: "AIza...",
  },
  ollama: {
    id: "ollama",
    name: "Ollama",
    defaultBaseUrl: "http://localhost:11434",
    needsV1Suffix: true,
    placeholder: "http://localhost:11434",
    keyPlaceholder: "ollama",
  },
  lmstudio: {
    id: "lmstudio",
    name: "LM Studio",
    defaultBaseUrl: "http://localhost:1234",
    needsV1Suffix: true,
    placeholder: "http://localhost:1234",
    keyPlaceholder: "lm-studio",
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    needsV1Suffix: false,
    placeholder: "https://openrouter.ai/api/v1",
    keyPlaceholder: "sk-or-...",
  },
  siliconflow: {
    id: "siliconflow",
    name: "SiliconFlow",
    defaultBaseUrl: "https://api.siliconflow.cn",
    needsV1Suffix: true,
    placeholder: "https://api.siliconflow.cn",
    keyPlaceholder: "sk-...",
  },
  moonshot: {
    id: "moonshot",
    name: "Moonshot (Kimi)",
    defaultBaseUrl: "https://api.moonshot.cn",
    needsV1Suffix: true,
    placeholder: "https://api.moonshot.cn",
    keyPlaceholder: "sk-...",
  },
  zhipu: {
    id: "zhipu",
    name: "智谱 GLM",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    needsV1Suffix: false,
    placeholder: "https://open.bigmodel.cn/api/paas/v4",
    keyPlaceholder: "...",
  },
  aliyun: {
    id: "aliyun",
    name: "阿里云通义",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    needsV1Suffix: false,
    placeholder: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    keyPlaceholder: "sk-...",
  },
  volces: {
    id: "volces",
    name: "火山引擎",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    needsV1Suffix: false,
    placeholder: "https://ark.cn-beijing.volces.com/api/v3",
    keyPlaceholder: "...",
  },
  baichuan: {
    id: "baichuan",
    name: "百川",
    defaultBaseUrl: "https://api.baichuan-ai.com",
    needsV1Suffix: true,
    placeholder: "https://api.baichuan-ai.com",
    keyPlaceholder: "sk-...",
  },
  minimax: {
    id: "minimax",
    name: "MiniMax",
    defaultBaseUrl: "https://api.minimax.chat/v1",
    needsV1Suffix: false,
    placeholder: "https://api.minimax.chat/v1",
    keyPlaceholder: "...",
  },
  groq: {
    id: "groq",
    name: "Groq",
    defaultBaseUrl: "https://api.groq.com/openai",
    needsV1Suffix: true,
    placeholder: "https://api.groq.com/openai",
    keyPlaceholder: "gsk_...",
  },
  together: {
    id: "together",
    name: "Together AI",
    defaultBaseUrl: "https://api.together.xyz",
    needsV1Suffix: true,
    placeholder: "https://api.together.xyz",
    keyPlaceholder: "...",
  },
  fireworks: {
    id: "fireworks",
    name: "Fireworks AI",
    defaultBaseUrl: "https://api.fireworks.ai/inference",
    needsV1Suffix: true,
    placeholder: "https://api.fireworks.ai/inference",
    keyPlaceholder: "...",
  },
  xai: {
    id: "xai",
    name: "xAI (Grok)",
    defaultBaseUrl: "https://api.x.ai",
    needsV1Suffix: true,
    placeholder: "https://api.x.ai",
    keyPlaceholder: "...",
  },
  mistral: {
    id: "mistral",
    name: "Mistral AI",
    defaultBaseUrl: "https://api.mistral.ai",
    needsV1Suffix: true,
    placeholder: "https://api.mistral.ai",
    keyPlaceholder: "...",
  },
  perplexity: {
    id: "perplexity",
    name: "Perplexity",
    defaultBaseUrl: "https://api.perplexity.ai",
    needsV1Suffix: false,
    placeholder: "https://api.perplexity.ai",
    keyPlaceholder: "pplx-...",
  },
  aihubmix: {
    id: "aihubmix",
    name: "AIHubMix",
    defaultBaseUrl: "https://aihubmix.com",
    needsV1Suffix: true,
    placeholder: "https://aihubmix.com",
    keyPlaceholder: "sk-...",
  },
  custom: {
    id: "custom",
    name: "Custom (OpenAI Compatible)",
    defaultBaseUrl: "",
    needsV1Suffix: true,
    placeholder: "https://your-api-endpoint.com",
    keyPlaceholder: "sk-...",
  },
};

const SPECIAL_HOSTS = ["volces.com/api/v3", "anthropic.com", "generativelanguage.googleapis.com"];

const CONSOLE_PATH_SEGMENTS = new Set(["console", "playground", "dashboard", "studio"]);

const VERSION_PATTERN =
  /\/(v[1-9]\d*|api\/v[1-9]\d*|api\/paas\/v[1-9]\d*|compatible-mode\/v[1-9]\d*|openai\/v[1-9]\d*)$/i;

export function formatApiHost(host: string): string {
  if (!host) return host;

  const normalizedHost = ensureUrlProtocol(host.trim());

  if (normalizedHost.endsWith("/")) {
    return normalizedHost;
  }

  for (const special of SPECIAL_HOSTS) {
    if (normalizedHost.includes(special)) {
      return `${normalizedHost}/`;
    }
  }

  if (VERSION_PATTERN.test(normalizedHost)) {
    return `${normalizedHost}/`;
  }

  return `${normalizedHost}/v1/`;
}

export function trimApiUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * If the URL has no scheme, prepend https:// (or http:// for localhost / loopback).
 * Without this, scheme-less inputs like "api.openai.com/v1" get resolved by the
 * Tauri webview as relative paths against tauri://localhost and fall through to
 * the SPA's own index.html, producing the confusing "Unexpected token '<'" /
 * "endpoint did not return JSON" error chain on connect.
 */
export function ensureUrlProtocol(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return trimmed;
  const stripped = trimmed.replace(/^\/+/, "");
  const isLoopback =
    /^(localhost(?:[:/]|$)|127\.\d+\.\d+\.\d+|0\.0\.0\.0(?:[:/]|$)|\[::1?\])/i.test(stripped);
  return `${isLoopback ? "http://" : "https://"}${stripped}`;
}

function sanitizeOpenAICompatibleBaseUrl(url: string): string {
  const trimmed = trimApiUrl(url);

  try {
    const parsed = new URL(trimmed);
    const segments = parsed.pathname.split("/").filter(Boolean);

    while (segments.length > 0) {
      const lastSegment = segments[segments.length - 1]?.toLowerCase();
      if (!lastSegment || !CONSOLE_PATH_SEGMENTS.has(lastSegment)) {
        break;
      }
      segments.pop();
    }

    parsed.pathname = segments.length > 0 ? `/${segments.join("/")}` : "/";
    parsed.search = "";
    parsed.hash = "";

    return trimApiUrl(parsed.toString());
  } catch {
    return trimmed;
  }
}

export function providerSupportsExactRequestUrl(providerId: string): boolean {
  return providerId !== "anthropic" && providerId !== "google";
}

export function resolveProviderBaseUrl(
  providerId: string,
  baseUrl?: string,
  exactRequestUrl = false,
): string {
  const rawBaseUrl = ensureUrlProtocol((baseUrl || getDefaultBaseUrl(providerId) || "").trim());
  if (!rawBaseUrl) return "";
  const providerConfig = getProviderConfig(providerId);
  const trimmedRawBaseUrl = trimApiUrl(rawBaseUrl);
  const rawLastSegment = trimmedRawBaseUrl.split("/").filter(Boolean).pop()?.toLowerCase();

  if (exactRequestUrl && providerSupportsExactRequestUrl(providerId)) {
    return rawBaseUrl;
  }

  if (!providerConfig.needsV1Suffix) {
    return trimApiUrl(rawBaseUrl);
  }

  if (rawBaseUrl.endsWith("/") && (!rawLastSegment || !CONSOLE_PATH_SEGMENTS.has(rawLastSegment))) {
    return trimApiUrl(rawBaseUrl);
  }

  return trimApiUrl(formatApiHost(sanitizeOpenAICompatibleBaseUrl(rawBaseUrl)));
}

export function buildProviderModelsUrl(
  providerId: string,
  baseUrl?: string,
  apiKey?: string,
  exactRequestUrl = false,
): string {
  const rawBaseUrl = ensureUrlProtocol((baseUrl || getDefaultBaseUrl(providerId) || "").trim());
  if (!rawBaseUrl) return "";

  if (exactRequestUrl && providerSupportsExactRequestUrl(providerId)) {
    return "";
  }

  switch (providerId) {
    case "google": {
      const resolvedBaseUrl = resolveProviderBaseUrl(providerId, baseUrl, exactRequestUrl);
      const keyQuery = apiKey ? `?key=${encodeURIComponent(apiKey)}` : "";
      return `${resolvedBaseUrl}/v1beta/models${keyQuery}`;
    }
    case "ollama":
      return `${trimApiUrl(rawBaseUrl)}/api/tags`;
    default: {
      const resolvedBaseUrl = resolveProviderBaseUrl(providerId, baseUrl, exactRequestUrl);
      return `${resolvedBaseUrl}/models`;
    }
  }
}

export function buildOpenAICompatibleUrl(
  baseUrl?: string,
  path = "chat/completions",
  fallbackBaseUrl = "https://api.openai.com",
  exactRequestUrl = false,
): string {
  const resolvedBaseUrl = resolveProviderBaseUrl(
    "custom",
    baseUrl || fallbackBaseUrl,
    exactRequestUrl,
  );
  if (!resolvedBaseUrl) return "";
  if (exactRequestUrl) return resolvedBaseUrl;
  return `${resolvedBaseUrl}/${path.replace(/^\/+/, "")}`;
}

function getPathSegments(url: string): string[] {
  try {
    return new URL(url).pathname.split("/").filter(Boolean);
  } catch {
    return trimApiUrl(url).split("/").filter(Boolean);
  }
}

function trimParsedUrlPath(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = getPathSegments(url);
    parsed.pathname = segments.length > 0 ? `/${segments.join("/")}` : "/";
    return trimApiUrl(parsed.toString());
  } catch {
    return trimApiUrl(url);
  }
}

function getLowerPathSegments(url: string): string[] {
  return getPathSegments(url).map((segment) => segment.toLowerCase());
}

export function isOllamaEmbeddingEndpointUrl(url: string): boolean {
  const normalized = ensureUrlProtocol(url);
  const segments = getLowerPathSegments(trimApiUrl(normalized));
  return (
    segments.length >= 2 &&
    segments[segments.length - 2] === "api" &&
    segments[segments.length - 1] === "embed"
  );
}

function isOllamaBaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.port === "11434" && getPathSegments(url).length === 0;
  } catch {
    return /(^|:)11434(\/|$)/.test(url);
  }
}

/**
 * Accept either an embeddings request URL or an OpenAI-compatible API base URL.
 * This keeps legacy saved root URLs working while preserving exact endpoints.
 */
export function normalizeEmbeddingEndpointUrl(
  url?: string,
  fallbackBaseUrl = "https://api.openai.com",
): string {
  const rawUrl = ensureUrlProtocol((url || fallbackBaseUrl).trim());
  if (!rawUrl) return "";
  const trimmedUrl = trimApiUrl(rawUrl);

  if (isOllamaEmbeddingEndpointUrl(trimmedUrl)) {
    return trimParsedUrlPath(trimmedUrl);
  }

  if (isOllamaBaseUrl(trimmedUrl)) {
    return `${trimmedUrl}/api/embed`;
  }

  const segments = getLowerPathSegments(trimmedUrl);
  if (segments[segments.length - 1] === "embeddings") {
    return trimParsedUrlPath(trimmedUrl);
  }

  return buildOpenAICompatibleUrl(trimmedUrl, "embeddings");
}

type EmbeddingEndpointFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface TestEmbeddingEndpointOptions {
  url?: string;
  modelId: string;
  apiKey?: string;
  input?: string;
  fetcher?: EmbeddingEndpointFetch;
}

export interface TestEmbeddingEndpointResult {
  url: string;
  dimension: number;
  isOllama: boolean;
}

export class EmbeddingEndpointTestError extends Error {
  readonly url: string;
  readonly status?: number;

  constructor(message: string, url: string, status?: number) {
    super(message);
    this.name = "EmbeddingEndpointTestError";
    this.url = url;
    this.status = status;
  }
}

export async function testEmbeddingEndpoint({
  url,
  modelId,
  apiKey,
  input = "test",
  fetcher = globalThis.fetch,
}: TestEmbeddingEndpointOptions): Promise<TestEmbeddingEndpointResult> {
  const requestUrl = normalizeEmbeddingEndpointUrl(url);
  const trimmedModelId = modelId.trim();

  if (!requestUrl) {
    throw new EmbeddingEndpointTestError("Missing endpoint URL", requestUrl);
  }
  if (!trimmedModelId) {
    throw new EmbeddingEndpointTestError("Missing model ID", requestUrl);
  }
  if (!fetcher) {
    throw new EmbeddingEndpointTestError("Fetch is not available in this environment", requestUrl);
  }

  const isOllama = isOllamaEmbeddingEndpointUrl(requestUrl);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const trimmedApiKey = apiKey?.trim();
  if (trimmedApiKey) {
    headers.Authorization = `Bearer ${trimmedApiKey}`;
  }

  const requestBody = isOllama
    ? { model: trimmedModelId, input }
    : { input: [input], model: trimmedModelId, encoding_format: "float" };

  const response = await fetcher(requestUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    const statusText = response.statusText ? ` ${response.statusText}` : "";
    const errorDetail = errorText ? `: ${errorText.slice(0, 200)}` : "";
    throw new EmbeddingEndpointTestError(
      `HTTP ${response.status}${statusText}${errorDetail}`,
      requestUrl,
      response.status,
    );
  }

  const json = await response.json();
  const dimension = isOllama
    ? (json?.embeddings?.[0]?.length ?? 0)
    : (json?.data?.[0]?.embedding?.length ?? 0);

  if (!dimension) {
    throw new EmbeddingEndpointTestError(
      "Response did not include an embedding vector",
      requestUrl,
    );
  }

  return { url: requestUrl, dimension, isOllama };
}

export function getProviderConfig(providerId: string): ProviderConfig {
  return PROVIDER_CONFIGS[providerId] || PROVIDER_CONFIGS.custom;
}

export function getDefaultBaseUrl(providerId: string): string {
  const config = getProviderConfig(providerId);
  return config.defaultBaseUrl;
}

export function detectProviderFromUrl(url: string): string {
  if (!url) return "custom";
  const urlLower = url.toLowerCase();

  if (urlLower.includes("openai.com")) return "openai";
  if (urlLower.includes("deepseek.com")) return "deepseek";
  if (urlLower.includes("anthropic.com")) return "anthropic";
  if (urlLower.includes("generativelanguage.googleapis.com")) return "google";
  if (urlLower.includes("localhost:11434")) return "ollama";
  if (urlLower.includes("localhost:1234")) return "lmstudio";
  if (urlLower.includes("openrouter.ai")) return "openrouter";
  if (urlLower.includes("siliconflow.cn")) return "siliconflow";
  if (urlLower.includes("moonshot.cn")) return "moonshot";
  if (urlLower.includes("bigmodel.cn")) return "zhipu";
  if (urlLower.includes("dashscope.aliyuncs.com")) return "aliyun";
  if (urlLower.includes("volces.com")) return "volces";
  if (urlLower.includes("baichuan-ai.com")) return "baichuan";
  if (urlLower.includes("minimax.chat")) return "minimax";
  if (urlLower.includes("groq.com")) return "groq";
  if (urlLower.includes("together.xyz")) return "together";
  if (urlLower.includes("fireworks.ai")) return "fireworks";
  if (urlLower.includes("api.x.ai")) return "xai";
  if (urlLower.includes("mistral.ai")) return "mistral";
  if (urlLower.includes("perplexity.ai")) return "perplexity";
  if (urlLower.includes("aihubmix.com")) return "aihubmix";

  return "custom";
}

export function providerRequiresApiKey(providerId: string): boolean {
  return !OPTIONAL_API_KEY_PROVIDERS.has(providerId);
}
