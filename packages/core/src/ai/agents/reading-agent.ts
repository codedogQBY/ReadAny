import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import i18n from "i18next";
import { z } from "zod";
import { estimateTokens } from "../../rag/chunker";
/**
 * Reading Agent — AI-powered reading assistant using LangGraph ReAct agent
 *
 * Architecture:
 * 1. Uses LangGraph's createReactAgent for automatic tool-calling loop
 * 2. Uses getAvailableTools() and a lightweight router to keep tool sets focused
 * 3. Builds proper Zod schemas from ToolDefinition.parameters
 * 4. Real streaming via streamEvents API
 * 5. System prompt from system-prompt.ts
 */
import type { AIConfig, Book, SemanticContext, Skill } from "../../types";
import { createChatModel } from "../llm-provider";
import { getReadingContextSnapshot } from "../reading-context-service";
import { buildSystemPrompt } from "../system-prompt";
import { ThinkTagStreamParser } from "../think-tag-parser";
import type { ToolDefinition, ToolParameter } from "../tools/tool-types";

const CHAPTER_REFERENCE_RE =
  /(?:第\s*)?[零〇一二两三四五六七八九十百千万\d]{1,8}\s*(?:章|卷|节|回|讲|篇|话)|这一章|这一节|chapter\s*\d+/iu;
const CHAPTER_REFERENCE_EXECUTION_LIMIT = 3;
const CHAPTER_TOOL_EXECUTION_LIMIT = 8;
const DEFAULT_RECURSION_LIMIT = 24;
const CHAPTER_TASK_RECURSION_LIMIT = 24;
const DEFAULT_TOOL_TIMEOUT_MS = 45_000;
const TOOL_EXECUTION_LIMIT = 12;
const REPEATED_TOOL_CALL_LIMIT = 2;
const FALLBACK_CONTENT_TOOL_NAMES = new Set([
  "fallbackSearch",
  "fallbackToc",
  "fallbackChapterContext",
]);
const TOOL_TIMEOUT_MS_BY_NAME: Record<string, number> = {
  getSelection: 5_000,
  getCurrentChapter: 5_000,
  getReadingProgress: 5_000,
  getSurroundingContext: 8_000,
  getRecentHighlights: 8_000,
  getAnnotations: 8_000,
  addCitation: 20_000,
  ragSearch: 30_000,
  ragToc: 20_000,
  ragContext: 30_000,
  summarize: 35_000,
  extractEntities: 35_000,
  analyzeArguments: 35_000,
  findQuotes: 35_000,
  compareSections: 35_000,
  fallbackSearch: 60_000,
  fallbackToc: 45_000,
  fallbackChapterContext: 60_000,
  classifyBooks: 60_000,
  tagBooks: 30_000,
  manageBookTags: 30_000,
  updateBookMetadata: 30_000,
  manageBookGroups: 30_000,
  mindmap: 10_000,
};
const MAX_USER_INPUT_TOKENS = 8_000;
const USER_INPUT_TOO_LONG_MESSAGE = "内容过长，请分段提问。";

const OUTPUT_LIMIT_FINISH_REASONS = new Set([
  "length",
  "max_tokens",
  "max_completion_tokens",
  "token_limit",
]);

/**
 * Providers expose the stop reason in slightly different places. Only treat
 * explicit output-limit reasons as truncation: guessing from punctuation would
 * turn legitimate short answers into false failures.
 */
export function isOutputLimitTermination(output: unknown): boolean {
  if (!output || typeof output !== "object") return false;
  const record = output as Record<string, unknown>;
  const metadata = [record.response_metadata, record.additional_kwargs];

  return metadata.some((value) => {
    if (!value || typeof value !== "object") return false;
    const reason =
      (value as Record<string, unknown>).finish_reason ??
      (value as Record<string, unknown>).finishReason;
    return typeof reason === "string" && OUTPUT_LIMIT_FINISH_REASONS.has(reason.toLowerCase());
  });
}

const CHAPTER_LOOKUP_STOP_TOOL_NAMES = new Set([
  "resolveChapterReference",
  "ragSearch",
  "ragToc",
  "ragContext",
  "summarize",
  "extractEntities",
  "analyzeArguments",
  "findQuotes",
  "compareSections",
  "fallbackSearch",
  "fallbackToc",
  "fallbackChapterContext",
  "getCurrentChapter",
  "getSurroundingContext",
]);

const GENERAL_CHAT_ONLY_RE =
  /^(?:你好|您好|hi|hello|hey|thanks|thank you|谢谢|感謝|早上好|中午好|晚上好|在吗|在嗎)[！!？?\s]*$/iu;
const LIBRARY_REQUEST_RE =
  /(?:书库|書庫|library|分组|分組|标签|標籤|tag|阅读统计|閱讀統計|reading\s*stats|技能|skill|思维导图|思維導圖|mindmap)/iu;
const CURRENT_SELECTION_RE =
  /(?:这段|這段|这句|這句|这部分|這部分|选中|選中|所选|所選|划线|劃線|框选|框選|這一段|这一段|這一句|这一句)/u;
const CURRENT_PAGE_CONTEXT_RE =
  /(?:这里|這裡|当前页|當前頁|这一页|這一頁|这页|這頁|当前位置|當前位置|目前看到|我看到这里|我看到這裡)/u;
const CURRENT_CHAPTER_CONTEXT_RE =
  /(?:这一章|這一章|这章|這章|当前章节|當前章節|当前章|當前章|現在這章|现在这章|本章)/u;
const IMMEDIATE_CONTEXT_RE =
  /(?:什么意思|什麼意思|看不懂|沒看懂|没看懂|解释一下|解釋一下|怎么理解|怎麼理解)/u;
const BOOK_CONTENT_RE =
  /(?:这本书|這本書|本书|本書|人物|角色|主角|配角|剧情|劇情|情节|情節|主题|主題|关系|關係|第一次|首次|结局|結局|梗概|总结|總結|摘要|分析|搜索|搜尋|查一下|搜一下|讲了什么|講了什麼|讲什么|講什麼)/u;

