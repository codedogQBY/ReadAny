import i18n from "i18next";
import {
  getBookMemory,
  getBooks,
  getChunks,
  getAllHighlights,
  getAllNotes,
  getReadingSessionsByDateRange,
  getBook,
  updateBook,
  getGroups,
  insertGroup,
  updateGroup as updateGroupDb,
  deleteGroup as deleteGroupDb,
  getBookmarks,
  insertBookmark,
  deleteBookmark,
  getSkills,
  getHighlightStats,
  getThreads,
  insertNote,
  getNotes,
} from "../db/database";
import { search as ragSearch } from "../rag";
import { emitLibraryChanged } from "../events/library-events";
import { debouncedSave, loadFromFS } from "../stores/persist";
import { estimateTokens } from "../rag/chunker";
import { getPlatformService } from "../services/platform";
import type { ExtractedBookChapter } from "../services/platform";
import type { AttachedQuote, Book, SemanticContext, Thread } from "../types";
import type { AgentStreamEvent } from "./agents/reading-agent";
import { type BookMemory, renderBookMemoryForPrompt } from "./book-memory";
import type { ProcessedMessage } from "./message-pipeline";
import { getReadingContextSnapshot } from "./reading-context-service";

type ClaudeContentBlock = {
  type?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  text?: string;
};

type ClaudeStreamPayload = Record<string, any>;

interface ParserState {
  assistantTextById: Map<string, string>;
  toolNamesById: Map<string, string>;
  streamTextEmitted: boolean;
  fallbackTextEmitted: boolean;
}

export interface ChapterContext {
  chapterTitle: string;
  chapterIndex: number;
  content: string;
  source: "chunks" | "file";
  chunks: Array<{
    content: string;
    cfi: string;
    chapterTitle: string;
    chapterIndex: number;
  }>;
  totalTokens: number;
}

export interface PreExecutedContext {
  intent: "library_query" | "reading_stats" | "highlight_note" | "library_organize" | "search_book" | "list_query" | "general";
  librarySummary?: string;
  statsSummary?: string;
  notesSummary?: string;
  classifyData?: string;
  searchResult?: string;
  listResult?: string;
}

export interface ReadAnyOp {
  action: string;
  params: Record<string, unknown>;
}

export interface ClaudeCodeStreamParser {
  parseLine(line: string): AgentStreamEvent[];
}

export function createClaudeCodeStreamParser(): ClaudeCodeStreamParser {
  const state: ParserState = createParserState();
  return {
    parseLine(line: string): AgentStreamEvent[] {
      return parseClaudeCodeStreamLine(line, state);
    },
  };
}

function createParserState(): ParserState {
  return {
    assistantTextById: new Map(),
    toolNamesById: new Map(),
    streamTextEmitted: false,
    fallbackTextEmitted: false,
  };
}

export function parseClaudeCodeStreamLine(
  line: string,
  state: ParserState = createParserState(),
): AgentStreamEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  let payload: ClaudeStreamPayload;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    return [{ type: "reasoning", content: trimmed, stepType: "thinking" }];
  }

  const events: AgentStreamEvent[] = [];

  if (payload.type === "system" && payload.subtype === "init") {
    const model = typeof payload.model === "string" ? ` (${payload.model})` : "";
    events.push({
      type: "reasoning",
      content: `Claude Code started${model}.`,
      stepType: "thinking",
    });
  }

  events.push(...readStreamEvent(payload, state));

  if (payload.type === "assistant" && payload.message) {
    events.push(...readAssistantMessage(payload.message, state));
  }

  if (payload.type === "user" && payload.message) {
    events.push(...readToolResults(payload.message, state));
  }

  if (payload.type === "result" && payload.is_error) {
    events.push({
      type: "error",
      error: String(payload.result || payload.error || "Claude Code failed"),
    });
  } else if (payload.type === "result" && !state.fallbackTextEmitted && payload.result) {
    events.push({ type: "token", content: String(payload.result) });
    state.fallbackTextEmitted = true;
  }

  return events;
}

function readStreamEvent(payload: ClaudeStreamPayload, state: ParserState): AgentStreamEvent[] {
  const event = payload.type === "stream_event" ? payload.event : payload;
  if (!event || typeof event !== "object") return [];

  if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
    const block = event.content_block as ClaudeContentBlock;
    if (!block.name) return [];
    const toolId = block.id || `${block.name}:${event.index ?? state.toolNamesById.size}`;
    if (state.toolNamesById.has(toolId)) return [];
    state.toolNamesById.set(toolId, block.name);
    return [{ type: "tool_call", name: block.name, args: block.input || {} }];
  }

  if (event.type !== "content_block_delta") return [];

  const delta = event.delta;
  if (delta?.type === "text_delta" && typeof delta.text === "string") {
    state.streamTextEmitted = true;
    state.fallbackTextEmitted = true;
    return [{ type: "token", content: delta.text }];
  }

  if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
    return [{ type: "reasoning", content: delta.thinking, stepType: "thinking" }];
  }

  return [];
}

function readAssistantMessage(message: any, state: ParserState): AgentStreamEvent[] {
  const events: AgentStreamEvent[] = [];
  const messageId = String(message.id || "assistant");
  const content = Array.isArray(message.content) ? message.content : [];
  const text = content
    .filter((block: ClaudeContentBlock) => block?.type === "text")
    .map((block: ClaudeContentBlock) => block.text || "")
    .join("");
  const previousText = state.assistantTextById.get(messageId) || "";

  if (text && text !== previousText && !state.streamTextEmitted) {
    const delta = text.startsWith(previousText) ? text.slice(previousText.length) : text;
    if (delta) events.push({ type: "token", content: delta });
    state.fallbackTextEmitted = true;
  }
  if (text) state.assistantTextById.set(messageId, text);

  for (const block of content as ClaudeContentBlock[]) {
    if (block?.type !== "tool_use" || !block.name) continue;
    const toolId = block.id || `${block.name}:${events.length}`;
    if (state.toolNamesById.has(toolId)) continue;
    state.toolNamesById.set(toolId, block.name);
    events.push({ type: "tool_call", name: block.name, args: block.input || {} });
  }

  return events;
}

function readToolResults(message: any, state: ParserState): AgentStreamEvent[] {
  const content = Array.isArray(message.content) ? message.content : [];
  return (content as ClaudeContentBlock[])
    .filter((block) => block?.type === "tool_result")
    .map((block) => ({
      type: "tool_result" as const,
      name: state.toolNamesById.get(block.tool_use_id || "") || "tool_result",
      result: normalizeToolResult(block.content),
    }));
}

function normalizeToolResult(content: unknown): unknown {
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          return String((item as { text: unknown }).text);
        }
        return JSON.stringify(item);
      })
      .join("\n");
  }
  return content;
}

export function shouldAttachFullChapter(content: string, quotes: AttachedQuote[] = []): boolean {
  if (quotes.length > 0) return true;
  const normalized = content.toLowerCase();
  // \u5bbd\u677e\u5339\u914d\uff1a\u5927\u591a\u6570\u9605\u8bfb\u76f8\u5173\u7684\u95ee\u9898\u90fd\u9700\u8981\u7ae0\u8282\u4e0a\u4e0b\u6587
  // \u53ea\u6709\u7eaf\u4e66\u5e93\u7ba1\u7406\u3001\u7eaf\u7edf\u8ba1\u3001\u7eaf\u95ee\u5019\u7b49\u95ee\u9898\u624d\u4e0d\u9700\u8981
  const skipPatterns = [
    "\u4e66\u5e93", "library", "\u6709\u54ea\u4e9b\u4e66", "my books",
    "\u7edf\u8ba1", "stats", "reading time",
    "\u4f60\u597d", "hello", "hi", "\u8c22\u8c22", "thank",
    "\u6807\u7b7e", "tag", "\u5206\u7c7b", "classify",
  ];
  if (skipPatterns.some((p) => normalized.includes(p)) && normalized.length < 50) {
    return false;
  }

  const attachKeywords = [
    // \u4e2d\u6587\uff1a\u7ae0\u8282/\u5185\u5bb9\u76f8\u5173
    "\u8fd9\u4e00\u7ae0", "\u672c\u7ae0", "\u5f53\u524d\u7ae0", "\u8fd9\u7ae0",
    "\u7ae0\u8282", "\u6574\u7ae0", "\u5168\u6587", "\u8fd9\u4e00\u8282", "\u672c\u8282",
    "\u5e8f\u8a00", "\u603b\u7ed3", "\u6982\u62ec", "\u5206\u6790", "\u8bba\u8bc1",
    "\u68b3\u7406", "\u4ee5\u4e0b\u6587\u672c", "\u8fd9\u6bb5\u6587\u672c",
    "\u5185\u5bb9", "\u89e3\u91ca", "\u8bf4\u660e", "\u8bb2\u8ff0",
    "\u89c2\u70b9", "\u4e3b\u9898", "\u4eba\u7269", "\u60c5\u8282",
    "\u5f15\u7528", "\u6458\u5f55", "\u6ce8\u91ca",
    // English: chapter/content related
    "chapter", "section", "selected text", "quote",
    "summary", "summarize", "argument", "explain",
    "content", "plot", "character", "theme",
    "analyze", "describe", "what is", "what are",
    "meaning", "concept",
  ];
  return attachKeywords.some((keyword) => normalized.includes(keyword));
}

