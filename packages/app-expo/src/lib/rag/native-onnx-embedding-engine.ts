import * as FileSystem from "expo-file-system/legacy";
import { InferenceSession, Tensor } from "onnxruntime-react-native";
import type { ILocalEmbeddingEngine } from "@readany/core/ai/local-embedding-service";
import { clsPoolAndNormalize, meanPoolAndNormalize } from "./embedding-pooling";
import { UnigramTokenizer } from "./unigram-tokenizer";

const MAX_TOKENS = 128;
/** A download is abandoned after this long without any bytes arriving. */
const DOWNLOAD_STALL_TIMEOUT_MS = 30_000;

type PoolingStrategy = "cls" | "mean";
type TokenizerKind = "wordpiece" | "unigram";
type MobileModel = {
  hfModelId: string;
  pooling: PoolingStrategy;
  tokenizer: TokenizerKind;
  maxTokens: number;
};

const MOBILE_MODELS: Record<string, MobileModel> = {
  "bge-small-zh-v1.5": {
    hfModelId: "Xenova/bge-small-zh-v1.5",
    pooling: "cls",
    tokenizer: "wordpiece",
    maxTokens: MAX_TOKENS,
  },
  "all-MiniLM-L6-v2": {
    hfModelId: "Xenova/all-MiniLM-L6-v2",
    pooling: "mean",
    tokenizer: "wordpiece",
    maxTokens: MAX_TOKENS,
  },
  // XLM-R SentencePiece vocabulary: covers Russian and ~100 other languages.
  // Desktop runs the same model through Transformers.js without E5's
  // "query: " / "passage: " prefixes, so none are added here either.
  "multilingual-e5-small": {
    hfModelId: "Xenova/multilingual-e5-small",
    pooling: "mean",
    tokenizer: "unigram",
    maxTokens: 256,
  },
};

type TokenizerFile = { model?: { vocab?: Record<string, number>; unk_token?: string } };

/** Native Android/iOS implementation of the built-in local embedding models. */
export class NativeOnnxEmbeddingEngine implements ILocalEmbeddingEngine {
  private session: InferenceSession | null = null;
  private vocab: Record<string, number> | null = null;
  private unigram: UnigramTokenizer | null = null;
  private loadedModelId: string | null = null;

  init(): void {}

  async load(modelId: string, _hfModelId: string, onProgress?: (p: number) => void): Promise<void> {
    const model = MOBILE_MODELS[modelId];
    if (!model) throw new Error(`Unsupported mobile local embedding model: ${modelId}`);
    if (this.session && (this.vocab || this.unigram) && this.loadedModelId === modelId) return;
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
    const tokenizer = JSON.parse(await FileSystem.readAsStringAsync(tokenizerPath));
    if (model.tokenizer === "unigram") {
      this.unigram = new UnigramTokenizer(tokenizer);
    } else {
      const vocab = (tokenizer as TokenizerFile).model?.vocab;
      if (!vocab) throw new Error("Downloaded tokenizer is missing its vocabulary.");
      this.vocab = vocab;
    }
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
    const model = MOBILE_MODELS[modelId];
    if (!this.session || !(this.vocab || this.unigram)) throw new Error("Local embedding model did not initialize.");
    const output: number[][] = [];
    for (let index = 0; index < texts.length; index++) {
      const tokens = this.unigram
        ? this.unigram.encode(texts[index], model.maxTokens)
        : encodeWordPiece(texts[index], this.vocab as Record<string, number>);
      // WordPiece models keep their fixed 128-token padding; the Unigram model
      // runs on the exact sequence length.
      const seqLength = this.unigram ? tokens.length : MAX_TOKENS;
      const ids = new BigInt64Array(seqLength);
      const mask = new BigInt64Array(seqLength);
      const types = new BigInt64Array(seqLength);
      for (let i = 0; i < tokens.length; i++) { ids[i] = BigInt(tokens[i]); mask[i] = 1n; }
      const feeds: Record<string, Tensor> = {
        input_ids: new Tensor(ids, [1, seqLength]),
        attention_mask: new Tensor(mask, [1, seqLength]),
      };
      if (this.session.inputNames.includes("token_type_ids")) feeds.token_type_ids = new Tensor(types, [1, seqLength]);
      const result = await this.session.run(feeds);
      const tensor = result.last_hidden_state ?? result[Object.keys(result)[0]];
      if (!tensor || !(tensor.data instanceof Float32Array)) throw new Error("Local model returned no float embedding output.");
      output.push(
        model.pooling === "cls"
          ? clsPoolAndNormalize(tensor.data, seqLength)
          : meanPoolAndNormalize(tensor.data, tokens.length, seqLength),
      );
      onItemProgress?.(index + 1, texts.length);
    }
    return output;
  }

  async dispose(): Promise<void> { this.session = null; this.vocab = null; this.unigram = null; this.loadedModelId = null; }

  async clearCache(hfModelId: string): Promise<void> {
    await this.dispose();
    const modelId = Object.entries(MOBILE_MODELS).find(([, model]) => model.hfModelId === hfModelId)?.[0];
    if (modelId) await FileSystem.deleteAsync(`${FileSystem.documentDirectory}readany-models/${modelId}`, { idempotent: true });
  }

  private async download(url: string, target: string, start: number, end: number, progress?: (p: number) => void) {
    if ((await FileSystem.getInfoAsync(target)).exists) { progress?.(end); return; }
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let rejectStalled: (error: Error) => void = () => undefined;
    // Restarted on every progress callback: large models may take minutes, but a
    // transfer that receives no bytes for DOWNLOAD_STALL_TIMEOUT_MS is abandoned.
    const armTimeout = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        timedOut = true;
        rejectStalled(new Error("Could not reach the model download server. Check the phone's network connection or use a VPN that can reach Hugging Face, then try again."));
      }, DOWNLOAD_STALL_TIMEOUT_MS);
    };
    const job = FileSystem.createDownloadResumable(url, target, {}, ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      armTimeout();
      if (totalBytesExpectedToWrite > 0) progress?.(Math.round(start + ((end - start) * totalBytesWritten) / totalBytesExpectedToWrite));
    });
    const stalled = new Promise<never>((_, reject) => { rejectStalled = reject; });
    armTimeout();
    try {
      const result = await Promise.race([job.downloadAsync(), stalled]);
      if (!result) throw new Error("Model download was cancelled.");
    } catch (error) {
      if (timedOut) await job.pauseAsync().catch(() => undefined);
      await FileSystem.deleteAsync(target, { idempotent: true });
      throw error;
    } finally {
      clearTimeout(timeoutId);
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
