# Knowledge Base Notes Redesign

This document set researches and scopes the next-generation ReadAny note system:
turning highlights and notes into a book-centered knowledge base with Tiptap
editing, mobile WebView editing, Obsidian export/linking, richer export, and
extensible custom display cards.

## Product Goal

ReadAny should stop treating notes as only "text attached to a highlight".
The target system should support:

- A dedicated editable knowledge document for every book.
- Highlights, quote notes, standalone notes, reviews, summaries, AI outputs, and
  custom cards as first-class knowledge items.
- A unified Tiptap editor on desktop and mobile.
- Mobile editing through a WebView-based Tiptap editor instead of native
  TextInput markdown editing.
- Scenario-based editor profiles: quick annotation stays lightweight, book
  knowledge pages stay powerful, reviews stay export-friendly, and metadata
  stays in structured fields instead of rich-text blocks.
- Obsidian-friendly export and, on desktop, optional linked vault/folder output.
- Export to Markdown, JSON, Obsidian-style vault folders, and later other targets.
- Backlinks, tags, book grouping, search, AI retrieval, and source citations.
- Extensible custom cards that can render rich interactive UI inside ReadAny and
  degrade cleanly to Markdown outside ReadAny.
- A real vault-style hierarchy with folders, breadcrumbs, and Obsidian-friendly
  paths, not a flat notes list disguised with tags.
- A WYSIWYG document canvas on desktop and mobile; Markdown stays as a
  projection for export, search, Obsidian, and fallback.

## Key Recommendation

Use Tiptap JSON as the canonical document source and maintain Markdown as a
projection/cache for export, Obsidian, full-text search, and interoperability.

Why:

- Tiptap officially recommends JSON persistence for flexibility and parseability.
- Custom ReadAny cards need structured node attributes and interactive node views.
- Markdown is still the right interchange format for Obsidian and export.
- A dual representation lets ReadAny be powerful without trapping user content.

In short:

```text
Tiptap JSON = source of truth inside ReadAny
Markdown = deterministic projection for export, Obsidian, search, and fallback
```

## Recommended Architecture

- Keep `highlights` as reader annotations because they are tied to CFI and reader
  rendering.
- Introduce knowledge documents as the new primary note layer.
- Create one `book_home` knowledge document per book.
- Convert highlight notes into knowledge documents linked to the highlight, while
  keeping the existing `highlights.note` field during migration for compatibility.
- Add a registry-driven Tiptap extension layer for ReadAny cards.
- Add sync metadata to every new knowledge table and include them in
  `SYNC_TABLES`.
- Treat attachments and exported vault files as file-sync concerns, not only DB
  rows.

## Research Inputs

Code paths inspected:

- `packages/core/src/types/annotation.ts`
- `packages/core/src/db/db-core.ts`
- `packages/core/src/db/note-queries.ts`
- `packages/core/src/db/highlight-queries.ts`
- `packages/core/src/stores/annotation-store.ts`
- `packages/core/src/stores/notebook-store.ts`
- `packages/core/src/sync/simple-sync.ts`
- `packages/core/src/export/annotation-exporter.ts`
- `packages/app/src/components/ui/markdown-editor.tsx`
- `packages/app/src/components/notes/NotesPage.tsx`
- `packages/app/src/components/reader/NotebookPanel.tsx`
- `packages/app-expo/src/components/ui/RichTextEditor.tsx`
- `packages/app-expo/src/screens/NotesView.tsx`
- `packages/app-expo/src/screens/reader/ReaderNoteViewModal.tsx`
- `packages/app-expo/src/components/reader/SelectionPopover.tsx`

External docs checked:

- Tiptap persistence: JSON is recommended for editor state persistence.
- Tiptap custom nodes and React node views.
- Tiptap static renderer for HTML, Markdown, and React output from JSON.
- Obsidian accepted formats: Markdown, Canvas, JSON Canvas, images, media, PDF.
- Obsidian URI: open, new, append, search, and vault/file addressing.

## Document Map

- [Current State](01-current-state.md)
- [Target Architecture](02-target-architecture.md)
- [Editor, Cards, and Obsidian](03-editor-cards-obsidian.md)
- [Roadmap](04-implementation-roadmap.md)
- [Vault Workspace Layout](05-vault-workspace-layout.md)
- [Acceptance Runbook](06-acceptance-runbook.md)
- [Manual QA Evidence](07-manual-qa-evidence.md)

## Acceptance Commands

```bash
pnpm acceptance:knowledge
pnpm acceptance:knowledge:manual
```

Use `pnpm acceptance:knowledge:manual -- --allow-incomplete` while manual
desktop, mobile, AI, Obsidian, and sync evidence is still being collected.
