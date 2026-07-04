import { getPlatformService } from "../services/platform";

export interface RemoteEmbeddingModel {
  url: string;
  modelId: string;
  apiKey: string;
}

export type RemoteEmbeddingBatchResult =
  | { ok: true; embeddings: number[][] }
  | { ok: false; status: number; errorText: string };

export type RemoteEmbeddingFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface RemoteEmbeddingBatchOptions {
  fetchImpl?: RemoteEmbeddingFetch;
  maxCharsPerInput?: number;
}

interface OpenAIEmbeddingItem {
  embedding: number[];
  index: number;
}

export async function requestRemoteEmbeddingBatch(
  model: RemoteEmbeddingModel,
  inputTexts: string[],
  options: RemoteEmbeddingBatchOptions = {},
): Promise<RemoteEmbeddingBatchResult> {
  const isOllama = isOllamaEmbeddingUrl(model.url);
  const maxCharsPerInput = options.maxCharsPerInput;
  const safeTexts =
    typeof maxCharsPerInput === "number" && maxCharsPerInput > 0
      ? inputTexts.map((text) =>
          text.length > maxCharsPerInput ? text.slice(0, maxCharsPerInput) : text,
        )
      : inputTexts;
  const requestBody = isOllama
    ? { model: model.modelId, input: safeTexts }
    : {
        input: safeTexts,
        model: model.modelId,
        encoding_format: "float",
      };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (model.apiKey.trim()) {
    headers.Authorization = `Bearer ${model.apiKey}`;
  }

  const fetchImpl = options.fetchImpl ?? getRemoteEmbeddingFetch();
  const response = await fetchImpl(model.url, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    return { ok: false, status: response.status, errorText };
  }

  const json = await response.json();
  return {
    ok: true,
    embeddings: parseRemoteEmbeddingResponse(json, isOllama),
  };
}

export function isOllamaEmbeddingUrl(url: string): boolean {
  return url.replace(/\/$/, "").endsWith("/api/embed");
}

function getRemoteEmbeddingFetch(): RemoteEmbeddingFetch {
  try {
    const platform = getPlatformService();
    return (url, init) => platform.fetch(url, init);
  } catch {
    return (url, init) => globalThis.fetch(url, init);
  }
}

function parseRemoteEmbeddingResponse(json: unknown, isOllama: boolean): number[][] {
  if (isOllama) {
    const embeddings = (json as { embeddings?: number[][] })?.embeddings;
    return Array.isArray(embeddings) ? embeddings : [];
  }

  const data = (json as { data?: OpenAIEmbeddingItem[] })?.data;
  if (!Array.isArray(data)) return [];

  return data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}
