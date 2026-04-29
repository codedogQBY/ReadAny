/**
 * 苏格拉底对话管理器
 *
 * 管理预热对话的流程：开场 → 联结 → 过渡 → 精读 → 回顾
 */

import type { Book } from "../types";
import type { PreheatingPhase, QuestionComplexity, SocraticMode } from "./socratic-prompt";
import {
  buildConnectionSystemPrompt,
  buildPreheatingSystemPrompt,
  buildReadingSystemPrompt,
  buildReviewSystemPrompt,
  buildTransitionSystemPrompt,
  determineQuestionComplexity,
} from "./socratic-prompt";

export interface PreheatingState {
  phase: PreheatingPhase;
  userAnswers: string[];
  keyInsights: string[];
  readerQuestions: string[];
  skippedPreheating: boolean;
}

export interface SocraticConfig {
  book: Book | null;
  currentChapter: string;
  userProfile?: {
    background?: string;
    interests?: string[];
  };
  mode: SocraticMode;
  knowledgeScope: "current_chapter" | "book_summary" | "author_background" | "custom_kb";
  language: string;
  customPrompt?: string;
  questionComplexity?: QuestionComplexity;
  enableWebSearch?: boolean;
}

export class SocraticDialogueManager {
  private state: PreheatingState;
  private config: SocraticConfig;
  private onPhaseChange?: (phase: PreheatingPhase) => void;

  constructor(config: SocraticConfig, onPhaseChange?: (phase: PreheatingPhase) => void) {
    this.config = config;
    this.state = {
      phase: "opening",
      userAnswers: [],
      keyInsights: [],
      readerQuestions: [],
      skippedPreheating: false,
    };
    this.onPhaseChange = onPhaseChange;
  }

  getSystemPrompt(): string {
    switch (this.state.phase) {
      case "opening":
        return buildPreheatingSystemPrompt({
          book: this.config.book
            ? {
                title: this.config.book.meta.title,
                author: this.config.book.meta.author,
                language: this.config.book.meta.language,
                progress: this.config.book.progress,
              }
            : null,
          currentChapter: this.config.currentChapter,
          userProfile: this.config.userProfile,
          phase: "opening",
          mode: this.config.mode,
          knowledgeScope: this.config.knowledgeScope,
          language: this.config.language,
          customPrompt: this.config.customPrompt,
          previousAnswers: this.state.userAnswers,
        });

      case "connection":
        return buildConnectionSystemPrompt({
          book: this.config.book
            ? {
                title: this.config.book.meta.title,
                author: this.config.book.meta.author,
                language: this.config.book.meta.language,
                progress: this.config.book.progress,
              }
            : null,
          currentChapter: this.config.currentChapter,
          userProfile: this.config.userProfile,
          phase: "connection",
          mode: this.config.mode,
          knowledgeScope: this.config.knowledgeScope,
          language: this.config.language,
          customPrompt: this.config.customPrompt,
          previousAnswers: this.state.userAnswers,
        });

      case "transition":
        return buildTransitionSystemPrompt({
          book: this.config.book
            ? {
                title: this.config.book.meta.title,
                author: this.config.book.meta.author,
                language: this.config.book.meta.language,
                progress: this.config.book.progress,
              }
            : null,
          currentChapter: this.config.currentChapter,
          userProfile: this.config.userProfile,
          phase: "transition",
          mode: this.config.mode,
          knowledgeScope: this.config.knowledgeScope,
          language: this.config.language,
          customPrompt: this.config.customPrompt,
          previousAnswers: this.state.userAnswers,
        });

      case "reading":
        return buildReadingSystemPrompt({
          book: this.config.book
            ? {
                title: this.config.book.meta.title,
                author: this.config.book.meta.author,
                language: this.config.book.meta.language,
                progress: this.config.book.progress,
              }
            : null,
          currentChapter: this.config.currentChapter,
          userProfile: this.config.userProfile,
          phase: "reading",
          mode: this.config.mode,
          knowledgeScope: this.config.knowledgeScope,
          language: this.config.language,
          customPrompt: this.config.customPrompt,
          previousAnswers: this.state.userAnswers,
        });

      case "review":
        return buildReviewSystemPrompt({
          book: this.config.book
            ? {
                title: this.config.book.meta.title,
                author: this.config.book.meta.author,
                language: this.config.book.meta.language,
                progress: this.config.book.progress,
              }
            : null,
          currentChapter: this.config.currentChapter,
          userProfile: this.config.userProfile,
          phase: "review",
          mode: this.config.mode,
          knowledgeScope: this.config.knowledgeScope,
          language: this.config.language,
          customPrompt: this.config.customPrompt,
          previousAnswers: this.state.userAnswers,
        });
    }
  }