export function buildChapterContextFromChunks(
  chunks: Array<{
    id: string;
    chapterIndex: number;
    chapterTitle: string;
    content: string;
    tokenCount?: number;
    startCfi?: string;
  }>,
  chapterIndex: number,
): ChapterContext | null {
  const chapterChunks = chunks
    .filter((chunk) => chunk.chapterIndex === chapterIndex)
    .sort(compareChunkOrder);
  if (chapterChunks.length === 0) return null;

  const content = joinChunkContent(chapterChunks.map((chunk) => chunk.content));
  return {
    chapterTitle: chapterChunks[0]?.chapterTitle || "Unknown",
    chapterIndex,
    content,
    source: "chunks",
    chunks: chapterChunks.map((chunk) => ({
      content: chunk.content,
      cfi: chunk.startCfi || "",
      chapterTitle: chunk.chapterTitle,
      chapterIndex: chunk.chapterIndex,
    })),
    totalTokens: estimateTokens(content),
  };
}

export function buildChapterContextFromExtractedChapter(
  chapter: ExtractedBookChapter,
): ChapterContext | null {
  const content = chapter.content.trim();
  if (!content) return null;

  const segments = chapter.segments?.length ? chapter.segments : [{ text: content, cfi: "" }];

  return {
    chapterTitle: chapter.title || `Section ${chapter.index + 1}`,
    chapterIndex: chapter.index,
    content,
    source: "file",
    chunks: segments.map((segment) => ({
      content: segment.text,
      cfi: segment.cfi,
      chapterTitle: chapter.title || `Section ${chapter.index + 1}`,
      chapterIndex: chapter.index,
    })),
    totalTokens: estimateTokens(content),
  };
}

/**
 * 根据用户输入检测意图，预执行 ReadAny 工具并返回格式化上下文。
 * 这些结果会被注入到用户 prompt 中，使 Claude Code 能够基于真实数据回答。
 */
