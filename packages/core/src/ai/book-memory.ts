import type { AttachedQuote } from "../types";

export interface BookMemory {
  bookId: string;
  summary: string;
  focus: string[];
  openQuestions: string[];
  recentQuestions: string[];
  lastChapterTitle?: string;
  lastChapterIndex?: number;
  lastPositionPercent?: number;
  totalMessages: number;
  lastCompactedAt: number;
  compactedMessageCount: number;
  updatedAt: number;
}

export interface BookMemoryExchange {
  userInput: string;
  assistantText: string;
  selectedQuotes?: AttachedQuote[];
  chapterTitle?: string;
  chapterIndex?: number;
  positionPercent?: number;
}

export const BOOK_MEMORY_LIMITS = {
  maxSummaryChars: 2500,
  maxFocusItems: 12,
  maxOpenQuestions: 10,
  maxRecentQuestions: 12,
  maxQuestionChars: 600,
  maxFocusChars: 500,
  compactEveryMessages: 24,
};

export function createEmptyBookMemory(bookId: string, now = Date.now()): BookMemory {
  return {
    bookId,
    summary: "",
    focus: [],
    openQuestions: [],
    recentQuestions: [],
    totalMessages: 0,
    lastCompactedAt: 0,
    compactedMessageCount: 0,
    updatedAt: now,
  };
}

export function mergeBookMemoryExchange(
  current: BookMemory | null,
  exchange: BookMemoryExchange,
  now = Date.now(),
): BookMemory {
  const memory = current ? cloneBookMemory(current) : createEmptyBookMemory("", now);
  const userQuestion = normalizeMemoryLine(exchange.userInput, BOOK_MEMORY_LIMITS.maxQuestionChars);

  if (userQuestion) {
    memory.recentQuestions = uniqueRecent(
      [userQuestion, ...memory.recentQuestions],
      BOOK_MEMORY_LIMITS.maxRecentQuestions,
    );
    if (isQuestionLike(userQuestion)) {
      memory.openQuestions = uniqueRecent(
        [userQuestion, ...memory.openQuestions],
        BOOK_MEMORY_LIMITS.maxOpenQuestions,
      );
    }
  }

  const focusItems = buildFocusItems(exchange);
  if (focusItems.length > 0) {
    memory.focus = uniqueRecent([...focusItems, ...memory.focus], BOOK_MEMORY_LIMITS.maxFocusItems);
  }

  if (exchange.chapterTitle) memory.lastChapterTitle = exchange.chapterTitle;
  if (exchange.chapterIndex !== undefined) memory.lastChapterIndex = exchange.chapterIndex;
  if (exchange.positionPercent !== undefined) memory.lastPositionPercent = exchange.positionPercent;
  memory.bookId = memory.bookId || "";
  memory.totalMessages += 2;
  memory.updatedAt = now;

  const nextSummary = appendExchangeSummary(memory.summary, exchange);
  memory.summary = trimToLimit(nextSummary, BOOK_MEMORY_LIMITS.maxSummaryChars);

  if (shouldCompactBookMemory(memory)) {
    return compactBookMemory(memory, now);
  }

  return memory;
}

export function shouldCompactBookMemory(memory: BookMemory): boolean {
  if (memory.summary.length > BOOK_MEMORY_LIMITS.maxSummaryChars) return true;
  if (memory.focus.length > BOOK_MEMORY_LIMITS.maxFocusItems) return true;
  if (memory.recentQuestions.length > BOOK_MEMORY_LIMITS.maxRecentQuestions) return true;
  if (memory.openQuestions.length > BOOK_MEMORY_LIMITS.maxOpenQuestions) return true;
  const messagesSinceCompact = memory.totalMessages - memory.compactedMessageCount;
  return messagesSinceCompact >= BOOK_MEMORY_LIMITS.compactEveryMessages;
}

