# Target Architecture

## Core Concepts

The knowledge base should be built around documents and links, not around only
annotations.

Recommended concepts:

- Book
  - Existing library book entity.
  - Owns a default knowledge document.
- Highlight
  - Existing reader annotation tied to a CFI.
  - Remains optimized for reader rendering.
- Knowledge document
  - Editable Tiptap document.
  - Can be a book home page, standalone note, highlight note, review, summary,
    imported Markdown file, AI-generated note, or custom user document.
  - Participates in a vault-style hierarchy through `parent_id`; folders and
    documents are first-class siblings, not a flat note list with fake labels.
- Knowledge link
  - Connects documents to books, highlights, CFIs, other documents, external
    URLs, Obsidian paths, or AI messages.
- Knowledge attachment
  - Images and other files used inside documents and cards.
- Knowledge card
  - Structured Tiptap node with a type, version, attrs, optional content, and a
    Markdown fallback renderer.

## Vault Hierarchy

The knowledge base should feel closer to an Obsidian vault than a notes table.
The tree is part of the product model, not only a view concern.

This hierarchy is not the same thing as tags or book groups. Tags answer
"what is this about?" while the vault tree answers "where does this document
live?" ReadAny must support both, but folder structure is the user's spatial
organization and should remain visible in navigation, breadcrumbs, export paths,
and sync reconciliation.

Rules:

- A book owns one `book_home` document at the root of its knowledge vault.
- `folder` documents are structural nodes. They can contain other folders,
  standalone notes, reviews, summaries, imported Markdown, and AI-created
  documents.
- Non-folder documents can have a `parent_id`, but they cannot contain children.
- `book_home` is pinned at the top and cannot be moved under another document.
- Moving a document updates only `parent_id`; content and links remain stable.
- Cycles are invalid. If a parent is missing after import or sync, the document
  is treated as an orphaned root and surfaced in the UI rather than hidden.
- Search should ignore collapse state and search the whole vault.
- AI tools and importers must accept `parentId` so proposed documents land in
  the user's chosen folder instead of always appearing at the root.
- WYSIWYG document editing is the primary surface. Markdown paths are kept for
  projection, import/export, search, Obsidian, and fallback, not as the default
  editing UI.

Navigation model:

- Desktop uses a persistent left tree, a center editor, and optional right
  context. The tree must show indentation, folder expand/collapse, active path,
  and quick create/move affordances.
- Mobile uses a native vault browser first, then a focused editor screen. It
  should show the current path and use bottom sheets for create/move actions so
  the editor remains calm.
- The current path is a real breadcrumb: `Knowledge base / Folder / Document`.
  It should be visible near the document title and preserved through export.
- Folder nodes open a folder browsing surface. They should not show a blank
  writing editor unless the product later introduces folder README content.

Export model:

- Obsidian export maps the ReadAny hierarchy to folders where possible.
- Stable document IDs stay in frontmatter and manifest data so renames and moves
  can be reconciled safely.
- Folder documents can export as folder-level `README.md` or index files when
  they contain body content; empty folders can still appear in the manifest.

## Proposed Tables

Names are intentionally explicit and can be shortened during implementation.

```sql
CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY,
  book_id TEXT,
  parent_id TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content_json TEXT NOT NULL DEFAULT '{}',
  content_md TEXT NOT NULL DEFAULT '',
  content_schema_version INTEGER NOT NULL DEFAULT 1,
  excerpt TEXT,
  tags TEXT DEFAULT '[]',
  source_kind TEXT,
  source_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  sync_version INTEGER DEFAULT 0,
  last_modified_by TEXT,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_links (
  id TEXT PRIMARY KEY,
  from_document_id TEXT NOT NULL,
  to_kind TEXT NOT NULL,
  to_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  label TEXT,
  cfi TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sync_version INTEGER DEFAULT 0,
  last_modified_by TEXT,
  FOREIGN KEY (from_document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_attachments (
  id TEXT PRIMARY KEY,
  document_id TEXT,
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  local_path TEXT,
  remote_path TEXT,
  size INTEGER DEFAULT 0,
  hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sync_version INTEGER DEFAULT 0,
  last_modified_by TEXT
);

CREATE TABLE IF NOT EXISTS knowledge_card_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  schema_json TEXT NOT NULL DEFAULT '{}',
  built_in INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sync_version INTEGER DEFAULT 0,
  last_modified_by TEXT
);
```

## Document Types

Recommended initial values:

- `book_home`
  - One default document per book.
  - Auto-created lazily when opening book details or notes.
- `standalone_note`
  - User-created note under a book or global knowledge area.
- `highlight_note`
  - A rich note linked to a highlight.
  - Replaces inline `highlights.note` over time.
- `review`
  - Long-form book review.
- `summary`
  - User or AI generated summary.
- `imported_markdown`
  - A document imported from Markdown/Obsidian.

## Migration Strategy

Use a compatibility migration, not a destructive rewrite.

Phase 1:

- Add new knowledge tables.
- For every book, create `book_home` lazily.
- For every existing `notes` row, create a matching `knowledge_document`.
- For every `highlight.note`, create a `highlight_note` document linked to the
  highlight.
- Keep writing `highlights.note` for old UI compatibility while the new UI is
  being built.

Phase 2:

- New UI reads from knowledge documents.
- Highlight note edits update the linked knowledge document first.
- A compatibility projection updates `highlights.note` from the Markdown
  projection so old paths keep working.

Phase 3:

- Remove direct editing paths for `highlights.note`.
- Keep the column as a denormalized preview field or migrate it away after
  enough versions.

## Sync Strategy

Add new tables to `SYNC_TABLES`:

- `knowledge_documents` using `updated_at`
- `knowledge_links` using `updated_at`
- `knowledge_attachments` using `updated_at`
- `knowledge_card_templates` using `updated_at`

Initial conflict model:

- Last-write-wins per document row.
- Keep `content_schema_version` for future migrations.
- Store `content_md` as a derived projection, but sync it with the document row
  so remote devices can search and export without rendering JSON immediately.

Future conflict model:

- Add per-document revision hashes.
- Consider block-level merge only after the basic document model is stable.
- If collaborative editing is introduced later, use a CRDT layer rather than
  stretching the current table sync model.

## File and Attachment Sync

Attachments should not be stored only in SQLite.

Recommended remote layout:

```text
/readany/data/knowledge/
  attachments/
    {hash-or-id}.{ext}
  exports/
    obsidian/
      manifest.json
```

The DB row stores metadata and the file sync layer moves bytes. This keeps S3,
WebDAV, and LAN behavior consistent.

## AI Integration

Knowledge documents should become AI-readable sources:

- Search current book home document and linked highlight notes.
- Search global knowledge documents.
- Let tools create or update documents with explicit user confirmation.
- Let tools manage book grouping and document tags through typed operations.
- Keep citation links back to book CFI, highlight, or source document.

Recommended tools later:

- `searchKnowledge`
- `getBookKnowledge`
- `createKnowledgeDocument`
- `updateKnowledgeDocument`
- `linkKnowledgeSource`
- `tagKnowledgeDocument`

## Search

Start with deterministic local search:

- `content_md` FTS for keyword search.
- Tags and title indexes.
- Book-scoped and global filters.

Then integrate with existing vectorization:

- Knowledge documents can be vectorized independently from books.
- Book text, highlights, and knowledge documents should be separate source types
  in retrieval results.
