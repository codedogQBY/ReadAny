import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  createKnowledgeDocument: vi.fn(),
  getKnowledgeDocument: vi.fn(),
  getKnowledgeDocuments: vi.fn(),
  getKnowledgeLinks: vi.fn(),
  insertKnowledgeLink: vi.fn(),
  updateKnowledgeDocument: vi.fn(),
}));

vi.mock("../db/database", () => dbMocks);

const idMocks = vi.hoisted(() => ({
  generateId: vi.fn(() => "generated-link-id"),
}));

vi.mock("../utils/generate-id", () => idMocks);

const internalLinkMocks = vi.hoisted(() => ({
  syncKnowledgeInternalDocumentLinks: vi.fn(),
}));

vi.mock("./internal-links", () => internalLinkMocks);

const { eventBus } = await import("../utils/event-bus");
const {
  applyKnowledgeWriteProposal,
  createKnowledgeWriteProposalPreview,
  getKnowledgeProposalApplyErrorDetails,
  getKnowledgeWriteProposal,
} = await import("./proposals");

describe("knowledge write proposals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventBus.clear("knowledge:changed");
    dbMocks.getKnowledgeDocuments.mockResolvedValue([]);
    internalLinkMocks.syncKnowledgeInternalDocumentLinks.mockResolvedValue({
      targetDocumentIds: [],
      added: 0,
      deleted: 0,
    });
  });

  function document(overrides: Record<string, unknown> = {}) {
    return {
      id: "doc-1",
      bookId: "book-1",
      parentId: undefined,
      type: "standalone_note",
      title: "Note",
      contentJson: { type: "doc", content: [] },
      contentMd: "Body",
      contentSchemaVersion: 1,
      excerpt: undefined,
      tags: [],
      createdAt: 1000,
      updatedAt: 2000,
      ...overrides,
    };
  }

  it("normalizes confirmation-required create proposals", () => {
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "create",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_create",
      targetPath: "Knowledge base / Summaries / Durable Summary",
      draft: {
        id: "proposal-doc-1",
        type: "summary",
        title: "Durable Summary",
        tags: ["reading", "reading", "summary"],
        contentMd: "A durable knowledge document.",
        contentJson: { type: "doc", content: [] },
        sourceKind: "book",
        sourceId: "book-1",
      },
    });

    expect(proposal).toMatchObject({
      action: "create",
      targetPath: "Knowledge base / Summaries / Durable Summary",
      draft: {
        id: "proposal-doc-1",
        type: "summary",
        title: "Durable Summary",
        tags: ["reading", "summary"],
        sourceKind: "book",
        sourceId: "book-1",
      },
    });
    expect(proposal ? createKnowledgeWriteProposalPreview(proposal) : null).toMatchObject({
      action: "create",
      title: "Durable Summary",
      documentType: "summary",
      tags: ["reading", "summary"],
      contentPreview: "A durable knowledge document.",
      targetPath: "Knowledge base / Summaries / Durable Summary",
      visiblePath: "Knowledge base / Summaries / Durable Summary",
      hasPathChange: false,
      writeSafety: {
        state: "proposal_pending_confirmation",
        label: "Confirmation required",
        description:
          "AI only prepared this proposal. It will not write to the knowledge base until you apply it.",
      },
    });
  });

  it("creates safe rich read-only previews for document proposals", () => {
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "create",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_create",
      targetPath: "Knowledge base / Reviews / Rich Preview",
      draft: {
        id: "proposal-doc-rich",
        type: "review",
        title: "Rich Preview",
        tags: ["review"],
        contentMd: "Rich preview body.",
        contentJson: {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 2 },
              content: [{ type: "text", text: "Review <Draft>" }],
            },
            {
              type: "paragraph",
              content: [
                { type: "text", text: "This is " },
                { type: "text", text: "important", marks: [{ type: "bold" }] },
                { type: "text", text: " and " },
                {
                  type: "text",
                  text: "unsafe",
                  marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
                },
                { type: "text", text: "." },
              ],
            },
            {
              type: "readanyCard",
              attrs: {
                cardType: "customMetric",
                version: 2,
                title: "Reading score",
                text: "Focus: 92%",
                data: { private: "<json>" },
              },
            },
          ],
        },
      },
    });

    expect(proposal).not.toBeNull();
    if (!proposal) throw new Error("Expected create proposal");

    const preview = createKnowledgeWriteProposalPreview(proposal);
    expect(preview.contentPreview).toBe("Rich preview body.");
    expect(preview.contentPreviewHtml).toContain("<h2>Review &lt;Draft&gt;</h2>");
    expect(preview.contentPreviewHtml).toContain(
      "<p>This is <strong>important</strong> and unsafe.</p>",
    );
    expect(preview.contentPreviewHtml).toContain('data-readany-card-state="unsupported"');
    expect(preview.contentPreviewHtml).toContain("<h4>Reading score</h4>");
    expect(preview.contentPreviewHtml).not.toContain("javascript:");
    expect(preview.contentPreviewHtml).not.toContain("private");
  });

  it("migrates custom card templates inside proposal previews", () => {
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "create",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_create",
      targetPath: "Knowledge base / Concepts / Attention",
      draft: {
        id: "proposal-card-migration",
        type: "standalone_note",
        title: "Attention",
        contentMd: "Card migration preview.",
        contentJson: {
          type: "doc",
          content: [
            {
              type: "readanyCard",
              attrs: {
                cardType: "custom:template-concept",
                version: 1,
                title: "Attention",
                markdown: "User body",
                data: {
                  summary: "Ritual attention",
                },
              },
            },
          ],
        },
      },
    });

    expect(proposal).not.toBeNull();
    if (!proposal) throw new Error("Expected create proposal");

    const preview = createKnowledgeWriteProposalPreview(proposal, {
      cardTemplates: [
        {
          id: "template-concept",
          name: "Concept",
          version: 2,
          schemaJson: {
            cardType: "custom:template-concept",
            title: "Concept",
            markdown: "Definition:\nEvidence:",
            migrations: [
              {
                fromVersion: 1,
                toVersion: 2,
                dataRenames: {
                  summary: "body.abstract",
                },
              },
            ],
          },
          builtIn: false,
          enabled: true,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    });

    expect(preview.contentPreviewHtml).toContain('data-readany-card-version="2"');
    expect(preview.contentPreviewHtml).toContain('data-readany-card-state="custom"');
    expect(preview.contentPreviewHtml).toContain("<h4>Attention</h4>");
    expect(preview.contentPreviewHtml).toContain("User body");
  });

  it("rejects ordinary tool results and malformed proposal payloads", () => {
    expect(getKnowledgeWriteProposal({ success: true, documents: [] })).toBeNull();
    expect(
      getKnowledgeWriteProposal({
        success: true,
        action: "create",
        requiresConfirmation: true,
        confirmationKind: "knowledge_document_create",
        draft: { type: "summary", title: "", contentJson: { type: "doc" } },
      }),
    ).toBeNull();
    expect(
      getKnowledgeWriteProposal({
        success: true,
        action: "update",
        requiresConfirmation: true,
        confirmationKind: "knowledge_document_update",
        documentId: "doc-1",
        patch: { contentMd: "Markdown without canonical JSON" },
      }),
    ).toBeNull();
    expect(
      getKnowledgeWriteProposal({
        success: true,
        action: "link",
        requiresConfirmation: true,
        confirmationKind: "knowledge_link_create",
        link: { fromDocumentId: "doc-1", toKind: "unknown", toId: "doc-2", relation: "related" },
      }),
    ).toBeNull();
  });

  it("normalizes confirmation-required link proposals", () => {
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "link",
      requiresConfirmation: true,
      confirmationKind: "knowledge_link_create",
      source: {
        id: "doc-1",
        type: "standalone_note",
        title: "Source note",
        path: "Knowledge base / Ideas / Source note",
      },
      target: {
        id: "doc-2",
        type: "standalone_note",
        title: "Target note",
        path: "Knowledge base / Ideas / Target note",
      },
      link: {
        id: "link-1",
        fromDocumentId: "doc-1",
        toKind: "document",
        toId: "doc-2",
        relation: "related",
        label: "Related idea",
      },
    });

    expect(proposal).toMatchObject({
      action: "link",
      source: {
        id: "doc-1",
        path: "Knowledge base / Ideas / Source note",
      },
      target: {
        id: "doc-2",
        path: "Knowledge base / Ideas / Target note",
      },
      link: {
        id: "link-1",
        fromDocumentId: "doc-1",
        toKind: "document",
        toId: "doc-2",
        relation: "related",
        label: "Related idea",
      },
    });
    expect(proposal ? createKnowledgeWriteProposalPreview(proposal) : null).toMatchObject({
      action: "link",
      title: "Related idea",
      linkType: "document",
      contentPreview:
        "related -> document: doc-2\nFrom: Knowledge base / Ideas / Source note\nTo: Knowledge base / Ideas / Target note",
      changedFields: ["related"],
      currentPath: "Knowledge base / Ideas / Source note",
      targetPath: "Knowledge base / Ideas / Target note",
      visiblePath: "Knowledge base / Ideas / Source note -> Knowledge base / Ideas / Target note",
      hasPathChange: false,
    });
  });

  it("surfaces document move paths in proposal previews", () => {
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "update",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_update",
      documentId: "doc-1",
      current: {
        id: "doc-1",
        type: "standalone_note",
        title: "Moved Note",
        path: "Knowledge base / Inbox / Moved Note",
        tags: ["draft"],
      },
      targetPath: "Knowledge base / Chapter Notes / Moved Note",
      patch: {
        parentId: "chapter-notes",
      },
      changedFields: ["parentId"],
    });

    expect(proposal).not.toBeNull();
    if (!proposal) throw new Error("Expected update proposal");

    expect(createKnowledgeWriteProposalPreview(proposal)).toMatchObject({
      action: "update",
      title: "Moved Note",
      documentType: "standalone_note",
      tags: ["draft"],
      changedFields: ["parentId"],
      currentPath: "Knowledge base / Inbox / Moved Note",
      targetPath: "Knowledge base / Chapter Notes / Moved Note",
      visiblePath: "Knowledge base / Chapter Notes / Moved Note",
      hasPathChange: true,
    });
  });

  it("applies create proposals once when the draft id already exists", async () => {
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "create",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_create",
      draft: {
        id: "proposal-doc-1",
        type: "standalone_note",
        title: "New Note",
        contentMd: "Body",
        contentJson: { type: "doc", content: [] },
      },
    });
    expect(proposal).not.toBeNull();
    if (!proposal) throw new Error("Expected create proposal");

    dbMocks.getKnowledgeDocument.mockResolvedValue(
      document({ id: "proposal-doc-1", bookId: undefined, sourceKind: undefined }),
    );

    const result = await applyKnowledgeWriteProposal(proposal);

    expect(result).toEqual({
      action: "create",
      documentId: "proposal-doc-1",
      alreadyApplied: true,
    });
    expect(dbMocks.createKnowledgeDocument).not.toHaveBeenCalled();
  });

  it("rejects create proposals whose draft id collides with a different document", async () => {
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "create",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_create",
      draft: {
        id: "proposal-doc-1",
        type: "summary",
        title: "Imported Summary",
        bookId: "book-1",
        contentMd: "Body",
        contentJson: { type: "doc", content: [] },
        sourceKind: "obsidian",
        sourceId: "Vault/Summary.md",
      },
    });
    expect(proposal).not.toBeNull();
    if (!proposal) throw new Error("Expected create proposal");

    dbMocks.getKnowledgeDocument.mockResolvedValue(
      document({
        id: "proposal-doc-1",
        type: "standalone_note",
        bookId: "book-2",
        sourceKind: "book",
        sourceId: "book-2",
      }),
    );

    await expect(applyKnowledgeWriteProposal(proposal)).rejects.toThrow(
      "Invalid knowledge document create: create_id_conflict",
    );
    expect(dbMocks.createKnowledgeDocument).not.toHaveBeenCalled();
  });

  it("creates documents and applies update patches", async () => {
    const createProposal = getKnowledgeWriteProposal({
      success: true,
      action: "create",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_create",
      draft: {
        type: "review",
        title: "Review",
        contentMd: "Body",
        contentJson: { type: "doc", content: [] },
      },
    });
    expect(createProposal).not.toBeNull();
    if (!createProposal) throw new Error("Expected create proposal");
    dbMocks.createKnowledgeDocument.mockResolvedValue({ id: "created-doc" });

    await expect(applyKnowledgeWriteProposal(createProposal)).resolves.toEqual({
      action: "create",
      documentId: "created-doc",
    });

    const updateProposal = getKnowledgeWriteProposal({
      success: true,
      action: "update",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_update",
      documentId: "doc-1",
      current: {
        id: "doc-1",
        updatedAt: 2000,
      },
      patch: {
        parentId: "folder-1",
        title: "Updated",
        tags: ["done"],
      },
      targetPath: "Knowledge base / Folder / Updated",
      changedFields: ["parentId", "title", "tags"],
    });
    expect(updateProposal).not.toBeNull();
    if (!updateProposal) throw new Error("Expected update proposal");
    dbMocks.getKnowledgeDocument.mockResolvedValue(document({ id: "doc-1", bookId: "book-1" }));
    dbMocks.getKnowledgeDocuments.mockResolvedValue([
      document({ id: "doc-1", bookId: "book-1" }),
      document({ id: "folder-1", type: "folder", title: "Folder", bookId: "book-1" }),
    ]);

    await expect(applyKnowledgeWriteProposal(updateProposal)).resolves.toEqual({
      action: "update",
      documentId: "doc-1",
    });
    expect(dbMocks.updateKnowledgeDocument).toHaveBeenCalledWith("doc-1", {
      parentId: "folder-1",
      title: "Updated",
      tags: ["done"],
    });
    expect(createKnowledgeWriteProposalPreview(updateProposal)).toMatchObject({
      action: "update",
      title: "Updated",
      documentType: undefined,
      tags: ["done"],
      changedFields: ["parentId", "title", "tags"],
      targetPath: "Knowledge base / Folder / Updated",
      visiblePath: "Knowledge base / Folder / Updated",
      hasPathChange: false,
    });
  });

  it("rejects stale update proposals before overwriting changed documents", async () => {
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "update",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_update",
      documentId: "doc-1",
      current: {
        id: "doc-1",
        updatedAt: 1000,
      },
      patch: {
        title: "Outdated AI Patch",
      },
      changedFields: ["title"],
    });
    expect(proposal).not.toBeNull();
    if (!proposal) throw new Error("Expected update proposal");

    dbMocks.getKnowledgeDocument.mockResolvedValue(
      document({ id: "doc-1", title: "User changed this", updatedAt: 2000 }),
    );

    await expect(applyKnowledgeWriteProposal(proposal)).rejects.toThrow(
      "Invalid knowledge document update: stale_document",
    );
    expect(dbMocks.updateKnowledgeDocument).not.toHaveBeenCalled();
  });

  it("exposes translatable apply error details without changing legacy messages", async () => {
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "update",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_update",
      documentId: "doc-1",
      current: {
        id: "doc-1",
        updatedAt: 1000,
      },
      patch: {
        title: "Outdated AI Patch",
      },
      changedFields: ["title"],
    });
    expect(proposal).not.toBeNull();
    if (!proposal) throw new Error("Expected update proposal");

    dbMocks.getKnowledgeDocument.mockResolvedValue(
      document({ id: "doc-1", title: "User changed this", updatedAt: 2000 }),
    );

    let caught: unknown;
    try {
      await applyKnowledgeWriteProposal(proposal);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("Invalid knowledge document update: stale_document");
    expect(getKnowledgeProposalApplyErrorDetails(caught)).toEqual({
      scope: "update",
      reason: "stale_document",
      message: "Invalid knowledge document update: stale_document",
      i18nKey: "knowledgeProposal.errors.update.stale_document",
    });
  });

  it("parses legacy apply error messages for UI display", () => {
    expect(
      getKnowledgeProposalApplyErrorDetails(
        new Error("Invalid knowledge document title: duplicate_sibling_title"),
      ),
    ).toEqual({
      scope: "title",
      reason: "duplicate_sibling_title",
      message: "Invalid knowledge document title: duplicate_sibling_title",
      i18nKey: "knowledgeProposal.errors.title.duplicate_sibling_title",
    });
    expect(getKnowledgeProposalApplyErrorDetails(new Error("Network failed"))).toBeNull();
  });

  it("syncs internal document links after applying create proposals", async () => {
    const contentJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "readanyInternalLink",
              attrs: { documentId: "target-doc", label: "Target" },
            },
          ],
        },
      ],
    };
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "create",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_create",
      draft: {
        id: "created-doc",
        type: "standalone_note",
        title: "Linked Note",
        bookId: "book-1",
        contentMd: "[Target](readany://knowledge/target-doc)",
        contentJson,
      },
    });
    expect(proposal).not.toBeNull();
    if (!proposal) throw new Error("Expected create proposal");

    dbMocks.getKnowledgeDocuments.mockResolvedValue([
      document({ id: "target-doc", bookId: "book-1", title: "Target" }),
    ]);
    dbMocks.getKnowledgeDocument.mockResolvedValue(null);
    dbMocks.createKnowledgeDocument.mockResolvedValue(
      document({ id: "created-doc", bookId: "book-1", title: "Linked Note", contentJson }),
    );

    await expect(applyKnowledgeWriteProposal(proposal)).resolves.toEqual({
      action: "create",
      documentId: "created-doc",
    });
    expect(internalLinkMocks.syncKnowledgeInternalDocumentLinks).toHaveBeenCalledWith({
      documentId: "created-doc",
      contentJson,
      validDocumentIds: expect.arrayContaining(["created-doc", "target-doc"]),
    });
  });

  it("syncs internal document links after applying content update proposals", async () => {
    const contentJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "readanyInternalLink",
              attrs: { documentId: "target-doc", label: "Target" },
            },
          ],
        },
      ],
    };
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "update",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_update",
      documentId: "doc-1",
      patch: {
        contentMd: "[Target](readany://knowledge/target-doc)",
        contentJson,
        excerpt: "Target",
      },
      changedFields: ["contentMd", "contentJson", "excerpt"],
    });
    expect(proposal).not.toBeNull();
    if (!proposal) throw new Error("Expected update proposal");

    dbMocks.getKnowledgeDocument.mockResolvedValue(document({ id: "doc-1", bookId: "book-1" }));
    dbMocks.getKnowledgeDocuments.mockResolvedValue([
      document({ id: "target-doc", bookId: "book-1", title: "Target" }),
    ]);

    await expect(applyKnowledgeWriteProposal(proposal)).resolves.toEqual({
      action: "update",
      documentId: "doc-1",
    });
    expect(dbMocks.updateKnowledgeDocument).toHaveBeenCalledWith("doc-1", {
      contentMd: "[Target](readany://knowledge/target-doc)",
      contentJson,
      excerpt: "Target",
    });
    expect(internalLinkMocks.syncKnowledgeInternalDocumentLinks).toHaveBeenCalledWith({
      documentId: "doc-1",
      contentJson,
      validDocumentIds: expect.arrayContaining(["doc-1", "target-doc"]),
    });
  });

  it("emits knowledge changed events after create and update proposals apply", async () => {
    const events: unknown[] = [];
    const unsubscribe = eventBus.on("knowledge:changed", (event) => events.push(event));

    const createProposal = getKnowledgeWriteProposal({
      success: true,
      action: "create",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_create",
      draft: {
        type: "review",
        title: "Review",
        bookId: "book-1",
        contentMd: "Body",
        contentJson: { type: "doc", content: [] },
      },
    });
    expect(createProposal).not.toBeNull();
    if (!createProposal) throw new Error("Expected create proposal");
    dbMocks.createKnowledgeDocument.mockResolvedValue({ id: "created-doc", bookId: "book-1" });

    await applyKnowledgeWriteProposal(createProposal);

    const updateProposal = getKnowledgeWriteProposal({
      success: true,
      action: "update",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_update",
      documentId: "doc-1",
      patch: {
        title: "Updated",
      },
      changedFields: ["title"],
    });
    expect(updateProposal).not.toBeNull();
    if (!updateProposal) throw new Error("Expected update proposal");
    dbMocks.getKnowledgeDocument.mockResolvedValue(document({ id: "doc-1", bookId: "book-1" }));

    await applyKnowledgeWriteProposal(updateProposal);
    unsubscribe();

    expect(events).toEqual([
      {
        action: "create",
        documentId: "created-doc",
        bookId: "book-1",
        timestamp: expect.any(Number),
      },
      {
        action: "update",
        documentId: "doc-1",
        bookId: "book-1",
        timestamp: expect.any(Number),
      },
    ]);
  });

  it("validates parent folders before applying create proposals", async () => {
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "create",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_create",
      draft: {
        type: "standalone_note",
        title: "Child Note",
        bookId: "book-1",
        parentId: "not-folder",
        contentMd: "Body",
        contentJson: { type: "doc", content: [] },
      },
    });
    expect(proposal).not.toBeNull();
    if (!proposal) throw new Error("Expected create proposal");

    dbMocks.getKnowledgeDocument.mockResolvedValue(document({ id: "not-folder", type: "summary" }));

    await expect(applyKnowledgeWriteProposal(proposal)).rejects.toThrow(
      "Invalid knowledge document parent: parent_not_folder",
    );
    expect(dbMocks.createKnowledgeDocument).not.toHaveBeenCalled();
  });

  it("validates parent moves before applying update proposals", async () => {
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "update",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_update",
      documentId: "folder-root",
      patch: {
        parentId: "folder-child",
      },
      changedFields: ["parentId"],
    });
    expect(proposal).not.toBeNull();
    if (!proposal) throw new Error("Expected update proposal");

    dbMocks.getKnowledgeDocument.mockResolvedValue(
      document({ id: "folder-root", type: "folder", bookId: "book-1" }),
    );
    dbMocks.getKnowledgeDocuments.mockResolvedValue([
      document({ id: "folder-root", type: "folder", bookId: "book-1" }),
      document({
        id: "folder-child",
        type: "folder",
        parentId: "folder-root",
        bookId: "book-1",
      }),
    ]);

    await expect(applyKnowledgeWriteProposal(proposal)).rejects.toThrow(
      "Invalid knowledge document parent: descendant_parent",
    );
    expect(dbMocks.updateKnowledgeDocument).not.toHaveBeenCalled();
  });

  it("rejects create proposals with duplicate sibling titles", async () => {
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "create",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_create",
      draft: {
        type: "standalone_note",
        title: "Chapter Notes",
        bookId: "book-1",
        parentId: "folder-1",
        contentMd: "Body",
        contentJson: { type: "doc", content: [] },
      },
    });
    expect(proposal).not.toBeNull();
    if (!proposal) throw new Error("Expected create proposal");

    dbMocks.getKnowledgeDocument.mockResolvedValue(
      document({ id: "folder-1", type: "folder", bookId: "book-1" }),
    );
    dbMocks.getKnowledgeDocuments.mockResolvedValue([
      document({
        id: "existing-note",
        bookId: "book-1",
        parentId: "folder-1",
        title: "chapter notes",
      }),
    ]);

    await expect(applyKnowledgeWriteProposal(proposal)).rejects.toThrow(
      "Invalid knowledge document title: duplicate_sibling_title",
    );
    expect(dbMocks.createKnowledgeDocument).not.toHaveBeenCalled();
  });

  it("rejects update proposals that rename into a duplicate sibling title", async () => {
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "update",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_update",
      documentId: "doc-1",
      patch: {
        title: "Chapter Notes",
      },
      changedFields: ["title"],
    });
    expect(proposal).not.toBeNull();
    if (!proposal) throw new Error("Expected update proposal");

    dbMocks.getKnowledgeDocument.mockResolvedValue(
      document({ id: "doc-1", bookId: "book-1", parentId: "folder-1", title: "Draft" }),
    );
    dbMocks.getKnowledgeDocuments.mockResolvedValue([
      document({ id: "doc-1", bookId: "book-1", parentId: "folder-1", title: "Draft" }),
      document({
        id: "existing-note",
        bookId: "book-1",
        parentId: "folder-1",
        title: "chapter notes",
      }),
    ]);

    await expect(applyKnowledgeWriteProposal(proposal)).rejects.toThrow(
      "Invalid knowledge document title: duplicate_sibling_title",
    );
    expect(dbMocks.updateKnowledgeDocument).not.toHaveBeenCalled();
  });

  it("rejects update proposals that move into a folder with the same document title", async () => {
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "update",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_update",
      documentId: "doc-1",
      patch: {
        parentId: "target-folder",
      },
      changedFields: ["parentId"],
    });
    expect(proposal).not.toBeNull();
    if (!proposal) throw new Error("Expected update proposal");

    dbMocks.getKnowledgeDocument.mockResolvedValue(
      document({ id: "doc-1", bookId: "book-1", parentId: "source-folder", title: "Quote Map" }),
    );
    dbMocks.getKnowledgeDocuments.mockResolvedValue([
      document({
        id: "source-folder",
        type: "folder",
        bookId: "book-1",
        title: "Source",
      }),
      document({
        id: "target-folder",
        type: "folder",
        bookId: "book-1",
        title: "Target",
      }),
      document({
        id: "doc-1",
        bookId: "book-1",
        parentId: "source-folder",
        title: "Quote Map",
      }),
      document({
        id: "target-copy",
        bookId: "book-1",
        parentId: "target-folder",
        title: "quote map",
      }),
    ]);

    await expect(applyKnowledgeWriteProposal(proposal)).rejects.toThrow(
      "Invalid knowledge document title: duplicate_sibling_title",
    );
    expect(dbMocks.updateKnowledgeDocument).not.toHaveBeenCalled();
  });

  it("applies link proposals once and avoids duplicates", async () => {
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "link",
      requiresConfirmation: true,
      confirmationKind: "knowledge_link_create",
      link: {
        fromDocumentId: "doc-1",
        toKind: "highlight",
        toId: "hl-1",
        relation: "source",
        label: "Original highlight",
        cfi: "epubcfi(/6/2)",
      },
    });
    expect(proposal).not.toBeNull();
    if (!proposal) throw new Error("Expected link proposal");

    dbMocks.getKnowledgeDocument.mockResolvedValue(document({ id: "doc-1", bookId: "book-1" }));
    dbMocks.getKnowledgeLinks.mockResolvedValueOnce([]);
    await expect(applyKnowledgeWriteProposal(proposal)).resolves.toEqual({
      action: "link",
      documentId: "doc-1",
      linkId: "generated-link-id",
    });
    expect(dbMocks.insertKnowledgeLink).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "generated-link-id",
        fromDocumentId: "doc-1",
        toKind: "highlight",
        toId: "hl-1",
        relation: "source",
        cfi: "epubcfi(/6/2)",
      }),
    );

    dbMocks.getKnowledgeLinks.mockResolvedValueOnce([
      {
        id: "existing-link",
        fromDocumentId: "doc-1",
        toKind: "highlight",
        toId: "hl-1",
        relation: "source",
        cfi: "epubcfi(/6/2)",
        createdAt: 1000,
        updatedAt: 1000,
      },
    ]);
    await expect(applyKnowledgeWriteProposal(proposal)).resolves.toEqual({
      action: "link",
      documentId: "doc-1",
      linkId: "existing-link",
      alreadyApplied: true,
    });
  });

  it("validates link proposal source and document targets before applying", async () => {
    const missingSourceProposal = getKnowledgeWriteProposal({
      success: true,
      action: "link",
      requiresConfirmation: true,
      confirmationKind: "knowledge_link_create",
      link: {
        fromDocumentId: "missing-source",
        toKind: "highlight",
        toId: "hl-1",
        relation: "source",
      },
    });
    expect(missingSourceProposal).not.toBeNull();
    if (!missingSourceProposal) throw new Error("Expected link proposal");

    dbMocks.getKnowledgeDocument.mockResolvedValueOnce(null);
    await expect(applyKnowledgeWriteProposal(missingSourceProposal)).rejects.toThrow(
      "Invalid knowledge link: missing_source_document",
    );
    expect(dbMocks.getKnowledgeLinks).not.toHaveBeenCalled();
    expect(dbMocks.insertKnowledgeLink).not.toHaveBeenCalled();

    vi.clearAllMocks();
    const missingTargetProposal = getKnowledgeWriteProposal({
      success: true,
      action: "link",
      requiresConfirmation: true,
      confirmationKind: "knowledge_link_create",
      link: {
        fromDocumentId: "doc-1",
        toKind: "document",
        toId: "missing-target",
        relation: "related",
      },
    });
    expect(missingTargetProposal).not.toBeNull();
    if (!missingTargetProposal) throw new Error("Expected link proposal");

    dbMocks.getKnowledgeDocument
      .mockResolvedValueOnce(document({ id: "doc-1", bookId: "book-1" }))
      .mockResolvedValueOnce(null);
    await expect(applyKnowledgeWriteProposal(missingTargetProposal)).rejects.toThrow(
      "Invalid knowledge link: missing_target_document",
    );
    expect(dbMocks.getKnowledgeLinks).not.toHaveBeenCalled();
    expect(dbMocks.insertKnowledgeLink).not.toHaveBeenCalled();
  });

  it("emits knowledge changed events after link proposals apply", async () => {
    const events: unknown[] = [];
    const unsubscribe = eventBus.on("knowledge:changed", (event) => events.push(event));
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "link",
      requiresConfirmation: true,
      confirmationKind: "knowledge_link_create",
      link: {
        fromDocumentId: "doc-1",
        toKind: "highlight",
        toId: "hl-1",
        relation: "source",
      },
    });
    expect(proposal).not.toBeNull();
    if (!proposal) throw new Error("Expected link proposal");

    dbMocks.getKnowledgeLinks.mockResolvedValue([]);
    dbMocks.getKnowledgeDocument.mockResolvedValue(document({ id: "doc-1", bookId: "book-1" }));

    await applyKnowledgeWriteProposal(proposal);
    unsubscribe();

    expect(events).toEqual([
      {
        action: "link",
        documentId: "doc-1",
        linkId: "generated-link-id",
        bookId: "book-1",
        timestamp: expect.any(Number),
      },
    ]);
  });
});
