import { describe, expect, it } from "vitest";
import { getKnowledgeToolResultDisplay } from "../ai/knowledge-tool-result";
import type {
  Book,
  JSONValue,
  KnowledgeAttachment,
  KnowledgeCardTemplate,
  KnowledgeDocument,
  KnowledgeLink,
} from "../types";
import {
  KnowledgeExporter,
  createKnowledgeExportHash,
  scopeKnowledgeExportInputToDocumentSubtree,
} from "./knowledge-exporter";

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
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Notes" }],
        },
        {
          type: "readanyCard",
          attrs: {
            cardType: "bookQuote",
            title: "Quote",
            text: "Reading is thinking.",
            sourceTitle: "Chapter 1",
          },
        },
      ],
    },
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

describe("KnowledgeExporter", () => {
  it("exports book home documents as Obsidian-friendly README files", () => {
    const exporter = new KnowledgeExporter();
    const files = exporter.export({
      books: [baseBook],
      documents: [knowledgeDocument()],
    });

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("Books/The Book A Study/README.md");
    expect(files[0].mimeType).toBe("text/markdown");
    expect(files[0].content).toContain("type: readany-knowledge");
    expect(files[0].content).toContain('title: "Book Home"');
    expect(files[0].content).toContain('book: "The Book: A Study"');
    expect(files[0].content).toContain("# Book Home");
    expect(files[0].content).toContain("## Notes");
    expect(files[0].content).toContain("> [!quote] Quote");
    expect(files[0].content).toContain("> Reading is thinking.");
  });

  it("exports folders as directory README files and nests child documents", () => {
    const exporter = new KnowledgeExporter();
    const folder = knowledgeDocument({
      id: "folder-1",
      type: "folder",
      title: "Reading Trail",
      contentJson: { type: "doc", content: [] },
      contentMd: "",
      tags: [],
    });
    const note = knowledgeDocument({
      id: "note-1",
      parentId: "folder-1",
      type: "standalone_note",
      title: "Question Log",
      contentJson: { type: "doc", content: [] },
      contentMd: "Why does this matter?",
    });
    const nestedFolder = knowledgeDocument({
      id: "folder-2",
      parentId: "folder-1",
      type: "folder",
      title: "Themes",
      contentJson: { type: "doc", content: [] },
      contentMd: "",
      tags: [],
    });
    const nestedNoteWithSameName = knowledgeDocument({
      id: "note-2",
      parentId: "folder-2",
      type: "standalone_note",
      title: "Question Log",
      contentJson: { type: "doc", content: [] },
      contentMd: "A same-name note can live in a different folder.",
    });
    const vault = exporter.buildVaultPackage({
      books: [baseBook],
      documents: [knowledgeDocument(), folder, note, nestedFolder, nestedNoteWithSameName],
    });

    expect(vault.files.map((file) => file.path)).toContain(
      "Books/The Book A Study/Reading Trail/README.md",
    );
    expect(vault.files.map((file) => file.path)).toContain(
      "Books/The Book A Study/Reading Trail/Question Log.md",
    );
    expect(vault.files.map((file) => file.path)).toContain(
      "Books/The Book A Study/Reading Trail/Themes/README.md",
    );
    expect(vault.files.map((file) => file.path)).toContain(
      "Books/The Book A Study/Reading Trail/Themes/Question Log.md",
    );
    expect(vault.files.find((file) => file.path.endsWith("Question Log.md"))?.content).toContain(
      'parentId: "folder-1"',
    );
    expect(vault.manifest.documents["note-1"]).toMatchObject({
      parentId: "folder-1",
      path: "Books/The Book A Study/Reading Trail/Question Log.md",
    });
    expect(vault.manifest.documents["folder-2"]).toMatchObject({
      parentId: "folder-1",
      path: "Books/The Book A Study/Reading Trail/Themes/README.md",
    });
    expect(vault.manifest.documents["note-2"]).toMatchObject({
      parentId: "folder-2",
      path: "Books/The Book A Study/Reading Trail/Themes/Question Log.md",
    });
  });

  it("scopes export input to a folder subtree with matching links and attachments", () => {
    const folder = knowledgeDocument({
      id: "folder-1",
      type: "folder",
      title: "Ideas",
      contentJson: { type: "doc", content: [] },
      contentMd: "",
    });
    const child = knowledgeDocument({
      id: "child-1",
      parentId: "folder-1",
      type: "standalone_note",
      title: "Question Log",
      contentJson: { type: "doc", content: [] },
      contentMd: "Why does this matter?",
    });
    const nested = knowledgeDocument({
      id: "nested-1",
      parentId: "folder-1",
      type: "standalone_note",
      title: "Theme Map",
      contentJson: { type: "doc", content: [] },
      contentMd: "Attention and memory.",
    });
    const sibling = knowledgeDocument({
      id: "sibling-1",
      type: "standalone_note",
      title: "Outside",
      contentJson: { type: "doc", content: [] },
      contentMd: "This should not be exported.",
    });
    const scoped = scopeKnowledgeExportInputToDocumentSubtree(
      {
        books: [baseBook],
        documents: [knowledgeDocument(), folder, child, nested, sibling],
        links: [
          {
            id: "inside-link",
            fromDocumentId: "child-1",
            toKind: "document",
            toId: "nested-1",
            relation: "references",
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: "outside-document-link",
            fromDocumentId: "child-1",
            toKind: "document",
            toId: "sibling-1",
            relation: "references",
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: "source-link",
            fromDocumentId: "child-1",
            toKind: "highlight",
            toId: "highlight-1",
            relation: "source",
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: "sibling-link",
            fromDocumentId: "sibling-1",
            toKind: "highlight",
            toId: "highlight-2",
            relation: "source",
            createdAt: 1,
            updatedAt: 1,
          },
        ] satisfies KnowledgeLink[],
        attachments: [
          {
            id: "child-attachment",
            documentId: "child-1",
            kind: "image",
            fileName: "diagram.png",
            localPath: "attachments/diagram.png",
            size: 10,
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: "sibling-attachment",
            documentId: "sibling-1",
            kind: "image",
            fileName: "outside.png",
            localPath: "attachments/outside.png",
            size: 10,
            createdAt: 1,
            updatedAt: 1,
          },
        ] satisfies KnowledgeAttachment[],
      },
      folder,
    );

    expect(scoped.documents.map((document) => document.id)).toEqual([
      "folder-1",
      "child-1",
      "nested-1",
    ]);
    expect(scoped.links?.map((link) => link.id)).toEqual(["inside-link", "source-link"]);
    expect(scoped.attachments?.map((attachment) => attachment.id)).toEqual(["child-attachment"]);

    const bundle = new KnowledgeExporter().exportBundle(scoped, {
      format: "obsidian",
      rootDir: "ReadAny",
      title: "Ideas Export",
    });
    expect(bundle.content).toContain(
      "_Source: `ReadAny/Books/The Book A Study/Ideas/Question Log.md`_",
    );
    expect(bundle.content).not.toContain("Outside");
  });

  it("renders links and attachments into readable Markdown sections", () => {
    const exporter = new KnowledgeExporter();
    const related = knowledgeDocument({
      id: "doc-2",
      type: "standalone_note",
      title: "Related Idea",
      bookId: undefined,
      sourceKind: undefined,
      sourceId: undefined,
      contentJson: { type: "doc", content: [] },
    });
    const links: KnowledgeLink[] = [
      {
        id: "link-1",
        fromDocumentId: "doc-1",
        toKind: "document",
        toId: "doc-2",
        relation: "related",
        createdAt: 1000,
        updatedAt: 1000,
      },
      {
        id: "link-2",
        fromDocumentId: "doc-1",
        toKind: "highlight",
        toId: "hl-1",
        relation: "source",
        label: "Original highlight",
        cfi: "epubcfi(/6/2!/4/8)",
        createdAt: 1000,
        updatedAt: 1000,
      },
      {
        id: "link-3",
        fromDocumentId: "doc-1",
        toKind: "cfi",
        toId: "epubcfi(/6/4)",
        relation: "source",
        label: "Precise location",
        cfi: "epubcfi(/6/4)",
        createdAt: 1000,
        updatedAt: 1000,
      },
    ];
    const attachments: KnowledgeAttachment[] = [
      {
        id: "att-1",
        documentId: "doc-1",
        kind: "image",
        fileName: "diagram.png",
        localPath: "attachments/diagram.png",
        size: 128,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ];

    const files = exporter.export({
      books: [baseBook],
      documents: [knowledgeDocument(), related],
      links,
      attachments,
    });
    const home = files.find((file) => file.path.endsWith("README.md"));

    expect(home?.content).toContain("## ReadAny Links");
    expect(home?.content).toContain("- **related:** [[Notes/Related Idea|Related Idea]]");
    expect(home?.content).toContain(
      "- **source:** [Original highlight](readany://cfi/epubcfi%28%2F6%2F2!%2F4%2F8%29?sourceId=hl-1)",
    );
    expect(home?.content).toContain(
      "- **source:** [Precise location](readany://cfi/epubcfi%28%2F6%2F4%29)",
    );
    expect(home?.content).toContain("## Attachments");
    expect(home?.content).toContain("- [diagram.png](attachments/diagram.png)");
  });

  it("renders document links with vault paths so same-title notes stay unambiguous", () => {
    const exporter = new KnowledgeExporter();
    const folder = knowledgeDocument({
      id: "folder-1",
      type: "folder",
      title: "Reading Trail",
      contentJson: { type: "doc", content: [] },
      contentMd: "",
      tags: [],
    });
    const firstNote = knowledgeDocument({
      id: "note-1",
      parentId: "folder-1",
      type: "standalone_note",
      title: "Question Log",
      contentJson: { type: "doc", content: [] },
      contentMd: "One question.",
    });
    const nestedFolder = knowledgeDocument({
      id: "folder-2",
      parentId: "folder-1",
      type: "folder",
      title: "Themes",
      contentJson: { type: "doc", content: [] },
      contentMd: "",
      tags: [],
    });
    const nestedNote = knowledgeDocument({
      id: "note-2",
      parentId: "folder-2",
      type: "standalone_note",
      title: "Question Log",
      contentJson: { type: "doc", content: [] },
      contentMd: "A same-name note can live in a different folder.",
    });
    const links: KnowledgeLink[] = [
      {
        id: "link-1",
        fromDocumentId: "doc-1",
        toKind: "document",
        toId: "note-1",
        relation: "related",
        createdAt: 1000,
        updatedAt: 1000,
      },
      {
        id: "link-2",
        fromDocumentId: "doc-1",
        toKind: "document",
        toId: "note-2",
        relation: "related",
        label: "Deep | question",
        createdAt: 1000,
        updatedAt: 1000,
      },
    ];
    const vault = exporter.buildVaultPackage({
      books: [baseBook],
      documents: [knowledgeDocument(), folder, firstNote, nestedFolder, nestedNote],
      links,
    });
    const home = vault.files.find((file) => file.path === "Books/The Book A Study/README.md");

    expect(home?.content).toContain(
      "- **related:** [[Books/The Book A Study/Reading Trail/Question Log|Question Log]]",
    );
    expect(home?.content).toContain(
      "- **related:** [[Books/The Book A Study/Reading Trail/Themes/Question Log|Deep \\| question]]",
    );
  });

  it("renders inline internal links with vault paths in exported document bodies", () => {
    const exporter = new KnowledgeExporter();
    const folder = knowledgeDocument({
      id: "folder-1",
      type: "folder",
      title: "Reading Trail",
      contentJson: { type: "doc", content: [] },
      contentMd: "",
      tags: [],
    });
    const firstNote = knowledgeDocument({
      id: "note-1",
      parentId: "folder-1",
      type: "standalone_note",
      title: "Question Log",
      contentJson: { type: "doc", content: [] },
      contentMd: "One question.",
    });
    const nestedFolder = knowledgeDocument({
      id: "folder-2",
      parentId: "folder-1",
      type: "folder",
      title: "Themes",
      contentJson: { type: "doc", content: [] },
      contentMd: "",
      tags: [],
    });
    const nestedNote = knowledgeDocument({
      id: "note-2",
      parentId: "folder-2",
      type: "standalone_note",
      title: "Question Log",
      contentJson: { type: "doc", content: [] },
      contentMd: "A same-name note can live in a different folder.",
    });
    const home = knowledgeDocument({
      contentJson: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Compare " },
              {
                type: "readanyInternalLink",
                attrs: {
                  documentId: "note-1",
                  label: "Question Log",
                  title: "Question Log",
                },
              },
              { type: "text", text: " and " },
              {
                type: "readanyInternalLink",
                attrs: {
                  documentId: "note-2",
                  label: "Deep question",
                  title: "Question Log",
                },
              },
              { type: "text", text: "." },
            ],
          },
        ],
      },
    });
    const vault = exporter.buildVaultPackage({
      books: [baseBook],
      documents: [home, folder, firstNote, nestedFolder, nestedNote],
    });
    const homeFile = vault.files.find((file) => file.path === "Books/The Book A Study/README.md");

    expect(homeFile?.content).toContain(
      "Compare [[Books/The Book A Study/Reading Trail/Question Log|Question Log]] and [[Books/The Book A Study/Reading Trail/Themes/Question Log|Deep question]].",
    );
  });

  it("skips deleted documents by default and disambiguates duplicate paths", () => {
    const exporter = new KnowledgeExporter();
    const files = exporter.export({
      documents: [
        knowledgeDocument({
          id: "doc-a",
          bookId: undefined,
          type: "standalone_note",
          title: "Same Name",
        }),
        knowledgeDocument({
          id: "doc-b",
          bookId: undefined,
          type: "standalone_note",
          title: "Same Name",
        }),
        knowledgeDocument({
          id: "doc-deleted",
          bookId: undefined,
          type: "standalone_note",
          title: "Deleted",
          deletedAt: 2000,
        }),
      ],
    });

    expect(files.map((file) => file.path)).toEqual(["Notes/Same Name.md", "Notes/Same Name-2.md"]);
  });

  it("can preserve ReadAny card metadata for round-tripping exports", () => {
    const exporter = new KnowledgeExporter();
    const [file] = exporter.export(
      {
        documents: [knowledgeDocument({ bookId: undefined })],
      },
      { format: "markdown", includeReadAnyCardMetadata: true },
    );

    expect(file.content).toContain(':::readany-card type="bookQuote" version="1"');
    expect(file.content).toContain("Reading is thinking.");
    expect(file.content).not.toContain("type: readany-knowledge");
  });

  it("migrates custom card metadata with synced templates during export", () => {
    const exporter = new KnowledgeExporter();
    const [file] = exporter.export(
      {
        documents: [
          knowledgeDocument({
            bookId: undefined,
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
        cardTemplates: [readingPromptTemplate],
      },
      { format: "markdown", includeReadAnyCardMetadata: true },
    );

    expect(file.content).toContain(
      ':::readany-card type="custom:template-reading-question" version="4" title="My prompt" data="%7B%22kind%22%3A%22prompt%22%7D"',
    );
    expect(file.content).toContain("Question: What changed?");
    expect(file.content).not.toContain("Prompt:\\nResponse:");
  });

  it("exports structured custom card fields as readable Markdown", () => {
    const exporter = new KnowledgeExporter();
    const [file] = exporter.export(
      {
        documents: [
          knowledgeDocument({
            bookId: undefined,
            contentJson: {
              type: "doc",
              content: [
                {
                  type: "readanyCard",
                  attrs: {
                    cardType: "custom:template-concept",
                    version: 1,
                    title: "Attention",
                    markdown: "Definition: directed perception",
                    data: {
                      term: "Attention",
                      confidence: 0.92,
                    },
                  },
                },
              ],
            },
          }),
        ],
        cardTemplates: [
          {
            id: "template-concept",
            name: "Concept",
            version: 1,
            schemaJson: {
              cardType: "custom:template-concept",
              title: "Concept",
              fields: [
                { key: "term", label: "Term", type: "text" },
                { key: "confidence", label: "Confidence", type: "number" },
                { key: "source", label: "Source", type: "text", required: true },
              ],
            },
            builtIn: false,
            enabled: true,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      },
      { format: "markdown", includeReadAnyCardMetadata: true },
    );

    expect(file.content).toContain("Definition: directed perception");
    expect(file.content).toContain("Fields:");
    expect(file.content).toContain("- Term: Attention");
    expect(file.content).toContain("- Confidence: 0.92");
    expect(file.content).toContain("- Source: Missing required value");
  });

  it("exports AI tool failure cards with paths and safe no-write hints", () => {
    const display = getKnowledgeToolResultDisplay("compressKnowledgeDocumentSummary", {
      success: false,
      status: "failed",
      error: "Model request failed",
      reason: "model_error",
      documentId: "doc-1",
      document: {
        id: "doc-1",
        title: "Durable Memory",
        type: "summary",
        path: "Knowledge base / Chapter Notes / Durable Memory",
      },
    });
    const failureAttrs = display?.failureCardAttrs;
    if (!failureAttrs) throw new Error("Expected knowledge tool failure card attrs");

    const failureDoc = knowledgeDocument({
      id: "failure-doc",
      bookId: undefined,
      type: "standalone_note",
      title: "Tool Failure Log",
      sourceKind: undefined,
      sourceId: undefined,
      contentJson: {
        type: "doc",
        content: [
          {
            type: "readanyCard",
            attrs: failureAttrs as unknown as JSONValue,
          },
        ],
      },
      contentMd: "",
    });
    const vault = new KnowledgeExporter().buildVaultPackage({
      documents: [failureDoc],
    });
    const exported = vault.files.find((file) => file.path === "Notes/Tool Failure Log.md");

    expect(vault.manifest.documents["failure-doc"]).toMatchObject({
      id: "failure-doc",
      path: "Notes/Tool Failure Log.md",
    });
    expect(exported?.content).toContain("> [!failure] compressKnowledgeDocumentSummary");
    expect(exported?.content).toContain("> Tool: compressKnowledgeDocumentSummary");
    expect(exported?.content).toContain("> Status: failed");
    expect(exported?.content).toContain("> Error: Model request failed");
    expect(exported?.content).toContain("> Reason: model_error");
    expect(exported?.content).toContain("> Document: doc-1");
    expect(exported?.content).toContain("> Path: Knowledge base / Chapter Notes / Durable Memory");
    expect(exported?.content).toContain(
      "> No knowledge document or link was saved or changed by this failed tool call.",
    );
  });

  it("exports multiple documents as a single shareable knowledge bundle", () => {
    const exporter = new KnowledgeExporter();
    const bundle = exporter.exportBundle(
      {
        books: [baseBook],
        documents: [
          knowledgeDocument(),
          knowledgeDocument({
            id: "doc-2",
            type: "standalone_note",
            title: "Second Note",
            contentJson: { type: "doc", content: [] },
            contentMd: "## A nested idea\n\nMore detail.",
            updatedAt: 1700000300000,
          }),
        ],
      },
      {
        format: "obsidian",
        rootDir: "ReadAny",
        title: "The Book Knowledge",
        exportedAt: 1700000400000,
      },
    );

    expect(bundle.path).toBe("ReadAny/The Book Knowledge.md");
    expect(bundle.mimeType).toBe("text/markdown");
    expect(bundle.content).toContain("type: readany-knowledge-bundle");
    expect(bundle.content).toContain('title: "The Book Knowledge"');
    expect(bundle.content).toContain("documentCount: 2");
    expect(bundle.content).toContain("# The Book Knowledge");
    expect(bundle.content).toContain("Documents: 2");
    expect(bundle.content).toContain("## Book Home");
    expect(bundle.content).toContain("_Source: `ReadAny/Books/The Book A Study/README.md`_");
    expect(bundle.content).toContain("## Second Note");
    expect(bundle.content).toContain("### A nested idea");
    expect(bundle.content.match(/type: readany-knowledge/g)).toHaveLength(1);
  });

  it("builds a vault package with a ReadAny manifest", () => {
    const exporter = new KnowledgeExporter();
    const vault = exporter.buildVaultPackage(
      {
        books: [baseBook],
        documents: [knowledgeDocument()],
      },
      { rootDir: "ReadAny", exportedAt: 1700000200000 },
    );

    expect(vault.conflicts).toEqual([]);
    expect(vault.files.map((file) => file.path)).toEqual([
      "ReadAny/Books/The Book A Study/README.md",
      "ReadAny/.readany/manifest.json",
    ]);
    expect(vault.files[vault.files.length - 1]?.mimeType).toBe("application/json");
    expect(vault.manifest).toMatchObject({
      version: 1,
      app: "ReadAny",
      format: "obsidian",
      rootDir: "ReadAny",
      exportedAt: 1700000200000,
    });
    expect(vault.manifest.documents["doc-1"]).toMatchObject({
      id: "doc-1",
      type: "book_home",
      title: "Book Home",
      path: "ReadAny/Books/The Book A Study/README.md",
      bookId: "book-1",
      sourceKind: "book",
      sourceId: "book-1",
      contentSchemaVersion: 1,
      updatedAt: 1700000100000,
    });
    expect(vault.manifest.documents["doc-1"].hash).toBe(
      createKnowledgeExportHash(vault.files[0].content),
    );

    const manifestFile = vault.files.find((file) => file.path.endsWith("manifest.json"));
    expect(JSON.parse(manifestFile?.content ?? "{}")).toEqual(vault.manifest);
  });

  it("stores custom card template snapshots in vault manifests", () => {
    const exporter = new KnowledgeExporter();
    const disabledTemplate: KnowledgeCardTemplate = {
      ...readingPromptTemplate,
      id: "template-disabled",
      enabled: false,
    };
    const vault = exporter.buildVaultPackage(
      {
        books: [baseBook],
        documents: [knowledgeDocument()],
        cardTemplates: [
          readingPromptTemplate,
          disabledTemplate,
          { ...readingPromptTemplate, id: "built-in-template", builtIn: true },
        ],
      },
      { rootDir: "ReadAny", exportedAt: 1700000200000 },
    );

    expect(vault.manifest.cardTemplates).toEqual([readingPromptTemplate, disabledTemplate]);

    const manifestFile = vault.files.find((file) => file.path.endsWith("manifest.json"));
    expect(JSON.parse(manifestFile?.content ?? "{}").cardTemplates).toEqual([
      readingPromptTemplate,
      disabledTemplate,
    ]);
  });

  it("exports local attachments into the vault and links documents to exported assets", () => {
    const exporter = new KnowledgeExporter();
    const vault = exporter.buildVaultPackage({
      books: [baseBook],
      documents: [knowledgeDocument()],
      attachments: [
        {
          id: "att-1",
          documentId: "doc-1",
          kind: "image",
          fileName: "cover.png",
          mimeType: "image/png",
          localPath: "local/cover.png",
          size: 42,
          hash: "sha256:cover",
          createdAt: 1000,
          updatedAt: 2000,
        },
      ],
    });

    expect(vault.files.map((file) => file.path)).toEqual([
      "Books/The Book A Study/README.md",
      "Assets/cover.png",
      ".readany/manifest.json",
    ]);
    expect(vault.files[0].content).toContain("- [cover.png](../../Assets/cover.png)");
    expect(vault.files[1]).toMatchObject({
      path: "Assets/cover.png",
      mimeType: "image/png",
      sourcePath: "local/cover.png",
    });
    expect(vault.manifest.attachments["att-1"]).toEqual({
      id: "att-1",
      documentId: "doc-1",
      kind: "image",
      fileName: "cover.png",
      mimeType: "image/png",
      path: "Assets/cover.png",
      size: 42,
      hash: "sha256:cover",
      updatedAt: 2000,
    });
  });

  it("rewrites inline attachment images to Obsidian asset paths", () => {
    const exporter = new KnowledgeExporter();
    const vault = exporter.buildVaultPackage({
      books: [baseBook],
      documents: [
        knowledgeDocument({
          contentJson: {
            type: "doc",
            content: [
              {
                type: "image",
                attrs: {
                  attachmentId: "att-1",
                  src: "asset://localhost/local/cover.png",
                  alt: "Cover [draft]",
                },
              },
            ],
          },
        }),
      ],
      attachments: [
        {
          id: "att-1",
          documentId: "doc-1",
          kind: "image",
          fileName: "cover (final).png",
          mimeType: "image/png",
          localPath: "local/cover.png",
          size: 42,
          createdAt: 1000,
          updatedAt: 2000,
        },
      ],
    });

    const document = vault.files.find((file) => file.path.endsWith("README.md"));
    expect(document?.content).toContain("![Cover \\[draft\\]](<../../Assets/cover (final).png>)");
    expect(document?.content).not.toContain("asset://localhost");
  });

  it("rewrites portable attachment image URIs even when attachment ids are implicit", () => {
    const exporter = new KnowledgeExporter();
    const vault = exporter.buildVaultPackage({
      books: [baseBook],
      documents: [
        knowledgeDocument({
          contentJson: {
            type: "doc",
            content: [
              {
                type: "image",
                attrs: {
                  src: "readany-attachment://att-1",
                  alt: "Synced cover",
                },
              },
            ],
          },
        }),
      ],
      attachments: [
        {
          id: "att-1",
          documentId: "doc-1",
          kind: "image",
          fileName: "cover.png",
          mimeType: "image/png",
          localPath: "local/cover.png",
          size: 42,
          createdAt: 1000,
          updatedAt: 2000,
        },
      ],
    });

    const document = vault.files.find((file) => file.path.endsWith("README.md"));
    expect(document?.content).toContain("![Synced cover](../../Assets/cover.png)");
    expect(document?.content).not.toContain("readany-attachment://att-1");
  });

  it("keeps duplicate attachment paths unique and synced with the manifest", () => {
    const exporter = new KnowledgeExporter();
    const vault = exporter.buildVaultPackage({
      documents: [knowledgeDocument({ bookId: undefined })],
      attachments: [
        {
          id: "att-a",
          documentId: "doc-1",
          kind: "image",
          fileName: "diagram.png",
          localPath: "/tmp/a.png",
          size: 10,
          createdAt: 1000,
          updatedAt: 1000,
        },
        {
          id: "att-b",
          documentId: "doc-1",
          kind: "image",
          fileName: "diagram.png",
          localPath: "/tmp/b.png",
          size: 20,
          createdAt: 1000,
          updatedAt: 2000,
        },
      ],
    });

    expect(vault.files.map((file) => file.path)).toEqual([
      "Notes/Book Home.md",
      "Assets/diagram.png",
      "Assets/diagram-2.png",
      ".readany/manifest.json",
    ]);
    expect(vault.files[0].content).toContain("- [diagram.png](../Assets/diagram.png)");
    expect(vault.files[0].content).toContain("- [diagram.png](../Assets/diagram-2.png)");
    expect(vault.manifest.attachments["att-a"].path).toBe("Assets/diagram.png");
    expect(vault.manifest.attachments["att-b"].path).toBe("Assets/diagram-2.png");
  });

  it("reuses previous attachment paths by id during linked-folder exports", () => {
    const exporter = new KnowledgeExporter();
    const first = exporter.buildVaultPackage({
      documents: [knowledgeDocument({ bookId: undefined })],
      attachments: [
        {
          id: "att-rename",
          documentId: "doc-1",
          kind: "image",
          fileName: "old-name.png",
          localPath: "/tmp/old-name.png",
          size: 10,
          createdAt: 1000,
          updatedAt: 1000,
        },
      ],
    });
    const second = exporter.buildVaultPackage(
      {
        documents: [knowledgeDocument({ bookId: undefined })],
        attachments: [
          {
            id: "att-rename",
            documentId: "doc-1",
            kind: "image",
            fileName: "new-name.png",
            localPath: "/tmp/new-name.png",
            size: 12,
            createdAt: 1000,
            updatedAt: 2000,
          },
        ],
      },
      { previousManifest: first.manifest },
    );

    expect(first.manifest.attachments["att-rename"].path).toBe("Assets/old-name.png");
    expect(second.files[1]).toMatchObject({
      path: "Assets/old-name.png",
      sourcePath: "/tmp/new-name.png",
    });
    expect(second.manifest.attachments["att-rename"]).toMatchObject({
      id: "att-rename",
      fileName: "new-name.png",
      path: "Assets/old-name.png",
      size: 12,
      updatedAt: 2000,
    });
  });

  it("keeps duplicate document paths unique in both files and manifest entries", () => {
    const exporter = new KnowledgeExporter();
    const vault = exporter.buildVaultPackage({
      documents: [
        knowledgeDocument({
          id: "doc-a",
          bookId: undefined,
          type: "standalone_note",
          title: "Same Name",
        }),
        knowledgeDocument({
          id: "doc-b",
          bookId: undefined,
          type: "standalone_note",
          title: "Same Name",
        }),
        knowledgeDocument({
          id: "doc-c",
          bookId: undefined,
          type: "standalone_note",
          title: "Same Name-2",
        }),
      ],
    });

    expect(vault.files.map((file) => file.path)).toEqual([
      "Notes/Same Name.md",
      "Notes/Same Name-2.md",
      "Notes/Same Name-2-2.md",
      ".readany/manifest.json",
    ]);
    expect(vault.manifest.documents["doc-a"].path).toBe("Notes/Same Name.md");
    expect(vault.manifest.documents["doc-b"].path).toBe("Notes/Same Name-2.md");
    expect(vault.manifest.documents["doc-c"].path).toBe("Notes/Same Name-2-2.md");
  });

  it("reuses previous manifest paths by document id during linked-folder exports", () => {
    const exporter = new KnowledgeExporter();
    const first = exporter.buildVaultPackage({
      documents: [
        knowledgeDocument({
          id: "doc-rename",
          bookId: undefined,
          type: "standalone_note",
          title: "Old Title",
        }),
      ],
    });
    const second = exporter.buildVaultPackage(
      {
        documents: [
          knowledgeDocument({
            id: "doc-rename",
            bookId: undefined,
            type: "standalone_note",
            title: "New Title",
          }),
        ],
      },
      { previousManifest: first.manifest },
    );

    expect(first.manifest.documents["doc-rename"].path).toBe("Notes/Old Title.md");
    expect(second.files[0].path).toBe("Notes/Old Title.md");
    expect(second.manifest.documents["doc-rename"]).toMatchObject({
      id: "doc-rename",
      title: "New Title",
      path: "Notes/Old Title.md",
    });
  });

  it("detects external edits before overwriting a manifest-tracked file", () => {
    const exporter = new KnowledgeExporter();
    const first = exporter.buildVaultPackage(
      {
        books: [baseBook],
        documents: [knowledgeDocument()],
      },
      { exportedAt: 1000 },
    );
    const next = exporter.buildVaultPackage(
      {
        books: [baseBook],
        documents: [
          knowledgeDocument({
            contentMd: "Updated from ReadAny",
            contentJson: { type: "doc", content: [] },
            updatedAt: 1700000300000,
          }),
        ],
      },
      {
        previousManifest: first.manifest,
        existingFiles: [
          {
            path: "Books/The Book A Study/README.md",
            content: `${first.files[0].content}\nEdited in Obsidian.\n`,
          },
        ],
      },
    );

    expect(next.conflicts).toHaveLength(1);
    expect(next.conflicts[0]).toMatchObject({
      kind: "external_modified",
      documentId: "doc-1",
      path: "Books/The Book A Study/README.md",
      previousHash: first.manifest.documents["doc-1"].hash,
      nextHash: next.manifest.documents["doc-1"].hash,
    });
  });

  it("does not report conflicts for unchanged or already-updated files", () => {
    const exporter = new KnowledgeExporter();
    const first = exporter.buildVaultPackage({
      books: [baseBook],
      documents: [knowledgeDocument()],
    });
    const next = exporter.buildVaultPackage(
      {
        books: [baseBook],
        documents: [
          knowledgeDocument({
            contentMd: "Updated from ReadAny",
            contentJson: { type: "doc", content: [] },
            updatedAt: 1700000300000,
          }),
        ],
      },
      {
        previousManifest: first.manifest,
        existingFiles: [
          {
            path: "Books/The Book A Study/README.md",
            content: first.files[0].content,
          },
          {
            path: "Notes/Missing.md",
            content: "Unknown file",
          },
        ],
      },
    );
    const alreadyUpdated = exporter.buildVaultPackage(
      {
        books: [baseBook],
        documents: [
          knowledgeDocument({
            contentMd: "Updated from ReadAny",
            contentJson: { type: "doc", content: [] },
            updatedAt: 1700000300000,
          }),
        ],
      },
      {
        previousManifest: first.manifest,
        existingFiles: [
          {
            path: "Books/The Book A Study/README.md",
            content: next.files[0].content,
          },
        ],
      },
    );

    expect(next.conflicts).toEqual([]);
    expect(alreadyUpdated.conflicts).toEqual([]);
  });
});
