/**
 * Dynamic System Prompt assembly — 6-section structure
 * 1. Role & persona
 * 2. Book context (metadata, current position)
 * 3. Semantic reading context (SRC)
 * 4. Available tools description (context + RAG + analysis)
 * 5. Core workflow & strict tool-use rules
 * 6. Response constraints
 */
import type { Book, SemanticContext, Skill } from "../types";
import { getBookProgressPercent } from "../utils/book-progress";

type ReadingQuestionCategory =
  | "general_chat"
  | "library_request"
  | "current_selection"
  | "current_page_context"
  | "current_chapter_context"
  | "specific_chapter_request"
  | "book_wide_search";

interface PromptContext {
  book: Book | null;
  bookId?: string | null;
  semanticContext: SemanticContext | null;
  enabledSkills: Skill[];
  isVectorized: boolean;
  userLanguage: string;
  spoilerFree?: boolean;
  memorySummary?: string;
  questionCategory?: ReadingQuestionCategory;
  selectionActive?: boolean;
  routeHint?: string;
  allowedToolNames?: string[];
}

/** Build the full system prompt from context */
export function buildSystemPrompt(ctx: PromptContext): string {
  const sections: string[] = [
    buildRoleSection(),
    buildBookContextSection(ctx.book),
    buildMemorySection(ctx.memorySummary),
    buildSemanticSection(ctx.semanticContext),
    buildRouteSection(ctx.questionCategory, ctx.selectionActive, ctx.routeHint),
    buildTurnAvailableToolsSection(ctx.allowedToolNames),
    buildToolsSection(
      ctx.enabledSkills,
      ctx.isVectorized,
      !!(ctx.book?.id || ctx.bookId),
      ctx.allowedToolNames,
    ),
    buildWorkflowSection(ctx.isVectorized, !!(ctx.book?.id || ctx.bookId)),
    buildConstraintsSection(
      ctx.userLanguage,
      ctx.isVectorized,
      ctx.spoilerFree,
      ctx.book,
      ctx.semanticContext,
    ),
  ];

  return sections.filter(Boolean).join("\n\n---\n\n");
}

function buildMemorySection(memorySummary?: string): string {
  if (!memorySummary?.trim()) return "";
  return ["## Conversation Memory", memorySummary.trim()].join("\n");
}

function buildRoleSection(): string {
  return `You are ReadAny AI, an intelligent reading assistant. You help users understand, analyze, and engage with the books they are reading. You provide thoughtful insights, answer questions about the content, and help with annotations and note-taking.

**CRITICAL: You do NOT have access to the book's content in your training data. You MUST use the provided tools to retrieve book content before answering any content-related questions. NEVER fabricate, guess, or rely on your own knowledge about the book. If you cannot retrieve the content, tell the user honestly.**`;
}