export async function preExecuteReadAnyTools(options: {
  userInput: string;
  book: Book | null;
}): Promise<PreExecutedContext> {
  const input = options.userInput.toLowerCase();
  const result: PreExecutedContext = { intent: "general" };

  // 检测书库查询意图
  const libraryKeywords = [
    "书库", "我的书", "有哪些书", "library", "my books", "书籍列表",
    "书单", "藏书", "在读", "已读完", "未读",
  ];
  const statsKeywords = [
    "阅读统计", "阅读时长", "阅读数据", "统计", "reading stats",
    "reading time", "读了多久", "读了多少",
  ];
  const notesKeywords = [
    "笔记", "标注", "划线", "highlight", "note", "annotation",
    "我的标注", "我的笔记", "摘录",
  ];
  const organizeKeywords = [
    "整理", "分类", "标签", "标记", "organize", "classify",
    "tag", "归类", "分门别类", "管理书库", "打理", "去重",
    "归类整理", "重新整理", "帮我整理",
  ];

  if (libraryKeywords.some((kw) => input.includes(kw))) {
    result.intent = "library_query";
  }
  if (statsKeywords.some((kw) => input.includes(kw))) {
    result.intent = "reading_stats";
  }
  if (notesKeywords.some((kw) => input.includes(kw))) {
    result.intent = "highlight_note";
  }
  if (organizeKeywords.some((kw) => input.includes(kw))) {
    result.intent = "library_organize";
  }

  // 检测书内搜索意图（仅当未匹配到书库查询意图时）
  const searchKeywords = ["搜寻", "查找", "搜索", "search", "找一下", "帮我找", "搜一下", "find", "找一找"];
  const listKeywords = ["列出", "有哪些", "查看", "list", "show", "有什么", "多少个", "多少条", "书签", "对话", "技能", "skills"];

  if (searchKeywords.some((kw) => input.includes(kw)) && result.intent === "general" && options.book?.isVectorized) {
    result.intent = "search_book";
  }
  if (listKeywords.some((kw) => input.includes(kw)) && result.intent === "general") {
    result.intent = "list_query";
  }
  // organize 优先级最高
  if (organizeKeywords.some((kw) => input.includes(kw))) {
    result.intent = "library_organize";
  }

  try {
    // 获取书库总览（对所有意图都提供轻量书库上下文）
    const books = await getBooks();
    const totalBooks = books.length;
    const inProgress = books.filter((b) => b.progress > 0 && b.progress < 1).length;
    const completed = books.filter((b) => b.progress >= 1).length;

    result.librarySummary = [
      `书库概况：共 ${totalBooks} 本书，${inProgress} 本在读，${completed} 本已读完`,
      books.length > 0
        ? `最近书籍：${books
            .slice(0, 10)
            .map(
              (b) =>
                `《${b.meta.title || "未知"}》${b.meta.author ? ` (${b.meta.author})` : ""} [${Math.round((b.progress || 0) * 100)}%]${b.isVectorized ? " ✓已向量化" : ""}`,
            )
            .join("；")}`
        : "书库为空",
    ].join("\n");

    // 书库查询：提供完整书单
    if (result.intent === "library_query") {
      const statusFilter = input.includes("在读")
        ? "reading"
        : input.includes("读完") || input.includes("completed")
          ? "completed"
          : input.includes("未读") || input.includes("unread")
            ? "unread"
            : undefined;

      let filteredBooks = books;
      if (statusFilter === "unread") {
        filteredBooks = books.filter((b) => !b.progress || b.progress === 0);
      } else if (statusFilter === "reading") {
        filteredBooks = books.filter((b) => b.progress > 0 && b.progress < 1);
      } else if (statusFilter === "completed") {
        filteredBooks = books.filter((b) => b.progress >= 1);
      }

      result.librarySummary = [
        `书库详情（${statusFilter ? statusFilter : "全部"}）：共 ${filteredBooks.length} 本`,
        ...filteredBooks.map(
          (b) =>
            `- 《${b.meta.title || "未知"}》${b.meta.author ? ` 作者：${b.meta.author}` : ""} | 进度：${Math.round((b.progress || 0) * 100)}% | 格式：${b.format || "未知"} | ${b.isVectorized ? "已向量化" : "未向量化"}`,
        ),
      ].join("\n");
    }

    // 阅读统计
    if (result.intent === "reading_stats") {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      const sessions = await getReadingSessionsByDateRange(startDate, endDate);
      const totalMs = sessions.reduce((sum, s) => sum + s.totalActiveTime, 0);
      const totalPages = sessions.reduce((sum, s) => sum + s.pagesRead, 0);

      result.statsSummary = [
        "近30天阅读统计：",
        `- 阅读会话数：${sessions.length} 次`,
        `- 总阅读时间：${Math.round(totalMs / 60000)} 分钟`,
        `- 总阅读页数：${totalPages} 页`,
        `- 书库总览：${totalBooks} 本书，${inProgress} 本在读，${completed} 本已读完`,
      ].join("\n");
    }

    // 标注/笔记查询
    if (result.intent === "highlight_note") {
      const highlights = await getAllHighlights(20);
      const notes = await getAllNotes(20);

      if (highlights.length > 0 || notes.length > 0) {
        const bookMap = new Map(books.map((b) => [b.id, b.meta.title]));
        const parts: string[] = ["最近的标注和笔记："];

        if (highlights.length > 0) {
          parts.push("## 最近划线");
          for (const h of highlights.slice(0, 10)) {
            const bookTitle = bookMap.get(h.bookId) || "未知";
            parts.push(
              `- [${bookTitle}] ${h.text.slice(0, 100)}${h.text.length > 100 ? "..." : ""}${h.note ? ` (笔记：${h.note.slice(0, 60)})` : ""}`,
            );
          }
        }

        if (notes.length > 0) {
          parts.push("## 最近笔记");
          for (const n of notes.slice(0, 10)) {
            parts.push(`- ${n.title}: ${n.content.slice(0, 100)}`);
          }
        }

        result.notesSummary = parts.join("\n");
      }
    }

    // 整理书库意图：预执行 classifyBooks 获取分类数据
    if (result.intent === "library_organize") {
      const allTags = [...new Set(books.flatMap((b) => b.tags || []))];
      const groups = await getGroups();
      const groupMap = new Map(groups.map((g) => [g.id, g.name]));
      const uncategorizedWithContent = await Promise.all(
        books
          .filter((b) => (b.tags || []).length === 0)
          .map(async (b) => {
            let toc: string[] = [];
            let contentSample = "";
            try {
              const chunks = await getChunks(b.id);
              if (chunks.length > 0) {
                const chapters = new Map<number, string>();
                for (const chunk of chunks) {
                  if (!chapters.has(chunk.chapterIndex)) {
                    chapters.set(chunk.chapterIndex, chunk.chapterTitle);
                  }
                }
                toc = Array.from(chapters.entries())
                  .sort((a, b) => a[0] - b[0])
                  .map(([, title]) => title);
                contentSample = chunks
                  .slice(0, 3)
                  .map((c) => c.content)
                  .join("\n")
                  .slice(0, 800);
              }
            } catch { /* ok */ }
            return {
              id: b.id,
              title: b.meta.title,
              author: b.meta.author,
              description: b.meta.description,
              subjects: b.meta.subjects,
              language: b.meta.language,
              format: b.format,
              progress: Math.round((b.progress || 0) * 100),
              isVectorized: b.isVectorized,
              currentTags: b.tags || [],
              toc,
              contentSample,
            };
          }),
      );
      const allGroups = [...new Set([
        ...groups.map(g => g.name),
        ...books.map(b => b.groupId ? (groupMap.get(b.groupId) || "") : ""),
      ])].filter(Boolean);

      result.classifyData = [
        `书库整理数据：共 ${books.length} 本书`,
        `已有分组：${allGroups.length > 0 ? allGroups.join("、") : "(无)"}`,
        `已有标签：${allTags.length > 0 ? allTags.join("、") : "(无)"}`,
        `全部书籍：`,
        ...books.map(
          (b) => {
            const groupName = b.groupId ? (groupMap.get(b.groupId) || "") : "";
            return `- [${b.id}] 《${b.meta.title || "未知"}》${b.meta.author ? ` 作者: ${b.meta.author}` : ""} | 分组: ${groupName || "(未分组)"} | 标签: ${(b.tags || []).join(", ") || "(无)"} | 语言: ${b.meta.language || "未知"} | 进度: ${Math.round((b.progress || 0) * 100)}%`;
          },
        ),
        uncategorizedWithContent.length > 0
          ? `注意：${uncategorizedWithContent.length} 本无标签，需重点整理`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
    }

    // 书内搜索意图：预执行 RAG 搜索
    if (result.intent === "search_book" && options.book?.isVectorized) {
      try {
        // 尝试从用户输入中提取搜索词
        const searchTerm = input.replace(/搜索|查找|搜寻|帮我找|搜一下|找一下|find|search/gi, "").trim();
        if (searchTerm && searchTerm.length > 0) {
          const searchResults = await ragSearch({ query: searchTerm, bookId: options.book.id, topK: 5, mode: "hybrid", threshold: 0.3 });
          if (searchResults.length > 0) {
            result.searchResult = [
              `RAG 搜索结果（"${searchTerm}"，共 ${searchResults.length} 条）：`,
              ...searchResults.map((r, i) =>
                `[${i + 1}] 第${r.chunk.chapterIndex}章 ${r.chunk.chapterTitle || ""} (相关度 ${Math.round(r.score * 100)}%)\n${r.chunk.content.slice(0, 400)}${r.chunk.content.length > 400 ? "…" : ""}`
              ),
            ].join("\n\n");
          }
        }
      } catch { /* 搜索失败不影响主流程 */ }
    }

    // 列表查询意图：预执行列表操作
    if (result.intent === "list_query") {
      try {
        const parts: string[] = [];
        if (["技能", "skills"].some((kw) => input.includes(kw))) {
          const skills = await getSkills();
          if (skills.length > 0) {
            parts.push(`可用技能 (${skills.length}):\n${skills.map((s) => `- ${s.name}: ${s.description || "(无描述)"}`).join("\n")}`);
          }
        }
        if (["书签", "bookmark"].some((kw) => input.includes(kw)) && options.book) {
          const bookmarks = await getBookmarks(options.book.id);
          if (bookmarks.length > 0) {
            parts.push(`书签 (${bookmarks.length}):\n${bookmarks.map((b, i) => `[${i + 1}] ${b.label || "(无标签)"}`).join("\n")}`);
          }
        }
        if (["标注", "高亮", "highlight"].some((kw) => input.includes(kw))) {
          const stats = await getHighlightStats();
          parts.push(`标注统计：${stats.totalHighlights} 条高亮，${stats.highlightsWithNotes} 条带笔记，涉及 ${stats.totalBooks} 本书`);
        }
        if (["对话", "thread", "记录"].some((kw) => input.includes(kw)) && options.book) {
          const threads = await getThreads(options.book.id);
          if (threads.length > 0) {
            parts.push(`对话记录 (${threads.length}):\n${threads.map((t, i) => `[${i + 1}] ${t.title || "无标题"} (${t.messages?.length || 0}条)`).join("\n")}`);
          }
        }
        if (parts.length > 0) result.listResult = parts.join("\n\n");
      } catch { /* 列表查询失败不影响主流程 */ }
    }
  } catch (err) {
    console.warn("[ClaudeCode] Pre-execution failed:", err);
  }

  return result;
}

/** 解析 Claude Code 回复中的操作指令 */
export function parseReadAnyOps(text: string): ReadAnyOp[] {
  const ops: ReadAnyOp[] = [];

  // 方法1：解析 ```readany-ops 代码块（新格式）
  const blockRegex = /```readany(?:-ops)?[^\S\r\n]*\r?\n([\s\S]*?)```/gi;
  let blockMatch;
  while ((blockMatch = blockRegex.exec(text)) !== null) {
    const lines = blockMatch[1].split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // tag: bookId=标签1, 标签2
      const tagMatch = trimmed.match(/^tag:\s*(.+?)\s*=\s*(.+)$/);
      if (tagMatch) {
        const bookId = tagMatch[1];
        const tags = tagMatch[2].split(/[,，]/).map((t) => t.trim()).filter(Boolean);
        ops.push({ action: "tagBooks", params: { assignments: [{ bookId, tags }] } });
        continue;
      }

      // create-tag: 标签名
      const createMatch = trimmed.match(/^create-tag:\s*(.+)$/);
      if (createMatch) {
        const tagName = createMatch[1].trim();
        ops.push({ action: "manageBookTags", params: { action: "create", tags: [tagName] } });
        continue;
      }

      // rename-tag: 旧名=新名
      const renameMatch = trimmed.match(/^rename-tag:\s*(.+?)\s*=\s*(.+)$/);
      if (renameMatch) {
        ops.push({ action: "manageBookTags", params: { action: "rename", tag: renameMatch[1].trim(), newTag: renameMatch[2].trim() } });
        continue;
      }

      // set-book-tags: bookId=标签1, 标签2
      const setMatch = trimmed.match(/^set-book-tags:\s*(.+?)\s*=\s*(.+)$/);
      if (setMatch) {
        const bookId = setMatch[1];
        const tags = setMatch[2].split(/[,，]/).map((t) => t.trim()).filter(Boolean);
        ops.push({ action: "manageBookTags", params: { action: "setBookTags", bookId, tags } });
        continue;
      }

      // create-group: 分组名
      const createGroupMatch = trimmed.match(/^create-group:\s*(.+)$/);
      if (createGroupMatch) {
        ops.push({ action: "manageGroup", params: { action: "create", name: createGroupMatch[1].trim() } });
        continue;
      }

      // rename-group: 旧名=新名
      const renameGroupMatch = trimmed.match(/^rename-group:\s*(.+?)\s*=\s*(.+)$/);
      if (renameGroupMatch) {
        ops.push({ action: "manageGroup", params: { action: "rename", oldName: renameGroupMatch[1].trim(), newName: renameGroupMatch[2].trim() } });
        continue;
      }

      // delete-group: 分组名
      const deleteGroupMatch = trimmed.match(/^delete-group:\s*(.+)$/);
      if (deleteGroupMatch) {
        ops.push({ action: "manageGroup", params: { action: "delete", name: deleteGroupMatch[1].trim() } });
        continue;
      }

      // move-to-group: 分组名=bookId1, bookId2, ...
      const moveGroupMatch = trimmed.match(/^move-to-group:\s*(\S.*?)\s*=\s*(.+)$/);
      if (moveGroupMatch) {
        const groupName = moveGroupMatch[1].trim();
        const bookIds = moveGroupMatch[2].split(/[,，]/).map((s) => s.trim()).filter(Boolean);
        ops.push({ action: "manageGroup", params: { action: "moveBooks", groupName, bookIds } });
        continue;
      }

      // search-book: bookId=查询关键词
      const searchBookMatch = trimmed.match(/^search-book:\s*(.+?)\s*=\s*(.+)$/);
      if (searchBookMatch) {
        ops.push({ action: "searchBook", params: { bookId: searchBookMatch[1], query: searchBookMatch[2].trim() } });
        continue;
      }

      // add-bookmark: bookId=标签标题
      const addBookmarkMatch = trimmed.match(/^add-bookmark:\s*(.+?)\s*=\s*(.+)$/);
      if (addBookmarkMatch) {
        ops.push({ action: "bookmark", params: { action: "create", bookId: addBookmarkMatch[1], label: addBookmarkMatch[2].trim() } });
        continue;
      }

      // remove-bookmark: bookmarkId
      const removeBookmarkMatch = trimmed.match(/^remove-bookmark:\s*(\S+)$/);
      if (removeBookmarkMatch) {
        ops.push({ action: "bookmark", params: { action: "delete", id: removeBookmarkMatch[1] } });
        continue;
      }

      // list-bookmarks: bookId
      const listBookmarksMatch = trimmed.match(/^list-bookmarks:\s*(.+?)\s*$/);
      if (listBookmarksMatch) {
        ops.push({ action: "listData", params: { type: "bookmarks", bookId: listBookmarksMatch[1] } });
        continue;
      }

      // list-highlights: bookId
      const listHighlightsMatch = trimmed.match(/^list-highlights:\s*(.+?)\s*$/);
      if (listHighlightsMatch) {
        ops.push({ action: "listData", params: { type: "highlights", bookId: listHighlightsMatch[1] } });
        continue;
      }

      // highlight-stats
      if (trimmed.match(/^highlight-stats\b/)) {
        ops.push({ action: "listData", params: { type: "highlightStats" } });
        continue;
      }

      // list-notes: bookId
      const listNotesMatch = trimmed.match(/^list-notes:\s*(.+?)\s*$/);
      if (listNotesMatch) {
        ops.push({ action: "listData", params: { type: "notes", bookId: listNotesMatch[1] } });
        continue;
      }

      // list-skills
      if (trimmed.match(/^list-skills\b/)) {
        ops.push({ action: "listData", params: { type: "skills" } });
        continue;
      }

      // list-threads: bookId
      const listThreadsMatch = trimmed.match(/^list-threads:\s*(.+?)\s*$/);
      if (listThreadsMatch) {
        ops.push({ action: "listData", params: { type: "threads", bookId: listThreadsMatch[1] } });
        continue;
      }

      // add-note: bookId=标题|内容
      const addNoteMatch = trimmed.match(/^add-note:\s*(.+?)\s*=\s*(.+)$/);
      if (addNoteMatch) {
        const parts = addNoteMatch[2].split("|").map((s) => s.trim());
        ops.push({ action: "note", params: { action: "create", bookId: addNoteMatch[1], title: parts[0] || "", content: parts[1] || parts[0] || "" } });
        continue;
      }
    }
  }

  // 方法2：解析 <readany> XML 标签（旧格式兼容）
  const xmlRegex = /<readany\s+action="([^"]+)"\s+params='([^']*)'\s*\/>/g;
  let xmlMatch;
  while ((xmlMatch = xmlRegex.exec(text)) !== null) {
    try {
      const action = xmlMatch[1];
      const params = xmlMatch[2] ? JSON.parse(xmlMatch[2]) : {};
      ops.push({ action, params });
    } catch {
      console.warn("[ClaudeCode] Failed to parse ReadAny XML op:", xmlMatch[0]);
    }
  }

  // 后处理：合并 tagBooks 操作（同一书的多次 tag 合并）
  const mergedOps: ReadAnyOp[] = [];
  const tagAssignments = new Map<string, string[]>();
  for (const op of ops) {
    if (op.action === "tagBooks" && op.params.assignments) {
      for (const a of op.params.assignments as Array<{ bookId: string; tags: string[] }>) {
        const existing = tagAssignments.get(a.bookId) || [];
        tagAssignments.set(a.bookId, [...new Set([...existing, ...a.tags])]);
      }
    } else {
      mergedOps.push(op);
    }
  }
  if (tagAssignments.size > 0) {
    const assignments = Array.from(tagAssignments.entries()).map(([bookId, tags]) => ({ bookId, tags }));
    mergedOps.unshift({ action: "tagBooks", params: { assignments } });
  }

  return mergedOps;
}

