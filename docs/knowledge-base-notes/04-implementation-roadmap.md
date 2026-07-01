# Implementation Roadmap

This feature is too large for one PR. It should land as a sequence of stable,
testable layers.

## Phase 0: Research and Design

Status: completed as the initial design baseline. The current branch has moved
into layered runtime implementation.

Deliverables:

- Architecture research docs.
- Data model proposal.
- Editor and Obsidian plan.
- Implementation split.

No runtime behavior should change in this phase.

## Phase 1: Core Knowledge Model

Status: implemented on the current branch; keep expanding tests when the model
changes.

Goal:

- Add knowledge tables and core queries without replacing the UI yet.

Work:

- Add DB migrations for `knowledge_documents`, `knowledge_links`,
  `knowledge_attachments`, and `knowledge_card_templates`.
- Add core types.
- Add query modules and tests.
- Add conversion helpers:
  - `createBookHomeDocument`
  - `createHighlightNoteDocument`
  - `projectKnowledgeDocumentToMarkdown`
- Add sync table entries.
- Add simple sync integration tests for document create/update/delete.

Verification:

- Existing annotation tests still pass.
- New document query tests pass.
- Sync applies knowledge documents and tombstones across devices.

## Phase 2: Desktop Knowledge MVP

Status: implemented as an active MVP on the current branch; polish and
compatibility work continues. The next desktop milestone is layout correction:
make hierarchy and the WYSIWYG document surface obvious before adding more
secondary features.

Goal:

- Introduce a desktop knowledge page for books while keeping old notes usable.

Work:

- Add `KnowledgeEditor` using Tiptap JSON canonical storage.
- Auto-create and open the book home document.
- Treat knowledge documents as a vault hierarchy, not a flat list:
  - Add folder documents.
  - Build a tree from `parent_id`.
  - Support create-inside-folder, move-to-folder, breadcrumbs, orphan surfacing,
    and search across the whole tree.
- Align the desktop UI with the workspace contract:
  - Left vault navigator for hierarchy.
  - Center WYSIWYG document canvas.
  - Right collapsible context panel for sources, backlinks, outline, and AI
    memory.
  - Reduce card nesting around the editor so the document, not the chrome, is
    the visual focus.
  - Make folder nodes open folder browsers, not blank document editors.
  - Keep breadcrumbs, tree ancestry, export paths, and move destinations
    visually consistent.
- Show linked highlights and notes as source cards.
- Allow standalone book notes.
- Add basic tags and backlinks display.
- Keep `highlights.note` compatibility projection.

Verification:

- Existing notes page still works.
- Book home document persists and syncs.
- Folder hierarchy persists, syncs, and survives invalid or missing parents
  without hiding documents.
- The editor reads as a WYSIWYG document canvas, not a textarea or metadata
  form.
- Editing a highlight note updates the linked document and old note preview.
- Export still includes old notes and new knowledge documents.

## Phase 3: Mobile WebView Tiptap Editor

Status: implemented for knowledge documents on the current branch. Legacy quick
annotation surfaces still use lightweight native editors by design. The next
mobile milestone is interaction correction: split vault browsing and document
editing into clear modes instead of one stacked screen. The mobile vault
browser now exposes labeled header actions for folder/note creation so the
first browsing mode is understandable without relying on icon recognition.

Goal:

- Replace mobile Markdown TextInput editing with a WebView Tiptap editor.

Work:

- Build a local editor HTML bundle for Expo WebView.
- Add typed bridge messages.
- Add native toolbar state.
- Add autosave and explicit error states.
- Update `NoteCard`, `ReaderNoteViewModal`, and `SelectionPopover`.
- Rework the knowledge mobile layout into a native vault-browser screen and a
  focused document-editor screen instead of one long stacked dashboard.
- Use bottom sheets for create, move, insert-card, image, and context actions.
- Preserve path awareness in mobile: current folder path, create destination,
  move destination, and document header should all describe the same place.
- Keep long-form writing inside the WebView document editor; use sheets only
  for short configuration and context.

