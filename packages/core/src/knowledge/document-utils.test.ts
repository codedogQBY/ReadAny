import { describe, expect, it } from "vitest";
import type { KnowledgeDocument } from "../types";
import {
  buildKnowledgeDocumentTree,
  collectKnowledgeDocumentSubtree,
  createHighlightNoteMarkdown,
  createHighlightNoteProjection,
  createHighlightNoteTitle,
  createKnowledgeFolderDisplaySections,
  createKnowledgeDocumentMoveTargets,
  createKnowledgeDocumentSearchText,
  createKnowledgeExcerpt,
  createKnowledgeRootDisplaySections,
  createLegacyNoteMarkdown,
  createLegacyNoteProjection,
  createLegacyNoteTitle,
  extractHighlightNoteContentForLegacyField,
  extractKnowledgeDocumentOutline,
  extractLegacyNoteContentForLegacyField,
  filterKnowledgeDocumentTreeNodesForSearch,
  flattenKnowledgeDocumentTree,
  formatKnowledgeDocumentPath,
  getKnowledgeDocumentCreateParentId,
  getKnowledgeDocumentOpenMode,
  getKnowledgeDocumentWorkspaceMode,
  isGeneratedHighlightNoteDocument,
  isGeneratedLegacyNoteDocument,
  knowledgeDocumentFingerprint,
  orderKnowledgeDocuments,
  resolveKnowledgeDocumentPath,
  validateKnowledgeDocumentParent,
  validateKnowledgeDocumentSiblingTitle,
} from "./document-utils";

