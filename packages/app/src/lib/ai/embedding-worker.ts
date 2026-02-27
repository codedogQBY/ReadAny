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

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === "load") {
    await handleLoad(msg.modelId, msg.hfModelId);
  } else if (msg.type === "embed") {
    await handleEmbed(msg.requestId, msg.texts);
  } else if (msg.type === "dispose") {
    await handleDispose();
  }
};

async function handleLoad(modelId: string, hfModelId: string) {
  try {
    // Reuse if same model already loaded
    if (pipeline && currentModelId === modelId) {
      self.postMessage({ type: "load:done" });
      return;
    }

    // Dispose previous pipeline
    if (pipeline) {
      try { await pipeline.dispose?.(); } catch { /* ignore */ }
      pipeline = null;
      currentModelId = null;
    }

    const { pipeline: createPipeline, env } = await import("@huggingface/transformers");
    env.allowLocalModels = false;

    pipeline = await createPipeline("feature-extraction", hfModelId, {
      progress_callback: (p: any) => {
        if (p.status === "progress") {
          self.postMessage({ type: "load:progress", progress: Math.round(p.progress ?? 0) });
        }
      },
    });

    currentModelId = modelId;
    self.postMessage({ type: "load:done" });
  } catch (err) {
    self.postMessage({ type: "load:error", error: err instanceof Error ? err.message : String(err) });
  }
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
    self.postMessage({ type: "embed:error", requestId, error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleDispose() {
  if (pipeline) {
    try { await pipeline.dispose?.(); } catch { /* ignore */ }
    pipeline = null;
    currentModelId = null;
  }
}
