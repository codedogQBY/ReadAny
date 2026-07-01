export type { ToolDefinition, ToolParameter } from "./tools";

export {
  createChatModel,
  createChatModelFromEndpoint,
  resolveActiveEndpoint,
  setStreamingFetch,
} from "./llm-provider";
export type { LLMOptions } from "./llm-provider";

export { processMessages } from "./message-pipeline";
export type { ProcessedMessage } from "./message-pipeline";
export {
  maybeCompressKnowledgeDocumentsById,
  maybeCompressAndPersistKnowledgeSummary,
  maybeCompressKnowledgeSummary,
} from "./knowledge-memory";
export type {
  KnowledgeSummaryCompressionResult,
  KnowledgeSummaryCompressionStatus,
  KnowledgeSummaryMaintenanceResult,
  KnowledgeSummaryMaintenanceStatus,
  PersistedKnowledgeSummaryCompressionResult,
} from "./knowledge-memory";

export { generateSemanticContext, detectOperationType } from "./semantic-context";
export type { OperationType } from "./semantic-context";

export { StreamingChat, createMessageId, createThreadId } from "./streaming";
export type { StreamingOptions } from "./streaming";
export { getAIEndpointRequestPreview, testAIEndpoint } from "./test-endpoint";
export type { EndpointTestResult } from "./test-endpoint";

export { buildSystemPrompt } from "./system-prompt";
export { buildKnowledgePromptContext, loadKnowledgePromptContext } from "./knowledge-context";
export { buildAnnotationPromptContext, loadAnnotationPromptContext } from "./annotation-context";
export { getToolResultError, isToolErrorResult } from "./tool-result";
export type { ToolErrorResult } from "./tool-result";
export { getKnowledgeToolResultDisplay } from "./knowledge-tool-result";
export type {
  KnowledgeToolResultDisplay,
  KnowledgeToolResultDocument,
  KnowledgeToolResultKind,
  KnowledgeToolResultRelation,
} from "./knowledge-tool-result";

export { BUILTIN_EMBEDDING_MODELS } from "./builtin-embedding-models";
export type { BuiltinEmbeddingModel } from "./builtin-embedding-models";

export {
  loadEmbeddingPipeline,
  generateLocalEmbeddings,
  disposeEmbeddingPipeline,
  setEmbeddingWorkerFactory,
} from "./local-embedding-service";

export { getAvailableTools } from "./tools";

export { getContextTools } from "./tools";

export { readingContextService, getReadingContextSnapshot } from "./reading-context-service";
export {
  fallbackContentService,
  setFallbackContentProvider,
  type FallbackChapter,
  type FallbackContentProvider,
  type FallbackTextSegment,
} from "./fallback-content-service";
