import { describe, expect, it } from "vitest";
import type { KnowledgeCardTemplate, KnowledgeDocument } from "../types";
import { KnowledgeExporter } from "./knowledge-exporter";
import {
  createKnowledgeImportWriteProposal,
  createKnowledgeMarkdownImportPlan,
  createKnowledgeVaultImportPlan,
  createKnowledgeVaultImportWriteProposals,
  parseKnowledgeMarkdownDocument,
} from "./knowledge-importer";

function knowledgeDocument(overrides: Partial<KnowledgeDocument> = {}): KnowledgeDocument {
  return {
    id: "doc-1",
    bookId: "book-1",
    type: "book_home",
    title: "Book Home",
    contentJson: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "A durable idea." }],
        },
        {
          type: "readanyCard",
          attrs: {
            cardType: "bookQuote",
            id: "card-1",
            version: 2,
            title: "Important Quote",
            sourceId: "hl-1",
            sourceTitle: "Chapter 1",
            cfi: "epubcfi(/6/2)",
            markdown: "Reading is thinking.\n\nKeep the source.",
            data: {
              citations: [{ cfi: "epubcfi(/6/2)", text: "Reading is thinking." }],
            },
          },
        },
      ],
    },
    contentMd: "",
    contentSchemaVersion: 1,
    tags: ["reading", "idea"],
    sourceKind: "book",
    sourceId: "book-1",
    createdAt: 1700000000000,
    updatedAt: 1700000100000,
    ...overrides,
  };
}

const readingPromptTemplate: KnowledgeCardTemplate = {
  id: "template-reading-question",
  name: "Reading Prompt",
  version: 4,
  schemaJson: {
    cardType: "custom:template-reading-question",
    title: "Reading Prompt",
    markdown: "Prompt:\nResponse:",
    attrs: {
      data: { kind: "prompt" },
    },
  },
  builtIn: false,
  enabled: true,
  createdAt: 1,
  updatedAt: 2,
};