  getQuestionComplexity(): QuestionComplexity {
    if (this.config.questionComplexity) {
      return this.config.questionComplexity;
    }
    return determineQuestionComplexity(
      this.config.book?.meta.title || "",
      this.config.currentChapter,
    );
  }

  addUserAnswer(answer: string): void {
    this.state.userAnswers.push(answer);
    this.extractInsights(answer);

    // Auto-transition from opening to connection after first user answer
    if (this.state.phase === "opening" && this.state.userAnswers.length >= 1) {
      this.transitionTo("connection");
    }
  }

  private extractInsights(answer: string): void {
    if (answer.length > 20) {
      this.state.keyInsights.push(answer.slice(0, 100));
    }
  }

  addReaderQuestion(question: string): void {
    this.state.readerQuestions.push(question);
  }

  transitionTo(phase: PreheatingPhase): void {
    this.state.phase = phase;
    this.onPhaseChange?.(phase);
  }

  skipPreheating(): void {
    this.state.skippedPreheating = true;
    this.transitionTo("reading");
  }

  startReading(): void {
    // Directly transition to reading mode from any preheating phase
    this.transitionTo("reading");
  }

  startReview(): void {
    this.transitionTo("review");
  }

  getState(): Readonly<PreheatingState> {
    return { ...this.state };
  }

  getPreheatingSummary(): string {
    if (this.state.userAnswers.length === 0) {
      return "";
    }

    const summaryParts: string[] = ["## 预热对话摘要", "", "### 读者的思考"];

    this.state.userAnswers.forEach((answer, index) => {
      summaryParts.push(`${index + 1}. ${answer.slice(0, 200)}${answer.length > 200 ? "..." : ""}`);
    });

    if (this.state.readerQuestions.length > 0) {
      summaryParts.push("", "### 读者的问题");
      this.state.readerQuestions.forEach((question, index) => {
        summaryParts.push(`${index + 1}. ${question}`);
      });
    }

    return summaryParts.join("\n");
  }

  getContextForTransition(): {
    summary: string;
    keyInsights: string[];
    readerQuestions: string[];
  } {
    return {
      summary: this.getPreheatingSummary(),
      keyInsights: [...this.state.keyInsights],
      readerQuestions: [...this.state.readerQuestions],
    };
  }

  isPreheatingComplete(): boolean {
    return (
      this.state.phase === "reading" ||
      this.state.phase === "review" ||
      this.state.skippedPreheating
    );
  }

  shouldAutoProgress(): boolean {
    return this.state.phase === "transition";
  }

  static parseCommand(input: string): {
    command: string;
    args: string[];
  } | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) {
      return null;
    }

    const parts = trimmed.slice(1).split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    return { command, args };
  }

  static isSkipCommand(input: string): boolean {
    const parsed = this.parseCommand(input);
    return parsed?.command === "跳过";
  }

  static isStartReadingCommand(input: string): boolean {
    const parsed = this.parseCommand(input);
    return parsed?.command === "开始阅读";
  }

  static isEndChapterCommand(input: string): boolean {
    const parsed = this.parseCommand(input);
    return parsed?.command === "本章结束";
  }

  static isModeSwitchCommand(input: string): boolean {
    const parsed = this.parseCommand(input);
    if (!parsed) return false;
    return ["模式", "角色", "引用", "总结", "重试", "换个话题", "重读"].includes(parsed.command);
  }
}
