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

  if (isVectorized) {
    tools.push("- **ragSearch**: Search book content using semantic/keyword search");
    tools.push("- **ragToc**: Retrieve table of contents structure");
    tools.push("- **ragContext**: Get surrounding context for a specific position");
  }

  for (const skill of skills) {
    tools.push(`- **${skill.name}**: ${skill.description}`);
  }

  if (tools.length === 0) return "";
  return `## Available Tools\n${tools.join("\n")}`;
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
