import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  type KnowledgeSummaryCompressionOptions,
  type KnowledgeSummaryCompressionPlan,
  type KnowledgeSummaryCompressionState,
  type KnowledgeSummaryDocument,
  createKnowledgeSummaryCompressionStateFromDocument,
  createKnowledgeSummaryCompressionState,
  prepareKnowledgeSummaryCompression,
} from "../knowledge";
import { getKnowledgeDocument, updateKnowledgeDocumentSummary } from "../db/database";
import type { AIConfig } from "../types";
import { createChatModel } from "./llm-provider";

export type KnowledgeSummaryCompressionStatus = "skipped" | "compressed" | "failed";

export interface KnowledgeSummaryCompressionResult {
  status: KnowledgeSummaryCompressionStatus;
  plan: KnowledgeSummaryCompressionPlan;
  state?: KnowledgeSummaryCompressionState;
  summaryMd?: string;
  error?: string;
}

export interface PersistedKnowledgeSummaryCompressionResult
  extends KnowledgeSummaryCompressionResult {
  persisted: boolean;
}

export type KnowledgeSummaryMaintenanceStatus =
  | KnowledgeSummaryCompressionStatus
  | "missing";

export interface KnowledgeSummaryMaintenanceResult {
  documentId: string;
  status: KnowledgeSummaryMaintenanceStatus;
  persisted: boolean;
  reason?: KnowledgeSummaryCompressionPlan["reason"];
  error?: string;
}

function responseContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .join("\n");
}

function maxTokensForSummary(maxSummaryChars: number): number {
  return Math.min(1200, Math.max(256, Math.ceil(maxSummaryChars / 2)));
}

export async function maybeCompressKnowledgeSummary(
  document: KnowledgeSummaryDocument,
  aiConfig: AIConfig,
  state?: KnowledgeSummaryCompressionState,
  options: KnowledgeSummaryCompressionOptions = {},
): Promise<KnowledgeSummaryCompressionResult> {
  const plan = prepareKnowledgeSummaryCompression(document, state, options);
  if (!plan.shouldCompress || !plan.systemPrompt || !plan.userPrompt) {
    return { status: "skipped", plan, state };
  }

  try {
    const model = await createChatModel(aiConfig, {
      temperature: 0.2,
      maxTokens: maxTokensForSummary(plan.maxSummaryChars),
      streaming: false,
    });
    const response = await model.invoke([
      new SystemMessage(plan.systemPrompt),
      new HumanMessage(plan.userPrompt),
    ]);
    const summaryMd = responseContentToText(response.content).trim().slice(0, plan.maxSummaryChars);

    if (!summaryMd) {
      return {
        status: "failed",
        plan,
        state,
        error: "Knowledge summary compression returned an empty summary.",
      };
    }

    const nextState = createKnowledgeSummaryCompressionState(summaryMd, plan);
    return {
      status: "compressed",
      plan,
      state: nextState,
      summaryMd,
    };
  } catch (error) {
    console.warn("[knowledge-memory] Failed to compress knowledge document:", error);
    return {
      status: "failed",
      plan,
      state,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function maybeCompressAndPersistKnowledgeSummary(
  document: KnowledgeSummaryDocument,
  aiConfig: AIConfig,
  options: KnowledgeSummaryCompressionOptions = {},
): Promise<PersistedKnowledgeSummaryCompressionResult> {
  const existingState = createKnowledgeSummaryCompressionStateFromDocument(document);
  const result = await maybeCompressKnowledgeSummary(document, aiConfig, existingState, options);

  if (result.status !== "compressed" || !result.state) {
    return { ...result, persisted: false };
  }

  try {
    await updateKnowledgeDocumentSummary(document.id, result.state);
    return { ...result, persisted: true };
  } catch (error) {
    console.warn("[knowledge-memory] Failed to persist knowledge document summary:", error);
    return {
      ...result,
      status: "failed",
      persisted: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function maybeCompressKnowledgeDocumentsById(
  documentIds: readonly string[],
  aiConfig: AIConfig,
  options: KnowledgeSummaryCompressionOptions = {},
): Promise<KnowledgeSummaryMaintenanceResult[]> {
  const uniqueDocumentIds = [...new Set(documentIds.map((id) => id.trim()).filter(Boolean))];
  const results: KnowledgeSummaryMaintenanceResult[] = [];

  for (const documentId of uniqueDocumentIds) {
    try {
      const document = await getKnowledgeDocument(documentId);
      if (!document) {
        results.push({
          documentId,
          status: "missing",
          persisted: false,
          error: "Knowledge document not found",
        });
        continue;
      }

      const result = await maybeCompressAndPersistKnowledgeSummary(document, aiConfig, options);
      results.push({
        documentId,
        status: result.status,
        persisted: result.persisted,
        reason: result.plan.reason,
        error: result.error,
      });
    } catch (error) {
      results.push({
        documentId,
        status: "failed",
        persisted: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}