function buildBookContextSection(book: Book | null): string {
  if (!book) return "";
  return [
    "## Current Book",
    `- Title: ${book.meta.title}`,
    `- Author: ${book.meta.author}`,
    book.meta.language ? `- Language: ${book.meta.language}` : "",
    `- Reading Progress: ${getBookProgressPercent(book.progress)}%`,
  ]
    .filter(Boolean)
    .join("\n");
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function buildSemanticSection(ctx: SemanticContext | null): string {
  if (!ctx) return "";
  return [
    "## Reading Context",
    `- Current Chapter: ${ctx.currentChapter}`,
    `- Reader Activity: ${ctx.operationType}`,
    ctx.surroundingText ? `- Surrounding Text:\n> ${compactText(ctx.surroundingText, 280)}` : "",
    ctx.recentHighlights.length > 0
      ? `- Recent Highlights:\n${ctx.recentHighlights
          .slice(0, 3)
          .map((h) => `  > ${compactText(h, 120)}`)
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildRouteSection(
  category?: ReadingQuestionCategory,
  selectionActive?: boolean,
  routeHint?: string,
): string {
  if (!category && !selectionActive && !routeHint) return "";

  return [
    "## Turn Focus",
    category ? `- Detected Question Type: ${category}` : "",
    selectionActive ? "- Active Text Selection: yes" : "",
    routeHint ? `- Routing Hint: ${routeHint}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildTurnAvailableToolsSection(allowedToolNames?: string[]): string {
  if (!allowedToolNames) return "";
  if (allowedToolNames.length === 0) {
    return "## Turn-Available Tools\n- No tools are available for this turn. Respond directly without tool calls.";
  }

  return [
    "## Turn-Available Tools",
    "- Only the tools listed here are actually callable in this turn. Do not plan with any other tools.",
    ...allowedToolNames.map((name) => `- ${name}`),
  ].join("\n");
}

function buildToolsSection(
  skills: Skill[],
  isVectorized: boolean,
  hasBookContext: boolean,
  allowedToolNames?: string[],
): string {
  const tools: string[] = [];
  const allowed = allowedToolNames ? new Set(allowedToolNames) : null;
  const canUse = (name: string) => !allowed || allowed.has(name);
  const pushTool = (name: string, description: string) => {
    if (canUse(name)) tools.push(description);
  };

  // General tools (always available)
  const generalStartIndex = tools.length;
  pushTool(
    "listBooks",
    "- **listBooks**: List books in the library with search/status filters (params: reasoning, search, status, limit)",
  );
  pushTool(
    "searchAllHighlights",
    "- **searchAllHighlights**: Get highlights across all books (params: reasoning, days, limit)",
  );
  pushTool(
    "searchAllNotes",
    "- **searchAllNotes**: Get notes across all books (params: reasoning, days, bookTitle, limit)",
  );
  pushTool(
    "getReadingStats",
    "- **getReadingStats**: Get reading statistics (params: reasoning, days)",
  );
  pushTool(
    "getSkills",
    "- **getSkills**: Query available skills/SOPs for guidance (params: reasoning, task)",
  );
  pushTool(
    "mindmap",
    "- **mindmap**: Generate an interactive mindmap visualization (params: reasoning, title, markdown)",
  );
  pushTool(
    "updateBookMetadata",
    "- **updateBookMetadata**: Edit a book's library metadata when the user explicitly asks to modify it (params: reasoning, bookId, updates JSON)",
  );
  pushTool(
    "manageBookGroups",
    "- **manageBookGroups**: List/create/rename/delete groups or move books between groups (params: reasoning, action, groupId, name, bookIds)",
  );
  if (tools.length > generalStartIndex) {
    tools.splice(generalStartIndex, 0, "### General Tools");
  }

  if (hasBookContext) {
    const contextStartIndex = tools.length;
    pushTool(
      "getCurrentChapter",
      "- **getCurrentChapter**: Get current chapter title, index, and reading position",
    );
    pushTool("getSelection", "- **getSelection**: Get the text the user has currently selected");
    pushTool(
      "getReadingProgress",
      "- **getReadingProgress**: Get overall reading progress, current page and chapter",
    );
    pushTool(
      "getRecentHighlights",
      "- **getRecentHighlights**: Get user's recent highlights and annotations (params: limit)",
    );
    pushTool(
      "getSurroundingContext",
      "- **getSurroundingContext**: Get the text visible on the current page (params: includeSelection)",
    );
    if (tools.length > contextStartIndex) {
      tools.splice(contextStartIndex, 0, "", "### Reading Context Tools");
    }
  }

  // RAG tools (require vectorization)
  if (hasBookContext && isVectorized) {
    const retrievalStartIndex = tools.length;
    pushTool(
      "resolveChapterReference",
      "- **resolveChapterReference**: Resolve user-mentioned chapter numbers or fuzzy chapter titles to internal chapterIndex (params: query, maxCandidates)",
    );
    pushTool(
      "ragSearch",
      "- **ragSearch**: Semantic/keyword search across book content (params: query, mode, topK)",
    );
    pushTool(
      "ragToc",
      "- **ragToc**: Get a compact, paginated chapter list (params: query, aroundChapter, offset, limit)",
    );
    pushTool(
      "ragContext",
      "- **ragContext**: Get content around a specific chapter position (params: chapterIndex, range)",
    );
    if (tools.length > retrievalStartIndex) {
      tools.splice(retrievalStartIndex, 0, "", "### Content Retrieval Tools (RAG)");
    }

    const analysisStartIndex = tools.length;
    pushTool(
      "summarize",
      "- **summarize**: Generate summary of a chapter or entire book (params: scope, chapterIndex, style)",
    );
    pushTool(
      "extractEntities",
      "- **extractEntities**: Extract characters, places, concepts from text (params: entityType, chapterIndex)",
    );
    pushTool(
      "analyzeArguments",
      "- **analyzeArguments**: Analyze author's arguments and reasoning (params: chapterIndex, focusType)",
    );
    pushTool(
      "findQuotes",
      "- **findQuotes**: Find notable quotes and passages (params: quoteType, chapterIndex, maxQuotes)",
    );
    pushTool(
      "compareSections",
      "- **compareSections**: Compare two chapters (params: chapterIndex1, chapterIndex2, compareType)",
    );
    if (tools.length > analysisStartIndex) {
      tools.splice(analysisStartIndex, 0, "", "### Content Analysis Tools");
    }
  } else if (hasBookContext) {
    const fallbackStartIndex = tools.length;
    pushTool(
      "resolveChapterReference",
      "- **resolveChapterReference**: Resolve user-mentioned chapter numbers or fuzzy chapter titles to internal chapterIndex (params: query, maxCandidates)",
    );
    pushTool(
      "fallbackToc",
      "- **fallbackToc**: Read a compact, paginated chapter list from the original file (params: query, aroundChapter, offset, limit, includePreview)",
    );
    pushTool(
      "fallbackSearch",
      "- **fallbackSearch**: Keyword-scan the original file when the book is not vectorized (params: query, topK)",
    );
    pushTool(
      "fallbackChapterContext",
      "- **fallbackChapterContext**: Read a specific chapter from the original file (params: chapterIndex)",
    );
    if (tools.length > fallbackStartIndex) {
      tools.splice(fallbackStartIndex, 0, "", "### Fallback Content Tools (no vector index)");
    }
  }

  if (hasBookContext) {
    pushTool(
      "getAnnotations",
      "- **getAnnotations**: Get user's highlights and notes (params: type)",
    );
    if (isVectorized && canUse("addCitation")) {
      pushTool(
        "addCitation",
        "- **addCitation**: CRITICAL - Register a citation with CFI for precise navigation. You MUST extract the 'cfi' field from ragSearch/tool results and pass it here. The citationIndex param determines which [N] marker it maps to (params: citationIndex [REQUIRED - the number N for [N]], chapterTitle, chapterIndex, cfi [REQUIRED from tool results], quotedText, reasoning)",
      );
    } else if (canUse("addCitation")) {
      pushTool(
        "addCitation",
        "- **addCitation**: Register a citation only when fallbackSearch/fallbackChapterContext returns a non-empty segment-level cfi for the exact text you cite. If no cfi is present, cite chapter titles/indices in plain text instead.",
      );
    }
  }

  // Custom skills
  if (skills.length > 0) {
    const skillStartIndex = tools.length;
    for (const skill of skills) {
      pushTool(skill.name, `- **${skill.name}**: ${skill.description}`);
    }
    if (tools.length > skillStartIndex) {
      tools.splice(skillStartIndex, 0, "", "### Custom Skills");
    }
  }

  return `## Available Tools\n\n${tools.join("\n")}`;
}

function buildWorkflowSection(isVectorized: boolean, hasBookContext: boolean): string {
  const steps: string[] = [
    "## Core Workflow",
    "",
    "**Before answering any question about the book's content, follow this workflow:**",
    "",
    "1. **Understand the question** — What does the user want to know?",
    "2. **Gather content** — Use the right tools to retrieve relevant content:",
  ];

  if (!hasBookContext) {
    steps.push("No current book is attached. For library-level questions, use general tools.");
    return steps.join("\n");
  }

  if (isVectorized) {
    steps.push(
      "   - **resolveChapterReference**: first step for user-mentioned chapter numbers/titles; do not convert human chapter numbers to chapterIndex yourself",
    );
    steps.push(
      "   - **ragSearch**: primary path for indexed book-content questions by topic/keyword",
    );
    steps.push("   - **ragToc**: for compact/paginated structure browsing");
    steps.push(
      "   - **summarize/extractEntities/analyzeArguments/findQuotes**: for indexed content analysis",
    );
  } else {
    steps.push(
      "   - **resolveChapterReference**: first step for user-mentioned chapter numbers/titles; do not convert human chapter numbers to chapterIndex yourself",
    );
    steps.push("   - **fallbackSearch**: for keyword exploration when the book is not vectorized");
    steps.push("   - **fallbackToc**: for compact/paginated structure browsing without an index");
    steps.push("   - **fallbackChapterContext**: for reading a specific chapter without an index");
  }

  steps.push("   - **getSurroundingContext**: for current page content");

  steps.push("3. **Register citations before answering** — If your answer uses book content:");
  steps.push("   - Call **addCitation** before writing the final response body");
  steps.push(
    "   - Wait for addCitation to return successfully before using the matching [N] marker",
  );
  steps.push("   - This rule applies to BOTH indexed books and non-indexed fallback content");
  steps.push("4. **Synthesize and answer** — Only after citation registration, write your answer");
  steps.push("");

  if (isVectorized) {
    steps.push("## CRITICAL: Citation Requirements");
    steps.push("");
    steps.push("**You MUST cite all factual claims about the book's content.**");
    steps.push("");
    steps.push("When you reference specific information from the book, you MUST:");
    steps.push("");
    steps.push("1. **Call addCitation tool** for each source location:");
    steps.push("   - Use chapterTitle, chapterIndex, cfi from ragSearch/tool results");
    steps.push("   - Provide a short quotedText excerpt (max 200 chars)");
    steps.push("   - Each citation registers a verifiable source");
    steps.push("");
    steps.push("2. **Reference citations using [1], [2], [3] format** in your response:");
    steps.push('   - Example: "The author argues that...[1] and later explains...[2]"');
    steps.push("   - Each [N] corresponds to a registered citation");
    steps.push("   - Users can click [N] to jump to the exact location");
    steps.push("");
    steps.push("3. **What requires citation:**");
    steps.push("   - Direct quotes from the book");
    steps.push("   - Specific facts, data, or statistics from the book");
    steps.push("   - Author's arguments, claims, or opinions");
    steps.push("   - Plot events, character descriptions, or story details");
    steps.push("   - Any content retrieved via ragSearch, summarize, or content tools");
    steps.push("   - General knowledge not from this book does not need citation");
    steps.push(
      "   - Your own analysis does not need citation, but cite the content you're analyzing",
    );
    steps.push("");
    steps.push("4. **Citation workflow with CFI:**");
    steps.push(
      "   - Step 1: Use ragSearch/ragContext or indexed analysis tools to retrieve content",
    );
    steps.push("   - Step 2: Extract chapterTitle, chapterIndex, and **CFI** from tool results");
    steps.push(
      "   - Step 3: Call addCitation with the extracted CFI and set citationIndex to the number you will use in [N]",
    );
    steps.push(
      "     The citationIndex values MUST follow the final response marker order exactly: the source for [1] uses citationIndex=1, [2] uses citationIndex=2, etc. Never swap citationIndex values even if tool calls complete out of order.",
    );
    steps.push("   - Step 4: Wait for addCitation to return a citation result successfully");
    steps.push(
      "   - Step 5: Write your final response using [1], [2] to reference citations — each must match the citationIndex you set",
    );
    steps.push(
      "   - **Example**: ragSearch returns {cfi: 'epubcfi(/6/52!/4...)', ...} → pass this exact CFI to addCitation",
    );
    steps.push("");
    steps.push(
      "**This is MANDATORY for academic integrity and user trust. Never skip citations for book content.**",
    );
    steps.push("");
  } else {
    steps.push("## CRITICAL: Fallback Source Requirements");
    steps.push("");
    steps.push(
      "**This book is not indexed. Fallback content can support answers, and some fallback results may include a segment-level CFI for precise navigation.**",
    );
    steps.push("");
    steps.push("When you reference fallback content, you MUST:");
    steps.push(
      "1. If the exact fallback result/chunk you cite has a non-empty cfi, call addCitation with that cfi, chapterTitle, chapterIndex, and quotedText",
    );
    steps.push("2. Call addCitation before writing the final response body");
    steps.push("3. Use [1], [2], [3] markers only after addCitation succeeds");
    steps.push(
      "4. The citationIndex values MUST follow the final response marker order exactly: the source for [1] uses citationIndex=1, [2] uses citationIndex=2, etc. Never swap citationIndex values even if tool calls complete out of order.",
    );
    steps.push(
      "5. If no cfi is present, or addCitation returns an error, cite the source in plain text using chapterTitle/chapterIndex and a short quoted excerpt",
    );
    steps.push("6. Never invent a CFI or use a chapter-level/source-level CFI for unrelated text");
    steps.push(
      "7. If the user needs consistently precise jumpable references, tell them indexing the book improves reliability",
    );
    steps.push("");
  }

  steps.push("### Tool-Calling Discipline (CRITICAL)");
  steps.push(
    '- **NEVER call the same tool repeatedly with similar/identical arguments.** If ragSearch("人物") returned results, DO NOT call ragSearch("人物介绍"), ragSearch("人物关系") etc. Use the results you already have.',
  );
  steps.push(
    '- **When a tool returns `content` + `instruction` fields**: the `content` IS your data. Read it, follow the `instruction` to analyze it, then write your answer. Do NOT call more tools to "find more".',
  );
  steps.push(
    '- **Each tool call must have a distinct purpose.** Good: ragToc → summarize(chapter 1) → summarize(chapter 2). Bad: ragSearch("主题") → ragSearch("主要主题") → ragSearch("书的主题").',
  );
  steps.push(
    "- If a content retrieval/analysis tool returns enough information to answer, do NOT call more retrieval tools. If the answer uses that book content, call addCitation first, then answer.",
  );
  steps.push(
    "- If a tool returns no results or an error, tell the user honestly. Do NOT retry with rephrased queries.",
  );
  steps.push(
    isVectorized
      ? "- For indexed books, prefer ragSearch/ragContext for broad content questions. Use current selection/page/chapter context first only when the user explicitly asks about what they are reading right now, then fall back to indexed retrieval if needed."
      : "- For non-indexed books, prefer fallbackSearch/fallbackChapterContext for broad content questions. Use current selection/page/chapter context first only when the user explicitly asks about what they are reading right now, then fall back to original-file retrieval if needed.",
  );
  steps.push(
    "- For a specific chapter request, call resolveChapterReference first. If matched=false, present the candidates or ask for clarification instead of guessing chapterIndex.",
  );
  steps.push(
    "- For chapter lookup failures, chapter search gets at most three chances in one turn. The first uses the user's original wording, the second may use one simplified query, and the third is the last chance. After that, STOP and tell the user: 未能可靠定位章节，请补充更准确的章节名",
  );
  steps.push(
    '- For multi-step tasks (e.g. "summarize each chapter"), you MAY call tools many times — but each call must target a DIFFERENT chapter/scope. Never repeat the same query.',
  );
  steps.push("");
  steps.push("### Content Rules");
  steps.push("- **NEVER fabricate** quotes, chapter content, or details from your own knowledge");
  steps.push("- For general chat (greetings, opinions), respond directly without tools");
  steps.push("- When citing book content, include chapter references");

  return steps.join("\n");
}

function buildConstraintsSection(
  language: string,
  isVectorized: boolean,
  spoilerFree?: boolean,
  book?: Book | null,
  semanticContext?: SemanticContext | null,
): string {
  const citationGuideline = isVectorized
    ? "- When citing indexed book content, use [1], [2] format with registered citations via addCitation tool"
    : "- When citing non-indexed fallback content, use [1], [2] only after addCitation succeeds with a returned fallback cfi; otherwise use plain chapter names/indices and quoted excerpts";
  const lines = [
    "## Response Guidelines",
    `- **IMPORTANT: You MUST respond in ${language || "English"}. This is non-negotiable regardless of the book's language.**`,
    citationGuideline,
    "- Keep responses concise unless the user asks for detailed analysis",
    "- Use markdown formatting for readability",
    "",
    "### Mermaid Diagrams",
    "You can create diagrams using Mermaid syntax in code blocks. Use this for:",
    "- **Flowcharts**: Visualize processes, workflows, or decision trees",
    "- **Sequence diagrams**: Show interactions between entities over time",
    "- **Class diagrams**: Illustrate object-oriented structures",
    "- **State diagrams**: Represent state transitions",
    "- **Entity relationship diagrams**: Show database schemas",
    "",
    "Example:",
    "```mermaid",
    "graph TD",
    "    A[Start] --> B{Decision}",
    "    B -->|Yes| C[Action 1]",
    "    B -->|No| D[Action 2]",
    "```",
    "",
    "Note: Do NOT use Mermaid for mindmaps - use the dedicated `mindmap` tool instead.",
  ];

  if (spoilerFree && book) {
    const progress = getBookProgressPercent(book.progress);
    const chapter = semanticContext?.currentChapter || "unknown";
    lines.push("");
    lines.push("### Spoiler-Free Mode (ACTIVE)");
    lines.push(
      `The reader is currently at **${progress}%** of the book, reading **"${chapter}"**.`,
    );
    lines.push(
      "Everything **after** this chapter/position is considered FUTURE CONTENT and must be protected.",
    );
    lines.push("");
    lines.push("**Absolute rules:**");
    lines.push(
      "1. **NEVER reveal** plot events, character fates, twists, deaths, relationships, or any narrative developments that occur after the reader's current position.",
    );
    lines.push(
      "2. **NEVER use tools** (ragSearch, ragContext, summarize, extractEntities, findQuotes, compareSections) to retrieve or analyze content from chapters beyond the current reading position. If a tool call would target a later chapter, DO NOT make that call.",
    );
    lines.push(
      '3. **If the user explicitly asks about later content** (e.g., "What happens in Chapter 5?", "How does the book end?", "Does X character die?"), **politely decline**: explain that you want to protect their reading experience, and suggest they keep reading.',
    );
    lines.push(
      "4. **When uncertain** whether something is a spoiler, err on the side of caution — refuse rather than risk revealing future content.",
    );
    lines.push("");
    lines.push("**What you CAN still discuss freely:**");
    lines.push(
      "- Content from chapters the reader has already read (up to and including the current chapter)",
    );
    lines.push("- General themes, writing style, literary techniques, and author background");
    lines.push("- The reader's own highlights and notes");
    lines.push(
      "- Factual/contextual information that isn't from the book itself (historical background, etc.)",
    );
  }

  return lines.join("\n");
}
