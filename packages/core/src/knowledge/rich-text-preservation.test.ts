import { describe, expect, it } from "vitest";
import { buildKnowledgePromptContext } from "../ai/knowledge-context";
import { KnowledgeExporter } from "../export/knowledge-exporter";
import type { Book, JSONValue, KnowledgeAttachment, KnowledgeDocument } from "../types";
import { renderKnowledgeJsonToMarkdown, type TiptapNode } from "./editor-projection";

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
  return {
    id: "doc-1",
    bookId: "book-1",
    type: "standalone_note",
    title: "Durable Reading Trail",
    contentJson: { type: "doc", content: [] },
    contentMd: "",
    contentSchemaVersion: 1,
    tags: ["reading"],
    sourceKind: "book",
    sourceId: "book-1",
    createdAt: 1700000000000,
    updatedAt: 1700000100000,
    ...overrides,
  };
}

function syncClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function appendBlock(contentJson: JSONValue, block: TiptapNode): JSONValue {
  const document = syncClone(contentJson) as unknown as TiptapNode;
  return {
    ...document,
    content: [...(document.content ?? []), block],
  } as unknown as JSONValue;
}

describe("knowledge rich text preservation", () => {
  it("keeps rich document blocks through desktop save, sync, mobile edit, export, and AI context", () => {
    const folder = knowledgeDocument({
      id: "folder-chapters",
      type: "folder",
      title: "Chapter Notes",
      contentJson: { type: "doc", content: [] },
      tags: [],
    });
    const linkedFolder = knowledgeDocument({
      id: "folder-references",
      type: "folder",
      title: "References",
      contentJson: { type: "doc", content: [] },
      tags: [],
    });
    const linkedDocument = knowledgeDocument({
      id: "doc-linked",
      parentId: "folder-references",
      title: "Linked Thought",
      contentJson: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Related thought." }] }],
      },
      contentMd: "Related thought.",
    });
    const desktopContentJson: JSONValue = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Durable Reading Trail" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Read " },
            { type: "text", text: "slowly", marks: [{ type: "bold" }] },
            { type: "text", text: " beside " },
            {
              type: "readanyInternalLink",
              attrs: {
                documentId: "doc-linked",
                label: "Linked Thought",
                targetPath: "Knowledge base / References / Linked Thought",
              },
            },
            { type: "text", text: " and cite " },
            {
              type: "readanySourceReference",
              attrs: {
                label: "Chapter 4",
                sourceId: "hl-1",
                cfi: "epubcfi(/6/4)",
              },
            },
            { type: "text", text: "." },
          ],
        },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Review source quote" }] },
              ],
            },
          ],
        },
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "A quote should stay attached to its source." }],
            },
          ],
        },
        {
          type: "image",
          attrs: {
            attachmentId: "att-diagram",
            src: "asset://local/diagram.png",
            alt: "Diagram",
          },
        },
        {
          type: "readanyCard",
          attrs: {
            cardType: "bookQuote",
            title: "Important Quote",
            text: "Reading is thinking.",
            sourceTitle: "Chapter 1",
            sourceId: "hl-1",
            cfi: "epubcfi(/6/2)",
          },
        },
        {
          type: "readanyCard",
          attrs: {
            cardType: "aiSummary",
            title: "AI Summary",
            markdown: "The durable idea is slow reading with evidence.",
          },
        },
        {
          type: "readanyCard",
          attrs: {
            cardType: "aiToolFailure",
            title: "searchKnowledgeBase",
            data: {
              toolName: "searchKnowledgeBase",
              error: "Index unavailable",
              reason: "Use safe no-write fallback.",
            },
          },
        },
      ],
    };

    const desktopMarkdown = renderKnowledgeJsonToMarkdown(desktopContentJson);
    const desktopSaved = knowledgeDocument({
      id: "doc-rich",
      parentId: "folder-chapters",
      contentJson: desktopContentJson,
      contentMd: desktopMarkdown,
      excerpt: "A durable rich-text reading trail.",
    });

    expect(desktopSaved.contentMd).toContain("## Durable Reading Trail");
    expect(desktopSaved.contentMd).toContain("Read **slowly** beside [[Knowledge base / References / Linked Thought|Linked Thought]]");
    expect(desktopSaved.contentMd).toContain("- [ ] Review source quote");
    expect(desktopSaved.contentMd).toContain("> A quote should stay attached to its source.");
    expect(desktopSaved.contentMd).toContain("![Diagram](readany-attachment://att-diagram)");
    expect(desktopSaved.contentMd).toContain("> [!failure] searchKnowledgeBase");

    const syncedToMobile = syncClone(desktopSaved);
    const mobileContentJson = appendBlock(syncedToMobile.contentJson, {
      type: "paragraph",
      content: [{ type: "text", text: "Mobile follow-up keeps keyboard-safe editing." }],
    });
    const mobileSaved: KnowledgeDocument = {
      ...syncedToMobile,
      contentJson: mobileContentJson,
      contentMd: renderKnowledgeJsonToMarkdown(mobileContentJson),
      summaryMd: "Durable memory: keyboard-safe mobile editing plus AI provenance.",
      summarySourceFingerprint: "fnv1a32:mobile",
      summarySourceUpdatedAt: 1700000200000,
      summaryUpdatedAt: 1700000200000,
      updatedAt: 1700000200000,
    };
    const attachment: KnowledgeAttachment = {
      id: "att-diagram",
      documentId: mobileSaved.id,
      kind: "image",
      fileName: "diagram.png",
      mimeType: "image/png",
      localPath: "/tmp/readany/diagram.png",
      size: 42,
      hash: "sha256:diagram",
      createdAt: 1700000000000,
      updatedAt: 1700000200000,
    };

    expect(mobileSaved.contentMd).toContain("Mobile follow-up keeps keyboard-safe editing.");
    expect(mobileSaved.contentMd).toContain("Tool: searchKnowledgeBase");
    expect(mobileSaved.contentMd).toContain("Reason: Use safe no-write fallback.");

    const vault = new KnowledgeExporter().buildVaultPackage(
      {
        books: [baseBook],
        documents: [folder, linkedFolder, linkedDocument, mobileSaved],
        attachments: [attachment],
      },
      { exportedAt: 1700000300000 },
    );
    const exportedDocument = vault.files.find((file) =>
      file.path.endsWith("Chapter Notes/Durable Reading Trail.md"),
    );
    if (!exportedDocument) throw new Error("Expected exported rich document");

    expect(vault.manifest.documents[mobileSaved.id]).toMatchObject({
      id: mobileSaved.id,
      parentId: "folder-chapters",
      path: "Books/The Book A Study/Chapter Notes/Durable Reading Trail.md",
    });
    expect(vault.manifest.attachments["att-diagram"]).toMatchObject({
      documentId: mobileSaved.id,
      path: "Assets/diagram.png",
    });
    expect(exportedDocument.content).toContain(
      "[[Books/The Book A Study/References/Linked Thought|Linked Thought]]",
    );
    expect(exportedDocument.content).toContain("![Diagram](../../../Assets/diagram.png)");
    expect(exportedDocument.content).toContain("> [!quote] Important Quote");
    expect(exportedDocument.content).toContain("> [!summary] AI Summary");
    expect(exportedDocument.content).toContain("> [!failure] searchKnowledgeBase");
    expect(exportedDocument.content).toContain("Mobile follow-up keeps keyboard-safe editing.");

    const aiContext = buildKnowledgePromptContext([folder, linkedFolder, linkedDocument, mobileSaved], {
      query: "keyboard provenance",
      maxDocuments: 1,
      maxChars: 1200,
    });

    expect(aiContext).toContain("[standalone_note] Durable Reading Trail");
    expect(aiContext).toContain("id: doc-rich");
    expect(aiContext).toContain("path: Knowledge base / Chapter Notes / Durable Reading Trail");
    expect(aiContext).toContain("keyboard-safe mobile editing plus AI provenance");
  });
});
