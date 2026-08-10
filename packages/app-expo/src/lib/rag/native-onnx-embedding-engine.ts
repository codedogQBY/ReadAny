import * as FileSystem from "expo-file-system/legacy";
import { InferenceSession, Tensor } from "onnxruntime-react-native";
import type { ILocalEmbeddingEngine } from "@readany/core/ai/local-embedding-service";

const MAX_TOKENS = 128;
const DOWNLOAD_TIMEOUT_MS = 30_000;

type PoolingStrategy = "cls" | "mean";
type MobileModel = { hfModelId: string; pooling: PoolingStrategy };

const MOBILE_MODELS: Record<string, MobileModel> = {
  "bge-small-zh-v1.5": {
    hfModelId: "Xenova/bge-small-zh-v1.5",
    pooling: "cls",
  },
  "all-MiniLM-L6-v2": {
    hfModelId: "Xenova/all-MiniLM-L6-v2",
    pooling: "mean",
  },
};

type TokenizerFile = { model?: { vocab?: Record<string, number>; unk_token?: string } };

/** Native Android/iOS implementation for the compact Chinese BGE model. */
export class NativeOnnxEmbeddingEngine implements ILocalEmbeddingEngine {
  private session: InferenceSession | null = null;
  private vocab: Record<string, number> | null = null;
  private loadedModelId: string | null = null;

  init(): void {}

  async load(modelId: string, _hfModelId: string, onProgress?: (p: number) => void): Promise<void> {
    const model = MOBILE_MODELS[modelId];
    if (!model) throw new Error(`Unsupported mobile local embedding model: ${modelId}`);
    if (this.session && this.vocab && this.loadedModelId === modelId) return;
    await this.dispose();
    const directory = `${FileSystem.documentDirectory}readany-models/${modelId}`;
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    const modelPath = `${directory}/model_quantized.onnx`;
    const tokenizerPath = `${directory}/tokenizer.json`;
    const readyPath = `${directory}/.ready`;
    const ready = await FileSystem.getInfoAsync(readyPath);
    if (!ready.exists) {
      // Interrupted downloads leave a file at the target path. Remove it before
      // retrying rather than treating a partial model as a valid cache entry.
      await FileSystem.deleteAsync(directory, { idempotent: true });
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    }
    const modelBase = `https://huggingface.co/${model.hfModelId}/resolve/main`;
    await this.download(`${modelBase}/onnx/model_quantized.onnx`, modelPath, 0, 88, onProgress);
    await this.download(`${modelBase}/tokenizer.json`, tokenizerPath, 88, 100, onProgress);
    const tokenizer = JSON.parse(await FileSystem.readAsStringAsync(tokenizerPath)) as TokenizerFile;
    if (!tokenizer.model?.vocab) throw new Error("Downloaded tokenizer is missing its vocabulary.");
    this.vocab = tokenizer.model.vocab;
    this.session = await InferenceSession.create(modelPath, {
      executionProviders: ["nnapi", "cpu"],
      graphOptimizationLevel: "all",
      intraOpNumThreads: 2,
    });
    this.loadedModelId = modelId;
    await FileSystem.writeAsStringAsync(readyPath, "ok");
  }

  async generate(modelId: string, texts: string[], onItemProgress?: (done: number, total: number) => void): Promise<number[][]> {
    await this.load(modelId, "");
    if (!this.session || !this.vocab) throw new Error("Local embedding model did not initialize.");
    const output: number[][] = [];
    for (let index = 0; index < texts.length; index++) {
      const tokens = encodeWordPiece(texts[index], this.vocab);
      const ids = new BigInt64Array(MAX_TOKENS);
      const mask = new BigInt64Array(MAX_TOKENS);
      const types = new BigInt64Array(MAX_TOKENS);
      for (let i = 0; i < tokens.length; i++) { ids[i] = BigInt(tokens[i]); mask[i] = 1n; }
      const feeds: Record<string, Tensor> = {
        input_ids: new Tensor(ids, [1, MAX_TOKENS]),
        attention_mask: new Tensor(mask, [1, MAX_TOKENS]),
      };
      if (this.session.inputNames.includes("token_type_ids")) feeds.token_type_ids = new Tensor(types, [1, MAX_TOKENS]);
      const result = await this.session.run(feeds);
      const tensor = result.last_hidden_state ?? result[Object.keys(result)[0]];
      if (!tensor || !(tensor.data instanceof Float32Array)) throw new Error("Local model returned no float embedding output.");
      output.push(
        MOBILE_MODELS[modelId].pooling === "cls"
          ? clsPoolAndNormalize(tensor.data)
          : meanPoolAndNormalize(tensor.data, tokens.length),
      );
      onItemProgress?.(index + 1, texts.length);
    }
    return output;
  }

