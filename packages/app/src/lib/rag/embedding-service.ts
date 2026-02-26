/**
 * Embedding service — handles API calls to embedding providers
 */
import type { EmbeddingModel } from "@/types";

export interface EmbeddingConfig {
  model: EmbeddingModel;
  apiKey: string;
  baseUrl?: string;
  batchSize: number;
}

const DEFAULT_BATCH_SIZE = 20;

export class EmbeddingService {
  private config: EmbeddingConfig;

  constructor(config: Partial<EmbeddingConfig> & { model: EmbeddingModel; apiKey: string }) {
    this.config = {
      batchSize: DEFAULT_BATCH_SIZE,
      ...config,
    };
  }

  /** Generate embedding for a single text */
  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  /** Generate embeddings for multiple texts with batching */
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

  private async callOpenAI(texts: string[]): Promise<number[][]> {
    const baseUrl = this.config.baseUrl || "https://api.openai.com/v1";
    const url = `${baseUrl}/embeddings`;

    const response = await fetch(url, {
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
