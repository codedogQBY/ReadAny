import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JSONValue, KnowledgeLink } from "../types";

const dbMocks = vi.hoisted(() => ({
  deleteKnowledgeLink: vi.fn(),
  getKnowledgeLinks: vi.fn(),
  insertKnowledgeLink: vi.fn(),
}));

vi.mock("../db/knowledge-queries", () => dbMocks);

const {
  createAutoKnowledgeInternalLinkId,
  extractKnowledgeInternalDocumentLinkIds,
  syncKnowledgeInternalDocumentLinks,
} = await import("./internal-links");

function link(overrides: Partial<KnowledgeLink>): KnowledgeLink {
  return {
    id: "link-1",
    fromDocumentId: "doc-1",
    toKind: "document",
    toId: "doc-2",
    relation: "related",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("knowledge internal links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(1234);
  });

  it("extracts unique valid internal document links from Tiptap JSON", () => {
    const contentJson: JSONValue = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "readanyInternalLink", attrs: { documentId: "doc-2", label: "Target" } },
            { type: "readanyInternalLink", attrs: { documentId: "doc-2", label: "Target" } },
            { type: "readanyInternalLink", attrs: { documentId: "doc-1", label: "Self" } },
            { type: "readanyInternalLink", attrs: { documentId: "missing", label: "Missing" } },
            { type: "readanyInternalLink", attrs: { label: "Loose title" } },
          ],
        },
      ],
    };

    expect(
      extractKnowledgeInternalDocumentLinkIds(contentJson, {
        sourceDocumentId: "doc-1",
        validDocumentIds: ["doc-2", "doc-3"],
      }),
    ).toEqual(["doc-2"]);
  });

  it("keeps path-only Obsidian links out of document-id backlink sync", () => {
    const contentJson: JSONValue = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "readanyInternalLink",
              attrs: {
                targetPath: "Books/The Book/Ideas/Question Log",
                label: "Question Log",
              },
            },
            {
              type: "readanyInternalLink",
              attrs: {
                documentId: "doc-2",
                targetPath: "Books/The Book/Ideas/Resolved",
                label: "Resolved",
              },
            },
          ],
        },
      ],
    };

    expect(
      extractKnowledgeInternalDocumentLinkIds(contentJson, {
        sourceDocumentId: "doc-1",
        validDocumentIds: ["doc-2"],
      }),
    ).toEqual(["doc-2"]);
  });

  it("syncs editor internal links without deleting manual knowledge links", async () => {
    const staleAutoId = createAutoKnowledgeInternalLinkId("doc-1", "doc-3");
    dbMocks.getKnowledgeLinks.mockResolvedValue([
      link({
        id: staleAutoId,
        toId: "doc-3",
        relation: "references",
      }),
      link({
        id: "manual-link",
        toId: "doc-4",
        relation: "related",
        label: "Manual relation",
      }),
    ]);

    const result = await syncKnowledgeInternalDocumentLinks({
      documentId: "doc-1",
      validDocumentIds: ["doc-2", "doc-4"],
      contentJson: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "readanyInternalLink", attrs: { documentId: "doc-2", label: "New" } },
              { type: "readanyInternalLink", attrs: { documentId: "doc-4", label: "Manual" } },
            ],
          },
        ],
      },
    });

    expect(result).toEqual({ targetDocumentIds: ["doc-2", "doc-4"], added: 1, deleted: 1 });
    expect(dbMocks.deleteKnowledgeLink).toHaveBeenCalledWith(staleAutoId);
    expect(dbMocks.insertKnowledgeLink).toHaveBeenCalledWith(
      expect.objectContaining({
        id: createAutoKnowledgeInternalLinkId("doc-1", "doc-2"),
        fromDocumentId: "doc-1",
        toKind: "document",
        toId: "doc-2",
        relation: "references",
        createdAt: 1234,
        updatedAt: 1234,
      }),
    );
    expect(dbMocks.insertKnowledgeLink).not.toHaveBeenCalledWith(
      expect.objectContaining({ toId: "doc-4" }),
    );
  });
});
