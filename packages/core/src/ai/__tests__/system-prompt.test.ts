import { describe, expect, it } from "vitest";
import type { Book } from "../../types";
import { buildSystemPrompt } from "../system-prompt";

function makeBook(): Book {
  return {
    id: "book-1",
    filePath: "book.epub",
    format: "epub",
    meta: {
      title: "Test Book",
      author: "Test Author",
      description: "",
      subjects: [],
      language: "en",
    },
    progress: 0,
    isVectorized: false,
    vectorizeProgress: 0,
    tags: [],
    addedAt: 1,
    lastOpenedAt: 1,
    updatedAt: 1,
    syncStatus: "local",
  };
}

describe("buildSystemPrompt citations", () => {
  it("allows fallback citations only when a returned CFI can be validated", () => {
    const prompt = buildSystemPrompt({
      book: makeBook(),
      semanticContext: null,
      enabledSkills: [],
      isVectorized: false,
      userLanguage: "en",
    });

    expect(prompt).toContain("Fallback Source Requirements");
    expect(prompt).toContain("If the exact fallback result/chunk you cite has a non-empty cfi");
    expect(prompt).toContain("If the result has no cfi, still call addCitation with an empty cfi");
    expect(prompt).toContain("resolve the paragraph CFI");
    expect(prompt).toContain("Use [1], [2], [3] markers only after addCitation succeeds");
    expect(prompt).toContain("Never invent a CFI");
    expect(prompt).toContain("addCitation");
  });

  it("keeps clickable citation instructions for indexed content", () => {
    const prompt = buildSystemPrompt({
      book: makeBook(),
      semanticContext: null,
      enabledSkills: [],
      isVectorized: true,
      userLanguage: "en",
    });

    expect(prompt).toContain("Citation Requirements");
    expect(prompt).toContain("addCitation");
    expect(prompt).toContain("Wait for addCitation to return a citation result successfully");
    expect(prompt).toContain("Users can click [N]");
  });

  it("includes turn-focus routing hints when provided", () => {
    const prompt = buildSystemPrompt({
      book: makeBook(),
      semanticContext: null,
      enabledSkills: [],
      isVectorized: true,
      userLanguage: "en",
      questionCategory: "current_selection",
      selectionActive: true,
      routeHint:
        "The user already has an active selection. Prefer the selected text and surrounding context before any chapter-wide or book-wide retrieval.",
    });

    expect(prompt).toContain("## Turn Focus");
    expect(prompt).toContain("Detected Question Type: current_selection");
    expect(prompt).toContain("Active Text Selection: yes");
    expect(prompt).toContain("Prefer the selected text and surrounding context");
  });

  it("lists the actually allowed tools for the current turn when provided", () => {
    const prompt = buildSystemPrompt({
      book: makeBook(),
      semanticContext: null,
      enabledSkills: [],
      isVectorized: true,
      userLanguage: "en",
      allowedToolNames: ["getCurrentChapter", "getSurroundingContext", "addCitation"],
    });

    expect(prompt).toContain("## Turn-Available Tools");
    expect(prompt).toContain("- getCurrentChapter");
    expect(prompt).toContain("- getSurroundingContext");
    expect(prompt).toContain("- addCitation");
  });

  it("does not describe tools that are unavailable in the current turn", () => {
    const prompt = buildSystemPrompt({
      book: makeBook(),
      semanticContext: null,
      enabledSkills: [],
      isVectorized: true,
      userLanguage: "en",
      allowedToolNames: ["getCurrentChapter", "addCitation"],
    });

    expect(prompt).toContain("- getCurrentChapter");
    expect(prompt).toContain("- addCitation");
    expect(prompt).not.toContain("- getReadingProgress");
    expect(prompt).not.toContain("Get overall reading progress");
    expect(prompt).not.toContain("ragSearch");
    expect(prompt).not.toContain("ragContext");
    expect(prompt).not.toContain("fallbackSearch");
    expect(prompt).not.toContain("Semantic/keyword search across book content");
  });

  it("keeps workflow instructions aligned with library-only tools", () => {
    const prompt = buildSystemPrompt({
      book: makeBook(),
      semanticContext: null,
      enabledSkills: [],
      isVectorized: true,
      userLanguage: "en",
      questionCategory: "library_request",
      allowedToolNames: ["listBooks", "getReadingStats"],
    });

    expect(prompt).toContain("- listBooks");
    expect(prompt).toContain("- getReadingStats");
    expect(prompt).toContain("This turn does not expose book-content retrieval tools");
    expect(prompt).not.toContain("ragSearch");
    expect(prompt).not.toContain("fallbackSearch");
    expect(prompt).not.toContain("addCitation");
    expect(prompt).not.toContain("mindmap");
  });

  it("does not inject Chinese failure copy into English chapter requests", () => {
    const prompt = buildSystemPrompt({
      book: makeBook(),
      semanticContext: null,
      enabledSkills: [],
      isVectorized: true,
      userLanguage: "en",
      questionCategory: "specific_chapter_request",
      allowedToolNames: ["resolveChapterReference", "ragToc", "ragContext"],
    });

    expect(prompt).not.toContain("未能可靠定位章节");
    expect(prompt).toContain("in the user's language");
  });
});
