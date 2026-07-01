import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeDocument } from "../../types";

const mockExecute = vi.fn();
const mockSelect = vi.fn();
const mockDb = { execute: mockExecute, select: mockSelect, close: vi.fn() };

const coreMocks = vi.hoisted(() => ({
  getDB: vi.fn(),
  getDeviceId: vi.fn(),
  nextSyncVersion: vi.fn(),
  nextUpdatedAt: vi.fn(),
  parseJSON: vi.fn((str: string | null | undefined, fallback: unknown) => {
    if (!str) return fallback;
    try {
      return JSON.parse(str);
    } catch {
      return fallback;
    }
  }),
}));

vi.mock("../db-core", () => coreMocks);

const { syncKnowledgeDocumentToLegacySource } = await import("../knowledge-source-writeback");

function document(overrides: Partial<KnowledgeDocument> = {}): KnowledgeDocument {
  return {
    id: "doc-1",
    bookId: "book-1",
    type: "standalone_note",
    title: "Document",
    contentJson: { type: "doc", content: [] },
    contentMd: "Document content",
    contentSchemaVersion: 1,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("knowledge source writeback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coreMocks.getDB.mockResolvedValue(mockDb);
    coreMocks.getDeviceId.mockResolvedValue("device-1");
    coreMocks.nextSyncVersion.mockResolvedValue(9);
    coreMocks.nextUpdatedAt.mockResolvedValue(3000);
    mockSelect.mockResolvedValue([]);
    mockExecute.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips documents that are not legacy projections", async () => {
    const result = await syncKnowledgeDocumentToLegacySource(
      document({ type: "book_home", sourceKind: "book", sourceId: "book-1" }),
      mockDb,
    );

    expect(result.status).toBe("skipped");
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("writes expanded highlight notes back without projected quote metadata", async () => {
    mockSelect.mockResolvedValue([
      {
        id: "hl-1",
        text: "Quoted source",
        note: "Old note",
        chapter_title: "Chapter 1",
      },
    ]);

    const result = await syncKnowledgeDocumentToLegacySource(
      document({
        type: "highlight_note",
        sourceKind: "highlight",
        sourceId: "hl-1",
        contentMd: `New note

> Quoted source

_Source: Chapter 1_

Follow-up idea`,
      }),
      mockDb,
    );

    expect(result).toEqual({
      status: "updated",
      sourceTable: "highlights",
      sourceId: "hl-1",
    });
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining("UPDATE highlights"), [
      "New note\n\nFollow-up idea",
      3000,
      9,
      "device-1",
      "hl-1",
    ]);
  });

  it("does not update highlight sync metadata when the legacy note is unchanged", async () => {
    mockSelect.mockResolvedValue([
      {
        id: "hl-1",
        text: "Quoted source",
        note: "Same note",
        chapter_title: "Chapter 1",
      },
    ]);

    const result = await syncKnowledgeDocumentToLegacySource(
      document({
        type: "highlight_note",
        sourceKind: "highlight",
        sourceId: "hl-1",
        contentMd: `Same note

> Quoted source

_Source: Chapter 1_`,
      }),
      mockDb,
    );

    expect(result.status).toBe("unchanged");
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("writes standalone note projections back to legacy notes", async () => {
    mockSelect.mockResolvedValue([
      {
        id: "note-1",
        title: "Old title",
        content: "Old content",
        chapter_title: "Chapter 2",
        tags: '["old"]',
      },
    ]);

    const result = await syncKnowledgeDocumentToLegacySource(
      document({
        title: "New title",
        type: "standalone_note",
        sourceKind: "note",
        sourceId: "note-1",
        contentMd: `New content

_Source: Chapter 2_`,
        tags: [" idea ", "book", "idea"],
      }),
      mockDb,
    );

    expect(result).toEqual({
      status: "updated",
      sourceTable: "notes",
      sourceId: "note-1",
    });
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining("UPDATE notes"), [
      "New title",
      "New content",
      '["book","idea"]',
      3000,
      9,
      "device-1",
      "note-1",
    ]);
  });
});
