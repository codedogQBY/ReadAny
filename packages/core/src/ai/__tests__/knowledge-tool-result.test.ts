import { describe, expect, it } from "vitest";
import { getKnowledgeToolResultDisplay } from "../knowledge-tool-result";

describe("knowledge tool result display", () => {
  it("summarizes knowledge search results without exposing raw tool JSON", () => {
    const display = getKnowledgeToolResultDisplay("searchKnowledgeBase", {
      total: 2,
      showing: 1,
      documents: [
        {
          id: "doc-1",
          bookId: "book-1",
          title: "Chapter Notes",
          type: "standalone_note",
          path: "Knowledge base / Chapter Notes",
          snippet: "A useful theme note",
          matchFields: ["title", "path", "tags"],
          childCount: 0,
        },
      ],
    });

    expect(display).toEqual({
      kind: "search",
      toolName: "searchKnowledgeBase",
      total: 2,
      showing: 1,
      writeSafety: {
        state: "read_only",
        label: "Read-only",
        description: "This tool only read knowledge context. It did not save or change anything.",
      },
      documents: [
        {
          id: "doc-1",
          bookId: "book-1",
          title: "Chapter Notes",
          type: "standalone_note",
          path: "Knowledge base / Chapter Notes",
          snippet: "A useful theme note",
          matchFields: ["title", "path", "tags"],
          childCount: 0,
        },
      ],
    });
  });

  it("keeps knowledge search match fields readable and sanitized", () => {
    const display = getKnowledgeToolResultDisplay("searchKnowledgeBase", {
      total: 1,
      showing: 1,
      documents: [
        {
          id: "doc-1",
          title: "Tagged Note",
          path: "Knowledge base / Tagged Note",
          matchFields: ["tags", "bad-field", "summary", "tags", 1],
        },
      ],
    });

    expect(display?.documents[0]?.matchFields).toEqual(["tags", "summary"]);
  });

  it("summarizes current-book knowledge reads", () => {
    const display = getKnowledgeToolResultDisplay("getBookKnowledge", {
      bookId: "book-1",
      total: 3,
      showing: 1,
      documents: [
        {
          id: "home-1",
          title: "Book Home",
          type: "book_home",
          summary: "Compact memory",
        },
      ],
    });

    expect(display?.kind).toBe("bookKnowledge");
    expect(display?.bookId).toBe("book-1");
    expect(display?.total).toBe(3);
    expect(display?.showing).toBe(1);
    expect(display?.documents[0]?.snippet).toBe("Compact memory");
  });

  it("summarizes exact knowledge document reads", () => {
    const display = getKnowledgeToolResultDisplay("getKnowledgeDocument", {
      success: true,
      bookId: "book-1",
      documentId: "doc-1",
      path: "Knowledge base / Chapter Notes / Theme Map",
      document: {
        id: "doc-1",
        title: "Theme Map",
        type: "standalone_note",
        path: "Knowledge base / Chapter Notes / Theme Map",
        snippet: "A durable map of the chapter themes.",
      },
      outgoingLinks: [
        {
          id: "link-out",
          relation: "related",
          label: "Compare with",
          target: {
            id: "doc-2",
            title: "Related Note",
            type: "standalone_note",
            path: "Knowledge base / Chapter Notes / Related Note",
          },
        },
      ],
      backlinks: [
        {
          id: "link-back",
          relation: "references",
          label: "Mentioned by",
          from: {
            id: "doc-3",
            title: "Earlier Note",
            type: "standalone_note",
            path: "Knowledge base / Chapter Notes / Earlier Note",
          },
        },
      ],
    });

    expect(display).toEqual({
      kind: "document",
      toolName: "getKnowledgeDocument",
      total: 1,
      bookId: "book-1",
      documentId: "doc-1",
      writeSafety: {
        state: "read_only",
        label: "Read-only",
        description: "This tool only read knowledge context. It did not save or change anything.",
      },
      documents: [
        {
          id: "doc-1",
          title: "Theme Map",
          type: "standalone_note",
          path: "Knowledge base / Chapter Notes / Theme Map",
          snippet: "A durable map of the chapter themes.",
        },
        {
          id: "doc-2",
          title: "Related Note",
          type: "standalone_note",
          path: "Knowledge base / Chapter Notes / Related Note",
        },
        {
          id: "doc-3",
          title: "Earlier Note",
          type: "standalone_note",
          path: "Knowledge base / Chapter Notes / Earlier Note",
        },
      ],
      relations: [
        {
          id: "link-out",
          direction: "outgoing",
          relation: "related",
          label: "Compare with",
          document: {
            id: "doc-2",
            title: "Related Note",
            type: "standalone_note",
            path: "Knowledge base / Chapter Notes / Related Note",
          },
        },
        {
          id: "link-back",
          direction: "backlink",
          relation: "references",
          label: "Mentioned by",
          document: {
            id: "doc-3",
            title: "Earlier Note",
            type: "standalone_note",
            path: "Knowledge base / Chapter Notes / Earlier Note",
          },
        },
      ],
    });
  });

  it("omits unresolved exact-read relations instead of rendering empty rows", () => {
    const display = getKnowledgeToolResultDisplay("getKnowledgeDocument", {
      success: true,
      documentId: "doc-1",
      document: {
        id: "doc-1",
        title: "Theme Map",
        path: "Knowledge base / Theme Map",
      },
      outgoingLinks: [
        {
          id: "missing-target",
          relation: "related",
          toId: "missing-doc",
        },
      ],
      backlinks: [
        {
          id: "missing-source",
          relation: "references",
        },
      ],
    });

    expect(display).toMatchObject({
      kind: "document",
      documents: [
        {
          id: "doc-1",
          title: "Theme Map",
          path: "Knowledge base / Theme Map",
        },
      ],
      relations: [],
    });
  });

  it("uses full document content as a readable preview when exact reads include content", () => {
    const display = getKnowledgeToolResultDisplay("getKnowledgeDocument", {
      success: true,
      documentId: "doc-2",
      document: {
        id: "doc-2",
        title: "Long Note",
        type: "standalone_note",
        path: "Knowledge base / Long Note",
        content:
          "## Main Idea\n\n```ts\nconst hidden = true;\n```\nA durable note with **rich** context.",
      },
    });

    expect(display?.documents[0]).toMatchObject({
      id: "doc-2",
      title: "Long Note",
      path: "Knowledge base / Long Note",
      snippet: "Main Idea A durable note with rich context.",
    });
  });

  it("summarizes compact-memory updates", () => {
    const display = getKnowledgeToolResultDisplay("compressKnowledgeDocumentSummary", {
      success: true,
      status: "compressed",
      persisted: true,
      documentId: "doc-1",
      path: "Knowledge base / Chapter Notes / Durable Memory",
      document: {
        id: "doc-1",
        title: "Durable Memory",
        type: "summary",
        path: "Knowledge base / Chapter Notes / Durable Memory",
      },
      reason: "stale",
      sourceChars: 12000,
      summaryMd: "## Summary\n\nA durable reading memory.",
    });

    expect(display).toMatchObject({
      kind: "summary",
      toolName: "compressKnowledgeDocumentSummary",
      status: "compressed",
      persisted: true,
      documentId: "doc-1",
      reason: "stale",
      sourceChars: 12000,
      summaryPreview: "Summary A durable reading memory.",
      writeSafety: {
        state: "memory_persisted",
        label: "Memory updated",
        description:
          "This tool updated compact retrieval memory. It did not rewrite user-authored document content.",
      },
      documents: [
        {
          id: "doc-1",
          title: "Durable Memory",
          type: "summary",
          path: "Knowledge base / Chapter Notes / Durable Memory",
        },
      ],
    });
  });

  it("marks skipped compact-memory runs as no-write tool results", () => {
    const display = getKnowledgeToolResultDisplay("compressKnowledgeDocumentSummary", {
      success: true,
      status: "skipped",
      persisted: false,
      documentId: "doc-1",
      reason: "fresh",
    });

    expect(display).toMatchObject({
      kind: "summary",
      toolName: "compressKnowledgeDocumentSummary",
      persisted: false,
      writeSafety: {
        state: "memory_skipped",
        label: "No write",
        description: "This tool did not persist a summary or change user-authored content.",
      },
    });
  });

  it("turns knowledge tool failures into explicit failure cards", () => {
    const display = getKnowledgeToolResultDisplay("proposeKnowledgeDocumentUpdate", {
      success: false,
      error: "Knowledge document not found",
      documentId: "missing-doc",
    });

    expect(display).toMatchObject({
      kind: "failure",
      toolName: "proposeKnowledgeDocumentUpdate",
      documentId: "missing-doc",
      error: "Knowledge document not found",
      safeNoWriteHint:
        "No knowledge document or link was saved or changed by this failed tool call.",
      writeSafety: {
        state: "no_write_failed",
        label: "No write",
        description:
          "No knowledge document or link was saved or changed by this failed tool call.",
      },
      documents: [],
    });
    expect(display?.failureCardAttrs).toMatchObject({
      cardType: "aiToolFailure",
      title: "proposeKnowledgeDocumentUpdate",
      sourceId: "missing-doc",
      markdown:
        "Tool: proposeKnowledgeDocumentUpdate\nError: Knowledge document not found\nDocument: missing-doc\nNo knowledge document or link was saved or changed by this failed tool call.",
    });
    expect(display?.failureCardMarkdown).toContain("> [!failure] proposeKnowledgeDocumentUpdate");
    expect(display?.failureCardMarkdown).toContain("> Error: Knowledge document not found");
  });

  it("keeps knowledge document paths visible on tool failure cards", () => {
    const display = getKnowledgeToolResultDisplay("compressKnowledgeDocumentSummary", {
      success: false,
      status: "failed",
      error: "Model request failed",
      documentId: "doc-1",
      path: "Knowledge base / Chapter Notes / Durable Memory",
      document: {
        id: "doc-1",
        title: "Durable Memory",
        type: "summary",
        path: "Knowledge base / Chapter Notes / Durable Memory",
      },
    });

    expect(display).toMatchObject({
      kind: "failure",
      toolName: "compressKnowledgeDocumentSummary",
      status: "failed",
      documentId: "doc-1",
      error: "Model request failed",
      safeNoWriteHint:
        "No knowledge document or link was saved or changed by this failed tool call.",
      writeSafety: {
        state: "no_write_failed",
        label: "No write",
        description:
          "No knowledge document or link was saved or changed by this failed tool call.",
      },
      documents: [
        {
          id: "doc-1",
          title: "Durable Memory",
          type: "summary",
          path: "Knowledge base / Chapter Notes / Durable Memory",
        },
      ],
    });
    expect(display?.failureCardAttrs).toMatchObject({
      cardType: "aiToolFailure",
      sourceId: "doc-1",
      sourceTitle: "Knowledge base / Chapter Notes / Durable Memory",
    });
    expect(display?.failureCardMarkdown).toContain(
      "> Path: Knowledge base / Chapter Notes / Durable Memory",
    );
  });

  it("keeps proposal preview paths visible on failure cards", () => {
    const display = getKnowledgeToolResultDisplay("proposeKnowledgeDocumentUpdate", {
      success: false,
      status: "failed",
      error: "Move target is no longer available",
      documentId: "doc-1",
      currentPath: "Knowledge base / Inbox / Draft",
      targetPath: "Knowledge base / Missing Folder / Draft",
      visiblePath: "Knowledge base / Inbox / Draft -> Knowledge base / Missing Folder / Draft",
    });

    expect(display).toMatchObject({
      kind: "failure",
      toolName: "proposeKnowledgeDocumentUpdate",
      documentId: "doc-1",
      documents: [
        {
          id: "doc-1",
          title: "Knowledge base / Inbox / Draft -> Knowledge base / Missing Folder / Draft",
          path: "Knowledge base / Inbox / Draft -> Knowledge base / Missing Folder / Draft",
        },
      ],
    });
    expect(display?.failureCardMarkdown).toContain(
      "> Path: Knowledge base / Inbox / Draft -> Knowledge base / Missing Folder / Draft",
    );
  });

  it("keeps current and target knowledge paths visible on update failure cards", () => {
    const display = getKnowledgeToolResultDisplay("proposeKnowledgeDocumentUpdate", {
      success: false,
      status: "failed",
      error: "Move target became invalid before confirmation",
      documentId: "doc-1",
      current: {
        id: "doc-1",
        title: "Draft",
        path: "Knowledge base / Inbox / Draft",
      },
      target: {
        id: "doc-1",
        title: "Draft",
        path: "Knowledge base / Themes / Draft",
      },
    });

    expect(display).toMatchObject({
      kind: "failure",
      toolName: "proposeKnowledgeDocumentUpdate",
      documents: [
        {
          id: "doc-1",
          title: "Draft",
          path: "Knowledge base / Inbox / Draft",
        },
        {
          id: "doc-1",
          title: "Draft",
          path: "Knowledge base / Themes / Draft",
        },
      ],
    });
    expect(display?.failureCardMarkdown).toContain("> Paths:");
    expect(display?.failureCardMarkdown).toContain("> - Knowledge base / Inbox / Draft");
    expect(display?.failureCardMarkdown).toContain("> - Knowledge base / Themes / Draft");
  });

  it("keeps source and target paths visible on link failure cards", () => {
    const display = getKnowledgeToolResultDisplay("proposeKnowledgeLinkCreate", {
      success: false,
      status: "failed",
      error: "Target knowledge document no longer exists",
      fromDocumentId: "source-doc",
      source: {
        id: "source-doc",
        title: "Source note",
        path: "Knowledge base / Sources / Source note",
      },
      target: {
        id: "target-doc",
        title: "Target note",
        path: "Knowledge base / Themes / Target note",
      },
    });

    expect(display).toMatchObject({
      kind: "failure",
      toolName: "proposeKnowledgeLinkCreate",
      documentId: "source-doc",
      documents: [
        {
          id: "source-doc",
          title: "Source note",
          path: "Knowledge base / Sources / Source note",
        },
        {
          id: "target-doc",
          title: "Target note",
          path: "Knowledge base / Themes / Target note",
        },
      ],
    });
    expect(display?.failureCardMarkdown).toContain("> Paths:");
    expect(display?.failureCardMarkdown).toContain("> - Knowledge base / Sources / Source note");
    expect(display?.failureCardMarkdown).toContain("> - Knowledge base / Themes / Target note");
  });

  it("parses JSON string failures from knowledge tools", () => {
    const display = getKnowledgeToolResultDisplay(
      "compressKnowledgeDocumentSummary",
      JSON.stringify({
        success: false,
        status: "failed",
        reason: "model_error",
        message: "Model request failed",
      }),
    );

    expect(display).toMatchObject({
      kind: "failure",
      toolName: "compressKnowledgeDocumentSummary",
      status: "failed",
      reason: "model_error",
      error: "Model request failed",
      safeNoWriteHint:
        "No knowledge document or link was saved or changed by this failed tool call.",
      writeSafety: {
        state: "no_write_failed",
      },
      documents: [],
    });
    expect(display?.failureCardMarkdown).toContain("> Reason: model_error");
  });

  it("turns direct tool-call errors into knowledge failure cards", () => {
    const display = getKnowledgeToolResultDisplay("searchKnowledgeBase", undefined, {
      error: "Tool searchKnowledgeBase is not available",
    });

    expect(display).toMatchObject({
      kind: "failure",
      toolName: "searchKnowledgeBase",
      error: "Tool searchKnowledgeBase is not available",
      safeNoWriteHint:
        "No knowledge document or link was saved or changed by this failed tool call.",
      writeSafety: {
        state: "no_write_failed",
      },
      documents: [],
    });
    expect(display?.failureCardMarkdown).toContain("> [!failure] searchKnowledgeBase");
  });

  it("keeps direct knowledge errors visible even when the raw result is malformed", () => {
    const display = getKnowledgeToolResultDisplay("getBookKnowledge", "not-json", {
      error: new Error("Bridge message failed"),
    });

    expect(display).toMatchObject({
      kind: "failure",
      toolName: "getBookKnowledge",
      error: "Bridge message failed",
      safeNoWriteHint:
        "No knowledge document or link was saved or changed by this failed tool call.",
      writeSafety: {
        state: "no_write_failed",
      },
      documents: [],
    });
    expect(display?.failureCardAttrs?.cardType).toBe("aiToolFailure");
  });

  it("lets successful knowledge proposals use the proposal card renderer", () => {
    expect(
      getKnowledgeToolResultDisplay("proposeKnowledgeDocumentCreate", {
        success: true,
        action: "create",
        requiresConfirmation: true,
      }),
    ).toBeNull();
  });

  it("ignores unrelated tools and malformed results", () => {
    expect(getKnowledgeToolResultDisplay("fallbackSearch", { hits: [] })).toBeNull();
    expect(
      getKnowledgeToolResultDisplay("fallbackSearch", undefined, { error: "No tool" }),
    ).toBeNull();
    expect(getKnowledgeToolResultDisplay("searchKnowledgeBase", "not-json")).toBeNull();
  });
});