/** 执行一个 ReadAny 操作，返回结果文本 */
function normalizeBookReference(value: string): string {
  return value
    .trim()
    .replace(/^["'“”‘’《〈]|["'“”‘’》〉]$/g, "")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

export async function resolveReadAnyBookReference(
  reference: string,
  currentBook: Book | null,
): Promise<string> {
  const trimmed = reference.trim();
  const normalized = normalizeBookReference(trimmed);
  if (!normalized) return trimmed;

  if (
    currentBook &&
    (["current", "current-book", "当前书", "当前书籍", "本书"].includes(normalized) ||
      normalizeBookReference(currentBook.meta.title || "") === normalized)
  ) {
    return currentBook.id;
  }

  try {
    const direct = await getBook(trimmed);
    if (direct) return direct.id;
  } catch {
    // Fall through to title matching.
  }

  const books = await getBooks();
  const exactMatches = books.filter(
    (book) => normalizeBookReference(book.meta.title || "") === normalized,
  );
  if (exactMatches.length === 1) return exactMatches[0].id;

  const partialMatches = books.filter((book) => {
    const title = normalizeBookReference(book.meta.title || "");
    return title.length > 0 && (title.includes(normalized) || normalized.includes(title));
  });
  return partialMatches.length === 1 ? partialMatches[0].id : trimmed;
}

async function resolveReadAnyOpBookReferences(
  op: ReadAnyOp,
  currentBook: Book | null,
): Promise<ReadAnyOp> {
  const params = { ...op.params };

  if (typeof params.bookId === "string") {
    params.bookId = await resolveReadAnyBookReference(params.bookId, currentBook);
  }

  if (Array.isArray(params.bookIds)) {
    params.bookIds = await Promise.all(
      params.bookIds.map((bookId) =>
        typeof bookId === "string"
          ? resolveReadAnyBookReference(bookId, currentBook)
          : Promise.resolve(bookId),
      ),
    );
  }

  if (Array.isArray(params.assignments)) {
    params.assignments = await Promise.all(
      params.assignments.map(async (assignment) => {
        if (
          !assignment ||
          typeof assignment !== "object" ||
          typeof (assignment as { bookId?: unknown }).bookId !== "string"
        ) {
          return assignment;
        }
        return {
          ...assignment,
          bookId: await resolveReadAnyBookReference(
            (assignment as { bookId: string }).bookId,
            currentBook,
          ),
        };
      }),
    );
  }

  return { ...op, params };
}

async function executeSingleReadAnyOp(op: ReadAnyOp): Promise<string> {
  const { action, params } = op;

  try {
    switch (action) {
      case "tagBooks": {
        const assignments = params.assignments as Array<{ bookId: string; tags: string[] }>;
        if (!Array.isArray(assignments)) return "tagBooks 错误: assignments 参数必须是数组";
        const results: string[] = [];
        for (const { bookId, tags } of assignments) {
          const book = await getBook(bookId);
          if (!book) { results.push(`✗ ${bookId}: 书籍未找到`); continue; }
          const merged = [...new Set([...(book.tags || []), ...tags])];
          await updateBook(bookId, { tags: merged });
          results.push(`✓ 《${book.meta.title || bookId}》标签已更新: ${merged.join(", ")}`);
        }
        emitLibraryChanged();
        return results.join("\n");
      }
      case "manageBookTags": {
        const act = params.action as string;
        if (act === "create") {
          const tagsToCreate: string[] = Array.isArray(params.tags) ? params.tags : (params.tag ? [params.tag as string] : []);
          const existingTags = (await loadFromFS<string[]>("library-tags")) || [];
          const newTags = tagsToCreate.filter((t) => !existingTags.includes(t));
          if (newTags.length === 0) return "所有标签已存在";
          const allTags = [...existingTags, ...newTags].sort();
          debouncedSave("library-tags", allTags);
          emitLibraryChanged();
          return `✓ 已创建标签: ${newTags.join(", ")}（现有 ${allTags.length} 个标签）`;
        }
        if (act === "rename") {
          const oldTag = params.tag as string;
          const newTag = params.newTag as string;
          if (!oldTag || !newTag) return "rename 需要 tag 和 newTag 参数";
          const books = await getBooks();
          let count = 0;
          for (const book of books) {
            if (book.tags?.includes(oldTag)) {
              const updated = book.tags.map((t) => (t === oldTag ? newTag : t));
              await updateBook(book.id, { tags: [...new Set(updated)] });
              count++;
            }
          }
          emitLibraryChanged();
          return `✓ 已将标签 "${oldTag}" 重命名为 "${newTag}"，影响 ${count} 本书`;
        }
        if (act === "delete") {
          const tagsToDelete: string[] = Array.isArray(params.tags) ? params.tags : (params.tag ? [params.tag as string] : []);
          const books = await getBooks();
          let count = 0;
          for (const book of books) {
            if (tagsToDelete.some((t) => book.tags?.includes(t))) {
              const updated = (book.tags || []).filter((t) => !tagsToDelete.includes(t));
              await updateBook(book.id, { tags: updated });
              count++;
            }
          }
          emitLibraryChanged(tagsToDelete);
          return `✓ 已删除标签: ${tagsToDelete.join(", ")}，影响 ${count} 本书`;
        }
        if (act === "setBookTags") {
          const bookId = params.bookId as string;
          const tags = params.tags as string[];
          if (!bookId || !tags) return "setBookTags 需要 bookId 和 tags 参数";
          const book = await getBook(bookId);
          if (!book) return `✗ 书籍 ${bookId} 未找到`;
          await updateBook(bookId, { tags: [...new Set(tags)] });
          emitLibraryChanged();
          return `✓ 《${book.meta.title}》标签已设为: ${tags.join(", ")}`;
        }
        if (act === "removeFromBook") {
          const bookId = params.bookId as string;
          const tagsToRemove: string[] = Array.isArray(params.tags) ? params.tags : [];
          if (!bookId || !tagsToRemove.length) return "removeFromBook 需要 bookId 和 tags 参数";
          const book = await getBook(bookId);
          if (!book) return `✗ 书籍 ${bookId} 未找到`;
          const updated = (book.tags || []).filter((t) => !tagsToRemove.includes(t));
          await updateBook(bookId, { tags: updated });
          emitLibraryChanged();
          return `✓ 已从《${book.meta.title}》移除标签: ${tagsToRemove.join(", ")}`;
        }
        return `未知的 manageBookTags 操作: ${act}`;
      }
      case "manageGroup": {
        const act = params.action as string;
        if (act === "create") {
          const name = params.name as string;
          if (!name) return "create 需要 name 参数";
          const groups = await getGroups();
          if (groups.find((g) => g.name === name)) return `分组"${name}"已存在`;
          await insertGroup({ name });
          return `✓ 已创建分组: ${name}`;
        }
        if (act === "rename") {
          const oldName = params.oldName as string;
          const newName = params.newName as string;
          if (!oldName || !newName) return "rename 需要 oldName 和 newName 参数";
          const groups = await getGroups();
          const target = groups.find((g) => g.name === oldName);
          if (!target) return `✗ 未找到分组"${oldName}"`;
          await updateGroupDb(target.id, { name: newName });
          return `✓ 已将分组"${oldName}"重命名为"${newName}"`;
        }
        if (act === "delete") {
          const name = params.name as string;
          if (!name) return "delete 需要 name 参数";
          const groups = await getGroups();
          const target = groups.find((g) => g.name === name);
          if (!target) return `✗ 未找到分组"${name}"`;
          await deleteGroupDb(target.id);
          return `✓ 已删除分组"${name}"`;
        }
        if (act === "moveBooks") {
          const groupName = params.groupName as string;
          const bookIds = params.bookIds as string[];
          if (!groupName || !bookIds?.length) return "moveBooks 需要 groupName 和 bookIds 参数";
          const groups = await getGroups();
          const targetGroup = groups.find((g) => g.name === groupName);
          if (!targetGroup) return `✗ 未找到分组"${groupName}"，请先用 create-group 创建`;
          let count = 0;
          for (const bookId of bookIds) {
            const book = await getBook(bookId);
            if (!book) continue;
            await updateBook(bookId, { groupId: targetGroup.id });
            count++;
          }
          emitLibraryChanged();
          return `✓ 已将${count}本书移入分组"${groupName}"`;
        }
        return `已知的 manageGroup 操作: ${act}`;
      }
      case "searchBook": {
        const bookId = params.bookId as string;
        const query = params.query as string;
        if (!bookId || !query) return "searchBook 需要 bookId 和 query 参数";
        try {
          const results = await ragSearch({ query, bookId, topK: 8, mode: "hybrid", threshold: 0.3 });
          if (results.length === 0) return `在《${(await getBook(bookId))?.meta.title || bookId}》中未找到与"${query}"相关的内容`;
          const book = await getBook(bookId);
          const title = book?.meta.title || bookId;
          const parts = results.map((r, i) =>
            `[${i + 1}] 第${r.chunk.chapterIndex}章 ${r.chunk.chapterTitle || ""} (相关度: ${Math.round(r.score * 100)}%)\n${r.chunk.content}`
          );
          return `在《${title}》中搜索"${query}"，找到 ${results.length} 条：\n${parts.join("\n\n")}`;
        } catch (err) {
          return `搜索失败: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      case "bookmark": {
        const act = params.action as string;
        if (act === "create") {
          const bookId = params.bookId as string;
          const label = (params.label as string) || "";
          if (!bookId) return "bookmark create 需要 bookId 参数";
          const id = `bm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          await insertBookmark({ id, bookId, cfi: "", label, createdAt: Date.now() });
          emitLibraryChanged();
          return `✓ 已添加书签: ${label || id}`;
        }
        if (act === "delete") {
          const id = params.id as string;
          if (!id) return "bookmark delete 需要 id 参数";
          await deleteBookmark(id);
          emitLibraryChanged();
          return `✓ 已删除书签 ${id}`;
        }
        return `已知的 bookmark 操作: ${act}`;
      }
      case "listData": {
        const type = params.type as string;
        if (type === "bookmarks") {
          const bookId = params.bookId as string;
          if (!bookId) return "list bookmarks 需要 bookId 参数";
          const bookmarks = await getBookmarks(bookId);
          if (bookmarks.length === 0) return "该书暂无书签";
          return `书签列表 (${bookmarks.length}):\n${bookmarks.map((b, i) => `[${i + 1}] ${b.label || "(无标签)"} | cfi: ${b.cfi || "(无)"}`).join("\n")}`;
        }
        if (type === "highlights") {
          const bookId = params.bookId as string;
          if (!bookId) return "list highlights 需要 bookId 参数";
          const highlights = await getAllHighlights();
          const filtered = highlights.filter((h) => h.bookId === bookId).slice(0, 30);
          if (filtered.length === 0) return "该书暂无高亮标注";
          return `高亮标注 (${filtered.length}):\n${filtered.map((h, i) => `[${i + 1}] ${h.text.slice(0, 120)}${h.text.length > 120 ? "…" : ""} | 颜色: ${h.color || "yellow"} | ${h.note ? `笔记: ${h.note.slice(0, 60)}` : ""}`).join("\n")}`;
        }
        if (type === "highlightStats") {
          const stats = await getHighlightStats();
          return `标注统计：总计 ${stats.totalHighlights} 条高亮，${stats.highlightsWithNotes} 条带笔记，涉及 ${stats.totalBooks} 本书，最近 ${stats.recentCount} 条`;
        }
        if (type === "notes") {
          const bookId = params.bookId as string;
          if (!bookId) return "list notes 需要 bookId 参数";
          const notes = await getNotes(bookId);
          if (notes.length === 0) return "该书暂无笔记";
          return `笔记列表 (${notes.length}):\n${notes.slice(0, 20).map((n, i) => `[${i + 1}] ${n.title}: ${n.content.slice(0, 150)}${n.content.length > 150 ? "…" : ""}`).join("\n")}`;
        }
        if (type === "skills") {
          const skills = await getSkills();
          if (skills.length === 0) return "暂无可用技能";
          return `可用技能 (${skills.length}):\n${skills.map((s) => `- ${s.name}: ${s.description || "(无描述)"}`).join("\n")}`;
        }
        if (type === "threads") {
          const bookId = params.bookId as string;
          if (!bookId) return "list threads 需要 bookId 参数";
          const threads = await getThreads(bookId);
          if (threads.length === 0) return "该书暂无对话";
          return `对话列表 (${threads.length}):\n${threads.map((t, i) => `[${i + 1}] ${t.title || "无标题"} | ${t.messages?.length || 0} 条消息 | ${new Date(t.createdAt).toLocaleDateString("zh-CN")}`).join("\n")}`;
        }
        return `已知的 listData 类型: ${type}`;
      }
      case "note": {
        const act = params.action as string;
        if (act === "create") {
          const bookId = params.bookId as string;
          const title = (params.title as string) || "";
          const content = (params.content as string) || "";
          if (!bookId) return "note create 需要 bookId 参数";
          const id = `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          await insertNote({ id, bookId, title, content, tags: [], createdAt: Date.now(), updatedAt: Date.now() });
          emitLibraryChanged();
          return `✓ 已创建笔记: ${title}`;
        }
        return `已知的 note 操作: ${act}`;
      }
      default:
        return `已知操作类型: ${action}`;
    }
  } catch (err) {
    return `操作执行失败: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** 批量执行 ReadAny 操作 */
export async function executeReadAnyOpsDetailed(
  ops: ReadAnyOp[],
  currentBook: Book | null = null,
): Promise<Array<{ op: ReadAnyOp; result: string }>> {
  const results: Array<{ op: ReadAnyOp; result: string }> = [];
  for (const rawOp of ops) {
    const op = await resolveReadAnyOpBookReferences(rawOp, currentBook);
    const result = await executeSingleReadAnyOp(op);
    results.push({ op, result });
  }
  return results;
}

export async function executeReadAnyOps(
  ops: ReadAnyOp[],
  currentBook: Book | null = null,
): Promise<string[]> {
  const detailed = await executeReadAnyOpsDetailed(ops, currentBook);
  return detailed.map(({ op, result }) => `[${op.action}] ${result}`);
}

/** 自动分类引擎：根据书籍元数据自动生成标签和分组 */
export async function autoClassifyAndTag(): Promise<{ createdTags: string[]; tagResults: string[] }> {
  const books = await getBooks();
  const existingTags = (await loadFromFS<string[]>("library-tags")) || [];
  const existingGroups = await getGroups();
  const allTags = new Set(existingTags.map((t) => t.toLowerCase()));

  // 关键词到标签的映射（优先复用已有标签）
  const keywordTagMap: Record<string, string> = {
    fiction: "小说", novel: "小说", "小说": "小说", "文学": "文学", literature: "文学",
    science: "科学", fiction_sci: "科幻", scifi: "科幻", "科幻": "科幻",
    philosophy: "哲学", "哲学": "哲学", thought: "哲学",
    economics: "经济学", economy: "经济学", "经济学": "经济学", "经济": "经济学",
    history: "历史", "历史": "历史", "史学": "历史",
    politics: "政治", political: "政治", "政治": "政治",
    psychology: "心理学", "心理": "心理学", "心理学": "心理学",
    sociology: "社会学", "社会": "社会学",
    biography: "传记", "传记": "传记", memoir: "传记",
    poetry: "诗歌", "诗歌": "诗歌", poem: "诗歌",
    essay: "散文", "散文": "散文", "随笔": "散文",
    japan: "日本文学", japanese: "日本文学", "日本": "日本文学",
    china: "中国文学", chinese: "中国文学", "中国": "中国文学",
    french: "法国文学", france: "法国文学", "法国": "法国文学",
    english: "英国文学", british: "英国文学", "英国": "英国文学",
    american: "美国文学", america: "美国文学", "美国": "美国文学",
    german: "德国文学", germany: "德国文学", "德国": "德国文学",
    russian: "俄罗斯文学", russia: "俄罗斯文学", "俄罗斯": "俄罗斯文学",
    technology: "技术", tech: "技术", "技术": "技术", "科技": "技术",
    religion: "宗教", "宗教": "宗教",
    art: "艺术", "艺术": "艺术", "美术": "艺术",
    music: "音乐", "音乐": "音乐",
    law: "法律", legal: "法律", "法律": "法律",
    medicine: "医学", medical: "医学", "医学": "医学",
    business: "商业", "商业": "商业", management: "管理",
    education: "教育", "教育": "教育",
    travel: "旅行", "旅行": "旅行", "游记": "旅行",
    cooking: "美食", food: "美食", "美食": "美食", "烹饪": "美食",
    comics: "漫画", manga: "漫画", "漫画": "漫画",
    mystery: "推理", detective: "推理", "推理": "推理", "悬疑": "推理",
    romance: "爱情", love: "爱情", "爱情": "爱情",
    fantasy: "奇幻", "奇幻": "奇幻", "魔幻": "奇幻",
    horror: "恐怖", "恐怖": "恐怖", thriller: "恐怖",
    classic: "经典", classical: "经典",
  };

  function classifyBook(book: Awaited<ReturnType<typeof getBooks>>[number]): string[] {
    const candidates = new Map<string, number>(); // tag → score
    const text = [
      book.meta.title || "",
      book.meta.author || "",
      book.meta.description || "",
      (book.meta.subjects || []).join(" "),
      book.meta.language || "",
    ].join(" ").toLowerCase();

    for (const [keyword, tag] of Object.entries(keywordTagMap)) {
      if (text.includes(keyword.toLowerCase())) {
        candidates.set(tag, (candidates.get(tag) || 0) + 1);
      }
    }

    // 按得分排序，取 top 2
    return Array.from(candidates.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([tag]) => tag);
  }

  // 标签到分组的映射（最优先匹配的标签决定所属分组）
  const tagToGroup: Record<string, string> = {
    "日语学习": "日语学习", "N1": "日语学习", "N2": "日语学习", "N3": "日语学习",
    "哲学": "哲学", "精神分析": "哲学",
    "文学": "文学", "小说": "文学", "日本文学": "文学", "中国文学": "文学", "推理悬疑": "文学", "推理": "文学", "悬疑": "文学",
    "政治历史": "政治历史", "政治": "政治历史", "历史": "政治历史", "毛泽东": "政治历史",
    "科普": "科普", "科学": "科普",
    "数学": "数学",
    "经济学": "经济学", "经济": "经济学",
    "心理学": "心理学",
    "技术": "技术",
    "艺术": "艺术",
  };

  function inferGroupFromTags(tags: string[]): string | null {
    for (const t of tags) {
      const group = tagToGroup[t];
      if (group) return group;
    }
    return null;
  }

  // 收集需要创建的新标签和新分组
  const newTags: string[] = [];
  const assignments: Array<{ bookId: string; tags: string[] }> = [];
  const groupMoves: Array<{ bookId: string; groupName: string }> = [];
  const groupNames = new Set(existingGroups.map((g) => g.name));

  for (const book of books) {
    const existingForBook = book.tags || [];
    const hasGroup = existingGroups.some((g) => g.id === book.groupId);

    const suggested = classifyBook(book);
    const needed = suggested.filter((t) => !existingForBook.includes(t)).slice(0, 2 - existingForBook.length);

    if (needed.length > 0) {
      assignments.push({ bookId: book.id, tags: needed });
      for (const t of needed) {
        if (!allTags.has(t.toLowerCase()) && !newTags.includes(t)) {
          newTags.push(t);
        }
      }
    }

    // 推断分组
    const allTagsForBook = [...existingForBook, ...needed];
    const inferredGroup = inferGroupFromTags(allTagsForBook);
    if (inferredGroup && !hasGroup) {
      groupMoves.push({ bookId: book.id, groupName: inferredGroup });
    }
  }

  const results: string[] = [];

  // 先创建缺失的分组
  if (groupMoves.length > 0) {
    for (const gm of groupMoves) {
      if (!groupNames.has(gm.groupName)) {
        await insertGroup({ name: gm.groupName });
        groupNames.add(gm.groupName);
        results.push(`✓ 已创建分组: ${gm.groupName}`);
      }
    }
  }

  // 再创建新标签
  if (newTags.length > 0) {
    const allExisting = await loadFromFS<string[]>("library-tags") || [];
    const updated = [...new Set([...allExisting, ...newTags])].sort();
    debouncedSave("library-tags", updated);
    results.push(`✓ 已创建标签: ${newTags.join(", ")}`);
  }

  // 执行标签分配
  for (const { bookId, tags } of assignments) {
    const book = await getBook(bookId);
    if (!book) continue;
    const merged = [...new Set([...(book.tags || []), ...tags])];
    await updateBook(bookId, { tags: merged });
    results.push(`✓ 《${book.meta.title}》→ 标签 ${merged.join(", ")}`);
  }

  // 执行移动分组
  for (const { bookId, groupName } of groupMoves) {
    const group = existingGroups.find((g) => g.name === groupName) ||
      (await getGroups()).find((g) => g.name === groupName);
    if (!group) continue;
    await updateBook(bookId, { groupId: group.id });
  }
  if (groupMoves.length > 0) {
    results.push(`✓ 已将${groupMoves.length}本书移入对应分组`);
  }

  if (assignments.length > 0 || groupMoves.length > 0) emitLibraryChanged();

  return {
    createdTags: newTags,
    tagResults: results,
  };
}

export function buildContextToolEvents(options: {
  requestedFullChapter: boolean;
  chapterContext: ChapterContext | null;
  bookMemory: BookMemory | null;
}): AgentStreamEvent[] {
  const events: AgentStreamEvent[] = [];

  if (options.bookMemory) {
    events.push({
      type: "tool_call",
      name: "readBookMemory",
      args: { bookId: options.bookMemory.bookId },
    });
    events.push({
      type: "tool_result",
      name: "readBookMemory",
      result: {
        summary: options.bookMemory.summary || "",
        focus: options.bookMemory.focus,
        openQuestions: options.bookMemory.openQuestions,
        recentQuestions: options.bookMemory.recentQuestions.slice(-5),
        totalMessages: options.bookMemory.totalMessages,
        lastChapterTitle: options.bookMemory.lastChapterTitle,
        lastChapterIndex: options.bookMemory.lastChapterIndex,
      },
    });
  }

  if (options.requestedFullChapter && options.chapterContext) {
    events.push({
      type: "tool_call",
      name: "getCurrentChapter",
      args: {
        chapterIndex: options.chapterContext.chapterIndex,
        requestedFullChapter: true,
      },
    });
    events.push({
      type: "tool_result",
      name: "getCurrentChapter",
      result: {
        chapterTitle: options.chapterContext.chapterTitle,
        chapterIndex: options.chapterContext.chapterIndex,
        source: options.chapterContext.source,
        totalTokens: options.chapterContext.totalTokens,
        characterCount: options.chapterContext.content.length,
        segmentCount: options.chapterContext.chunks.length,
      },
    });
  }

  return events;
}

function compareChunkOrder(a: { id: string }, b: { id: string }): number {
  return getChunkIndexFromId(a.id) - getChunkIndexFromId(b.id) || a.id.localeCompare(b.id);
}

function getChunkIndexFromId(id: string): number {
  const match = id.match(/-(\d+)$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function joinChunkContent(parts: string[]): string {
  let result = "";
  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) continue;
    if (!result) {
      result = part;
      continue;
    }
    result = appendWithoutOverlap(result, part);
  }
  return result;
}

function appendWithoutOverlap(existing: string, next: string): string {
  const maxOverlap = Math.min(existing.length, next.length, 4000);
  for (let length = maxOverlap; length >= 80; length--) {
    if (existing.endsWith(next.slice(0, length))) {
      return `${existing}${next.slice(length)}`;
    }
  }
  return `${existing}\n\n${next}`;
}

export function buildReadAnyToolContinuationPrompt(options: {
  basePrompt: string;
  previousResponse: string;
  results: Array<{ op: ReadAnyOp; result: string }>;
}): string {
  const toolResults = options.results
    .map(
      ({ op, result }, index) =>
        `## ReadAny tool ${index + 1}: ${op.action}\nArguments: ${JSON.stringify(op.params)}\nResult:\n${result}`,
    )
    .join("\n\n");

  return [
    options.basePrompt,
    "",
    "# ReadAny tool continuation",
    "You requested ReadAny library tools in the previous assistant turn. They have now executed.",
    "Continue the same task using the results below. Do not stop after announcing a search or tool call.",
    "Answer the user's original question directly. If more ReadAny tools are truly necessary, output another readany-ops block at the end.",
    "",
    "## Previous assistant turn",
    options.previousResponse,
    "",
    "# ReadAny tool results",
    toolResults,
  ].join("\n");
}

export async function* streamClaudeCodeAgent(
  options: {
    thread: Thread;
    book: Book | null;
    semanticContext: SemanticContext | null;
    isVectorized: boolean;
    deepThinking?: boolean;
    spoilerFree?: boolean;
    signal?: AbortSignal;
  },
  userInput: string,
  history: ProcessedMessage[] = [],
): AsyncGenerator<AgentStreamEvent> {
  const platform = getPlatformService();
  if (!platform.runClaudeCodeChat) {
    yield {
      type: "error",
      error: "Claude Code local mode is only available in the ReadAny desktop app.",
    };
    return;
  }

  const readingContext = getReadingContextSnapshot();
  const selectionQuotes = getSelectionQuotes(readingContext);
  const requestedFullChapter = shouldAttachFullChapter(userInput, selectionQuotes);
  const chapterContext = await loadChapterContext({
    book: options.book,
    userInput,
    spoilerFree: options.spoilerFree,
    requestedFullChapter,
  });
  const bookMemory = await loadBookMemory(options.book);
  const preExecutedContext = await preExecuteReadAnyTools({
    userInput,
    book: options.book,
  });
  for (const event of buildContextToolEvents({
    requestedFullChapter,
    chapterContext,
    bookMemory,
  })) {
    yield event;
  }

  const systemPrompt = buildClaudeCodeSystemPrompt({
    book: options.book,
    userLanguage: i18n.language || options.book?.meta.language || "zh-CN",
    spoilerFree: options.spoilerFree,
  });
  const prompt = buildClaudeCodeUserPrompt({
    userInput,
    history,
    book: options.book,
    readingContext,
    semanticContext: options.semanticContext,
    chapterContext,
    bookMemory,
    preExecutedContext,
    spoilerFree: options.spoilerFree,
  });

  const pendingErrors: string[] = [];
  const executedOpKeys = new Set<string>();
  let executedReadAnyOps = 0;
  let nextPrompt = prompt;
  const maxReadAnyRounds = 3;

  for (let round = 0; round < maxReadAnyRounds && !options.signal?.aborted; round++) {
    const parser = createClaudeCodeStreamParser();
    const queue: AgentStreamEvent[] = [];
    let wake: (() => void) | null = null;
    let done = false;
    let roundResponseText = "";

    const notify = () => {
      wake?.();
      wake = null;
    };

    const push = (events: AgentStreamEvent[]) => {
      for (const event of events) {
        if (event.type === "token") roundResponseText += event.content;
      }
      queue.push(...events);
      notify();
    };

    const runPromise = platform
      .runClaudeCodeChat(
        {
          requestId: `cc-${Date.now()}-${round}-${Math.random().toString(36).slice(2, 8)}`,
          prompt: nextPrompt,
          systemPrompt,
          effort: options.deepThinking ? "max" : "medium",
          tools: ["WebSearch", "WebFetch"],
        },
        {
          signal: options.signal,
          onStdoutLine: (line) => push(parser.parseLine(line)),
          onStderr: (_content) => {
            // Claude Code can write diagnostics to stderr while continuing normally.
          },
        },
      )
      .catch((error) => {
        pendingErrors.push(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        done = true;
        notify();
      });

    while (!done || queue.length > 0) {
      while (queue.length > 0) {
        const event = queue.shift();
        if (event) yield event;
      }
      if (done) break;
      await Promise.race([
        runPromise,
        new Promise<void>((resolve) => {
          wake = resolve;
        }),
      ]);
    }

    if (options.signal?.aborted || pendingErrors.length > 0) break;

    const newOps = parseReadAnyOps(roundResponseText).filter((op) => {
      const key = JSON.stringify(op);
      if (executedOpKeys.has(key)) return false;
      executedOpKeys.add(key);
      return true;
    });
    if (newOps.length === 0) break;

    const results: Array<{ op: ReadAnyOp; result: string }> = [];
    for (const op of newOps) {
      yield { type: "tool_call", name: op.action, args: op.params };
      const [result] = await executeReadAnyOpsDetailed([op], options.book);
      results.push(result);
      yield { type: "tool_result", name: result.op.action, result: result.result };
    }
    executedReadAnyOps += results.length;

    if (round + 1 >= maxReadAnyRounds) break;

    yield {
      type: "reasoning",
      content: "ReadAny tools completed. Continuing with the tool results.",
      stepType: "analyzing",
    };
    nextPrompt = buildReadAnyToolContinuationPrompt({
      basePrompt: prompt,
      previousResponse: roundResponseText,
      results,
    });
  }

  // 自动分类引擎：如果用户要求整理书库但模型没有输出操作指令，自动执行
  if (
    executedReadAnyOps === 0 &&
    preExecutedContext.intent === "library_organize" &&
    !options.signal?.aborted
  ) {
    yield { type: "token", content: "\n\n" };
    const autoResult = await autoClassifyAndTag();
    for (const r of autoResult.tagResults) {
      yield { type: "token", content: `📋 ${r}\n` };
    }
  }

  const finalError = pendingErrors[0];
  if (finalError && !options.signal?.aborted) {
    yield { type: "error", error: finalError };
  }
}

async function loadChapterContext(options: {
  book: Book | null;
  userInput: string;
  spoilerFree?: boolean;
  requestedFullChapter?: boolean;
}): Promise<ChapterContext | null> {
  if (!options.book || options.spoilerFree) return null;

  const readingContext = getReadingContextSnapshot();
  const chapterIndex = readingContext?.currentChapter.index;
  const chapterTitle = readingContext?.currentChapter.title;
  const quotes = getSelectionQuotes(readingContext);

  // 如果没有显式请求且输入不涉及章节分析，跳过加载
  if (!(options.requestedFullChapter ?? shouldAttachFullChapter(options.userInput, quotes))) {
    return null;
  }

  // 尝试加载指定章节
  const tryLoadChapter = async (idx: number): Promise<ChapterContext | null> => {
    if (idx < 0) return null;
    try {
      const chunks = await getChunks(options.book!.id);
      const context = buildChapterContextFromChunks(chunks, idx);
      if (context) return context;
    } catch {
      // 继续尝试文件提取
    }

    try {
      const platform = getPlatformService();
      const extractedChapter = await platform.extractBookChapter?.(options.book!.filePath, idx);
      return extractedChapter ? buildChapterContextFromExtractedChapter(extractedChapter) : null;
    } catch {
      return null;
    }
  };

  // 优先用 chapterIndex
  if (chapterIndex !== undefined && chapterIndex >= 0) {
    const result = await tryLoadChapter(chapterIndex);
    if (result) return result;
  }

  // 回退 1：如果有章节标题，尝试在所有 chunks 中按标题匹配
  if (chapterTitle && chapterTitle !== "Unknown") {
    try {
      const chunks = await getChunks(options.book.id);
      const titleMatch = chunks.find(
        (c) =>
          c.chapterTitle === chapterTitle ||
          c.chapterTitle.toLowerCase().includes(chapterTitle.toLowerCase()) ||
          chapterTitle.toLowerCase().includes(c.chapterTitle.toLowerCase()),
      );
      if (titleMatch) {
        const context = buildChapterContextFromChunks(chunks, titleMatch.chapterIndex);
        if (context) return context;
      }
    } catch {
      // 继续
    }
  }

  // 回退 2：作为最后手段，尝试加载第一章
  if (chapterIndex === undefined || chapterIndex < 0) {
    const firstChapter = await tryLoadChapter(0);
    if (firstChapter) return firstChapter;
  }

  return null;
}

async function loadBookMemory(book: Book | null): Promise<BookMemory | null> {
  if (!book) return null;
  try {
    return await getBookMemory(book.id);
  } catch {
    return null;
  }
}

function getSelectionQuotes(
  readingContext: ReturnType<typeof getReadingContextSnapshot>,
): AttachedQuote[] {
  return readingContext?.selection
    ? [
        {
          id: "selection",
          text: readingContext.selection.text,
          source: readingContext.selection.chapterTitle,
        },
      ]
    : [];
}

function buildClaudeCodeSystemPrompt(options: {
  book: Book | null;
  userLanguage: string;
  spoilerFree?: boolean;
}): string {
  const language = options.userLanguage || "zh-CN";
  const bookInfo = options.book
    ? `当前书籍: 《${options.book.meta.title || "未知"}》${options.book.meta.author ? `，作者 ${options.book.meta.author}` : ""}`
    : "当前没有打开书籍。";

  return [
    "# 角色",
    `你是 ReadAny 的 AI 阅读助手，运行在 Claude Code + DeepSeek 后端上。你的职责是帮助用户理解书籍内容、管理书库、分析阅读数据。${options.book ? "用户当前正在阅读一本书，书籍信息已注入到本轮对话的上下文中。" : ""}`,
    "",
    "# 你的能力",
    "你有四类能力：",
    "1. **分析能力**：基于注入的书籍内容进行分析、总结、解释",
    "2. **网络搜索**：使用 WebSearch / WebFetch 查外部资料",
    "3. **书库操作**：通过输出操作指令码来执行书库操作（见下方指令集）",
    "",
    "# 操作指令格式",
    "在回复末尾输出 ```readany-ops 代码块，每行一条指令。系统自动解析并执行，不征求确认。",
    "",
    "## 书库整理",
    "| 指令 | 说明 |",
    "|------|------|",
    "| `create-group: 名` | 创建新分组 |",
    "| `rename-group: 旧名=新名` | 重命名分组 |",
    "| `delete-group: 名` | 删除分组 |",
    "| `move-to-group: 分组名=bookId1, bookId2` | 书籍移入分组 |",
    "| `create-tag: 名` | 创建全局标签 |",
    "| `rename-tag: 旧名=新名` | 重命名标签 |",
    "| `set-book-tags: bookId=标签1, 标签2` | 替换某书标签（每书≤2个） |",
    "",
    "## 搜索与查询",
    "| 指令 | 说明 |",
    "|------|------|",
    "| `search-book: bookId=关键词` | RAG语义搜索（需已向量化） |",
    "| `list-highlights: bookId` | 列出某书高亮标注 |",
    "| `highlight-stats` | 全局标注统计 |",
    "| `list-notes: bookId` | 列出某书笔记 |",
    "| `list-bookmarks: bookId` | 列出某书书签 |",
    "| `list-threads: bookId` | 列出某书对话记录 |",
    "",
    "## 编辑与操作",
    "| 指令 | 说明 |",
    "|------|------|",
    "| `add-bookmark: bookId=标题` | 添加书签 |",
    "| `remove-bookmark: bookmarkId` | 删除书签 |",
    "| `add-note: bookId=标题\|内容` | 添加笔记（\|分隔标题和内容） |",
    "| `list-skills` | 列出可用技能 |",
    "",
    "## 规则",
    "- 整理书库时优先用分组归类，标签做细分",
    "- 分析回复+操作指令放在同一条消息中，指令块放末尾",
    "- user要搜书内内容时用 search-book，并且必须使用 Current book 中提供的 Book ID，不要使用书名代替 ID",
    "- 用户没说要保留但含义相近的旧分组，用 rename-group 而非 create-group",
    "- 用户要求整理书库又没指定维度时，按主题/学科分类",
    "",
    `- 回复语言：${language}`,
    "- 书籍内容基于注入文本，不编造",
    options.spoilerFree
      ? "- **防剧透模式已开启**：不使用当前阅读位置之后的内容"
      : "",
    bookInfo,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildClaudeCodeUserPrompt(options: {
  userInput: string;
  history: ProcessedMessage[];
  book: Book | null;
  readingContext: ReturnType<typeof getReadingContextSnapshot>;
  semanticContext: SemanticContext | null;
  chapterContext: ChapterContext | null;
  bookMemory: BookMemory | null;
  preExecutedContext?: PreExecutedContext;
  spoilerFree?: boolean;
}): string {
  const sections: string[] = [];
  const selectionQuotes = getSelectionQuotes(options.readingContext);
  const requestedFullChapter = shouldAttachFullChapter(options.userInput, selectionQuotes);
  const preExec = options.preExecutedContext;

  if (options.history.length > 0) {
    sections.push(
      [
        "# Recent conversation",
        ...options.history.slice(-8).map((message) => {
          const role = message.role === "user" ? "User" : "Assistant";
          return `## ${role}\n${message.content}`;
        }),
      ].join("\n\n"),
    );
  }

  if (options.book) {
    const vectorizedStatus = options.book.isVectorized
      ? "已向量化 — 支持语义搜索、摘要、实体提取等全部内容分析功能"
      : "未向量化 — 内容分析功能受限。建议用户在 ReadAny 中对此书进行向量化以解锁 RAG 搜索、摘要、实体提取等功能";
    sections.push(
      [
        "# Current book",
        `Book ID: ${options.book.id}`,
        `Title: ${options.book.meta.title || "Unknown"}`,
        options.book.meta.author ? `Author: ${options.book.meta.author}` : "",
        `Progress: ${Math.round((options.book.progress || 0) * 100)}%`,
        `Vectorization: ${vectorizedStatus}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  const bookMemory = renderBookMemoryForPrompt(options.bookMemory);
  if (bookMemory) {
    sections.push(bookMemory);
  }

  if (options.readingContext) {
    const context = options.readingContext;
    sections.push(
      [
        "# Current reading position",
        `Chapter: ${context.currentChapter.title || "Unknown"} (index ${context.currentChapter.index})`,
        `Progress: ${Math.round((context.currentPosition.percentage || 0) * 100)}%`,
        context.surroundingText ? `Visible text:\n${context.surroundingText}` : "",
        context.selection
          ? `Selected text (user focus):\n${context.selection.text}\nSource: ${
              context.selection.chapterTitle || context.currentChapter.title
            }`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  } else if (options.semanticContext?.surroundingText) {
    sections.push(`# Current visible text\n${options.semanticContext.surroundingText}`);
  }

  if (options.chapterContext) {
    sections.push(
      [
        "# Full current chapter",
        `Chapter: ${options.chapterContext.chapterTitle} (index ${options.chapterContext.chapterIndex}, about ${options.chapterContext.totalTokens} tokens)`,
        options.chapterContext.source === "chunks"
          ? "The following text was reconstructed from the local chunks table. For chapter summaries or chapter analysis, base the answer primarily on this text:"
          : "The following text was extracted directly from the local book file because no chunks are available. For chapter summaries or chapter analysis, base the answer primarily on this text:",
        options.chapterContext.content,
      ].join("\n\n"),
    );
  } else if (requestedFullChapter && options.book) {
    sections.push(
      [
        "# Full chapter context status",
        options.spoilerFree
          ? "Spoiler-free mode is enabled, so the full chapter was not injected. Use only visible text, selected text, and the current reading position."
          : "No full-chapter chunks are available for this request. If the user asked for a full chapter summary, state that the answer is limited to visible or selected text.",
      ].join("\n"),
    );
  }

  // 注入预执行的书库数据
  if (preExec) {
    const preParts: string[] = [];
    if (preExec.librarySummary) {
      preParts.push(`## 书库数据\n${preExec.librarySummary}`);
    }
    if (preExec.statsSummary) {
      preParts.push(`## 阅读统计\n${preExec.statsSummary}`);
    }
    if (preExec.notesSummary) {
      preParts.push(`## 标注与笔记\n${preExec.notesSummary}`);
    }
    if (preExec.classifyData) {
      preParts.push(`## 书籍分类数据\n${preExec.classifyData}`);
    }
    if (preExec.searchResult) {
      preParts.push(`## 搜索结果\n${preExec.searchResult}`);
    }
    if (preExec.listResult) {
      preParts.push(`## 查询结果\n${preExec.listResult}`);
    }
    if (preParts.length > 0) {
      sections.push(`# ReadAny Pre-executed Context\n\n${preParts.join("\n\n")}`);
    }
  }

  sections.push(
    `# User question\n${options.userInput || "Please analyze the selected text and reading context above."}`,
  );

  return sections.join("\n\n---\n\n");
}