function document(overrides: Partial<KnowledgeDocument>): KnowledgeDocument {
  return {
    id: "doc",
    bookId: "book-1",
    type: "standalone_note",
    title: "Document",
    contentJson: { type: "doc", content: [] },
    contentMd: "",
    contentSchemaVersion: 1,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("knowledge document utilities", () => {
  it("orders book home first and keeps newer documents ahead", () => {
    const oldNote = document({ id: "old", createdAt: 10, updatedAt: 20 });
    const home = document({ id: "home", type: "book_home", createdAt: 1, updatedAt: 1 });
    const newerNote = document({ id: "new", createdAt: 20, updatedAt: 40 });

    expect(orderKnowledgeDocuments([oldNote, newerNote, home]).map((item) => item.id)).toEqual([
      "home",
      "new",
      "old",
    ]);
  });

  it("orders folders before regular documents", () => {
    const note = document({ id: "note", title: "Latest note", updatedAt: 100 });
    const folder = document({ id: "folder", type: "folder", title: "Research", updatedAt: 1 });

    expect(orderKnowledgeDocuments([note, folder]).map((item) => item.id)).toEqual([
      "folder",
      "note",
    ]);
  });

  it("deduplicates documents before sorting", () => {
    const stale = document({ id: "same", title: "Stale", updatedAt: 1 });
    const current = document({ id: "same", title: "Current", updatedAt: 10 });

    expect(orderKnowledgeDocuments([stale, current])).toEqual([current]);
  });

  it("partitions ordered folder children into home, folder, and document sections", () => {
    const home = document({ id: "home", type: "book_home", title: "Home" });
    const folderA = document({ id: "folder-a", type: "folder", title: "A" });
    const folderB = document({ id: "folder-b", type: "folder", title: "B" });
    const review = document({ id: "review", type: "review", title: "Review" });
    const note = document({ id: "note", title: "Note" });

    expect(
      createKnowledgeFolderDisplaySections([home, folderA, note, folderB, review], "home"),
    ).toEqual({
      home: [home],
      folders: [folderA, folderB],
      documents: [note, review],
    });
  });

  it("keeps book home documents in the home section even without a home id", () => {
    const home = document({ id: "home", type: "book_home", title: "Home" });
    const note = document({ id: "note", title: "Note" });

    expect(createKnowledgeFolderDisplaySections([note, home])).toEqual({
      home: [home],
      folders: [],
      documents: [note],
    });
  });

  it("keeps orphaned root documents visible in a dedicated root browser section", () => {
    const home = document({ id: "home", type: "book_home", title: "Home" });
    const folder = document({ id: "folder", type: "folder", title: "Ideas" });
    const note = document({ id: "note", title: "Root note" });
    const orphanedNote = document({
      id: "orphaned-note",
      title: "Missing parent",
      parentId: "missing-folder",
    });
    const cyclicFolder = document({
      id: "cyclic-folder",
      type: "folder",
      title: "Cyclic",
      parentId: "cyclic-folder",
    });

    expect(
      createKnowledgeRootDisplaySections([orphanedNote, folder, cyclicFolder, home, note], "home"),
    ).toEqual({
      home: [home],
      folders: [folder],
      documents: [note],
      orphaned: [cyclicFolder, orphanedNote],
    });
  });

  it("routes vault roots and folders to browsers, not document editors", () => {
    const folder = document({ id: "folder", type: "folder", title: "Ideas" });
    const note = document({ id: "note", type: "standalone_note", title: "Note" });
    const home = document({ id: "home", type: "book_home", title: "Home" });

    expect(getKnowledgeDocumentOpenMode({ document: null })).toBe("vault_root");
    expect(getKnowledgeDocumentOpenMode({ document: note, isVaultRootOpen: true })).toBe(
      "vault_root",
    );
    expect(getKnowledgeDocumentOpenMode({ document: folder })).toBe("folder_browser");
    expect(getKnowledgeDocumentOpenMode({ document: note })).toBe("document_editor");
    expect(getKnowledgeDocumentOpenMode({ document: home })).toBe("document_editor");
  });

  it("keeps mobile workspace mode aligned with the open mode contract", () => {
    expect(getKnowledgeDocumentWorkspaceMode()).toBe("vault");
    expect(getKnowledgeDocumentWorkspaceMode(document({ id: "folder", type: "folder" }))).toBe(
      "vault",
    );
    expect(
      getKnowledgeDocumentWorkspaceMode(document({ id: "note", type: "standalone_note" })),
    ).toBe("document");
  });

  it("resolves create targets from the active vault context", () => {
    const folder = document({ id: "folder", type: "folder", title: "Ideas" });
    const nested = document({
      id: "nested",
      type: "standalone_note",
      title: "Question",
      parentId: "folder",
    });
    const rootNote = document({ id: "root-note", type: "standalone_note", title: "Root Note" });
    const home = document({ id: "home", type: "book_home", title: "Home" });

    expect(getKnowledgeDocumentCreateParentId({ document: folder })).toBe("folder");
    expect(getKnowledgeDocumentCreateParentId({ document: nested })).toBe("folder");
    expect(getKnowledgeDocumentCreateParentId({ document: rootNote })).toBeUndefined();
    expect(getKnowledgeDocumentCreateParentId({ document: home })).toBeUndefined();
    expect(
      getKnowledgeDocumentCreateParentId({ document: folder, isVaultRootOpen: true }),
    ).toBeUndefined();
  });

  it("builds a stable document tree from parent ids", () => {
    const home = document({ id: "home", type: "book_home", title: "Home" });
    const folder = document({ id: "folder", type: "folder", title: "Ideas", updatedAt: 1 });
    const nested = document({ id: "nested", title: "Nested note", parentId: "folder" });
    const stale = document({
      id: "stale",
      title: "Missing parent",
      parentId: "missing-folder",
      updatedAt: 2,
    });

    const tree = buildKnowledgeDocumentTree([nested, stale, folder, home], "home");

    expect(tree.roots.map((node) => node.document.id)).toEqual(["home", "folder", "stale"]);
    expect(tree.roots[1].children.map((node) => node.document.id)).toEqual(["nested"]);
    expect(tree.roots[1].children[0].depth).toBe(1);
    expect(tree.orphaned.map((item) => item.id)).toEqual(["stale"]);
  });

  it("promotes cyclic document parents to roots", () => {
    const left = document({ id: "left", parentId: "right" });
    const right = document({ id: "right", parentId: "left" });

    const tree = buildKnowledgeDocumentTree([left, right]);

    expect(tree.roots.map((node) => node.document.id).sort()).toEqual(["left", "right"]);
    expect(tree.roots.flatMap((node) => node.children)).toEqual([]);
  });

  it("collects a stable folder subtree without unrelated sibling documents", () => {
    const home = document({ id: "home", type: "book_home", title: "Home" });
    const folder = document({ id: "folder", type: "folder", title: "Ideas" });
    const childFolder = document({
      id: "child-folder",
      type: "folder",
      title: "Scenes",
      parentId: "folder",
    });
    const childNote = document({ id: "child-note", title: "Child note", parentId: "folder" });
    const nestedNote = document({
      id: "nested-note",
      title: "Nested note",
      parentId: "child-folder",
    });
    const sibling = document({ id: "sibling", title: "Sibling note" });

    expect(
      collectKnowledgeDocumentSubtree(
        "folder",
        [sibling, nestedNote, childNote, childFolder, folder, home],
        "home",
      ).map((item) => item.id),
    ).toEqual(["folder", "child-folder", "nested-note", "child-note"]);
  });

  it("returns an empty subtree for missing or cyclic roots", () => {
    const left = document({ id: "left", parentId: "right" });
    const right = document({ id: "right", parentId: "left" });

    expect(collectKnowledgeDocumentSubtree("missing", [left, right])).toEqual([]);
    expect(collectKnowledgeDocumentSubtree("left", [left, right]).map((item) => item.id)).toEqual([
      "left",
    ]);
  });

  it("resolves a stable vault path from parent ids", () => {
    const firstFolder = document({ id: "ideas-a", type: "folder", title: "Ideas" });
    const secondFolder = document({ id: "ideas-b", type: "folder", title: "Ideas" });
    const nested = document({
      id: "nested",
      title: "Quote map",
      parentId: "ideas-b",
      updatedAt: 20,
    });

    expect(resolveKnowledgeDocumentPath(nested, [nested, firstFolder, secondFolder])).toEqual([
      { id: "ideas-b", title: "Ideas", type: "folder" },
      { id: "nested", title: "Quote map", type: "standalone_note" },
    ]);
  });

  it("stops vault path resolution at missing or cyclic parents", () => {
    const orphan = document({ id: "orphan", title: "Orphan", parentId: "missing" });
    const left = document({ id: "left", title: "Left", parentId: "right" });
    const right = document({ id: "right", title: "Right", parentId: "left" });

    expect(resolveKnowledgeDocumentPath(orphan, [orphan])).toEqual([
      { id: "orphan", title: "Orphan", type: "standalone_note" },
    ]);
    expect(resolveKnowledgeDocumentPath(left, [left, right])).toEqual([
      { id: "right", title: "Right", type: "standalone_note" },
      { id: "left", title: "Left", type: "standalone_note" },
    ]);
  });

  it("formats a human-readable vault path with orphan context", () => {
    const folder = document({ id: "folder", type: "folder", title: "Ideas" });
    const nested = document({ id: "nested", title: "", parentId: "folder" });
    const orphan = document({ id: "orphan", title: "Loose", parentId: "missing" });

    expect(formatKnowledgeDocumentPath(nested, [folder, nested])).toBe(
      "Knowledge base / Ideas / Untitled document",
    );
    expect(
      formatKnowledgeDocumentPath(orphan, [orphan], {
        includeOrphanedParent: true,
      }),
    ).toBe("Knowledge base / Orphaned / Loose");
    expect(
      formatKnowledgeDocumentPath(nested, [folder, nested], {
        rootTitle: "知识库",
        untitledTitle: "未命名文档",
      }),
    ).toBe("知识库 / Ideas / 未命名文档");
  });

  it("includes vault paths and orphan context in document search text", () => {
    const folder = document({ id: "folder", type: "folder", title: "Chapter Notes" });
    const nested = document({
      id: "nested",
      title: "Question Log",
      parentId: "folder",
      contentMd: "A note about pacing.",
      tags: ["trail"],
    });
    const orphan = document({
      id: "orphan",
      title: "Loose",
      parentId: "missing",
      excerpt: "Recovered after sync",
    });

    expect(
      createKnowledgeDocumentSearchText(nested, [folder, nested], {
        rootTitle: "知识库",
        typeLabel: "文档",
      }),
    ).toContain("知识库 / chapter notes / question log");
    expect(createKnowledgeDocumentSearchText(nested, [folder, nested])).toContain("trail");
    expect(
      createKnowledgeDocumentSearchText(orphan, [orphan], {
        orphanedParentTitle: "孤立文档",
      }),
    ).toContain("knowledge base / 孤立文档 / loose");
  });

  it("filters flattened tree nodes by nested vault path and content", () => {
    const home = document({ id: "home", type: "book_home", title: "Book Home" });
    const folder = document({ id: "folder", type: "folder", title: "Chapter Notes" });
    const nestedFolder = document({
      id: "themes",
      type: "folder",
      title: "Themes",
      parentId: "folder",
    });
    const nested = document({
      id: "nested",
      title: "Question Log",
      parentId: "themes",
      contentMd: "Buried clue about pacing.",
    });
    const documents = [nested, nestedFolder, folder, home];
    const tree = buildKnowledgeDocumentTree(documents, "home");
    const flatNodes = flattenKnowledgeDocumentTree(tree.roots);

    expect(filterKnowledgeDocumentTreeNodesForSearch(flatNodes, documents, "")).toEqual([]);
    expect(
      filterKnowledgeDocumentTreeNodesForSearch(
        flatNodes,
        documents,
        "chapter notes / themes / question",
      ).map((node) => node.document.id),
    ).toEqual(["nested"]);
    expect(
      filterKnowledgeDocumentTreeNodesForSearch(
        flatNodes,
        documents,
        "chapter notes themes question",
      ).map((node) => node.document.id),
    ).toEqual(["nested"]);
    expect(
      filterKnowledgeDocumentTreeNodesForSearch(flatNodes, documents, "buried clue").map(
        (node) => node.document.id,
      ),
    ).toEqual(["nested"]);
  });

  it("creates move targets with full paths for duplicate folder names", () => {
    const ideas = document({ id: "ideas", type: "folder", title: "Ideas" });
    const reviews = document({ id: "reviews", type: "folder", title: "Reviews" });
    const inbox = document({ id: "inbox", type: "folder", title: "Inbox" });
    const ideaThemes = document({
      id: "idea-themes",
      type: "folder",
      title: "Themes",
      parentId: "ideas",
    });
    const reviewThemes = document({
      id: "review-themes",
      type: "folder",
      title: "Themes",
      parentId: "reviews",
    });
    const note = document({ id: "note", title: "Loose Note", parentId: "inbox" });

    expect(
      createKnowledgeDocumentMoveTargets(
        note,
        [ideas, reviews, inbox, ideaThemes, reviewThemes, note],
        {
          rootTargetTitle: "Root",
        },
      ),
    ).toEqual([
      { id: undefined, title: "Root", path: "Knowledge base", depth: 0 },
      { id: "ideas", title: "Ideas", path: "Knowledge base / Ideas", depth: 1 },
      {
        id: "idea-themes",
        title: "Themes",
        path: "Knowledge base / Ideas / Themes",
        depth: 2,
      },
      { id: "reviews", title: "Reviews", path: "Knowledge base / Reviews", depth: 1 },
      {
        id: "review-themes",
        title: "Themes",
        path: "Knowledge base / Reviews / Themes",
        depth: 2,
      },
    ]);
  });

  it("omits invalid move targets for folders", () => {
    const parent = document({ id: "parent", type: "folder", title: "Parent" });
    const child = document({ id: "child", type: "folder", title: "Child", parentId: "parent" });
    const sibling = document({ id: "sibling", type: "folder", title: "Sibling" });

    expect(createKnowledgeDocumentMoveTargets(parent, [parent, child, sibling])).toEqual([
      { id: "sibling", title: "Sibling", path: "Knowledge base / Sibling", depth: 1 },
    ]);
  });

  it("validates document parent moves", () => {
    const home = document({ id: "home", type: "book_home" });
    const root = document({ id: "root", type: "folder", title: "Root" });
    const child = document({ id: "child", type: "folder", title: "Child", parentId: "root" });
    const note = document({ id: "note", parentId: "child" });
    const sibling = document({ id: "sibling" });
    const documents = [home, root, child, note, sibling];

    expect(validateKnowledgeDocumentParent("note", "root", documents)).toEqual({ ok: true });
    expect(validateKnowledgeDocumentParent("note", undefined, documents)).toEqual({ ok: true });
    expect(validateKnowledgeDocumentParent("note", "child", documents)).toEqual({
      ok: false,
      reason: "same_parent",
    });
    expect(validateKnowledgeDocumentParent("note", "missing", documents)).toEqual({
      ok: false,
      reason: "missing_parent",
    });
    expect(validateKnowledgeDocumentParent("note", "sibling", documents)).toEqual({
      ok: false,
      reason: "parent_not_folder",
    });
    expect(validateKnowledgeDocumentParent("child", "child", documents)).toEqual({
      ok: false,
      reason: "self_parent",
    });
    expect(validateKnowledgeDocumentParent("root", "child", documents)).toEqual({
      ok: false,
      reason: "descendant_parent",
    });
    expect(validateKnowledgeDocumentParent("home", "root", documents)).toEqual({
      ok: false,
      reason: "book_home_locked",
    });
  });

  it("rejects empty knowledge document sibling titles", () => {
    expect(
      validateKnowledgeDocumentSiblingTitle({
        title: "   ",
        documents: [],
      }),
    ).toEqual({ ok: false, reason: "empty_title" });
  });

  it("rejects duplicate document titles in the same folder", () => {
    const existing = document({
      id: "existing",
      bookId: "book-1",
      parentId: "folder-1",
      title: "Chapter Notes",
    });

    expect(
      validateKnowledgeDocumentSiblingTitle({
        bookId: "book-1",
        parentId: "folder-1",
        title: " chapter   notes ",
        documents: [existing],
      }),
    ).toEqual({
      ok: false,
      reason: "duplicate_sibling_title",
      duplicate: existing,
    });
  });

  it("allows the same document title in different folders or books", () => {
    const sameTitleDifferentFolder = document({
      id: "folder-copy",
      bookId: "book-1",
      parentId: "folder-2",
      title: "Chapter Notes",
    });
    const sameTitleDifferentBook = document({
      id: "book-copy",
      bookId: "book-2",
      parentId: "folder-1",
      title: "Chapter Notes",
    });

    expect(
      validateKnowledgeDocumentSiblingTitle({
        bookId: "book-1",
        parentId: "folder-1",
        title: "Chapter Notes",
        documents: [sameTitleDifferentFolder, sameTitleDifferentBook],
      }),
    ).toEqual({ ok: true });
  });

  it("allows keeping the current document title and ignores deleted duplicates", () => {
    const current = document({
      id: "current",
      bookId: "book-1",
      parentId: "folder-1",
      title: "Chapter Notes",
    });
    const deleted = document({
      id: "deleted",
      bookId: "book-1",
      parentId: "folder-1",
      title: "Chapter Notes",
      deletedAt: 123,
    });

    expect(
      validateKnowledgeDocumentSiblingTitle({
        documentId: "current",
        bookId: "book-1",
        parentId: "folder-1",
        title: "Chapter Notes",
        documents: [current, deleted],
      }),
    ).toEqual({ ok: true });
  });

  it("extracts a heading outline from Tiptap JSON", () => {
    const outline = extractKnowledgeDocumentOutline({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "第一章  起点" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "Body" }] },
        {
          type: "blockquote",
          content: [
            {
              type: "heading",
              attrs: { level: 3 },
              content: [
                { type: "text", text: "关键问题" },
                { type: "hardBreak" },
                { type: "text", text: "继续" },
              ],
            },
          ],
        },
      ],
    });

    expect(outline).toEqual([
      { id: "heading-1", index: 0, level: 1, title: "第一章 起点" },
      { id: "heading-2", index: 1, level: 3, title: "关键问题 继续" },
    ]);
  });

  it("falls back to markdown headings when Tiptap JSON has no outline", () => {
    const outline = extractKnowledgeDocumentOutline(
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }] },
      `# Main **Idea**

\`\`\`md
## Hidden
\`\`\`

### [[doc-id|Linked section]]
`,
    );

    expect(outline).toEqual([
      { id: "heading-1-main-idea", index: 0, level: 1, title: "Main Idea" },
      { id: "heading-2-linked-section", index: 1, level: 3, title: "Linked section" },
    ]);
  });

  it("ignores empty headings and clamps invalid heading levels", () => {
    const outline = extractKnowledgeDocumentOutline({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 0 }, content: [{ type: "text", text: "Low" }] },
        { type: "heading", attrs: { level: 99 }, content: [{ type: "text", text: "High" }] },
        { type: "heading", attrs: { level: 2 }, content: [] },
      ],
    });

    expect(outline).toEqual([
      { id: "heading-1-low", index: 0, level: 1, title: "Low" },
      { id: "heading-2-high", index: 1, level: 6, title: "High" },
    ]);
  });

  it("uses normalized titles in document fingerprints", () => {
    const value = {
      contentJson: { type: "doc", content: [{ type: "paragraph" }] },
      contentMd: "Hello",
    };

    expect(knowledgeDocumentFingerprint("  Title  ", value)).toBe(
      knowledgeDocumentFingerprint("Title", value),
    );
    expect(knowledgeDocumentFingerprint("Other", value)).not.toBe(
      knowledgeDocumentFingerprint("Title", value),
    );
  });

  it("uses normalized tag sets in document fingerprints", () => {
    const value = {
      contentJson: { type: "doc", content: [{ type: "paragraph" }] },
      contentMd: "Hello",
    };

    expect(knowledgeDocumentFingerprint("Title", value, [" idea ", "book", "idea"])).toBe(
      knowledgeDocumentFingerprint("Title", value, ["book", "idea"]),
    );
    expect(knowledgeDocumentFingerprint("Title", value, ["book"])).not.toBe(
      knowledgeDocumentFingerprint("Title", value, ["book", "idea"]),
    );
  });

  it("creates compact excerpts from markdown", () => {
    const excerpt = createKnowledgeExcerpt(`# Title

> quoted **text**

<!-- internal marker -->

\`\`\`ts
const hidden = true;
\`\`\`

- final point`);

    expect(excerpt).toBe("Title quoted text final point");
  });

  it("projects highlight notes into readable knowledge markdown", () => {
    const highlight = {
      id: "hl-1",
      bookId: "book-1",
      cfi: "epubcfi(/6/2)",
      text: "Learning without thought is labor lost.\nThought without learning is perilous.",
      color: "yellow" as const,
      note: "Modern meaning: study and reflection need each other.",
      chapterTitle: "Analects",
      createdAt: 1,
      updatedAt: 1,
    };

    expect(createHighlightNoteTitle(highlight)).toBe(
      "Modern meaning: study and reflection need each other.",
    );
    expect(
      createHighlightNoteMarkdown(highlight),
    ).toBe(`Modern meaning: study and reflection need each other.

> Learning without thought is labor lost.
> Thought without learning is perilous.

_Source: Analects_`);

    const projection = createHighlightNoteProjection(highlight);
    expect(projection.contentJson).toMatchObject({ type: "doc" });
    expect(projection.excerpt).toContain("Modern meaning");
  });

  it("detects generated highlight note documents without treating user edits as generated", () => {
    const highlight = {
      id: "hl-1",
      bookId: "book-1",
      cfi: "epubcfi(/6/2)",
      text: "Source quote",
      color: "yellow" as const,
      note: "Original note",
      chapterTitle: "Chapter 1",
      createdAt: 1,
      updatedAt: 1,
    };
    const generated = document({
      id: "doc-1",
      type: "highlight_note",
      sourceKind: "highlight",
      sourceId: "hl-1",
      contentMd: createHighlightNoteMarkdown(highlight),
    });
    const edited = document({
      ...generated,
      contentMd: `${createHighlightNoteMarkdown(highlight)}\n\nUser expansion`,
    });

    expect(isGeneratedHighlightNoteDocument(generated, highlight)).toBe(true);
    expect(isGeneratedHighlightNoteDocument(edited, highlight)).toBe(false);
  });

  it("extracts only user-authored content when writing highlight notes back to legacy fields", () => {
    const highlight = {
      text: "Source quote\nwith two lines",
      chapterTitle: "Chapter 1",
    };

    const markdown = `My interpretation.

> Source quote
> with two lines

_Source: Chapter 1_

> A user-authored quote should stay.

Follow-up idea.`;

    expect(extractHighlightNoteContentForLegacyField(markdown, highlight)).toBe(`My interpretation.

> A user-authored quote should stay.

Follow-up idea.`);
  });

  it("projects legacy notes into standalone knowledge documents", () => {
    const note = {
      id: "note-1",
      bookId: "book-1",
      title: "Reading question",
      content: "Why does this argument depend on memory?",
      chapterTitle: "Chapter 2",
      tags: ["question"],
      createdAt: 1,
      updatedAt: 1,
    };

    expect(createLegacyNoteTitle(note)).toBe("Reading question");
    expect(createLegacyNoteMarkdown(note)).toBe(`Why does this argument depend on memory?

_Source: Chapter 2_`);

    const projection = createLegacyNoteProjection(note);
    expect(projection.contentJson).toMatchObject({ type: "doc" });
    expect(projection.tags).toEqual(["question"]);
    expect(projection.excerpt).toContain("argument");
  });

  it("detects generated legacy note documents without overwriting expanded notes", () => {
    const note = {
      id: "note-1",
      bookId: "book-1",
      title: "Reading question",
      content: "Original content",
      chapterTitle: "Chapter 2",
      tags: ["question"],
      createdAt: 1,
      updatedAt: 1,
    };
    const generated = document({
      id: "doc-1",
      type: "standalone_note",
      title: "Reading question",
      sourceKind: "note",
      sourceId: "note-1",
      contentMd: createLegacyNoteMarkdown(note),
    });
    const retitled = document({
      ...generated,
      title: "My own title",
    });
    const expanded = document({
      ...generated,
      contentMd: `${createLegacyNoteMarkdown(note)}\n\nUser expansion`,
    });

    expect(isGeneratedLegacyNoteDocument(generated, note)).toBe(true);
    expect(isGeneratedLegacyNoteDocument(retitled, note)).toBe(false);
    expect(isGeneratedLegacyNoteDocument(expanded, note)).toBe(false);
  });

  it("removes generated source metadata when writing legacy notes back", () => {
    const markdown = `Reading question.

_Source: Chapter 2_

Extra thought.`;

    expect(extractLegacyNoteContentForLegacyField(markdown, { chapterTitle: "Chapter 2" })).toBe(
      `Reading question.

Extra thought.`,
    );
  });
});
