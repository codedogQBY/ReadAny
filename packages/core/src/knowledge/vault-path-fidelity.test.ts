import { describe, expect, it } from "vitest";
import { getKnowledgeToolResultDisplay } from "../ai/knowledge-tool-result";
import { KnowledgeExporter } from "../export/knowledge-exporter";
import {
  createKnowledgeVaultImportPlan,
  createKnowledgeVaultImportWriteProposals,
} from "../export/knowledge-importer";
import type { Book, KnowledgeDocument } from "../types";
import {
  buildKnowledgeDocumentTree,
  filterKnowledgeDocumentTreeNodesForSearch,
  flattenKnowledgeDocumentTree,
  formatKnowledgeDocumentPath,
} from "./document-utils";

const baseBook: Book = {
  id: "book-1",
  filePath: "books/book.epub",
  format: "epub",
  meta: {
    title: "The Book: A Study",
    author: "Ada Reader",
    language: "en",
  },
  addedAt: 1000,
  updatedAt: 2000,
  progress: 0.4,
  isVectorized: false,
  vectorizeProgress: 0,
  tags: ["philosophy"],
  syncStatus: "local",
};

function knowledgeDocument(overrides: Partial<KnowledgeDocument> = {}): KnowledgeDocument {
  const body = overrides.contentMd ?? "A durable idea.";
  return {
    id: "doc-1",
    bookId: "book-1",
    type: "standalone_note",
    title: "Question Log",
    contentJson: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: body }],
        },
      ],
    },
    contentMd: body,
    contentSchemaVersion: 1,
    excerpt: body,
    tags: ["reading"],
    sourceKind: "book",
    sourceId: "book-1",
    createdAt: 1700000000000,
    updatedAt: 1700000100000,
    ...overrides,
  };
}

describe("knowledge vault path fidelity", () => {
  it("keeps one moved document address consistent across tree, search, AI, export, and import", () => {
    const home = knowledgeDocument({
      id: "home",
      type: "book_home",
      title: "Book Home",
      contentMd: "Home page.",
      excerpt: "Home page.",
    });
    const inbox = knowledgeDocument({
      id: "folder-inbox",
      type: "folder",
      title: "Inbox",
      contentJson: { type: "doc", content: [] },
      contentMd: "",
      excerpt: undefined,
      tags: [],
    });
    const chapterNotes = knowledgeDocument({
      id: "folder-chapters",
      type: "folder",
      title: "Chapter Notes",
      contentJson: { type: "doc", content: [] },
      contentMd: "",
      excerpt: undefined,
      tags: [],
    });
    const themes = knowledgeDocument({
      id: "folder-themes",
      parentId: "folder-chapters",
      type: "folder",
      title: "Themes",
      contentJson: { type: "doc", content: [] },
      contentMd: "",
      excerpt: undefined,
      tags: [],
    });
    const noteBeforeMove = knowledgeDocument({
      id: "note-question",
      parentId: "folder-inbox",
      title: "Question Log",
      contentMd: "Why does the argument begin with memory?",
      excerpt: "Why does the argument begin with memory?",
    });
    const beforeMove = [home, inbox, chapterNotes, themes, noteBeforeMove];

    expect(formatKnowledgeDocumentPath(noteBeforeMove, beforeMove)).toBe(
      "Knowledge base / Inbox / Question Log",
    );

    const afterMove = beforeMove.map((document) =>
      document.id === "note-question"
        ? { ...document, parentId: "folder-themes", updatedAt: 1700000200000 }
        : document,
    );
    const movedNote = afterMove.find((document) => document.id === "note-question");
    if (!movedNote) throw new Error("Expected moved note");

    const expectedVaultPath = "Knowledge base / Chapter Notes / Themes / Question Log";
    expect(formatKnowledgeDocumentPath(movedNote, afterMove)).toBe(expectedVaultPath);

    const tree = buildKnowledgeDocumentTree(afterMove, "home");
    const flattenedNodes = flattenKnowledgeDocumentTree(tree.roots);
    const movedNode = flattenedNodes.find((node) => node.document.id === movedNote.id);
    expect(movedNode).toMatchObject({ depth: 2 });

    const searchMatches = filterKnowledgeDocumentTreeNodesForSearch(
      flattenedNodes,
      afterMove,
      "chapter notes themes question",
    );
    expect(searchMatches.map((node) => node.document.id)).toEqual([movedNote.id]);

    const aiSearchDisplay = getKnowledgeToolResultDisplay("searchKnowledgeBase", {
      success: true,
      total: 1,
      showing: 1,
      documents: [
        {
          id: movedNote.id,
          title: movedNote.title,
          type: movedNote.type,
          path: expectedVaultPath,
          snippet: movedNote.excerpt,
        },
      ],
    });
    expect(aiSearchDisplay?.documents[0]).toMatchObject({
      id: movedNote.id,
      title: movedNote.title,
      path: expectedVaultPath,
    });

    const aiFailureDisplay = getKnowledgeToolResultDisplay("proposeKnowledgeDocumentUpdate", {
      success: false,
      error: "Parent folder no longer exists",
      documentId: movedNote.id,
      targetPath: expectedVaultPath,
    });
    expect(aiFailureDisplay?.documents[0]).toMatchObject({
      id: movedNote.id,
      title: expectedVaultPath,
      path: expectedVaultPath,
    });

    const exporter = new KnowledgeExporter();
    const vault = exporter.buildVaultPackage(
      {
        books: [baseBook],
        documents: afterMove,
      },
      { exportedAt: 1700000300000 },
    );
    const exportedPath = "Books/The Book A Study/Chapter Notes/Themes/Question Log.md";
    expect(vault.manifest.documents[movedNote.id]).toMatchObject({
      id: movedNote.id,
      parentId: "folder-themes",
      path: exportedPath,
    });

    const exportedFile = vault.files.find((file) => file.path === exportedPath);
    if (!exportedFile) throw new Error("Expected exported moved note");

    const editedContent = exportedFile.content.replace(
      "Why does the argument begin with memory?",
      "Why does the argument begin with remembered evidence?",
    );
    const importPlan = createKnowledgeVaultImportPlan({
      manifest: vault.manifest,
      files: [{ path: exportedPath, content: editedContent }],
    });
    const modifiedEntry = importPlan.modified.find((entry) => entry.documentId === movedNote.id);
    expect(modifiedEntry).toMatchObject({
      documentId: movedNote.id,
      path: exportedPath,
      status: "modified",
    });

    const [proposal] = createKnowledgeVaultImportWriteProposals({
      ...importPlan,
      modified: modifiedEntry ? [modifiedEntry] : [],
    });
    expect(proposal).toMatchObject({
      action: "update",
      documentId: movedNote.id,
      current: expect.objectContaining({
        id: movedNote.id,
        parentId: "folder-themes",
        title: "Question Log",
      }),
      patch: expect.objectContaining({
        title: "Question Log",
        contentMd: expect.stringContaining("remembered evidence"),
      }),
    });
  });
});
