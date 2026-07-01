import { describe, expect, it } from "vitest";
import { createToolCallPart } from "../../types/message";
import { applyToolResultToParts, markRunningToolCallPartsAsError } from "../tool-call-state";

describe("tool call state helpers", () => {
  it("marks a failed tool result as an error instead of leaving it running", () => {
    const part = createToolCallPart("fallbackToc", { bookId: "book-1" });

    const updated = applyToolResultToParts(
      [part],
      "fallbackToc",
      { error: "fallbackToc is not available" },
      456,
    );

    expect(updated).toBe(part);
    expect(part.status).toBe("error");
    expect(part.error).toBe("fallbackToc is not available");
    expect(part.updatedAt).toBe(456);
  });

  it("marks success=false knowledge tool results as failed", () => {
    const part = createToolCallPart("proposeKnowledgeDocumentUpdate", {
      documentId: "doc-1",
      parentId: "not-a-folder",
    });

    applyToolResultToParts(
      [part],
      "proposeKnowledgeDocumentUpdate",
      { success: false, error: "Invalid parentId: parent_not_folder", documentId: "doc-1" },
      567,
    );

    expect(part.status).toBe("error");
    expect(part.error).toBe("Invalid parentId: parent_not_folder");
    expect(part.updatedAt).toBe(567);
  });

  it("marks a successful tool result as completed", () => {
    const part = createToolCallPart("fallbackSearch", { query: "confucius" });

    applyToolResultToParts([part], "fallbackSearch", { hits: [] }, 456);

    expect(part.status).toBe("completed");
    expect(part.error).toBeUndefined();
    expect(part.result).toEqual({ hits: [] });
  });

  it("marks running tool calls as failed when the stream errors", () => {
    const runningPart = createToolCallPart("fallbackChapterContext", { chapterIndex: 1 });
    const completedPart = createToolCallPart("fallbackSearch", { query: "AI" });
    completedPart.status = "completed";
    completedPart.result = { hits: [] };

    markRunningToolCallPartsAsError([runningPart, completedPart], "Model stream failed", 789);

    expect(runningPart.status).toBe("error");
    expect(runningPart.error).toBe("Model stream failed");
    expect(runningPart.updatedAt).toBe(789);
    expect(completedPart.status).toBe("completed");
    expect(completedPart.error).toBeUndefined();
  });
});