describe("Knowledge markdown importer", () => {
  it("round-trips a ReadAny exported Markdown document into a document draft", () => {
    const exporter = new KnowledgeExporter();
    const [file] = exporter.export(
      {
        documents: [knowledgeDocument()],
        links: [
          {
            id: "link-1",
            fromDocumentId: "doc-1",
            toKind: "url",
            toId: "https://example.com",
            relation: "related",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        attachments: [
          {
            id: "att-1",
            documentId: "doc-1",
            kind: "image",
            fileName: "diagram.png",
            localPath: "/tmp/diagram.png",
            size: 12,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      { includeReadAnyCardMetadata: true },
    );

    const imported = parseKnowledgeMarkdownDocument({
      path: file.path,
      content: file.content,
    });

    expect(file.content).toContain("<!-- readany:generated-links -->");
    expect(file.content).toContain("<!-- readany:generated-attachments -->");
    expect(imported.isReadAnyExport).toBe(true);
    expect(imported.warnings).toEqual([]);
    expect(imported.frontmatter).toMatchObject({
      type: "readany-knowledge",
      id: "doc-1",
      documentType: "book_home",
      title: "Book Home",
      bookId: "book-1",
      sourceKind: "book",
      sourceId: "book-1",
      tags: ["reading", "idea"],
    });
    expect(imported.contentMd).not.toContain("## ReadAny Links");
    expect(imported.contentMd).not.toContain("readany:generated-links");
    expect(imported.contentMd).not.toContain("## Attachments");
    expect(imported.contentMd).not.toContain("readany:generated-attachments");
    expect(imported.draft).toMatchObject({
      id: "doc-1",
      type: "book_home",
      title: "Book Home",
      bookId: "book-1",
      sourceKind: "book",
      sourceId: "book-1",
      tags: ["reading", "idea"],
      contentSchemaVersion: 1,
    });
    expect(imported.draft.contentJson).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "A durable idea." }],
        },
        {
          type: "readanyCard",
          attrs: {
            cardType: "bookQuote",
            id: "card-1",
            version: 2,
            title: "Important Quote",
            sourceId: "hl-1",
            sourceTitle: "Chapter 1",
            cfi: "epubcfi(/6/2)",
            markdown: "Reading is thinking.\n\nKeep the source.",
            data: {
              citations: [{ cfi: "epubcfi(/6/2)", text: "Reading is thinking." }],
            },
          },
        },
      ],
    });
  });

  it("preserves user-authored sections that share ReadAny generated section names", () => {
    const imported = parseKnowledgeMarkdownDocument({
      path: "Books/The Book/Research.md",
      content: [
        "---",
        "type: readany-knowledge",
        'id: "doc-user-section"',
        'documentType: "standalone_note"',
        'title: "Research"',
        "tags: []",
        "---",
        "# Research",
        "",
        "Main body.",
        "",
        "## ReadAny Links",
        "",
        "This is a user-authored section, not generated metadata.",
        "",
        "## Follow Up",
        "",
        "Keep this content too.",
      ].join("\n"),
    });

    expect(imported.contentMd).toContain("## ReadAny Links");
    expect(imported.contentMd).toContain("This is a user-authored section");
    expect(imported.contentMd).toContain("## Follow Up");
    expect(imported.contentMd).toContain("Keep this content too.");
  });

  it("strips only trailing legacy generated ReadAny sections from imported exports", () => {
    const imported = parseKnowledgeMarkdownDocument({
      path: "Books/The Book/Research.md",
      content: [
        "---",
        "type: readany-knowledge",
        'id: "doc-legacy-section"',
        'documentType: "standalone_note"',
        'title: "Research"',
        "tags: []",
        "---",
        "# Research",
        "",
        "Main body.",
        "",
        "## ReadAny Links",
        "",
        "A user-authored section with the same title.",
        "",
        "## Follow Up",
        "",
        "Keep this content.",
        "",
        "## ReadAny Links",
        "",
        "- **related:** [[Ideas/Other Note]]",
        "",
        "## Attachments",
        "",
        "- [diagram.png](Assets/diagram.png)",
      ].join("\n"),
    });

    expect(imported.contentMd).toBe(
      [
        "Main body.",
        "",
        "## ReadAny Links",
        "",
        "A user-authored section with the same title.",
        "",
        "## Follow Up",
        "",
        "Keep this content.",
      ].join("\n"),
    );
  });

  it("preserves parent ids from ReadAny Markdown frontmatter", () => {
    const imported = parseKnowledgeMarkdownDocument({
      path: "Books/The Book/Ideas/Question.md",
      content: `---
type: "readany-knowledge"
id: "note-1"
documentType: "standalone_note"
title: "Question"
bookId: "book-1"
parentId: "folder-1"
tags: []
---
# Question

Why does this matter?
`,
    });

    expect(imported.frontmatter.parentId).toBe("folder-1");
    expect(imported.draft).toMatchObject({
      id: "note-1",
      bookId: "book-1",
      parentId: "folder-1",
      type: "standalone_note",
      title: "Question",
    });
  });

  it("imports ordinary Obsidian Markdown with frontmatter as an imported document", () => {
    const imported = parseKnowledgeMarkdownDocument({
      path: "Vault/Ideas/Slow Reading.md",
      content: [
        "---",
        'title: "Slow Reading"',
        "tags:",
        '  - "reading"',
        '  - "method"',
        "---",
        "# Slow Reading",
        "",
        "Read **slowly** and cite [[Book Home]].",
      ].join("\n"),
    });

    expect(imported.isReadAnyExport).toBe(false);
    expect(imported.warnings).toEqual(["frontmatter_not_readany"]);
    expect(imported.draft).toMatchObject({
      type: "imported_markdown",
      title: "Slow Reading",
      sourceKind: "obsidian",
      sourceId: "Vault/Ideas/Slow Reading.md",
      tags: ["reading", "method"],
      contentMd: "Read **slowly** and cite [[Book Home]].",
    });
    expect(imported.draft.contentJson).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Read " },
            { type: "text", text: "slowly", marks: [{ type: "bold" }] },
            { type: "text", text: " and cite " },
            {
              type: "readanyInternalLink",
              attrs: { label: "Book Home", title: "Book Home" },
            },
            { type: "text", text: "." },
          ],
        },
      ],
    });
  });

  it("imports ordinary Obsidian Markdown with inline frontmatter tag arrays", () => {
    const imported = parseKnowledgeMarkdownDocument({
      path: "Vault/Ideas/Inline Tags.md",
      content: [
        "---",
        'title: "Inline Tags"',
        "tags: [reading, \"slow method\", 'reader''s note']",
        "---",
        "# Inline Tags",
        "",
        "Keep Obsidian frontmatter portable.",
      ].join("\n"),
    });

    expect(imported.warnings).toEqual(["frontmatter_not_readany"]);
    expect(imported.draft.tags).toEqual(["reading", "slow method", "reader's note"]);
    expect(imported.draft.contentMd).toBe("Keep Obsidian frontmatter portable.");
  });

  it("places ordinary Markdown in the provided default parent folder", () => {
    const imported = parseKnowledgeMarkdownDocument({
      path: "Vault/Ideas/Slow Reading.md",
      content: "# Slow Reading\n\nRead slowly.",
      defaultParentId: "folder-current",
      bookId: "book-1",
    });

    expect(imported.draft).toMatchObject({
      bookId: "book-1",
      parentId: "folder-current",
      type: "imported_markdown",
      title: "Slow Reading",
    });
  });

  it("migrates imported ReadAny custom cards with current synced templates", () => {
    const plan = createKnowledgeMarkdownImportPlan({
      files: [
        {
          path: "Vault/Prompt.md",
          content: [
            "# Prompt",
            "",
            ':::readany-card type="custom:template-reading-question" version="1" title="My prompt"',
            "Question: What changed?",
            ":::",
          ].join("\n"),
        },
      ],
      cardTemplates: [
        {
          id: "template-reading-question",
          name: "Reading Prompt",
          version: 3,
          schemaJson: {
            cardType: "custom:template-reading-question",
            title: "Reading Prompt",
            markdown: "Prompt:\nResponse:",
            attrs: {
              data: { kind: "prompt" },
            },
          },
          builtIn: false,
          enabled: true,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    });

    const proposal = plan.documentItems[0]?.proposal;
    if (!proposal || proposal.action !== "create") {
      throw new Error("Expected document create proposal");
    }

    expect(proposal.draft.contentJson).toMatchObject({
      type: "doc",
      content: [
        {
          type: "readanyCard",
          attrs: {
            cardType: "custom:template-reading-question",
            version: 3,
            title: "My prompt",
            markdown: "Question: What changed?",
            data: { kind: "prompt" },
          },
        },
      ],
    });
  });

  it("creates folder proposals for ordinary Markdown path hierarchy", () => {
    const currentFolder = knowledgeDocument({
      id: "folder-current",
      bookId: "book-1",
      type: "folder",
      title: "Current Folder",
    });

    const plan = createKnowledgeMarkdownImportPlan({
      bookId: "book-1",
      defaultParentId: "folder-current",
      currentDocuments: [currentFolder],
      files: [
        {
          path: "/Users/me/Vault/Ideas/Slow Reading.md",
          relativePath: "Ideas/Slow Reading.md",
          content: "# Slow Reading\n\nRead slowly.",
        },
        {
          path: "/Users/me/Vault/Ideas/Themes/Attention.md",
          relativePath: "Ideas/Themes/Attention.md",
          content: "# Attention\n\nNotice what repeats.",
        },
      ],
    });

    expect(plan.items).toHaveLength(4);
    expect(plan.folderItems.map((item) => item.relativePath)).toEqual(["Ideas", "Ideas/Themes"]);
    expect(plan.documentItems.map((item) => item.relativePath)).toEqual([
      "Ideas/Slow Reading.md",
      "Ideas/Themes/Attention.md",
    ]);

    const [ideasFolder, themesFolder] = plan.folderItems;
    if (ideasFolder.proposal.action !== "create" || themesFolder.proposal.action !== "create") {
      throw new Error("Expected folder create proposals");
    }
    const [slowReadingDocument, attentionDocument] = plan.documentItems;
    if (
      slowReadingDocument.proposal.action !== "create" ||
      attentionDocument.proposal.action !== "create"
    ) {
      throw new Error("Expected document create proposals");
    }

    expect(ideasFolder.proposal).toMatchObject({
      action: "create",
      targetPath: "Knowledge base / Current Folder / Ideas",
      draft: {
        type: "folder",
        title: "Ideas",
        parentId: "folder-current",
        bookId: "book-1",
      },
    });
    expect(themesFolder.proposal).toMatchObject({
      action: "create",
      targetPath: "Knowledge base / Current Folder / Ideas / Themes",
      draft: {
        type: "folder",
        title: "Themes",
        parentId: ideasFolder.proposal.draft.id,
        bookId: "book-1",
      },
    });
    expect(slowReadingDocument.proposal).toMatchObject({
      action: "create",
      targetPath: "Knowledge base / Current Folder / Ideas / Slow Reading",
      draft: {
        title: "Slow Reading",
        parentId: ideasFolder.proposal.draft.id,
        bookId: "book-1",
      },
    });
    expect(attentionDocument.proposal).toMatchObject({
      action: "create",
      targetPath: "Knowledge base / Current Folder / Ideas / Themes / Attention",
      draft: {
        title: "Attention",
        parentId: themesFolder.proposal.draft.id,
        bookId: "book-1",
      },
    });
  });

  it("reuses existing destination folders when importing Markdown path hierarchy", () => {
    const currentFolder = knowledgeDocument({
      id: "folder-current",
      bookId: "book-1",
      type: "folder",
      title: "Current Folder",
    });
    const existingIdeasFolder = knowledgeDocument({
      id: "folder-ideas",
      bookId: "book-1",
      parentId: "folder-current",
      type: "folder",
      title: "Ideas",
    });

    const plan = createKnowledgeMarkdownImportPlan({
      bookId: "book-1",
      defaultParentId: "folder-current",
      currentDocuments: [currentFolder, existingIdeasFolder],
      files: [
        {
          path: "/Users/me/Vault/Ideas/Slow Reading.md",
          relativePath: "Ideas/Slow Reading.md",
          content: "# Slow Reading\n\nRead slowly.",
        },
        {
          path: "/Users/me/Vault/Ideas/Themes/Attention.md",
          relativePath: "Ideas/Themes/Attention.md",
          content: "# Attention\n\nNotice what repeats.",
        },
      ],
    });

    expect(plan.folderItems.map((item) => item.relativePath)).toEqual(["Ideas/Themes"]);
    const [themesFolder] = plan.folderItems;
    if (themesFolder.proposal.action !== "create") {
      throw new Error("Expected folder create proposal");
    }
    expect(themesFolder.proposal).toMatchObject({
      action: "create",
      targetPath: "Knowledge base / Current Folder / Ideas / Themes",
      draft: {
        type: "folder",
        title: "Themes",
        parentId: "folder-ideas",
        bookId: "book-1",
      },
    });

    const [slowReadingDocument, attentionDocument] = plan.documentItems;
    if (
      slowReadingDocument.proposal.action !== "create" ||
      attentionDocument.proposal.action !== "create"
    ) {
      throw new Error("Expected document create proposals");
    }
    expect(slowReadingDocument.proposal.draft.parentId).toBe("folder-ideas");
    expect(slowReadingDocument.proposal.targetPath).toBe(
      "Knowledge base / Current Folder / Ideas / Slow Reading",
    );
    expect(attentionDocument.proposal.draft.parentId).toBe(themesFolder.proposal.draft.id);
    expect(attentionDocument.proposal.targetPath).toBe(
      "Knowledge base / Current Folder / Ideas / Themes / Attention",
    );
  });

  it("warns when imported Markdown would duplicate a sibling document title", () => {
    const existingIdeasFolder = knowledgeDocument({
      id: "folder-ideas",
      bookId: "book-1",
      parentId: "folder-current",
      type: "folder",
      title: "Ideas",
    });
    const existingDocument = knowledgeDocument({
      id: "doc-existing",
      bookId: "book-1",
      parentId: "folder-ideas",
      type: "standalone_note",
      title: "Slow Reading",
    });

    const plan = createKnowledgeMarkdownImportPlan({
      bookId: "book-1",
      defaultParentId: "folder-current",
      currentDocuments: [existingIdeasFolder, existingDocument],
      files: [
        {
          path: "/Users/me/Vault/Ideas/Slow Reading.md",
          relativePath: "Ideas/Slow Reading.md",
          content: "# Slow Reading\n\nRead slowly.",
        },
      ],
    });

    expect(plan.folderItems).toEqual([]);
    expect(plan.documentItems[0].warnings).toContain("duplicate_sibling_title");
  });

  it("warns when a Markdown import batch contains duplicate sibling titles", () => {
    const plan = createKnowledgeMarkdownImportPlan({
      bookId: "book-1",
      files: [
        {
          path: "/Users/me/Vault/Ideas/Slow Reading.md",
          relativePath: "Ideas/Slow Reading.md",
          content: "# Slow Reading\n\nFirst copy.",
        },
        {
          path: "/Users/me/Vault/Ideas/slow   reading.md",
          relativePath: "Ideas/slow   reading.md",
          content: "# slow   reading\n\nSecond copy.",
        },
      ],
    });

    expect(plan.documentItems[0].warnings).not.toContain("duplicate_sibling_title");
    expect(plan.documentItems[1].warnings).toContain("duplicate_sibling_title");
  });

  it("derives relative import paths from the shared file directory", () => {
    const plan = createKnowledgeMarkdownImportPlan({
      bookId: "book-1",
      files: [
        {
          path: "/Users/me/Vault/Ideas/Slow Reading.md",
          content: "# Slow Reading\n\nRead slowly.",
        },
        {
          path: "/Users/me/Vault/Characters/Main.md",
          content: "# Main\n\nTrack relationships.",
        },
      ],
    });

    expect(plan.folderItems.map((item) => item.relativePath)).toEqual(["Ideas", "Characters"]);
    expect(plan.documentItems.map((item) => item.relativePath)).toEqual([
      "Ideas/Slow Reading.md",
      "Characters/Main.md",
    ]);
  });

  it("does not override ReadAny frontmatter parents with path-derived folders", () => {
    const plan = createKnowledgeMarkdownImportPlan({
      bookId: "book-1",
      defaultParentId: "folder-current",
      files: [
        {
          path: "Ideas/Question.md",
          content: `---
type: "readany-knowledge"
id: "note-1"
documentType: "standalone_note"
title: "Question"
bookId: "book-1"
parentId: "folder-from-frontmatter"
tags: []
---
# Question

Why does this matter?
`,
        },
      ],
    });

    expect(plan.folderItems).toEqual([]);
    if (plan.documentItems[0].proposal.action !== "create") {
      throw new Error("Expected document create proposal");
    }
    expect(plan.documentItems[0].proposal).toMatchObject({
      action: "create",
      draft: {
        id: "note-1",
        parentId: "folder-from-frontmatter",
      },
    });
  });

  it("keeps ReadAny exported root documents at their explicit parent", () => {
    const imported = parseKnowledgeMarkdownDocument({
      path: "Books/The Book/README.md",
      content: `---
type: "readany-knowledge"
id: "home-1"
documentType: "book_home"
title: "The Book"
bookId: "book-1"
tags: []
---
# The Book

Home note.
`,
      defaultParentId: "folder-current",
    });

    expect(imported.draft).toMatchObject({
      id: "home-1",
      type: "book_home",
      title: "The Book",
      parentId: undefined,
    });
  });

  it("uses the file name when ordinary Markdown has no title", () => {
    const imported = parseKnowledgeMarkdownDocument({
      path: "Vault/Untitled Note.md",
      content: "A note without a heading.",
    });

    expect(imported.draft.title).toBe("Untitled Note");
    expect(imported.draft.contentMd).toBe("A note without a heading.");
    expect(imported.draft.sourceKind).toBe("obsidian");
  });

  it("turns a single imported Markdown draft into a confirmation-required create proposal", () => {
    const imported = parseKnowledgeMarkdownDocument({
      path: "Vault/Ideas/Slow Reading.md",
      content: "# Slow Reading\n\nRead slowly.",
    });

    const proposal = createKnowledgeImportWriteProposal(imported);

    expect(proposal).toEqual({
      success: true,
      action: "create",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_create",
      message: "Imported knowledge draft generated. No document has been saved.",
      draft: expect.objectContaining({
        type: "imported_markdown",
        title: "Slow Reading",
        contentMd: "Read slowly.",
        tags: [],
        sourceKind: "obsidian",
        sourceId: "Vault/Ideas/Slow Reading.md",
      }),
    });
  });

  it("turns an imported ReadAny document into a confirmation-required update proposal", () => {
    const imported = parseKnowledgeMarkdownDocument({
      content: [
        "---",
        "type: readany-knowledge",
        'id: "doc-1"',
        'documentType: "standalone_note"',
        'title: "Updated Note"',
        "tags:",
        '  - "reading"',
        "---",
        "# Updated Note",
        "",
        "Updated in Obsidian.",
      ].join("\n"),
    });

    const proposal = createKnowledgeImportWriteProposal(imported, {
      mode: "update",
      current: {
        id: "doc-1",
        type: "standalone_note",
        title: "Old Note",
        tags: [],
        updatedAt: 1000,
      },
    });

    expect(proposal).toEqual({
      success: true,
      action: "update",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_update",
      message: "Imported knowledge update generated. The existing document has not been changed.",
      documentId: "doc-1",
      current: {
        id: "doc-1",
        type: "standalone_note",
        title: "Old Note",
        tags: [],
        updatedAt: 1000,
      },
      patch: expect.objectContaining({
        title: "Updated Note",
        contentMd: "Updated in Obsidian.",
        tags: ["reading"],
      }),
      changedFields: ["title", "contentMd", "contentJson", "excerpt", "tags"],
    });
  });

  it("creates a vault import plan for modified manifest-tracked documents", () => {
    const exporter = new KnowledgeExporter();
    const vault = exporter.buildVaultPackage(
      {
        documents: [knowledgeDocument({ bookId: undefined, sourceKind: undefined })],
      },
      { exportedAt: 1700000200000 },
    );
    const documentFile = vault.files.find((file) => file.path.endsWith(".md"));
    if (!documentFile) throw new Error("Expected exported document file");
    const editedContent = documentFile.content.replace(
      "A durable idea.",
      "A durable idea edited in Obsidian.",
    );

    const plan = createKnowledgeVaultImportPlan({
      manifest: vault.manifest,
      files: [{ path: documentFile.path, content: editedContent }],
    });

    expect(plan.entries).toHaveLength(1);
    expect(plan.missing).toEqual([]);
    expect(plan.unreadable).toEqual([]);
    expect(plan.modified).toHaveLength(1);
    expect(plan.modified[0]).toMatchObject({
      documentId: "doc-1",
      path: documentFile.path,
      status: "modified",
      previousHash: vault.manifest.documents["doc-1"].hash,
    });
    expect(plan.modified[0].draft?.draft).toMatchObject({
      id: "doc-1",
      type: "book_home",
      title: "Book Home",
      contentMd: expect.stringContaining("edited in Obsidian"),
    });

    const proposals = createKnowledgeVaultImportWriteProposals(plan);
    expect(proposals).toEqual([
      expect.objectContaining({
        action: "update",
        requiresConfirmation: true,
        confirmationKind: "knowledge_document_update",
        documentId: "doc-1",
        targetPath: documentFile.path,
        current: expect.objectContaining({
          id: "doc-1",
          type: "book_home",
          title: "Book Home",
          path: documentFile.path,
        }),
        patch: expect.objectContaining({
          title: "Book Home",
          contentMd: expect.stringContaining("edited in Obsidian"),
        }),
        changedFields: expect.arrayContaining(["contentMd", "contentJson", "excerpt", "tags"]),
      }),
    ]);
  });

  it("migrates custom cards while reconciling modified vault files", () => {
    const exporter = new KnowledgeExporter();
    const vault = exporter.buildVaultPackage(
      {
        documents: [
          knowledgeDocument({
            bookId: undefined,
            sourceKind: undefined,
            contentJson: {
              type: "doc",
              content: [
                {
                  type: "readanyCard",
                  attrs: {
                    cardType: "custom:template-reading-question",
                    version: 1,
                    title: "My prompt",
                    markdown: "Question: What changed?",
                  },
                },
              ],
            },
          }),
        ],
      },
      { exportedAt: 1700000200000, includeReadAnyCardMetadata: true },
    );
    const documentFile = vault.files.find((file) => file.path.endsWith(".md"));
    if (!documentFile) throw new Error("Expected exported document file");
    const editedContent = documentFile.content.replace(
      "Question: What changed?",
      "Question: What changed in Obsidian?",
    );

    const plan = createKnowledgeVaultImportPlan({
      manifest: vault.manifest,
      files: [{ path: documentFile.path, content: editedContent }],
      cardTemplates: [
        {
          id: "template-reading-question",
          name: "Reading Prompt",
          version: 3,
          schemaJson: {
            cardType: "custom:template-reading-question",
            title: "Reading Prompt",
            markdown: "Prompt:\nResponse:",
            attrs: {
              data: { kind: "prompt" },
            },
          },
          builtIn: false,
          enabled: true,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    });

    expect(plan.modified[0]?.draft?.draft.contentJson).toMatchObject({
      type: "doc",
      content: [
        {
          type: "readanyCard",
          attrs: {
            cardType: "custom:template-reading-question",
            version: 3,
            title: "My prompt",
            markdown: "Question: What changed in Obsidian?",
            data: { kind: "prompt" },
          },
        },
      ],
    });
  });

  it("uses disabled vault manifest card templates when reconciling existing custom cards", () => {
    const exporter = new KnowledgeExporter();
    const disabledTemplate: KnowledgeCardTemplate = {
      ...readingPromptTemplate,
      enabled: false,
    };
    const staleLocalTemplate: KnowledgeCardTemplate = {
      ...readingPromptTemplate,
      version: 1,
      schemaJson: {
        cardType: "custom:template-reading-question",
        title: "Stale Local Prompt",
        markdown: "Old prompt:",
        attrs: {
          data: { kind: "stale-local" },
        },
      },
      updatedAt: 1,
    };
    const vault = exporter.buildVaultPackage(
      {
        documents: [knowledgeDocument({ bookId: undefined, sourceKind: undefined })],
        cardTemplates: [disabledTemplate],
      },
      { exportedAt: 1700000200000, includeReadAnyCardMetadata: true },
    );
    expect(vault.manifest.cardTemplates).toEqual([disabledTemplate]);
    const documentFile = vault.files.find((file) => file.path.endsWith(".md"));
    if (!documentFile) throw new Error("Expected exported document file");

    const editedContent = [
      "---",
      "type: readany-knowledge",
      'id: "doc-1"',
      "documentType: standalone_note",
      'title: "Prompt"',
      "---",
      "",
      "# Prompt",
      "",
      ':::readany-card type="custom:template-reading-question" version="1" title="My prompt"',
      "Question: What changed in Obsidian?",
      ":::",
      "",
    ].join("\n");

    const plan = createKnowledgeVaultImportPlan({
      manifest: vault.manifest,
      files: [{ path: documentFile.path, content: editedContent }],
      cardTemplates: [staleLocalTemplate],
    });

    expect(plan.cardTemplateChanges).toEqual([
      {
        template: disabledTemplate,
        current: staleLocalTemplate,
        status: "modified",
        warnings: ["card_template_modified"],
      },
    ]);
    expect(plan.cardTemplateConflicts).toEqual([]);
    expect(plan.modified[0]?.draft?.draft.contentJson).toMatchObject({
      type: "doc",
      content: [
        {
          type: "readanyCard",
          attrs: {
            cardType: "custom:template-reading-question",
            version: 4,
            title: "My prompt",
            markdown: "Question: What changed in Obsidian?",
            data: { kind: "prompt" },
          },
        },
      ],
    });
  });

  it("plans missing vault manifest card templates for confirmed import", () => {
    const exporter = new KnowledgeExporter();
    const disabledTemplate: KnowledgeCardTemplate = {
      ...readingPromptTemplate,
      enabled: false,
    };
    const vault = exporter.buildVaultPackage(
      {
        documents: [knowledgeDocument({ bookId: undefined, sourceKind: undefined })],
        cardTemplates: [disabledTemplate],
      },
      { exportedAt: 1700000200000 },
    );
    const documentFile = vault.files.find((file) => file.path.endsWith(".md"));
    if (!documentFile) throw new Error("Expected exported document file");

    const plan = createKnowledgeVaultImportPlan({
      manifest: vault.manifest,
      files: [{ path: documentFile.path, content: documentFile.content }],
      cardTemplates: [],
    });

    expect(plan.modified).toEqual([]);
    expect(plan.cardTemplateChanges).toEqual([
      {
        template: disabledTemplate,
        status: "missing",
        warnings: ["card_template_missing"],
      },
    ]);
    expect(plan.cardTemplateConflicts).toEqual([]);
    expect(createKnowledgeVaultImportWriteProposals(plan)).toEqual([]);
  });

  it("does not auto-apply older vault card templates over newer local templates", () => {
    const exporter = new KnowledgeExporter();
    const newerLocalTemplate: KnowledgeCardTemplate = {
      ...readingPromptTemplate,
      version: 5,
      updatedAt: 99,
      schemaJson: {
        cardType: "custom:template-reading-question",
        title: "New Local Prompt",
        markdown: "Local prompt:",
      },
    };
    const vault = exporter.buildVaultPackage(
      {
        documents: [knowledgeDocument({ bookId: undefined, sourceKind: undefined })],
        cardTemplates: [readingPromptTemplate],
      },
      { exportedAt: 1700000200000 },
    );
    const documentFile = vault.files.find((file) => file.path.endsWith(".md"));
    if (!documentFile) throw new Error("Expected exported document file");

    const plan = createKnowledgeVaultImportPlan({
      manifest: vault.manifest,
      files: [{ path: documentFile.path, content: documentFile.content }],
      cardTemplates: [newerLocalTemplate],
    });

    expect(plan.cardTemplateChanges).toEqual([]);
    expect(plan.cardTemplateConflicts).toEqual([
      {
        template: readingPromptTemplate,
        current: newerLocalTemplate,
        status: "conflict",
        warnings: ["local_card_template_newer"],
        resolution: {
          kind: "keep_local_template",
          suggestedAction: "review_template_then_export_again",
          safeDefault: "keep_local_template",
          blocksAutomaticApply: true,
        },
      },
    ]);
  });

  it("reconciles moved Obsidian files by stable ReadAny document id", () => {
    const exporter = new KnowledgeExporter();
    const vault = exporter.buildVaultPackage(
      {
        documents: [knowledgeDocument({ bookId: undefined, sourceKind: undefined })],
      },
      { exportedAt: 1700000200000 },
    );
    const documentFile = vault.files.find((file) => file.path.endsWith(".md"));
    if (!documentFile) throw new Error("Expected exported document file");
    const fileName = documentFile.path.split("/").pop();
    if (!fileName) throw new Error("Expected exported document file name");
    const movedPath = documentFile.path.replace(fileName, `Moved/${fileName}`);
    const movedContent = documentFile.content.replace(
      "A durable idea.",
      "A durable idea moved and edited in Obsidian.",
    );

    const plan = createKnowledgeVaultImportPlan({
      manifest: vault.manifest,
      files: [{ path: movedPath, content: movedContent }],
    });

    expect(plan.missing).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.modified).toHaveLength(1);
    expect(plan.modified[0]).toMatchObject({
      documentId: "doc-1",
      path: movedPath,
      status: "modified",
      previousHash: vault.manifest.documents["doc-1"].hash,
      warnings: ["manifest_path_changed"],
    });

    const proposals = createKnowledgeVaultImportWriteProposals(plan);
    expect(proposals).toEqual([
      expect.objectContaining({
        action: "update",
        documentId: "doc-1",
        targetPath: movedPath,
        message: `Imported changes from ${movedPath}. The knowledge document has not been changed.`,
        current: expect.objectContaining({
          path: documentFile.path,
        }),
        patch: expect.objectContaining({
          contentMd: expect.stringContaining("moved and edited in Obsidian"),
        }),
      }),
    ]);
  });

  it("treats duplicate ReadAny frontmatter ids as vault import conflicts", () => {
    const exporter = new KnowledgeExporter();
    const vault = exporter.buildVaultPackage(
      {
        documents: [knowledgeDocument({ bookId: undefined, sourceKind: undefined })],
      },
      { exportedAt: 1700000200000 },
    );
    const documentFile = vault.files.find((file) => file.path.endsWith(".md"));
    if (!documentFile) throw new Error("Expected exported document file");
    const duplicatePath = documentFile.path.replace(/\.md$/i, " Copy.md");

    const plan = createKnowledgeVaultImportPlan({
      manifest: vault.manifest,
      files: [
        { path: documentFile.path, content: documentFile.content },
        { path: duplicatePath, content: documentFile.content },
      ],
    });

    expect(plan.modified).toEqual([]);
    expect(plan.missing).toEqual([]);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({
        documentId: "doc-1",
        path: documentFile.path,
        status: "conflict",
        warnings: ["multiple_files_with_same_document_id"],
        resolution: {
          kind: "remove_duplicate",
          suggestedAction: "remove_duplicate_then_reimport",
          safeDefault: "keep_readany",
          blocksAutomaticApply: true,
        },
      }),
    ]);
    expect(createKnowledgeVaultImportWriteProposals(plan)).toEqual([]);
  });

  it("resolves path-backed internal links to manifest document ids during vault import", () => {
    const exporter = new KnowledgeExporter();
    const source = knowledgeDocument({
      id: "doc-1",
      bookId: undefined,
      sourceKind: undefined,
      contentJson: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Home body." }],
          },
        ],
      },
      contentMd: "",
    });
    const folder = knowledgeDocument({
      id: "folder-1",
      bookId: undefined,
      parentId: undefined,
      type: "folder",
      title: "Ideas",
      sourceKind: undefined,
      contentJson: { type: "doc", content: [] },
      contentMd: "",
      tags: [],
    });
    const target = knowledgeDocument({
      id: "note-2",
      bookId: undefined,
      parentId: "folder-1",
      type: "standalone_note",
      title: "Question Log",
      sourceKind: undefined,
      contentJson: { type: "doc", content: [] },
      contentMd: "Target body.",
      tags: [],
    });
    const vault = exporter.buildVaultPackage(
      {
        documents: [source, folder, target],
      },
      { rootDir: "ReadAny", exportedAt: 1700000200000 },
    );
    const sourceFile = vault.files.find(
      (file) => file.path === vault.manifest.documents["doc-1"].path,
    );
    if (!sourceFile) throw new Error("Expected exported source document");
    const rootlessTargetPath = vault.manifest.documents["note-2"].path
      .replace(/^ReadAny\//, "")
      .replace(/\.md$/i, "");
    const editedContent = sourceFile.content.replace(
      "Home body.",
      `Home body.\n\nSee [[${rootlessTargetPath}|Question Log]].`,
    );

    const plan = createKnowledgeVaultImportPlan({
      manifest: vault.manifest,
      files: [{ path: sourceFile.path, content: editedContent }],
    });

    expect(plan.modified).toHaveLength(1);
    expect(plan.modified[0].draft?.draft.contentJson).toMatchObject({
      type: "doc",
      content: expect.arrayContaining([
        {
          type: "paragraph",
          content: expect.arrayContaining([
            {
              type: "readanyInternalLink",
              attrs: {
                documentId: "note-2",
                targetPath: rootlessTargetPath,
                label: "Question Log",
                title: "Question Log",
              },
            },
          ]),
        },
      ]),
    });
  });

  it("resolves folder index aliases to manifest document ids during vault import", () => {
    const exporter = new KnowledgeExporter();
    const source = knowledgeDocument({
      id: "doc-1",
      bookId: undefined,
      sourceKind: undefined,
      contentJson: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Home body." }],
          },
        ],
      },
      contentMd: "",
    });
    const folder = knowledgeDocument({
      id: "folder-1",
      bookId: undefined,
      parentId: undefined,
      type: "folder",
      title: "Ideas",
      sourceKind: undefined,
      contentJson: { type: "doc", content: [] },
      contentMd: "",
      tags: [],
    });
    const vault = exporter.buildVaultPackage(
      {
        documents: [source, folder],
      },
      { rootDir: "ReadAny", exportedAt: 1700000200000 },
    );
    const sourceFile = vault.files.find(
      (file) => file.path === vault.manifest.documents["doc-1"].path,
    );
    if (!sourceFile) throw new Error("Expected exported source document");

    const editedContent = sourceFile.content.replace(
      "Home body.",
      "Home body.\n\nSee [[Ideas/index|Ideas]].",
    );

    const plan = createKnowledgeVaultImportPlan({
      manifest: vault.manifest,
      files: [{ path: sourceFile.path, content: editedContent }],
    });

    expect(plan.modified).toHaveLength(1);
    expect(plan.modified[0].draft?.draft.contentJson).toMatchObject({
      type: "doc",
      content: expect.arrayContaining([
        {
          type: "paragraph",
          content: expect.arrayContaining([
            {
              type: "readanyInternalLink",
              attrs: {
                documentId: "folder-1",
                targetPath: "Ideas/index",
                label: "Ideas",
                title: "Ideas",
              },
            },
          ]),
        },
      ]),
    });
  });

  it("detects local and Obsidian edits as vault import conflicts", () => {
    const exporter = new KnowledgeExporter();
    const original = knowledgeDocument({ bookId: undefined, sourceKind: undefined });
    const vault = exporter.buildVaultPackage(
      {
        documents: [original],
      },
      { exportedAt: 1700000200000 },
    );
    const documentFile = vault.files.find((file) => file.path.endsWith(".md"));
    if (!documentFile) throw new Error("Expected exported document file");

    const obsidianContent = documentFile.content.replace(
      "A durable idea.",
      "A durable idea edited in Obsidian.",
    );
    const localVault = exporter.buildVaultPackage(
      {
        documents: [
          knowledgeDocument({
            bookId: undefined,
            sourceKind: undefined,
            contentJson: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "A durable idea edited in ReadAny." }],
                },
              ],
            },
          }),
        ],
      },
      {
        exportedAt: 1700000300000,
        previousManifest: vault.manifest,
      },
    );
    const currentFile = localVault.files.find((file) => file.path === documentFile.path);
    if (!currentFile) throw new Error("Expected current local document file");

    const plan = createKnowledgeVaultImportPlan({
      manifest: vault.manifest,
      files: [{ path: documentFile.path, content: obsidianContent }],
      currentFiles: [{ path: currentFile.path, content: currentFile.content }],
    });

    expect(plan.modified).toEqual([]);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({
        documentId: "doc-1",
        path: documentFile.path,
        status: "conflict",
        previousHash: vault.manifest.documents["doc-1"].hash,
        existingHash: expect.any(String),
        currentHash: expect.any(String),
        warnings: ["local_and_remote_modified"],
        resolution: {
          kind: "manual_merge",
          suggestedAction: "merge_then_reimport",
          safeDefault: "keep_readany",
          blocksAutomaticApply: true,
        },
      }),
    ]);
    expect(createKnowledgeVaultImportWriteProposals(plan)).toEqual([]);
  });

  it("keeps unchanged manifest files out of the modified import list", () => {
    const exporter = new KnowledgeExporter();
    const vault = exporter.buildVaultPackage({
      documents: [knowledgeDocument({ bookId: undefined })],
    });
    const documentFile = vault.files.find((file) => file.path.endsWith(".md"));
    if (!documentFile) throw new Error("Expected exported document file");

    const plan = createKnowledgeVaultImportPlan({
      manifest: vault.manifest,
      files: [{ path: documentFile.path, content: documentFile.content }],
    });

    expect(plan.modified).toEqual([]);
    expect(plan.entries).toEqual([
      expect.objectContaining({
        documentId: "doc-1",
        status: "unchanged",
        previousHash: vault.manifest.documents["doc-1"].hash,
        existingHash: vault.manifest.documents["doc-1"].hash,
      }),
    ]);
  });

  it("reports missing and unreadable modified vault files", () => {
    const exporter = new KnowledgeExporter();
    const vault = exporter.buildVaultPackage({
      documents: [
        knowledgeDocument({ id: "doc-missing", bookId: undefined }),
        knowledgeDocument({ id: "doc-unreadable", bookId: undefined, title: "Unreadable" }),
      ],
    });
    const unreadablePath = vault.manifest.documents["doc-unreadable"].path;

    const plan = createKnowledgeVaultImportPlan({
      manifest: vault.manifest,
      files: [{ path: unreadablePath, hash: "fnv1a32:changed" }],
    });

    expect(plan.missing).toEqual([
      expect.objectContaining({
        documentId: "doc-missing",
        status: "missing",
        warnings: ["manifest_file_missing"],
        resolution: {
          kind: "restore_missing",
          suggestedAction: "restore_file_or_export_again",
          safeDefault: "keep_readany",
          blocksAutomaticApply: true,
        },
      }),
    ]);
    expect(plan.unreadable).toEqual([
      expect.objectContaining({
        documentId: "doc-unreadable",
        status: "modified_unreadable",
        existingHash: "fnv1a32:changed",
        warnings: ["modified_file_content_missing"],
        resolution: {
          kind: "restore_readable",
          suggestedAction: "grant_access_or_export_again",
          safeDefault: "keep_readany",
          blocksAutomaticApply: true,
        },
      }),
    ]);
  });
});
