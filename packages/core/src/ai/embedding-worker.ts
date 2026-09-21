/**
 * Embedding Web Worker — runs Transformers.js model inference off the main thread.
 * Communicates with the main thread via postMessage.
 *
 * Messages IN:
 *   { type: "load", modelId: string, hfModelId: string }
 *   { type: "embed", requestId: string, texts: string[] }
 *   { type: "dispose" }
 *
 * Messages OUT:
 *   { type: "load:progress", progress: number }
 *   { type: "load:done" }
 *   { type: "load:error", error: string }
 *   { type: "embed:progress", requestId: string, done: number, total: number }
 *   { type: "embed:done", requestId: string, embeddings: number[][] }
 *   { type: "embed:error", requestId: string, error: string }
 */

let pipeline: any = null;
let currentModelId: string | null = null;

const MODEL_LOAD_MAX_ATTEMPTS = 3;
const MODEL_LOAD_RETRY_BASE_MS = 500;
const DEFAULT_REMOTE_HOSTS = ["https://hf-mirror.com/", "https://huggingface.co/"];

function getRemoteHosts(): string[] {
  const configured = (globalThis as { __READANY_HF_REMOTE_HOST__?: unknown })
    .__READANY_HF_REMOTE_HOST__;
  const hosts =
    typeof configured === "string" ? [configured, ...DEFAULT_REMOTE_HOSTS] : DEFAULT_REMOTE_HOSTS;
  return [...new Set(hosts.map((host) => `${host.trim().replace(/\/+$/, "")}/`).filter(Boolean))];
}

function describeError(error: unknown): { type: string; message: string } {
  if (error instanceof Error) return { type: error.name || "Error", message: error.message };
  return { type: typeof error, message: String(error) };
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === "load") {
    await handleLoad(msg.modelId, msg.hfModelId);
  } else if (msg.type === "embed") {
    await handleEmbed(msg.requestId, msg.texts);
  } else if (msg.type === "dispose") {
    await handleDispose();
  } else if (msg.type === "clearCache") {
    await handleClearCache(msg.hfModelId);
  }
};

async function handleLoad(modelId: string, hfModelId: string) {
  let lastError: unknown;
  const remoteHosts = getRemoteHosts();

  for (let attempt = 1; attempt <= MODEL_LOAD_MAX_ATTEMPTS; attempt++) {
    const remoteHost = remoteHosts[(attempt - 1) % remoteHosts.length];
    try {
      // Reuse if same model already loaded
      if (pipeline && currentModelId === modelId) {
        self.postMessage({ type: "load:done" });
        return;
      }

      // Dispose previous pipeline
      if (pipeline) {
        try {
          await pipeline.dispose?.();
        } catch {
          /* ignore */
        }
        pipeline = null;
        currentModelId = null;
      }

      const { pipeline: createPipeline, env } = await import("@huggingface/transformers");
      env.allowLocalModels = false;
      env.remoteHost = remoteHost;

      console.info("[EmbeddingWorker] loading model", {
        modelId,
        hfModelId,
        attempt,
        remoteHost,
      });

      pipeline = await createPipeline("feature-extraction", hfModelId, {
        progress_callback: (p: any) => {
          if (p.status === "progress") {
            self.postMessage({ type: "load:progress", progress: Math.round(p.progress ?? 0) });
          }
        },
      });

      currentModelId = modelId;
      self.postMessage({ type: "load:done" });
      return;
    } catch (err) {
      lastError = err;
      const details = describeError(err);
      console.warn("[EmbeddingWorker] model load failed", {
        modelId,
        hfModelId,
        attempt,
        remoteHost,
        errorType: details.type,
        error: details.message,
      });

      // A partial model download can poison subsequent attempts. Clear only this
      // model before retrying, then switch to the next configured host.
      if (attempt < MODEL_LOAD_MAX_ATTEMPTS) {
        await clearModelCacheEntries(hfModelId);
        await wait(MODEL_LOAD_RETRY_BASE_MS * 2 ** (attempt - 1));
      }
    }
  }

  const details = describeError(lastError);
  self.postMessage({
    type: "load:error",
    error: `模型下载失败（${details.type}）：${details.message}`,
  });
}

async function handleEmbed(requestId: string, texts: string[]) {
  if (!pipeline) {
    self.postMessage({ type: "embed:error", requestId, error: "Model not loaded" });
    return;
  }

  try {
    const embeddings: number[][] = [];
    const total = texts.length;

    // Process texts one-by-one (Transformers.js doesn't truly batch in WASM)
    // but doing it in the Worker means it doesn't block the main thread
    for (let i = 0; i < total; i++) {
      const output = await pipeline(texts[i], { pooling: "mean", normalize: true });
      embeddings.push(Array.from(output.data as Float32Array).slice(0, output.dims[1]));

      // Report progress every item
      if ((i + 1) % 2 === 0 || i === total - 1) {
        self.postMessage({ type: "embed:progress", requestId, done: i + 1, total });
      }
    }

    self.postMessage({ type: "embed:done", requestId, embeddings });
  } catch (err) {
    self.postMessage({
      type: "embed:error",
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleDispose() {
  if (pipeline) {
    try {
      await pipeline.dispose?.();
    } catch {
      /* ignore */
    }
    pipeline = null;
    currentModelId = null;
  }
}

/**
 * Clear cached model files from browser Cache Storage.
 * Transformers.js stores downloaded models in caches named like
 * "transformers-cache" or keyed by the HuggingFace model URL.
 */
async function handleClearCache(hfModelId: string) {
  try {
    // Dispose pipeline if it's the model being cleared
    if (pipeline && currentModelId) {
      try {
        await pipeline.dispose?.();
      } catch {
        /* ignore */
      }
      pipeline = null;
      currentModelId = null;
    }

    // Transformers.js uses the Cache API with cache name "transformers-cache"
    const deletedCount = await clearModelCacheEntries(hfModelId);

    self.postMessage({ type: "clearCache:done", deletedCount });
  } catch (err) {
    self.postMessage({
      type: "clearCache:error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function clearModelCacheEntries(hfModelId: string): Promise<number> {
  if (typeof caches === "undefined") return 0;
  const cacheNames = await caches.keys();
  let deletedCount = 0;
  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    for (const key of await cache.keys()) {
      if (key.url.includes(hfModelId) && (await cache.delete(key))) deletedCount++;
    }
  }
  if (deletedCount > 0)
    console.info("[EmbeddingWorker] cleared cached model files", { hfModelId, deletedCount });
  return deletedCount;
}
