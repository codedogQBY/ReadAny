/**
 * Dynamic System Prompt assembly — 6-section structure
 * 1. Role & persona
 * 2. Book context (metadata, current position)
 * 3. Semantic reading context (SRC)
 * 4. Available tools description (context + RAG + analysis)
 * 5. Core workflow & strict tool-use rules
 * 6. Response constraints
 */
import type { Book, SemanticContext, Skill } from "@/types";

interface PromptContext {
  book: Book | null;
  semanticContext: SemanticContext | null;
  enabledSkills: Skill[];
  isVectorized: boolean;
  userLanguage: string;
}

/** Build the full system prompt from context */
export function buildSystemPrompt(ctx: PromptContext): string {
  const sections: string[] = [
    buildRoleSection(),
    buildBookContextSection(ctx.book),
    buildSemanticSection(ctx.semanticContext),
    buildToolsSection(ctx.enabledSkills, ctx.isVectorized),
    buildWorkflowSection(ctx.isVectorized),
    buildConstraintsSection(ctx.userLanguage),
  ];

  return sections.filter(Boolean).join("\n\n---\n\n");
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
    `- Reading Progress: ${Math.round(book.progress * 100)}%`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSemanticSection(ctx: SemanticContext | null): string {
  if (!ctx) return "";
  return [
    "## Reading Context",
    `- Current Chapter: ${ctx.currentChapter}`,
    `- Reader Activity: ${ctx.operationType}`,
    ctx.surroundingText ? `- Surrounding Text:\n> ${ctx.surroundingText}` : "",
    ctx.recentHighlights.length > 0
      ? `- Recent Highlights:\n${ctx.recentHighlights.map((h) => `  > ${h}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildToolsSection(skills: Skill[], isVectorized: boolean): string {
  const tools: string[] = [];

  // General tools (always available)
  tools.push("### General Tools (always available)");
  tools.push("- **listBooks**: List books in the library with search/status filters (params: reasoning, search, status, limit)");
  tools.push("- **searchAllHighlights**: Get highlights across all books (params: reasoning, days, limit)");
  tools.push("- **searchAllNotes**: Get notes across all books (params: reasoning, days, bookTitle, limit)");
  tools.push("- **getReadingStats**: Get reading statistics (params: reasoning, days)");
  tools.push("- **getSkills**: Query available skills/SOPs for guidance (params: reasoning, task)");
  tools.push("- **mindmap**: Generate an interactive mindmap visualization (params: reasoning, title, markdown)");

  // Context tools (always available when reading a book)
  tools.push("");
  tools.push("### Reading Context Tools");
  tools.push("- **getCurrentChapter**: Get current chapter title, index, and reading position");
  tools.push("- **getSelection**: Get the text the user has currently selected");
  tools.push("- **getReadingProgress**: Get overall reading progress, current page and chapter");
  tools.push(
    "- **getRecentHighlights**: Get user's recent highlights and annotations (params: limit)",
  );
  tools.push(
    "- **getSurroundingContext**: Get the text visible on the current page (params: includeSelection)",
  );

  // RAG tools (require vectorization)
  if (isVectorized) {
    tools.push("");
    tools.push("### Content Retrieval Tools (RAG)");
    tools.push(
      "- **ragSearch**: Semantic/keyword search across book content (params: query, mode, topK)",
    );
    tools.push("- **ragToc**: Get the full table of contents with chapter indices");
    tools.push(
      "- **ragContext**: Get content around a specific chapter position (params: chapterIndex, range)",
    );
  }

  // Content analysis tools (always available)
  tools.push("");
  tools.push("### Content Analysis Tools");
  tools.push(
    "- **summarize**: Generate summary of a chapter or entire book (params: scope, chapterIndex, style)",
  );
  tools.push(
    "- **extractEntities**: Extract characters, places, concepts from text (params: entityType, chapterIndex)",
  );
  tools.push(
    "- **analyzeArguments**: Analyze author's arguments and reasoning (params: chapterIndex, focusType)",
  );
  tools.push(
    "- **findQuotes**: Find notable quotes and passages (params: quoteType, chapterIndex, maxQuotes)",
  );
  tools.push("- **getAnnotations**: Get user's highlights and notes (params: type)");
  tools.push(
    "- **compareSections**: Compare two chapters (params: chapterIndex1, chapterIndex2, compareType)",
  );

  // Custom skills
  if (skills.length > 0) {
    tools.push("");
    tools.push("### Custom Skills");
    for (const skill of skills) {
      tools.push(`- **${skill.name}**: ${skill.description}`);
    }
  }

  return `## Available Tools\n\n${tools.join("\n")}`;
}

function buildWorkflowSection(isVectorized: boolean): string {
  const steps: string[] = [
    "## Core Workflow",
    "",
    "**Before answering any question about the book's content, follow this workflow:**",
    "",
    "1. **Understand the question** — What does the user want to know?",
    "2. **Gather content** — Use the right tools to retrieve relevant content:",
  ];

  if (isVectorized) {
    steps.push("   - **ragSearch**: for finding specific content by topic/keyword");
    steps.push("   - **ragToc**: for understanding book structure");
  }

  steps.push("   - **extractEntities**: for finding characters, places, concepts");
  steps.push("   - **summarize**: for chapter or book summaries");
  steps.push("   - **getSurroundingContext**: for current page content");

  steps.push("3. **Synthesize and answer** — Analyze the tool results and write your answer");
  steps.push("");
  steps.push("### Tool-Calling Discipline (CRITICAL)");
  steps.push("- **NEVER call the same tool repeatedly with similar/identical arguments.** If ragSearch(\"人物\") returned results, DO NOT call ragSearch(\"人物介绍\"), ragSearch(\"人物关系\") etc. Use the results you already have.");
  steps.push("- **When a tool returns `content` + `instruction` fields**: the `content` IS your data. Read it, follow the `instruction` to analyze it, then write your answer. Do NOT call more tools to \"find more\".");
  steps.push("- **Each tool call must have a distinct purpose.** Good: ragToc → summarize(chapter 1) → summarize(chapter 2). Bad: ragSearch(\"主题\") → ragSearch(\"主要主题\") → ragSearch(\"书的主题\").");
  steps.push("- If a tool returns enough information to answer (even partially), STOP calling tools and answer with what you have.");
  steps.push("- If a tool returns no results or an error, tell the user honestly. Do NOT retry with rephrased queries.");
  steps.push("- For multi-step tasks (e.g. \"summarize each chapter\"), you MAY call tools many times — but each call must target a DIFFERENT chapter/scope. Never repeat the same query.");
  steps.push("");
  steps.push("### Content Rules");
  steps.push("- **NEVER fabricate** quotes, chapter content, or details from your own knowledge");
  steps.push("- For general chat (greetings, opinions), respond directly without tools");
  steps.push("- When citing book content, include chapter references");

  return steps.join("\n");
}

function buildConstraintsSection(language: string): string {
  return [
    "## Response Guidelines",
    `- Respond in ${language || "the same language as the user"}`,
    "- When citing book content, always include chapter/location references",
    "- Keep responses concise unless the user asks for detailed analysis",
    "- Use markdown formatting for readability",
  ].join("\n");
}
