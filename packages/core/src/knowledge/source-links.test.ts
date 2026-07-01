import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeLink } from "../types";

const dbMocks = vi.hoisted(() => ({
  getKnowledgeLinks: vi.fn(),
  insertKnowledgeLink: vi.fn(),
}));

const idMocks = vi.hoisted(() => ({
  generateId: vi.fn(() => "source-link-id"),
}));

vi.mock("../db/knowledge-queries", () => dbMocks);
vi.mock("../utils/generate-id", () => idMocks);

const { ensureKnowledgeSourceLink } = await import("./source-links");

function link(overrides: Partial<KnowledgeLink>): KnowledgeLink {
  return {
    id: "link-1",
    fromDocumentId: "doc-1",
    toKind: "highlight",
    toId: "highlight-1",
    relation: "source",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("knowledge source links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(1234);
  });

  it("creates a source link for a book highlight", async () => {
    dbMocks.getKnowledgeLinks.mockResolvedValueOnce([]);

    await expect(
      ensureKnowledgeSourceLink({
        documentId: "doc-1",
        toKind: "highlight",
        toId: "highlight-1",
        label: "Chapter 1",
        cfi: "epubcfi(/6/2)",
      }),
    ).resolves.toBe(true);

    expect(dbMocks.insertKnowledgeLink).toHaveBeenCalledWith({
      id: "source-link-id",
      fromDocumentId: "doc-1",
      toKind: "highlight",
      toId: "highlight-1",
      relation: "source",
      label: "Chapter 1",
      cfi: "epubcfi(/6/2)",
      createdAt: 1234,
      updatedAt: 1234,
    });
  });

  it("does not duplicate an existing source link at the same CFI", async () => {
    dbMocks.getKnowledgeLinks.mockResolvedValueOnce([
      link({ cfi: "epubcfi(/6/2)", label: "Existing chapter" }),
    ]);

    await expect(
      ensureKnowledgeSourceLink({
        documentId: "doc-1",
        toKind: "highlight",
        toId: "highlight-1",
        label: "Chapter 1",
        cfi: "epubcfi(/6/2)",
      }),
    ).resolves.toBe(false);

    expect(dbMocks.insertKnowledgeLink).not.toHaveBeenCalled();
  });
});
