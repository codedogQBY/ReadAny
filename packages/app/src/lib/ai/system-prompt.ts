/**
 * Dynamic System Prompt assembly — 5-section structure
 * 1. Role & persona
 * 2. Book context (metadata, current position)
 * 3. Semantic reading context (SRC)
 * 4. Available tools description
 * 5. Response constraints
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
    buildConstraintsSection(ctx.userLanguage),
  ];

  return sections.filter(Boolean).join("\n\n---\n\n");
}

function buildRoleSection(): string {
  return `You are ReadAny AI, an intelligent reading assistant. You help users understand, analyze, and engage with the books they are reading. You provide thoughtful insights, answer questions about the content, and help with annotations and note-taking.`;
}

function buildBookContextSection(book: Book | null): string {
  if (!book) return "";
  return [
    `## Current Book`,
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
    `## Reading Context`,
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

  // RAG tools (require vectorization)
  if (isVectorized) {
    tools.push("- **ragSearch**: Search book content using semantic/keyword search");
    tools.push("- **ragToc**: Retrieve table of contents structure");
    tools.push("- **ragContext**: Get surrounding context for a specific position");
  }

  // Content analysis tools (always available)
  tools.push("- **summarize**: Generate summary of a chapter or the entire book");
  tools.push("- **extractEntities**: Extract characters, places, concepts, organizations from the text");
  tools.push("- **analyzeArguments**: Analyze author's arguments, reasoning, and logical structure");
  tools.push("- **findQuotes**: Find notable quotes, passages, and memorable sentences");
  tools.push("- **getAnnotations**: Get user's highlights and notes from the book");
  tools.push("- **compareSections**: Compare two sections or chapters of the book");

  // Custom skills
  for (const skill of skills) {
    tools.push(`- **${skill.name}**: ${skill.description}`);
  }

  if (tools.length === 0) return "";
  return `## Available Tools

You have access to the following tools. Use them proactively when appropriate:

${tools.join("\n")}

### Tool Usage Guidelines:
- Use **summarize** when the user asks for a summary, overview, or brief
- Use **extractEntities** when the user asks about characters, people, places, or concepts
- Use **analyzeArguments** when the user asks about the author's viewpoint or arguments
- Use **findQuotes** when the user asks for quotes or memorable passages
- Use **getAnnotations** to reference what the user has highlighted or noted
- Use **compareSections** when the user wants to compare different parts of the book
- Use **ragSearch** (if available) for content-specific questions`;
}

function buildConstraintsSection(language: string): string {
  return [
    `## Response Guidelines`,
    `- Respond in ${language || "the same language as the user"}`,
    `- When citing book content, always include chapter/location references`,
    `- Keep responses concise unless the user asks for detailed analysis`,
    `- Use markdown formatting for readability`,
  ].join("\n");
}