export function compactBookMemory(memory: BookMemory, now = Date.now()): BookMemory {
  const compacted = cloneBookMemory(memory);
  compacted.focus = uniqueRecent(compacted.focus, BOOK_MEMORY_LIMITS.maxFocusItems);
  compacted.openQuestions = uniqueRecent(
    compacted.openQuestions,
    BOOK_MEMORY_LIMITS.maxOpenQuestions,
  );
  compacted.recentQuestions = uniqueRecent(
    compacted.recentQuestions,
    BOOK_MEMORY_LIMITS.maxRecentQuestions,
  );
  compacted.summary = trimToLimit(
    [
      compacted.summary,
      compacted.focus.length > 0 ? `Current focus: ${compacted.focus.join("; ")}` : "",
      compacted.recentQuestions.length > 0
        ? `Recent questions: ${compacted.recentQuestions.slice(0, 6).join("; ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    BOOK_MEMORY_LIMITS.maxSummaryChars,
  );
  compacted.lastCompactedAt = now;
  compacted.compactedMessageCount = compacted.totalMessages;
  compacted.updatedAt = now;
  return compacted;
}

export function renderBookMemoryForPrompt(memory: BookMemory | null): string {
  if (!memory) return "";
  const lines = [
    "# Book memory",
    memory.summary ? `Summary:\n${memory.summary}` : "",
    memory.focus.length > 0 ? `Focus:\n${memory.focus.map((item) => `- ${item}`).join("\n")}` : "",
    memory.openQuestions.length > 0
      ? `Open questions:\n${memory.openQuestions.map((item) => `- ${item}`).join("\n")}`
      : "",
    memory.recentQuestions.length > 0
      ? `Recent questions:\n${memory.recentQuestions.map((item) => `- ${item}`).join("\n")}`
      : "",
    memory.lastChapterTitle
      ? `Last reading position: ${memory.lastChapterTitle}${
          memory.lastChapterIndex !== undefined ? ` (chapter ${memory.lastChapterIndex})` : ""
        }${memory.lastPositionPercent !== undefined ? `, ${Math.round(memory.lastPositionPercent * 100)}%` : ""}`
      : "",
  ].filter(Boolean);
  return lines.length > 1 ? lines.join("\n\n") : "";
}

function cloneBookMemory(memory: BookMemory): BookMemory {
  return {
    ...memory,
    focus: [...memory.focus],
    openQuestions: [...memory.openQuestions],
    recentQuestions: [...memory.recentQuestions],
  };
}

function buildFocusItems(exchange: BookMemoryExchange): string[] {
  const items: string[] = [];
  const chapter =
    exchange.chapterTitle ||
    (exchange.chapterIndex !== undefined ? `chapter ${exchange.chapterIndex}` : "");
  if (chapter) items.push(`Reading ${chapter}`);
  for (const quote of exchange.selectedQuotes ?? []) {
    const source = quote.source || chapter || "selected text";
    const text = normalizeMemoryLine(quote.text, BOOK_MEMORY_LIMITS.maxFocusChars);
    if (text) items.push(`${source}: ${text}`);
  }
  return items;
}

function appendExchangeSummary(summary: string, exchange: BookMemoryExchange): string {
  const userQuestion = normalizeMemoryLine(exchange.userInput, 300);
  const assistantTakeaway = normalizeMemoryLine(exchange.assistantText, 360);
  if (!userQuestion && !assistantTakeaway) return summary;
  const chapter = exchange.chapterTitle ? `[${exchange.chapterTitle}] ` : "";
  const entry = `${chapter}User asked: ${userQuestion || "(selected text)"}. Assistant answered: ${
    assistantTakeaway || "(no durable answer captured)"
  }.`;
  return [summary, entry].filter(Boolean).join("\n");
}

function normalizeMemoryLine(value: string | undefined, maxChars: number): string {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}...`;
}

function uniqueRecent(items: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const normalized = normalizeMemoryLine(item, 800);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function trimToLimit(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const suffix = value.slice(Math.max(0, value.length - limit + 32));
  return `[Earlier memory compacted]\n${suffix}`;
}

function isQuestionLike(value: string): boolean {
  return /(?:[?\uFF1F]|why|how|what|explain|analy[sz]e|summary|summari[sz]e|\u4e3a\u4ec0\u4e48|\u5982\u4f55|\u600e\u4e48|\u89e3\u91ca|\u5206\u6790|\u603b\u7ed3)/i.test(
    value,
  );
}
