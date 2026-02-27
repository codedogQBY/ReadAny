/**
 * Local Embedding Service — runs embedding models via a Web Worker
 * to avoid blocking the main thread.
 *
 * Models are automatically downloaded from HuggingFace and cached by the browser.
 */
import { BUILTIN_EMBEDDING_MODELS } from "./builtin-embedding-models";

/** The singleton worker instance */
let worker: Worker | null = null;
let workerModelId: string | null = null;
let requestCounter = 0;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./embedding-worker.ts", import.meta.url), { type: "module" });
  }
  return worker;
}

/**
 * Load (or reuse) an embedding model in the Web Worker.
 * First call downloads the model; subsequent calls are instant.
 */
export function loadEmbeddingPipeline(
  builtinModelId: string,
  onProgress?: (progress: number) => void,
): Promise<void> {
  const model = BUILTIN_EMBEDDING_MODELS.find((m) => m.id === builtinModelId);
  if (!model) return Promise.reject(new Error(`Unknown built-in model: ${builtinModelId}`));

  // Already loaded
  if (workerModelId === builtinModelId) return Promise.resolve();

  const w = getWorker();

  return new Promise<void>((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === "load:progress") {
        onProgress?.(msg.progress);
      } else if (msg.type === "load:done") {
        workerModelId = builtinModelId;
        w.removeEventListener("message", handler);
        resolve();
      } else if (msg.type === "load:error") {
        w.removeEventListener("message", handler);
        reject(new Error(msg.error));
      }
    };

    w.addEventListener("message", handler);
    w.postMessage({ type: "load", modelId: builtinModelId, hfModelId: model.hfModelId });
  });
}

/**
 * Generate embeddings for one or more texts using the loaded model (via Worker).
 * Returns an array of number arrays (one embedding per text).
 * Does NOT block the main thread.
 */
export function generateLocalEmbeddings(
  builtinModelId: string,
  texts: string[],
  onItemProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  const w = getWorker();
  const requestId = `req-${++requestCounter}`;

  return new Promise<number[][]>((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.requestId !== requestId) return;

      if (msg.type === "embed:progress") {
        onItemProgress?.(msg.done, msg.total);
      } else if (msg.type === "embed:done") {
        w.removeEventListener("message", handler);
        resolve(msg.embeddings);
      } else if (msg.type === "embed:error") {
        w.removeEventListener("message", handler);
        reject(new Error(msg.error));
      }
    };

    w.addEventListener("message", handler);
    w.postMessage({ type: "embed", requestId, texts });
  });
}

/**
 * Dispose / unload the worker to free memory.
 */
export async function disposeEmbeddingPipeline() {
  if (worker) {
    worker.postMessage({ type: "dispose" });
    // Give time for cleanup, then terminate
    setTimeout(() => {
      worker?.terminate();
      worker = null;
      workerModelId = null;
    }, 500);
  }
}
