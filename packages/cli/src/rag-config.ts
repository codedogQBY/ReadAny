import type { EmbeddingModel, SearchMode, VectorModelConfig } from "@readany/core/types";

type PersistedVectorModelState = {
  vectorModels?: VectorModelConfig[];
  selectedVectorModelId?: string | null;
  vectorModelEnabled?: boolean;
  vectorModelMode?: "remote" | "builtin";
};

const SEARCH_MODES = new Set<SearchMode>(["bm25", "hybrid", "vector"]);
let configuredEmbeddingKey: string | null = null;

async function clearConfiguredEmbedding(): Promise<void> {
  const { clearSearchConfiguration } = await import("@readany/core/rag");
  clearSearchConfiguration();
  configuredEmbeddingKey = null;
}

export function isRagSearchMode(value: string): value is SearchMode {
  return SEARCH_MODES.has(value as SearchMode);
}

function getEnvEmbeddingConfig(env: NodeJS.ProcessEnv): VectorModelConfig | null {
  const modelId = env.READANY_EMBEDDING_MODEL?.trim();
  if (!modelId) return null;
  return {
    id: "env",
    name: "Environment embedding model",
    modelId,
    url: env.READANY_EMBEDDING_BASE_URL?.trim() || "https://api.openai.com",
    apiKey: env.READANY_EMBEDDING_API_KEY?.trim() || "",
  };
}

async function readPersistedVectorModelConfig(
  env: NodeJS.ProcessEnv,
): Promise<VectorModelConfig | null> {
  const { getPlatformService } = await import("@readany/core/services");
  const platform = getPlatformService();
  const appData = await platform.getAppDataDir();
  const filePath = await platform.joinPath(appData, "readany-store", "vector-model.json");

  let state: PersistedVectorModelState | null = null;
  try {
    state = JSON.parse(await platform.readTextFile(filePath)) as PersistedVectorModelState;
  } catch {
    return getEnvEmbeddingConfig(env);
  }

  if (state.vectorModelEnabled === false) return getEnvEmbeddingConfig(env);
  if (state.vectorModelMode && state.vectorModelMode !== "remote") {
    return getEnvEmbeddingConfig(env);
  }

  const selected = state.vectorModels?.find((model) => model.id === state.selectedVectorModelId);
  return selected ?? getEnvEmbeddingConfig(env);
}

function toEmbeddingModel(model: VectorModelConfig): EmbeddingModel {
  return {
    id: model.modelId,
    name: model.name || model.modelId,
    dimensions: model.dimension ?? 0,
    maxTokens: 8192,
    provider: "openai",
  };
}

export async function configureRagSearchForCli(
  mode: SearchMode,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ embeddingConfigured: boolean }> {
  if (mode === "bm25") return { embeddingConfigured: false };

  const model = await readPersistedVectorModelConfig(env);
  if (!model) {
    await clearConfiguredEmbedding();
    if (mode === "vector") {
      throw new Error(
        "Vector RAG search requires a configured remote vector model or READANY_EMBEDDING_MODEL.",
      );
    }
    return { embeddingConfigured: false };
  }

  if (!model.apiKey && !model.url.includes("localhost") && !model.url.includes("127.0.0.1")) {
    await clearConfiguredEmbedding();
    if (mode === "vector") {
      throw new Error(
        "Vector RAG search requires an embedding API key or a local OpenAI-compatible endpoint.",
      );
    }
    return { embeddingConfigured: false };
  }

  const key = `${model.url}\n${model.modelId}\n${model.apiKey}`;
  if (configuredEmbeddingKey === key) return { embeddingConfigured: true };

  const { EmbeddingService, configureSearch, normalizeEmbeddingEndpoint } = await import("@readany/core/rag");
  configureSearch(
    new EmbeddingService({
      model: toEmbeddingModel(model),
      apiKey: model.apiKey || "local",
      baseUrl: model.url,
    }),
    {
      kind: "remote",
      modelId: model.modelId,
      endpoint: normalizeEmbeddingEndpoint(model.url),
      dimensions: model.dimension ?? 0,
    },
  );
  configuredEmbeddingKey = key;
  return { embeddingConfigured: true };
}
