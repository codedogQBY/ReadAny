/**
 * Unified Prompt Builder — 混合模式架构核心
 *
 * 根据聊天模式（standard/socratic）选择合适的系统提示词
 * 支持标准阅读助手模式和苏格拉底式提问模式
 */

import type { Book, SemanticContext, Skill } from "../types";
import type { ChatMode, KnowledgeScope, SocraticMode } from "../types/chat";
import { type PreheatingPhase, type SocraticContext, buildSocraticPrompt } from "./socratic-prompt";
import { buildSystemPrompt } from "./system-prompt";

export interface UnifiedPromptContext {
  book: Book | null;
  semanticContext: SemanticContext | null;
  enabledSkills: Skill[];
  isVectorized: boolean;
  userLanguage: string;
  spoilerFree?: boolean;
  customPrompt?: string;
  chatMode: ChatMode;
  socraticMode: SocraticMode;
  knowledgeScope: KnowledgeScope;
  preheatingPhase: PreheatingPhase;
  previousAnswers?: string[];
  userProfile?: {
    background?: string;
    interests?: string[];
  };
}

export function buildUnifiedPrompt(ctx: UnifiedPromptContext): string {
  if (ctx.customPrompt && ctx.customPrompt.trim()) {
    return ctx.customPrompt.trim();
  }

  if (ctx.chatMode === "socratic") {
    const socraticCtx: SocraticContext = {
      book: ctx.book
        ? {
            title: ctx.book.meta.title,
            author: ctx.book.meta.author,
            language: ctx.book.meta.language,
            progress: ctx.book.progress,
          }
        : null,
      currentChapter: ctx.semanticContext?.currentChapter || "",
      userProfile: ctx.userProfile,
      phase: ctx.preheatingPhase,
      previousAnswers: ctx.previousAnswers,
      mode: ctx.socraticMode,
      knowledgeScope: ctx.knowledgeScope,
      language: ctx.userLanguage,
      customPrompt: ctx.customPrompt,
    };
    return buildSocraticPrompt(socraticCtx);
  }

  return buildSystemPrompt({
    book: ctx.book,
    semanticContext: ctx.semanticContext,
    enabledSkills: ctx.enabledSkills,
    isVectorized: ctx.isVectorized,
    userLanguage: ctx.userLanguage,
    spoilerFree: ctx.spoilerFree,
    customPrompt: ctx.customPrompt,
  });
}

export function isSocraticMode(chatMode: ChatMode): boolean {
  return chatMode === "socratic";
}

export function shouldAutoStartPreheating(
  chatMode: ChatMode,
  socraticEnabled: boolean,
  preheatingStrategy: "auto" | "manual" | "smart",
  previousSessionCount: number,
): boolean {
  if (chatMode !== "socratic" || !socraticEnabled) {
    return false;
  }

  switch (preheatingStrategy) {
    case "auto":
      return true;
    case "manual":
      return false;
    case "smart":
      return previousSessionCount === 0;
    default:
      return false;
  }
}

export function getDefaultPreheatingPhase(hasCompletedPreheating: boolean): PreheatingPhase {
  if (hasCompletedPreheating) {
    return "reading";
  }
  return "opening";
}

export { buildSystemPrompt } from "./system-prompt";
export { buildSocraticPrompt } from "./socratic-prompt";
export type { SocraticContext } from "./socratic-prompt";
export type { PreheatingPhase } from "./socratic-prompt";