Verification:

- iOS and Android can edit, save, focus, blur, and recover drafts.
- Keyboard does not cover the editor controls.
- WebView errors are visible and actionable.
- Existing reader selection flow remains fast.
- Folder screens behave like browsers with child rows, not empty editor pages.

## Phase 4: Export and Obsidian v1

Status: implemented as a desktop v1 on the current branch; mobile Markdown file
picker import is now available, while mobile inbound share-extension import and
automated or block-level conflict merging remain future work. Document export,
vault package generation, manifests, attachment path planning, conflict
detection with resolution guidance, ReadAny card fallbacks, Markdown file
import, and linked-folder import/reconcile exist.
Linked-folder import also recognizes folder-level `README.md` and `index.md`
aliases when resolving path-backed internal links, and restores non-built-in
card template snapshots from the vault manifest after user confirmation while
surfacing newer local template conflicts with safe local-default guidance.
Desktop conflict and import-review cards now also expose optional Obsidian URI
actions for opening exported files and searching the selected vault folder; this
is a convenience layer only, not a sync backbone.

Goal:

- Export the knowledge graph as a useful Markdown vault.

Work:

- Add `KnowledgeExporter`.
- Export book home, highlight notes, standalone notes, reviews, summaries, and
  assets.
- Add frontmatter with stable IDs.
- Add Obsidian callout rendering for ReadAny cards.
- Add desktop linked-folder export with manifest and conflict detection.
- Add desktop Markdown file import as confirmation-required create proposals.
- Add mobile Markdown file import as confirmation-required create proposals.
- Preserve ordinary Markdown file path hierarchy by generating confirmation
  proposals for missing folder documents before child documents.
- Add desktop linked-folder import/reconcile as confirmation-required update
  proposals.
- Preserve document hierarchy when exporting to an Obsidian-style vault and when
  reconciling imported files.
- Add optional Obsidian URI helpers and desktop actions for opening exported
  files or searching the selected vault from conflict/import review surfaces.

Verification:

- Exported Markdown opens cleanly in Obsidian.
- Wikilinks and assets resolve.
- Re-export updates existing files by ID.
- External edits are detected before overwrite.
- Folder moves and renames reconcile by stable document ID, not only by path.
- Markdown imports preview the target documents before saving.
- Vault imports surface modified, missing, unreadable, duplicate, and
  local-and-external conflict states with safe resolution guidance before
  applying updates.
- Obsidian URI actions encode vault, path, file, search, and append parameters
  through shared helpers and fail visibly if the host platform cannot open them.

## Phase 5: AI Knowledge Tools

Status: partially implemented. Search/get/propose/create/update/tag/link
tooling, confirmation proposals, compact summaries, proposal cards,
vault-aware result context, prompt snapshots and exact document reads with
outgoing-link/backlink context, relation labels/CFIs in prompt snapshots,
relation-aware desktop/mobile result cards, current-workspace document opening
from AI result and applied proposal cards, update proposals that reject duplicate
sibling vault paths, write-safety status on desktop/mobile tool result cards,
confirmation-required proposal write-safety status on desktop/mobile proposal
cards, structured failure cards, and visible search match-field explanations on
desktop/mobile result cards exist.
Broader end-to-end validation still needs work.

Goal:

- Let AI read and manage the user's knowledge base safely.

Work:

- Add tools for search, get, create, update, tag, and link.
- Add tool permission UI where needed.
- Include knowledge documents in retrieval.
- Add compact summaries for long documents.

Verification:

- AI can answer from book text, annotations, and knowledge documents.
- AI never silently overwrites user documents.
- Tool failures display clear failure cards on desktop and mobile, including
  the failing knowledge tool, error reason, and safe no-write hint.

## Phase 6: Custom Card Platform