const GENERAL_TOOL_NAMES = new Set([
  "listBooks",
  "searchAllHighlights",
  "searchAllNotes",
  "getReadingStats",
  "getSkills",
  "mindmap",
  "classifyBooks",
  "tagBooks",
  "manageBookTags",
  "updateBookMetadata",
  "manageBookGroups",
]);

const CATEGORY_TOOL_ORDER: Record<ReadingQuestionCategory, string[]> = {
  general_chat: [],
  library_request: [
    "listBooks",
    "searchAllHighlights",
    "searchAllNotes",
    "getReadingStats",
    "getSkills",
    "mindmap",
    "classifyBooks",
    "tagBooks",
    "manageBookTags",
    "updateBookMetadata",
    "manageBookGroups",
  ],
  current_selection: [
    "getSelection",
    "getSurroundingContext",
    "getCurrentChapter",
    "ragSearch",
    "ragContext",
    "fallbackSearch",
    "fallbackChapterContext",
    "addCitation",
  ],
  current_page_context: [
    "getSurroundingContext",
    "getCurrentChapter",
    "getReadingProgress",
    "ragSearch",
    "ragContext",
    "fallbackSearch",
    "fallbackChapterContext",
    "addCitation",
  ],
  current_chapter_context: [
    "getCurrentChapter",
    "getSurroundingContext",
    "getReadingProgress",
    "resolveChapterReference",
    "ragSearch",
    "ragContext",
    "summarize",
    "findQuotes",
    "fallbackChapterContext",
    "fallbackSearch",
    "addCitation",
  ],
  specific_chapter_request: [
    "resolveChapterReference",
    "ragSearch",
    "ragToc",
    "ragContext",
    "summarize",
    "findQuotes",
    "extractEntities",
    "analyzeArguments",
    "fallbackToc",
    "fallbackSearch",
    "fallbackChapterContext",
    "addCitation",
  ],
  book_wide_search: [
    "ragSearch",
    "resolveChapterReference",
    "ragToc",
    "ragContext",
    "summarize",
    "findQuotes",
    "extractEntities",
    "analyzeArguments",
    "compareSections",
    "fallbackSearch",
    "fallbackToc",
    "fallbackChapterContext",
    "getCurrentChapter",
    "getSurroundingContext",
    "getReadingProgress",
    "getRecentHighlights",
    "getAnnotations",
    "addCitation",
  ],
};

type ReadingQuestionCategory =
  | "general_chat"
  | "library_request"
  | "current_selection"
  | "current_page_context"
  | "current_chapter_context"
  | "specific_chapter_request"
  | "book_wide_search";

