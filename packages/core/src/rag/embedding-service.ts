/**
 * Embedding service — handles API calls to embedding providers
 */
import type { EmbeddingModel } from "../types";

import { normalizeEmbeddingEndpointUrl } from "../utils/api";

export interface EmbeddingConfig {
  model: EmbeddingModel;
  apiKey: string;
  baseUrl?: string;
  batchSize: number;
  maxRetries?: number;
  retryDelay?: number;
}

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;

export class EmbeddingService {
  private config: EmbeddingConfig;

  constructor(config: Partial<EmbeddingConfig> & { model: EmbeddingModel; apiKey: string }) {
    this.config = {
      batchSize: DEFAULT_BATCH_SIZE,
      maxRetries: DEFAULT_MAX_RETRIES,
      retryDelay: DEFAULT_RETRY_DELAY,
      ...config,
    };
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += this.config.batchSize) {
      const batch = texts.slice(i, i + this.config.batchSize);
      const batchEmbeddings = await this.callEmbeddingAPI(batch);
      allEmbeddings.push(...batchEmbeddings);
    }

    return allEmbeddings;
  }

  private async callEmbeddingAPI(texts: string[]): Promise<number[][]> {
    if (this.config.model.provider === "openai") {
      return this.callOpenAI(texts);
    }
    throw new Error(`Unsupported embedding provider: ${this.config.model.provider}`);
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    retries: number = this.config.maxRetries || DEFAULT_MAX_RETRIES,
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, options);
        return response;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isNetworkError =
          lastError.message.includes("network") ||
          lastError.message.includes("Load failed") ||
          lastError.message.includes("connection");

        if (attempt < retries && isNetworkError) {
          const delay = (this.config.retryDelay || DEFAULT_RETRY_DELAY) * (attempt + 1);
          console.log(
            `[Embedding] Network error, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})...`,
          );
          await this.sleep(delay);
          continue;
        }
        throw lastError;
      }
    }

    throw lastError || new Error("Fetch failed");
  }

  private async callOpenAI(texts: string[]): Promise<number[][]> {
    // Vector-model settings persist the complete embeddings request URL so the
    // vectorization path can call it directly. Accept that form here as well as
    // a plain OpenAI-compatible base URL; appending `/embeddings` unconditionally
    // would otherwise produce `.../embeddings/embeddings` for Reader queries.
    const url = normalizeEmbeddingEndpointUrl(this.config.baseUrl);

    const response = await this.fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model.id,
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI Embedding API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    return (data.data as Array<{ embedding: number[]; index: number }>)
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }
}