Status: partially implemented. Built-in card registry, card templates, desktop
node views, mobile WebView card rendering, Markdown fallbacks, shared card
attribute upgrades, visible unknown/future-version card fallback metadata,
user-created custom card templates from the desktop/mobile insert menus,
sync-safe disabled-template rendering for existing cards, export/import
template snapshots, and desktop/mobile structured-field schema editing exist.
The schema editor now supports text,
long text, number, checkbox, single-choice, and multi-choice fields with
placeholders, help text, required markers, options, defaults, and simple
conditional visibility rules. Fields can also be grouped into lightweight
sections with optional group-level visibility rules that survive
desktop/mobile editing, WebView rendering, Markdown fallbacks, and read-only
HTML projection. Richer card editing and JSON-based custom template schema
migrations now have a shared core path; deeply nested conditional groups and
richer layout rules remain future work. Lightweight field width rules,
covering auto, full, half, and third-width fields, now survive desktop/mobile
template editing, WebView rendering, static read-only HTML projection,
Markdown fallbacks, and automated acceptance checks.

Goal:

- Make ReadAny cards extensible and pleasant.

Work:

- Add card registry.
- Add built-in card nodes and node views.
- Add Markdown fallback renderer for every card.
- Add static read-only rendering.
- Add card template sync.

Verification:

- Cards edit on desktop and mobile.
- Cards export to readable Markdown.
- AI/tool failures remain visible and exportable as failure cards.
- Unsupported card versions degrade safely.
- Card attrs migrate across schema versions.

## Suggested PR Split

1. `feat/kb-core-model`
   - DB, types, queries, sync, tests.
2. `feat/kb-tiptap-core`
   - Shared editor utilities, JSON/Markdown projection, card registry skeleton.
3. `feat/kb-desktop-mvp`
   - Desktop book home document and knowledge editor.
4. `feat/kb-mobile-editor-webview`
   - Mobile WebView editor and bridge.
5. `feat/kb-export-obsidian`
   - Knowledge exporter and Obsidian vault export.
6. `feat/kb-ai-tools`
   - AI tools and retrieval integration.
7. `feat/kb-custom-cards`
   - Built-in rich cards and card UI polish.
8. `feat/kb-workspace-polish`
   - Obsidian-style vault navigation, WYSIWYG-first desktop/mobile layout,
     folder browsing screens, and context-panel polish.

Current branch priority before PR:

1. Finish the desktop vault shell so the tree, folder browser, document canvas,
   and context panel match the workspace contract.
2. Finish the mobile vault browser/editor split with keyboard-safe WYSIWYG
   editing.
3. Verify hierarchy through create, move, sync, export, import, search, and AI
   tool results.
4. Only then continue custom card template authoring and richer card editing.

## Test Plan by Layer

Core DB:

- Insert/update/delete knowledge documents.
- Link documents to books, highlights, CFIs, and external URLs.
- Tombstones are inserted on delete.
- Derived Markdown updates when JSON changes.

Sync:

- New tables are included in collect/apply.
- Deletions propagate.
- Linked documents survive book sync.
- Attachments are represented in file manifests.

Editor:

- JSON to Markdown projection is deterministic.
- Markdown import creates valid Tiptap JSON.
- Surface profiles expose only the rich-text features allowed for that scenario.
- Rich-text preservation tests cover desktop save, mobile save, sync apply, and
  export projection for headings, lists, source refs, cards, links, attachments,
  and AI provenance.
- Custom card nodes preserve attrs.
- Unsupported cards render fallback.

Mobile:

- WebView editor ready/error states.
- Bridge command/event contract.
- Keyboard and safe-area behavior.
- Autosave and draft recovery.

Export:

- Obsidian vault structure.
- Frontmatter ID stability.
- Wikilinks and assets.
- Re-export conflict detection.

## Open Product Questions

- Should there be a global knowledge area outside books in v1, or only
  book-scoped knowledge first?
- Should highlight notes appear inline in the reader, in the book home document,
  or both?
- Should Obsidian linked-folder mode be read-only export first, or allow import in
  the same milestone?
- Which custom cards are required for v1?
- Should AI-created documents require explicit confirmation every time?
- How much of the old Notes page should remain after the knowledge page ships?