function normalizeSearchFingerprint(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/请问|幫我|帮我|看看|查一下|搜一下|告诉我|告訴我|想知道|麻烦|麻煩|請|请|一下/gu, " ")
    .replace(/[，。、“”"'`!！?？,:：;；()\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(",")}}`;
}

function buildToolCacheKey(toolName: string, args: Record<string, unknown>): string {
  return `${toolName}:${stableSerialize(args)}`;
}

function buildSearchToolCacheKey(
  toolName: string,
  args: Record<string, unknown>,
): string | undefined {
  const rawQuery = typeof args.query === "string" ? args.query : "";
  const normalized = normalizeSearchFingerprint(rawQuery);
  if (!normalized) return undefined;
  return `${toolName}:${normalized}`;
}

function detectQuestionCategory(options: {
  userInput: string;
  hasBookContext: boolean;
  selectionActive: boolean;
}): ReadingQuestionCategory {
  const text = options.userInput.normalize("NFKC").trim();
  if (!text) return options.hasBookContext ? "book_wide_search" : "general_chat";
  if (GENERAL_CHAT_ONLY_RE.test(text)) return "general_chat";
  if (LIBRARY_REQUEST_RE.test(text) || !options.hasBookContext) return "library_request";
  const hasExplicitCurrentSelectionCue = CURRENT_SELECTION_RE.test(text);
  const hasExplicitCurrentPageCue = CURRENT_PAGE_CONTEXT_RE.test(text);
  const hasExplicitCurrentChapterCue = CURRENT_CHAPTER_CONTEXT_RE.test(text);
  const asksForImmediateExplanation = IMMEDIATE_CONTEXT_RE.test(text);

  if (options.selectionActive && hasExplicitCurrentSelectionCue) {
    return "current_selection";
  }
  if (hasExplicitCurrentPageCue || (asksForImmediateExplanation && hasExplicitCurrentPageCue)) {
    return "current_page_context";
  }
  if (CHAPTER_REFERENCE_RE.test(text)) return "specific_chapter_request";
  if (hasExplicitCurrentChapterCue) return "current_chapter_context";
  if (BOOK_CONTENT_RE.test(text)) return "book_wide_search";
  return "book_wide_search";
}

function getFocusedToolNames(
  category: ReadingQuestionCategory,
  isVectorized: boolean,
): Set<string> | null {
  switch (category) {
    case "general_chat":
      return new Set();
    case "library_request":
      return GENERAL_TOOL_NAMES;
    case "current_selection":
      return new Set(
        isVectorized
          ? [
              "getSelection",
              "getSurroundingContext",
              "getCurrentChapter",
              "ragSearch",
              "ragContext",
              "addCitation",
            ]
          : [
              "getSelection",
              "getSurroundingContext",
              "getCurrentChapter",
              "fallbackSearch",
              "fallbackChapterContext",
              "addCitation",
            ],
      );
    case "current_page_context":
      return new Set(
        isVectorized
          ? [
              "getCurrentChapter",
              "getSurroundingContext",
              "getReadingProgress",
              "ragSearch",
              "ragContext",
              "addCitation",
            ]
          : [
              "getCurrentChapter",
              "getSurroundingContext",
              "getReadingProgress",
              "fallbackSearch",
              "fallbackChapterContext",
              "addCitation",
            ],
      );
    case "current_chapter_context":
      return new Set(
        isVectorized
          ? [
              "getCurrentChapter",
              "getSurroundingContext",
              "getReadingProgress",
              "resolveChapterReference",
              "ragSearch",
              "ragContext",
              "summarize",
              "findQuotes",
              "addCitation",
            ]
          : [
              "getCurrentChapter",
              "getSurroundingContext",
              "getReadingProgress",
              "fallbackChapterContext",
              "addCitation",
            ],
      );
    case "specific_chapter_request":
      return new Set(
        isVectorized
          ? [
              "resolveChapterReference",
              "ragSearch",
              "ragToc",
              "ragContext",
              "summarize",
              "findQuotes",
              "extractEntities",
              "analyzeArguments",
              "addCitation",
            ]
          : ["resolveChapterReference", "fallbackChapterContext", "fallbackToc", "addCitation"],
      );
    case "book_wide_search":
      return null;
  }
}

function sortToolsForCategory(
  tools: ToolDefinition[],
  category: ReadingQuestionCategory,
): ToolDefinition[] {
  const order = CATEGORY_TOOL_ORDER[category];
  if (order.length === 0) return tools;

  const priority = new Map(order.map((name, index) => [name, index]));
  return [...tools].sort((a, b) => {
    const aPriority = priority.get(a.name) ?? Number.MAX_SAFE_INTEGER;
    const bPriority = priority.get(b.name) ?? Number.MAX_SAFE_INTEGER;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return 0;
  });
}

function filterToolsForQuestion(options: {
  tools: ToolDefinition[];
  category: ReadingQuestionCategory;
  isVectorized: boolean;
}): ToolDefinition[] {
  const focusedNames = getFocusedToolNames(options.category, options.isVectorized);
  if (focusedNames === null) {
    return sortToolsForCategory(
      options.tools.filter((tool) => !GENERAL_TOOL_NAMES.has(tool.name)),
      options.category,
    );
  }

  const filtered = options.tools.filter((tool) => focusedNames.has(tool.name));
  return sortToolsForCategory(filtered, options.category);
}

function buildRouteHint(
  category: ReadingQuestionCategory,
  selectionActive: boolean,
  isVectorized: boolean,
): string | undefined {
  switch (category) {
    case "current_selection":
      return selectionActive
        ? "The user already has an active selection. Start with the selected text and surrounding context; if that is not enough, use content retrieval instead of guessing."
        : undefined;
    case "current_page_context":
      return isVectorized
        ? "This question is about the user's current page or current reading location. Start with current-context tools; use ragSearch/ragContext when visible text is insufficient."
        : "This question is about the user's current page or current reading location. Start with current-context tools; use fallback content tools when visible text is insufficient.";
    case "current_chapter_context":
      return isVectorized
        ? "This question is about the chapter the user is currently reading. Get the current chapter first, then prefer indexed chapter/content retrieval."
        : "This question is about the chapter the user is currently reading. Get the current chapter first, then use fallback chapter content.";
    case "specific_chapter_request":
      return isVectorized
        ? "This question targets a specific chapter reference. Resolve the chapter reference first; if resolution is weak or the user asks for content, use ragSearch/ragToc/ragContext instead of guessing."
        : "This question targets a specific chapter reference. Resolve the chapter reference first; if resolution is weak, use fallbackToc/fallbackSearch or ask for clarification.";
    case "book_wide_search":
      return isVectorized
        ? "This is a book-content question and the book is indexed. Prefer ragSearch first for retrieval; use current-context tools only when the question is explicitly about the current page."
        : "This is a book-content question and the book is not indexed. Prefer fallbackSearch/fallbackToc for retrieval.";
    case "library_request":
      return "This is a library-management or cross-book request. Stay within library tools.";
    default:
      return undefined;
  }
}

function getRecursionLimitForCategory(category: ReadingQuestionCategory): number {
  switch (category) {
    case "current_selection":
    case "current_page_context":
      return 18;
    case "current_chapter_context":
      return 20;
    case "specific_chapter_request":
      return CHAPTER_TASK_RECURSION_LIMIT;
    case "library_request":
      return 20;
    case "book_wide_search":
      return DEFAULT_RECURSION_LIMIT;
    default:
      return DEFAULT_RECURSION_LIMIT;
  }
}

function simplifyChapterLookupQuery(query: string, fallback: string): string {
  const source = (query || fallback).normalize("NFKC");
  const sanitizedSource = source.replace(/(?:这|那|哪)\s*一\s*(?:章|卷|节|回|讲|篇|话)/gu, " ");
  const chapterNumber = sanitizedSource.match(
    /(?:第\s*)?([零〇一二两三四五六七八九十百千万\d]{1,8})\s*(?:章|卷|节|回|讲|篇|话)/u,
  );
  if (chapterNumber?.[1]) {
    return `第${chapterNumber[1].replace(/\s+/g, "")}章`;
  }

  const simplified = source
    .replace(
      /请问|帮我|看看|查一下|搜一下|告诉我|想知道|讲讲|说说|内容|讲了什么|讲什么|说了什么|这一章|那一章|这一节|那一节|是哪一章/gu,
      " ",
    )
    .replace(/[，。、“”"'`!！?？,:：;；()\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!simplified) return source.trim();

  const segments = simplified
    .split(/\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  return segments[0] || simplified;
}

function buildSecondAttemptChapterLookupQuery(query: string, fallback: string): string {
  const source = (query || fallback).normalize("NFKC");
  return source
    .replace(
      /请问|帮我|看看|查一下|搜一下|告诉我|想知道|讲讲|说说|内容|讲了什么|讲什么|说了什么|这一章|那一章|这一节|那一节|是哪一章/gu,
      " ",
    )
    .replace(/[，。、“”"'`!！?？,:：;；()\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildChapterReferenceLimitResult(
  lastResult: unknown,
  attemptedQueries: string[],
): Record<string, unknown> {
  const base =
    lastResult && typeof lastResult === "object" ? (lastResult as Record<string, unknown>) : {};
  return {
    ...base,
    matched: false,
    chapterIndex: undefined,
    chapterTitle: undefined,
    detectedChapterNumber: undefined,
    attemptLimitReached: true,
    attemptedQueries,
    notice: "未能可靠定位章节，请补充更准确的章节名",
    reason:
      "Chapter lookup attempt limit reached. Stop chapter search in this turn and ask the user for a more accurate chapter title.",
  };
}

function buildRepeatedToolCallResult(
  lastResult: unknown,
  toolName: string,
  reason: "duplicate" | "limit",
): Record<string, unknown> {
  const base =
    lastResult && typeof lastResult === "object" && !Array.isArray(lastResult)
      ? (lastResult as Record<string, unknown>)
      : lastResult === undefined
        ? {}
        : { previousResult: lastResult };
  return {
    ...base,
    ...(toolName === "addCitation" ? { type: "notice" } : {}),
    repeatedToolCall: true,
    toolName,
    stopToolCalls: true,
    reason:
      reason === "duplicate"
        ? "This tool call repeats information already returned in this turn."
        : "Tool execution limit reached for this turn.",
    instruction:
      "Stop calling tools now. Use the tool results already available in the conversation to answer the user directly. If the available results are insufficient, ask one concise clarification question.",
  };
}

// --- Stream Event Types ---

export type AgentStreamEvent =
  | { type: "token"; content: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: unknown }
  | {
      type: "reasoning";
      content: string;
      stepType: "thinking" | "planning" | "analyzing" | "deciding";
    }
  | {
      type: "citation";
      citation: {
        id: string;
        bookId: string;
        chapterTitle: string;
        chapterIndex: number;
        cfi: string;
        text: string;
        citationIndex?: number;
      };
    }
  | { type: "error"; error: string };

export interface ReadingAgentOptions {
  aiConfig: AIConfig;
  book: Book | null;
  bookId?: string | null;
  semanticContext: SemanticContext | null;
  enabledSkills: Skill[];
  isVectorized: boolean;
  deepThinking?: boolean;
  spoilerFree?: boolean;
  memorySummary?: string;
  /** Injected tool provider — returns available tools for the agent */
  getAvailableTools: (options: {
    bookId: string | null;
    isVectorized: boolean;
    enabledSkills: Skill[];
  }) => ToolDefinition[];
  /** Abort signal for immediate cancellation */
  signal?: AbortSignal;
  /** Maximum time a single tool may run before returning an error result. */
  toolTimeoutMs?: number;
}

// --- Build Zod schema from ToolDefinition.parameters ---

function buildZodSchema(
  parameters: Record<string, ToolParameter>,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, param] of Object.entries(parameters)) {
    let fieldSchema: z.ZodTypeAny;

    switch (param.type) {
      case "number":
        fieldSchema = z.union([z.number(), z.string()]).describe(param.description);
        break;
      case "boolean":
        fieldSchema = z.union([z.boolean(), z.string()]).describe(param.description);
        break;
      default:
        fieldSchema = /json/i.test(param.description)
          ? z
              .union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())])
              .describe(param.description)
          : z.string().describe(param.description);
        break;
    }

    if (!param.required) {
      fieldSchema = fieldSchema.optional();
    }

    shape[key] = fieldSchema;
  }

  return z.object(shape);
}

function normalizeToolInput(
  parameters: Record<string, ToolParameter>,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = { ...input };
  for (const [key, param] of Object.entries(parameters)) {
    const value = normalized[key];
    if (param.type === "number" && typeof value === "string" && value.trim()) {
      const numberValue = Number(value);
      if (Number.isFinite(numberValue)) normalized[key] = numberValue;
    } else if (param.type === "boolean" && typeof value === "string") {
      const booleanValue = value.trim().toLowerCase();
      if (booleanValue === "true") normalized[key] = true;
      else if (booleanValue === "false") normalized[key] = false;
    } else if (
      param.type === "string" &&
      /json/i.test(param.description) &&
      (Array.isArray(value) || (value !== null && typeof value === "object"))
    ) {
      normalized[key] = JSON.stringify(value);
    }
  }
  return normalized;
}

function countToolParameters(tools: ToolDefinition[]): number {
  return tools.reduce((sum, tool) => sum + Object.keys(tool.parameters ?? {}).length, 0);
}

// --- Tool Executor (error-safe wrapper) ---

function withToolTimeout<T>(promise: Promise<T>, timeoutMs: number, toolName: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Tool "${toolName}" timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function getToolTimeoutMs(tool: ToolDefinition, defaultTimeoutMs: number): number {
  return tool.timeoutMs ?? TOOL_TIMEOUT_MS_BY_NAME[tool.name] ?? defaultTimeoutMs;
}

function compactToolLogValue(value: unknown, maxLength = 240): unknown {
  if (typeof value === "string") {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength)}...(${value.length} chars)`;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item) => compactToolLogValue(item, 120));
  }
  if (!value || typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const [key, childValue] of Object.entries(value as Record<string, unknown>).slice(0, 12)) {
    result[key] = compactToolLogValue(childValue, 120);
  }
  return result;
}

async function executeTool(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  const startedAt = Date.now();
  console.log(
    "[ReadingAgent][tool-start]",
    JSON.stringify({
      name: tool.name,
      timeoutMs,
      args: compactToolLogValue(args),
    }),
  );
  try {
    const result = await withToolTimeout(Promise.resolve(tool.execute(args)), timeoutMs, tool.name);
    console.log(
      "[ReadingAgent][tool-end]",
      JSON.stringify({
        name: tool.name,
        durationMs: Date.now() - startedAt,
        ok: true,
        result: compactToolLogValue(result),
      }),
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const payload = {
      name: tool.name,
      durationMs: Date.now() - startedAt,
      ok: false,
      error: message,
    };
    if (/timed out/i.test(message)) {
      console.warn("[ReadingAgent][tool-timeout]", JSON.stringify(payload));
    } else {
      console.warn("[ReadingAgent][tool-error]", JSON.stringify(payload));
    }
    return {
      error: message,
    };
  }
}

function collectTextValues(value: unknown): string[] {
  if (typeof value === "string") return value ? [value] : [];
  if (!value || typeof value !== "object") return [];

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextValues(item));
  }

  const record = value as Record<string, unknown>;
  const values: string[] = [];
  for (const key of ["text", "content", "summary", "value"]) {
    values.push(...collectTextValues(record[key]));
  }
  return values;
}

function extractGeminiThoughtSummariesFromRaw(rawResponse: unknown): string[] {
  if (!rawResponse || typeof rawResponse !== "object") return [];

  const summaries: string[] = [];
  const visit = (value: unknown, keyHint = "") => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, keyHint);
      return;
    }

    const record = value as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type.toLowerCase() : "";
    const key = keyHint.toLowerCase();
    const isThoughtSummary =
      type === "thought_summary" ||
      type === "thinking_summary" ||
      key === "thought_summary" ||
      key === "thinking_summary";

    if (isThoughtSummary) {
      summaries.push(
        ...collectTextValues(record.text ?? record.content ?? record.summary ?? value),
      );
    }

    for (const [childKey, childValue] of Object.entries(record)) {
      const normalizedKey = childKey.toLowerCase();
      if (normalizedKey === "thought_signature" || normalizedKey === "signature") continue;
      if (normalizedKey === "thought_summary" || normalizedKey === "thinking_summary") {
        summaries.push(...collectTextValues(childValue));
        continue;
      }
      visit(childValue, childKey);
    }
  };

  visit(rawResponse);
  return summaries.filter((summary) => summary.trim().length > 0);
}

// --- Main Agent Function ---

export async function* streamReadingAgent(
  options: ReadingAgentOptions,
  userInput: string,
  history: Array<{ role: "user" | "assistant"; content: string; reasoning?: string }> = [],
): AsyncGenerator<AgentStreamEvent> {
  const {
    aiConfig,
    book,
    bookId,
    semanticContext,
    enabledSkills,
    isVectorized,
    deepThinking,
    spoilerFree,
    memorySummary,
    getAvailableTools,
    signal,
    toolTimeoutMs = DEFAULT_TOOL_TIMEOUT_MS,
  } = options;

  // Helper to check if aborted
  const isAborted = () => signal?.aborted ?? false;
  const readingContextSnapshot = getReadingContextSnapshot();
  const selectionActive = !!readingContextSnapshot?.selection?.text?.trim();
  const effectiveBookId = book?.id || bookId || null;
  const questionCategory = detectQuestionCategory({
    userInput,
    hasBookContext: !!effectiveBookId,
    selectionActive,
  });
  const chapterReferenceState = {
    executions: 0,
    totalChapterToolExecutions: 0,
    attemptedQueries: [] as string[],
    lastResult: null as unknown,
    limitReached: false,
  };
  const toolResultCache = new Map<string, unknown>();
  const searchResultCache = new Map<string, unknown>();
  const toolExecutionCounts = new Map<string, number>();
  const lastToolResults = new Map<string, unknown>();
  let fallbackSourceFailure: Record<string, unknown> | null = null;
  let totalToolExecutions = 0;
  const pendingToolCallNames: string[] = [];
  const isChapterTask =
    questionCategory === "specific_chapter_request" || CHAPTER_REFERENCE_RE.test(userInput);

  try {
    // Early abort check
    if (isAborted()) return;

    // Reject oversized input before creating a model or making an API request.
    if (estimateTokens(userInput.normalize("NFKC").trim()) > MAX_USER_INPUT_TOKENS) {
      yield { type: "token", content: USER_INPUT_TOO_LONG_MESSAGE };
      return;
    }

    // Create chat model
    const model = await createChatModel(aiConfig, {
      temperature: deepThinking ? 1 : 0.7,
      maxTokens: aiConfig.maxTokens,
      streaming: true,
      deepThinking,
    });

    // Check abort after async operation
    if (isAborted()) return;

    // Register tools via injected getAvailableTools, then narrow obvious chapter tasks.
    const tools = filterToolsForQuestion({
      tools: getAvailableTools({
        bookId: effectiveBookId,
        isVectorized,
        enabledSkills,
      }),
      category: questionCategory,
      isVectorized,
    });
    console.log(
      "[ReadingAgent] tools",
      JSON.stringify({
        registered: tools.length,
        parameters: countToolParameters(tools),
        names: tools.map((tool) => tool.name),
      }),
    );

    // Build system prompt
    const systemPrompt = buildSystemPrompt({
      book,
      bookId: effectiveBookId,
      semanticContext,
      enabledSkills,
      isVectorized,
      userLanguage: i18n.language || "en",
      spoilerFree,
      memorySummary,
      questionCategory,
      selectionActive,
      routeHint: buildRouteHint(questionCategory, selectionActive, isVectorized),
      allowedToolNames: tools.map((tool) => tool.name),
    });

    // Build input messages (history + user input, without system — handled by agent prompt)
    // For DeepSeek reasoner, we must include reasoning_content in assistant messages
    // to avoid 400 errors during multi-turn tool-calling conversations.
    const activeEndpoint = aiConfig.endpoints.find((e) => e.id === aiConfig.activeEndpointId);
    const isDeepSeek =
      activeEndpoint?.provider === "deepseek" ||
      activeEndpoint?.baseUrl?.includes("deepseek") ||
      aiConfig.activeModel?.toLowerCase().includes("deepseek") ||
      aiConfig.activeModel?.toLowerCase().includes("reasoner");

    const inputMessages: BaseMessage[] = [
      ...history.map((h) => {
        if (h.role === "user") {
          return new HumanMessage(h.content);
        }
        // For DeepSeek, include reasoning_content in additional_kwargs
        if (isDeepSeek && h.reasoning) {
          return new AIMessage({
            content: h.content,
            additional_kwargs: { reasoning_content: h.reasoning },
          });
        }
        return new AIMessage(h.content);
      }),
      new HumanMessage(userInput),
    ];

    // If no tools available, stream directly without agent graph
    if (tools.length === 0) {
      const { SystemMessage } = await import("@langchain/core/messages");
      const allMessages = [new SystemMessage(systemPrompt), ...inputMessages];
      const stream = await model.stream(allMessages);
      const thinkTagParser = new ThinkTagStreamParser();
      const emittedGeminiThoughtSummaries = new Set<string>();
      for await (const chunk of stream) {
        for (const summary of extractGeminiThoughtSummariesFromRaw(
          chunk.additional_kwargs?.__raw_response,
        )) {
          if (emittedGeminiThoughtSummaries.has(summary)) continue;
          emittedGeminiThoughtSummaries.add(summary);
          yield { type: "reasoning", content: summary, stepType: "thinking" };
        }

        const content = chunk.content;
        if (typeof content === "string" && content) {
          for (const event of thinkTagParser.push(content)) {
            if (event.type === "token") {
              yield { type: "token", content: event.content };
            } else {
              yield { type: "reasoning", content: event.content, stepType: "thinking" };
            }
          }
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text" && typeof block.text === "string" && block.text) {
              for (const event of thinkTagParser.push(block.text)) {
                if (event.type === "token") {
                  yield { type: "token", content: event.content };
                } else {
                  yield { type: "reasoning", content: event.content, stepType: "thinking" };
                }
              }
            } else if (block.type === "thinking") {
              const thinkingContent = [block.text, block.thinking, block.content].find(
                (value): value is string => typeof value === "string" && value.length > 0,
              );
              if (thinkingContent) {
                yield { type: "reasoning", content: thinkingContent, stepType: "thinking" };
              }
            }
          }
        }

        const reasoningContent = chunk.additional_kwargs?.reasoning_content;
        if (typeof reasoningContent === "string" && reasoningContent) {
          yield { type: "reasoning", content: reasoningContent, stepType: "thinking" };
        }
      }
      for (const event of thinkTagParser.flush()) {
        if (event.type === "token") {
          yield { type: "token", content: event.content };
        } else {
          yield { type: "reasoning", content: event.content, stepType: "thinking" };
        }
      }
      return;
    }

    // Build LangChain tools with proper Zod schemas
    const { DynamicStructuredTool } = await import("@langchain/core/tools");
    const langChainTools = tools.map((tool) => {
      const schema = buildZodSchema(tool.parameters);
      return new DynamicStructuredTool({
        name: tool.name,
        description: tool.description,
        schema,
        func: async (input) => {
          const toolInput = normalizeToolInput(tool.parameters, input as Record<string, unknown>);
          const isChapterLookupTool = CHAPTER_LOOKUP_STOP_TOOL_NAMES.has(tool.name);

          if (chapterReferenceState.limitReached && isChapterLookupTool) {
            return JSON.stringify(
              buildChapterReferenceLimitResult(
                chapterReferenceState.lastResult,
                chapterReferenceState.attemptedQueries,
              ),
            );
          }

          if (fallbackSourceFailure && FALLBACK_CONTENT_TOOL_NAMES.has(tool.name)) {
            return JSON.stringify(fallbackSourceFailure);
          }

          if (isChapterTask && isChapterLookupTool) {
            if (chapterReferenceState.totalChapterToolExecutions >= CHAPTER_TOOL_EXECUTION_LIMIT) {
              chapterReferenceState.limitReached = true;
              return JSON.stringify(
                buildChapterReferenceLimitResult(
                  chapterReferenceState.lastResult,
                  chapterReferenceState.attemptedQueries,
                ),
              );
            }
            chapterReferenceState.totalChapterToolExecutions += 1;
          }

          if (tool.name === "resolveChapterReference") {
            if (chapterReferenceState.executions >= CHAPTER_REFERENCE_EXECUTION_LIMIT) {
              chapterReferenceState.limitReached = true;
              return JSON.stringify(
                buildChapterReferenceLimitResult(
                  chapterReferenceState.lastResult,
                  chapterReferenceState.attemptedQueries,
                ),
              );
            }

            const originalQuery = String(toolInput.query || userInput || "").trim();
            const effectiveQuery =
              chapterReferenceState.executions === 0
                ? originalQuery
                : chapterReferenceState.executions === 1
                  ? buildSecondAttemptChapterLookupQuery(originalQuery, userInput) || originalQuery
                  : simplifyChapterLookupQuery(originalQuery, userInput) || originalQuery;

            toolInput.query = effectiveQuery;
            chapterReferenceState.executions += 1;
            chapterReferenceState.attemptedQueries.push(effectiveQuery);
          }

          const progressKey =
            tool.name === "ragSearch" || tool.name === "fallbackSearch"
              ? buildSearchToolCacheKey(tool.name, toolInput) ||
                buildToolCacheKey(tool.name, toolInput)
              : buildToolCacheKey(tool.name, toolInput);
          const previousExecutions = toolExecutionCounts.get(progressKey) ?? 0;
          if (previousExecutions >= REPEATED_TOOL_CALL_LIMIT) {
            return JSON.stringify(
              buildRepeatedToolCallResult(lastToolResults.get(progressKey), tool.name, "duplicate"),
            );
          }
          if (totalToolExecutions >= TOOL_EXECUTION_LIMIT) {
            return JSON.stringify(
              buildRepeatedToolCallResult(lastToolResults.get(progressKey), tool.name, "limit"),
            );
          }
          toolExecutionCounts.set(progressKey, previousExecutions + 1);
          totalToolExecutions += 1;

          const skipExactCache =
            tool.name === "addCitation" || tool.name === "resolveChapterReference";
          const exactCacheKey = skipExactCache
            ? undefined
            : buildToolCacheKey(tool.name, toolInput);
          if (exactCacheKey && toolResultCache.has(exactCacheKey)) {
            const cachedResult = toolResultCache.get(exactCacheKey);
            lastToolResults.set(progressKey, cachedResult);
            return JSON.stringify(cachedResult);
          }

          const searchCacheKey =
            tool.name === "ragSearch" || tool.name === "fallbackSearch"
              ? buildSearchToolCacheKey(tool.name, toolInput)
              : undefined;
          if (searchCacheKey && searchResultCache.has(searchCacheKey)) {
            const cachedResult = searchResultCache.get(searchCacheKey);
            lastToolResults.set(progressKey, cachedResult);
            return JSON.stringify(cachedResult);
          }

          let result = await executeTool(tool, toolInput, getToolTimeoutMs(tool, toolTimeoutMs));
          if (
            FALLBACK_CONTENT_TOOL_NAMES.has(tool.name) &&
            result &&
            typeof result === "object" &&
            (result as Record<string, unknown>).sourceUnavailable === true &&
            typeof (result as Record<string, unknown>).error === "string"
          ) {
            fallbackSourceFailure = {
              ...(result as Record<string, unknown>),
              stopFallbackToolCalls: true,
            };
            result = fallbackSourceFailure;
          }
          if (exactCacheKey) {
            toolResultCache.set(exactCacheKey, result);
          }
          if (searchCacheKey) {
            searchResultCache.set(searchCacheKey, result);
          }
          if (tool.name === "resolveChapterReference") {
            chapterReferenceState.lastResult = result;
            if (
              chapterReferenceState.executions >= CHAPTER_REFERENCE_EXECUTION_LIMIT &&
              (!result ||
                typeof result !== "object" ||
                (result as Record<string, unknown>).matched !== true)
            ) {
              chapterReferenceState.limitReached = true;
            }
          }
          lastToolResults.set(progressKey, result);
          return JSON.stringify(result);
        },
      });
    });

    // Create LangGraph ReAct agent — handles tool-calling loop automatically
    const agent = createReactAgent({
      llm: model,
      tools: langChainTools,
      prompt: systemPrompt,
    });

    // Stream events from the agent graph.
    // Keep normal turns bounded; batch chapter tasks should use dedicated flows later.
    const eventStream = agent.streamEvents(
      { messages: inputMessages },
      {
        version: "v2",
        recursionLimit: isChapterTask
          ? CHAPTER_TASK_RECURSION_LIMIT
          : getRecursionLimitForCategory(questionCategory),
      },
    );

    // Track tool calls already emitted (from streaming chunks or on_chat_model_end)
    // so we can deduplicate against on_tool_start events without hiding unrelated calls.
    const pendingEarlyToolStartNames: string[] = [];

    // Accumulate tool_call_chunks from streaming to emit tool_call as early as possible.
    // Key: chunk index, Value: { name accumulated so far, args accumulated so far }
    const streamingToolCalls = new Map<number, { name: string; args: string; emitted: boolean }>();

    // Helper to race iterator next() against abort signal
    const raceNext = async (iterator: AsyncIterator<unknown>): Promise<IteratorResult<unknown>> => {
      if (isAborted()) {
        return { done: true, value: undefined };
      }
      let onAbort: (() => void) | undefined;
      const abortPromise = new Promise<IteratorResult<unknown>>((resolve) => {
        const handler = () => {
          signal?.removeEventListener("abort", handler);
          resolve({ done: true, value: undefined });
        };
        onAbort = handler;
        signal?.addEventListener("abort", handler);
      });
      try {
        return await Promise.race([iterator.next(), abortPromise]);
      } finally {
        // The next event normally arrives before cancellation. Do not retain
        // an abort listener for every streamed event in that case.
        if (onAbort) signal?.removeEventListener("abort", onAbort);
      }
    };

    const iterator = eventStream[Symbol.asyncIterator]();
    let eventResult = await raceNext(iterator);
    let turnTextBuffer = "";
    const emittedGeminiThoughtSummaries = new Set<string>();

    function* flushBufferedTurnText(hasToolCalls: boolean): Generator<AgentStreamEvent> {
      if (!turnTextBuffer) return;
      const parser = new ThinkTagStreamParser();
      const events = [...parser.push(turnTextBuffer), ...parser.flush()];
      turnTextBuffer = "";
      for (const event of events) {
        if (event.type === "reasoning") {
          yield { type: "reasoning", content: event.content, stepType: "thinking" };
        } else if (hasToolCalls) {
          yield { type: "reasoning", content: event.content, stepType: "thinking" };
        } else {
          yield { type: "token", content: event.content };
        }
      }
    }

    while (!eventResult.done) {
      const event = eventResult.value as any;
      // Check for abort at each iteration
      if (isAborted()) return;

      // Token streaming from model
      if (event.event === "on_chat_model_stream") {
        const chunk = event.data?.chunk;
        if (chunk) {
          for (const summary of extractGeminiThoughtSummariesFromRaw(
            chunk.additional_kwargs?.__raw_response,
          )) {
            if (emittedGeminiThoughtSummaries.has(summary)) continue;
            emittedGeminiThoughtSummaries.add(summary);
            yield { type: "reasoning", content: summary, stepType: "thinking" };
          }

          const content = chunk.content;

          // Buffer normal text until the model turn ends. If the same turn also
          // calls tools, that text is tool-planning chatter rather than final
          // answer text and must not be streamed into the response body.
          if (typeof content === "string" && content) {
            turnTextBuffer += content;
          } else if (Array.isArray(content)) {
            // Handle Anthropic-style content blocks (text + thinking)
            for (const block of content) {
              if (block.type === "text" && typeof block.text === "string" && block.text) {
                turnTextBuffer += block.text;
              } else if (block.type === "thinking") {
                // Anthropic may return thinking content in different fields
                // Try block.text first (most common), then block.thinking, then block.content
                const thinkingContent = [block.text, block.thinking, block.content].find(
                  (value): value is string => typeof value === "string" && value.length > 0,
                );
                if (thinkingContent) {
                  yield { type: "reasoning", content: thinkingContent, stepType: "thinking" };
                }
              }
            }
          }

          // Handle DeepSeek reasoning_content from @langchain/deepseek
          // ChatDeepSeek puts reasoning_content in additional_kwargs.reasoning_content
          const reasoningContent = chunk.additional_kwargs?.reasoning_content;
          if (typeof reasoningContent === "string" && reasoningContent) {
            yield { type: "reasoning", content: reasoningContent, stepType: "thinking" };
          }

          // Detect tool_call_chunks in streaming and emit tool_call as soon as we have the name.
          // This eliminates the delay between the last text token and on_chat_model_end.
          const toolCallChunks = chunk.tool_call_chunks;
          if (Array.isArray(toolCallChunks)) {
            for (const tcc of toolCallChunks) {
              const idx = tcc.index ?? 0;
              let entry = streamingToolCalls.get(idx);
              if (!entry) {
                entry = { name: "", args: "", emitted: false };
                streamingToolCalls.set(idx, entry);
              }
              if (tcc.name) entry.name += tcc.name;
              if (tcc.args) entry.args += tcc.args;

              // Emit as soon as we have a tool name (don't wait for full args)
              if (entry.name && !entry.emitted) {
                entry.emitted = true;
                pendingEarlyToolStartNames.push(entry.name);
                yield {
                  type: "tool_call" as const,
                  name: entry.name,
                  args: {}, // args will arrive later; show pending UI immediately
                };
              }
            }
          }
        }
      }

      // When LLM finishes a turn, emit any tool_calls that weren't already
      // emitted from streaming chunks (e.g. non-OpenAI models that don't
      // send tool_call_chunks).
      if (event.event === "on_chat_model_end") {
        const output = event.data?.output;
        const toolCalls =
          output?.tool_calls ?? output?.additional_kwargs?.tool_calls ?? ([] as unknown[]);
        const hasToolCalls =
          (Array.isArray(toolCalls) && toolCalls.length > 0) ||
          [...streamingToolCalls.values()].some((entry) => entry.emitted);

        for (const flushedEvent of flushBufferedTurnText(hasToolCalls)) {
          yield flushedEvent;
        }

        // Clear streaming accumulator for the next LLM turn
        streamingToolCalls.clear();

        if (isOutputLimitTermination(output)) {
          yield {
            type: "error",
            error:
              "The model reached its output limit before finishing. Increase Max Tokens or try again.",
          };
          return;
        }

        if (output) {
          if (Array.isArray(toolCalls)) {
            const alreadyEmittedNames = [...pendingEarlyToolStartNames];
            for (const tc of toolCalls) {
              const toolName =
                typeof tc?.name === "string"
                  ? tc.name
                  : typeof tc?.function?.name === "string"
                    ? tc.function.name
                    : "";
              if (!toolName) continue;

              // Check if already emitted from streaming chunks
              const alreadyEmittedIndex = alreadyEmittedNames.findIndex(
                (name) => name === toolName,
              );
              if (alreadyEmittedIndex >= 0) {
                alreadyEmittedNames.splice(alreadyEmittedIndex, 1);
                continue;
              }
              let args: Record<string, unknown>;
              const rawArgs = tc.args ?? tc.function?.arguments;
              try {
                args = (typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs) as Record<
                  string,
                  unknown
                >;
              } catch {
                args = {};
              }
              pendingEarlyToolStartNames.push(toolName);
              yield {
                type: "tool_call" as const,
                name: toolName,
                args,
              };
            }
          }
        }
      }

      // Tool call started — skip if already emitted earlier
      if (event.event === "on_tool_start") {
        pendingToolCallNames.push(event.name);
        const pendingEarlyIndex = pendingEarlyToolStartNames.findIndex(
          (name) => name === event.name,
        );
        if (pendingEarlyIndex >= 0) {
          pendingEarlyToolStartNames.splice(pendingEarlyIndex, 1);
        } else {
          // Fallback: emit if not already emitted (e.g. non-OpenAI model)
          yield {
            type: "tool_call",
            name: event.name,
            args: (event.data?.input as Record<string, unknown>) ?? {},
          };
        }
      }

      // Tool call completed
      if (event.event === "on_tool_end") {
        const pendingIndex = pendingToolCallNames.findIndex((name) => name === event.name);
        if (pendingIndex >= 0) pendingToolCallNames.splice(pendingIndex, 1);

        let result: unknown = event.data?.output;
        // ToolMessage objects need to have their content extracted
        const resultContent = (result as any)?.content ?? (result as any)?.lc_kwargs?.content;
        if (resultContent !== undefined) {
          result = resultContent;
        }
        try {
          if (typeof result === "string") result = JSON.parse(result);
        } catch {
          /* keep as string */
        }

        // Emit citation event for addCitation tool results
        if (event.name === "addCitation" && result && typeof result === "object") {
          const citationData = result as Record<string, unknown>;
          if (citationData.type === "citation") {
            yield {
              type: "citation",
              citation: {
                id: `citation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                bookId: citationData.bookId as string,
                chapterTitle: citationData.chapterTitle as string,
                chapterIndex: citationData.chapterIndex as number,
                cfi: citationData.cfi as string,
                text: citationData.text as string,
                citationIndex: citationData.citationIndex as number | undefined,
              },
            };
          }
        }

        yield { type: "tool_result", name: event.name, result };
      }

      // Get next event
      eventResult = await raceNext(iterator);
    }
  } catch (error) {
    console.error("[ReadingAgent] Error:", error);
    if (error instanceof Error) {
      console.error("[ReadingAgent] Stack:", error.stack);
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isRecursionError = /Recursion limit/i.test(errorMessage);
    if (isChapterTask && (chapterReferenceState.limitReached || isRecursionError)) {
      const limitResult = buildChapterReferenceLimitResult(
        chapterReferenceState.lastResult,
        chapterReferenceState.attemptedQueries,
      );
      const uniquePendingNames = Array.from(new Set(pendingToolCallNames)).filter((name) =>
        CHAPTER_LOOKUP_STOP_TOOL_NAMES.has(name),
      );
      for (const name of uniquePendingNames) {
        yield { type: "tool_result", name, result: limitResult };
      }
      yield {
        type: "token",
        content: "未能可靠定位章节，请补充更准确的章节名",
      };
      return;
    }
    if (isRecursionError) {
      const noticeResult = {
        notice: "本轮检索步骤过多，没有稳定完成。请换个更具体的问法，或直接重试一次。",
        reason: errorMessage,
      };
      const uniquePendingNames = Array.from(new Set(pendingToolCallNames));
      for (const name of uniquePendingNames) {
        yield { type: "tool_result", name, result: noticeResult };
      }
      yield {
        type: "token",
        content: "本轮检索步骤过多，没有稳定完成。请换个更具体的问法，或直接重试一次。",
      };
      return;
    }
    yield { type: "error", error: errorMessage };
  }
}

// --- Legacy exports for compatibility ---

export { buildSystemPrompt };
