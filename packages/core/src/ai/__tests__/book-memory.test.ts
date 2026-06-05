import { describe, expect, it } from "vitest";
import {
  compactBookMemory,
  createEmptyBookMemory,
  mergeBookMemoryExchange,
  renderBookMemoryForPrompt,
} from "../book-memory";

describe("book memory", () => {
  it("records reading position, selected focus, and recent questions for one book", () => {
    const memory = mergeBookMemoryExchange(
      createEmptyBookMemory("book-1"),
      {
        userInput: "Why does the author compare reality and fantasy?",
        assistantText: "The answer focuses on the chapter's argument.",
        selectedQuotes: [{ text: "reality is structured by fantasy", source: "Preface" }],
        chapterTitle: "Preface",
        chapterIndex: 0,
        positionPercent: 0.12,
      },
      1000,
    );

    expect(memory.bookId).toBe("book-1");
    expect(memory.lastChapterTitle).toBe("Preface");
    expect(memory.lastChapterIndex).toBe(0);
    expect(memory.lastPositionPercent).toBe(0.12);
    expect(memory.recentQuestions[0]).toContain("Why does the author");
    expect(memory.focus[0]).toContain("Preface");
    expect(renderBookMemoryForPrompt(memory)).toContain("Book memory");
  });

  it("compacts long rolling memory so prompt context stays bounded", () => {
    let memory = createEmptyBookMemory("book-1");
    for (let index = 0; index < 40; index++) {
      memory = mergeBookMemoryExchange(
        memory,
        {
          userInput: `Question ${index}: explain this argument in detail?`,
          assistantText: `Answer ${index}: this was a long answer about the argument.`,
          chapterTitle: `Chapter ${index % 3}`,
          chapterIndex: index % 3,
          positionPercent: index / 100,
        },
        1000 + index,
      );
    }

    const compacted = compactBookMemory(memory, 5000);

    expect(compacted.recentQuestions.length).toBeLessThanOrEqual(12);
    expect(compacted.focus.length).toBeLessThanOrEqual(12);
    expect(compacted.summary.length).toBeLessThanOrEqual(2500);
    expect(compacted.lastCompactedAt).toBe(5000);
  });
});