  async dispose(): Promise<void> { this.session = null; this.vocab = null; this.loadedModelId = null; }

  async clearCache(hfModelId: string): Promise<void> {
    await this.dispose();
    const modelId = Object.entries(MOBILE_MODELS).find(([, model]) => model.hfModelId === hfModelId)?.[0];
    if (modelId) await FileSystem.deleteAsync(`${FileSystem.documentDirectory}readany-models/${modelId}`, { idempotent: true });
  }

  private async download(url: string, target: string, start: number, end: number, progress?: (p: number) => void) {
    if ((await FileSystem.getInfoAsync(target)).exists) { progress?.(end); return; }
    const job = FileSystem.createDownloadResumable(url, target, {}, ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      if (totalBytesExpectedToWrite > 0) progress?.(Math.round(start + ((end - start) * totalBytesWritten) / totalBytesExpectedToWrite));
    });
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        reject(new Error("无法连接模型下载服务器。请检查手机网络或开启可访问 Hugging Face 的 VPN 后重试。"));
      }, DOWNLOAD_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([job.downloadAsync(), timeout]);
      if (!result) throw new Error("Model download was cancelled.");
    } catch (error) {
      if (timedOut) await job.pauseAsync().catch(() => undefined);
      await FileSystem.deleteAsync(target, { idempotent: true });
      throw error;
    } finally {
      clearTimeout(timeoutId!);
    }
  }
}

function encodeWordPiece(text: string, vocab: Record<string, number>): number[] {
  const unk = vocab["[UNK]"] ?? 100, cls = vocab["[CLS]"] ?? 101, sep = vocab["[SEP]"] ?? 102;
  const ids = [cls];
  // BERT's BasicTokenizer surrounds each CJK code point with whitespace before
  // WordPiece. Treating "梅琳娜" as one word makes an English-style tokenizer
  // emit one [UNK] token, which collapses all short Chinese queries together.
  const cjkSeparated = Array.from(text.normalize("NFD"), (char) =>
    isCjk(char) ? ` ${char} ` : char,
  ).join("");
  const words = cjkSeparated.replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? [];
  for (const word of words) {
    let cursor = 0, parts: number[] = [], failed = word.length > 100;
    while (!failed && cursor < word.length) {
      let end = word.length, found: number | undefined;
      while (end > cursor) { const piece = `${cursor ? "##" : ""}${word.slice(cursor, end)}`; if (vocab[piece] !== undefined) { found = vocab[piece]; break; } end--; }
      if (found === undefined) failed = true; else { parts.push(found); cursor = end; }
    }
    ids.push(...(failed ? [unk] : parts));
    if (ids.length >= MAX_TOKENS - 1) break;
  }
  ids.push(sep); return ids.slice(0, MAX_TOKENS);
}

function isCjk(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x20000 && code <= 0x2fa1f) ||
    (code >= 0xf900 && code <= 0xfaff)
  );
}

function clsPoolAndNormalize(data: Float32Array): number[] {
  const dimension = data.length / MAX_TOKENS;
  if (!Number.isInteger(dimension) || dimension <= 0) throw new Error("Local model returned an invalid embedding shape.");
  const output = Array.from(data.subarray(0, dimension));
  let norm = 0; for (let d = 0; d < dimension; d++) norm += output[d] ** 2;
  norm = Math.sqrt(norm) || 1; return output.map((value) => value / norm);
}

function meanPoolAndNormalize(data: Float32Array, tokenCount: number): number[] {
  const dimension = data.length / MAX_TOKENS;
  if (!Number.isInteger(dimension) || dimension <= 0) throw new Error("Local model returned an invalid embedding shape.");
  const output = new Array<number>(dimension).fill(0);
  for (let token = 0; token < tokenCount; token++) {
    for (let d = 0; d < dimension; d++) output[d] += data[token * dimension + d];
  }
  let norm = 0;
  for (let d = 0; d < dimension; d++) {
    output[d] /= tokenCount;
    norm += output[d] ** 2;
  }
  norm = Math.sqrt(norm) || 1;
  return output.map((value) => value / norm);
}
