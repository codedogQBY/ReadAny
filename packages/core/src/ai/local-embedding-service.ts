/**
 * Local Embedding Service
 * Supports interchangeable engines (WebWorker for Desktop, Native ONNX for Mobile).
 */
import { BUILTIN_EMBEDDING_MODELS } from "./builtin-embedding-models";

export interface ILocalEmbeddingEngine {
  init(): void | Promise<void>;
  load(modelId: string, hfModelId: string, onProgress?: (p: number) => void): Promise<void>;
  generate(
    modelId: string,
    texts: string[],
    onItemProgress?: (done: number, total: number) => void,
  ): Promise<number[][]>;
  dispose(): Promise<void>;
  clearCache(hfModelId: string): Promise<void>;
}

let activeEngine: ILocalEmbeddingEngine | null = null;
let currentModelId: string | null = null;

export function setLocalEmbeddingEngine(engine: ILocalEmbeddingEngine) {
  activeEngine = engine;
  activeEngine.init?.();
}

function getEngine(): ILocalEmbeddingEngine {
  if (!activeEngine) {
    throw new Error(
      "Local embedding engine not set. Call setLocalEmbeddingEngine() early in your app lifecycle.",
    );
  }
  return activeEngine;
}

export async function loadEmbeddingPipeline(
  builtinModelId: string,
  onProgress?: (progress: number) => void,
): Promise<void> {
  const model = BUILTIN_EMBEDDING_MODELS.find((m) => m.id === builtinModelId);
  if (!model) throw new Error(`Unknown built-in model: ${builtinModelId}`);

  if (currentModelId === builtinModelId) return;

  const engine = getEngine();
  await engine.load(builtinModelId, model.hfModelId, onProgress);
  currentModelId = builtinModelId;
}

export function generateLocalEmbeddings(
  builtinModelId: string,
  texts: string[],
  onItemProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  return getEngine().generate(builtinModelId, texts, onItemProgress);
}

export async function disposeEmbeddingPipeline(): Promise<void> {
  if (activeEngine) {
    await activeEngine.dispose();
  }
  currentModelId = null;
}

export async function clearModelCache(builtinModelId: string): Promise<void> {
  const model = BUILTIN_EMBEDDING_MODELS.find((m) => m.id === builtinModelId);
  if (!model) throw new Error(`Unknown built-in model: ${builtinModelId}`);

  if (currentModelId === builtinModelId) {
    currentModelId = null;
  }
  await getEngine().clearCache(model.hfModelId);
}

// ------------------------------------------------------------------
// Legacy WebWorker Wrapper (Used by Tauri / Browser)
// ------------------------------------------------------------------

export class WebWorkerEmbeddingEngine implements ILocalEmbeddingEngine {
  private worker: Worker | null = null;
  private workerFactory: () => Worker;
  private requestCounter = 0;

  constructor(workerFactory: () => Worker) {
    this.workerFactory = workerFactory;
  }

  init() {
    // Lazily initialized
  }

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = this.workerFactory();
    }
    return this.worker;
  }

  load(modelId: string, hfModelId: string, onProgress?: (p: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const w = this.getWorker();
      const handler = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === "load:progress") onProgress?.(msg.progress);
        else if (msg.type === "load:done") {
          w.removeEventListener("message", handler);
          resolve();
        } else if (msg.type === "load:error") {
          w.removeEventListener("message", handler);
          reject(new Error(msg.error));
        }
      };
      w.addEventListener("message", handler);
      w.postMessage({ type: "load", modelId, hfModelId });
    });
  }

  generate(
    _modelId: string,
    texts: string[],
    onItemProgress?: (done: number, total: number) => void,
  ): Promise<number[][]> {
    return new Promise((resolve, reject) => {
      const w = this.getWorker();
      const reqId = `req-${++this.requestCounter}`;
      const handler = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.requestId !== reqId) return;
        if (msg.type === "embed:progress") onItemProgress?.(msg.done, msg.total);
        else if (msg.type === "embed:done") {
          w.removeEventListener("message", handler);
          resolve(msg.embeddings);
        } else if (msg.type === "embed:error") {
          w.removeEventListener("message", handler);
          reject(new Error(msg.error));
        }
      };
      w.addEventListener("message", handler);
      w.postMessage({ type: "embed", requestId: reqId, texts });
    });
  }

  async dispose(): Promise<void> {
    if (this.worker) {
      this.worker.postMessage({ type: "dispose" });
      setTimeout(() => {
        this.worker?.terminate();
        this.worker = null;
      }, 500);
    }
  }

  clearCache(hfModelId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const w = this.getWorker();
      const handler = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === "clearCache:done") {
          w.removeEventListener("message", handler);
          resolve();
        } else if (msg.type === "clearCache:error") {
          w.removeEventListener("message", handler);
          reject(new Error(msg.error));
        }
      };
      w.addEventListener("message", handler);
      w.postMessage({ type: "clearCache", hfModelId });
    });
  }
}

/** Legacy compat for existing app/src/main.tsx setups */
export function setEmbeddingWorkerFactory(factory: () => Worker): void {
  setLocalEmbeddingEngine(new WebWorkerEmbeddingEngine(factory));
}
