# Knowledge Manual QA Run Sheet

This file is generated from `07-manual-qa-evidence.md`. Use it while running
desktop, real-device mobile, AI, Obsidian, and sync checks, then copy the
actual status and evidence back into the evidence file. Do not treat this run
sheet as proof by itself.

## Session

- Evidence file: `docs/knowledge-base-notes/07-manual-qa-evidence.md`
- Branch: `feat/knowledge-base-notes-research`
- Commit under test: `4a901716`
- Required final gate: `pnpm acceptance:knowledge:manual`

## Preflight

- [ ] Pull the branch and confirm the worktree is clean.
- [ ] Run `pnpm acceptance:knowledge` on the commit under test.
- [ ] Prepare a desktop build, a real mobile device, a second sync device, an AI provider/model, a sync backend/account, and an Obsidian export folder.
- [ ] Keep screenshots, short videos, logs, exported file paths, and sync observations named so they can be pasted into the evidence rows.

## Desktop QA

Evidence hint: Screenshot or short screen recording, plus console log excerpt when behavior changes.

### Open knowledge entry

- Evidence row: `Desktop QA / Open knowledge entry`
- Expected: The first visible structure is left vault tree, center workspace, and quiet right context panel.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `desktop-qa-open-knowledge-entry`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Root browser

- Evidence row: `Desktop QA / Root browser`
- Expected: Selecting the vault root shows child folders/documents, not an editor.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `desktop-qa-root-browser`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Folder browser

- Evidence row: `Desktop QA / Folder browser`
- Expected: Selecting a folder shows child folders before child documents, not an empty document editor.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `desktop-qa-folder-browser`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Create inside folder

- Evidence row: `Desktop QA / Create inside folder`
- Expected: Creating a folder and note from a folder uses that folder as the destination.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `desktop-qa-create-inside-folder`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Move consistency

- Evidence row: `Desktop QA / Move consistency`
- Expected: After moving a note, tree row, breadcrumb, search result, and move target preview show the same path.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `desktop-qa-move-consistency`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### WYSIWYG editing

- Evidence row: `Desktop QA / WYSIWYG editing`
- Expected: Opening a document gives direct title/body editing in Tiptap, not raw Markdown or JSON by default.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `desktop-qa-wysiwyg-editing`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Rich blocks

- Evidence row: `Desktop QA / Rich blocks`
- Expected: Headings, lists, quote/callout/source cards, image, internal link, and custom ReadAny card insert and render.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `desktop-qa-rich-blocks`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Card editing safety

- Evidence row: `Desktop QA / Card editing safety`
- Expected: Editing card source attrs/data works, and invalid JSON shows an inline error without corrupting the last valid card.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `desktop-qa-card-editing-safety`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Autosave state

- Evidence row: `Desktop QA / Autosave state`
- Expected: Quiet saving/saved/pending state matches edits without requiring an explicit save button.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `desktop-qa-autosave-state`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Context panel

- Evidence row: `Desktop QA / Context panel`
- Expected: Sources, backlinks, outline, and AI memory/context stay attached to the active document path.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `desktop-qa-context-panel`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

## Mobile QA

Evidence hint: Real-device screenshot/video, keyboard-safe-area observation, and device log excerpt when relevant.

### Open knowledge area

- Evidence row: `Mobile QA / Open knowledge area`
- Expected: The first mode is vault browsing, not one long stacked dashboard.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `mobile-qa-open-knowledge-area`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Navigate folder

- Evidence row: `Mobile QA / Navigate folder`
- Expected: Path remains visible, and folder rows show child folders before child documents.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `mobile-qa-navigate-folder`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Open document

- Evidence row: `Mobile QA / Open document`
- Expected: The document view becomes focused, WYSIWYG, and keyboard-aware.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `mobile-qa-open-document`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Long editing

- Evidence row: `Mobile QA / Long editing`
- Expected: Long body edits, toolbar actions, link, image, source reference, and ReadAny card insertion remain usable.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `mobile-qa-long-editing`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Card details

- Evidence row: `Mobile QA / Card details`
- Expected: Editing card attrs/data in WebView works; invalid JSON shows an error and preserves previous valid attrs.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `mobile-qa-card-details`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Keyboard and safe area

- Evidence row: `Mobile QA / Keyboard and safe area`
- Expected: Keyboard never covers editor controls or chat input, including Chinese and system keyboards.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `mobile-qa-keyboard-and-safe-area`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Background recovery

- Evidence row: `Mobile QA / Background recovery`
- Expected: Backgrounding and reopening offers the latest draft instead of silently losing unsaved content.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `mobile-qa-background-recovery`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Mobile import review

- Evidence row: `Mobile QA / Mobile import review`
- Expected: Markdown import previews destination paths and readable picker file names before applying writes; it should not show cache-only picker URIs as the source identity.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `mobile-qa-mobile-import-review`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

## AI Knowledge QA

Evidence hint: Chat transcript excerpt showing tool cards/proposals/failure states and the visible vault path.

### Search knowledge

- Evidence row: `AI Knowledge QA / Search knowledge`
- Expected: AI search returns document rows with titles and full vault paths.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `ai-knowledge-qa-search-knowledge`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Exact document read

- Evidence row: `AI Knowledge QA / Exact document read`
- Expected: Reading a specific knowledge document shows the document id/path and does not mutate data.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `ai-knowledge-qa-exact-document-read`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Book knowledge read

- Evidence row: `AI Knowledge QA / Book knowledge read`
- Expected: Book-scoped knowledge is available in context with bounded summaries.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `ai-knowledge-qa-book-knowledge-read`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Create proposal

- Evidence row: `AI Knowledge QA / Create proposal`
- Expected: AI create tool renders a confirmation-required proposal card with target path and preview.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `ai-knowledge-qa-create-proposal`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Update proposal

- Evidence row: `AI Knowledge QA / Update proposal`
- Expected: AI update tool renders changed fields and path before applying.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `ai-knowledge-qa-update-proposal`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Tag proposal

- Evidence row: `AI Knowledge QA / Tag proposal`
- Expected: AI tag update remains a proposal and does not write until confirmed.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `ai-knowledge-qa-tag-proposal`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Link proposal

- Evidence row: `AI Knowledge QA / Link proposal`
- Expected: AI link creation remains a proposal and shows the involved document path(s).
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `ai-knowledge-qa-link-proposal`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Apply proposal

- Evidence row: `AI Knowledge QA / Apply proposal`
- Expected: Applying a proposal is the first database write, and the card changes to applied/saved.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `ai-knowledge-qa-apply-proposal`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Failed tool card

- Evidence row: `AI Knowledge QA / Failed tool card`
- Expected: A failing knowledge tool renders a visible failure card with tool name, reason, safe no-write hint, and path when available.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `ai-knowledge-qa-failed-tool-card`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Summary compression

- Evidence row: `AI Knowledge QA / Summary compression`
- Expected: Compact summaries update retrieval memory without rewriting user-authored content.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `ai-knowledge-qa-summary-compression`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

## Obsidian And Import/Export QA

Evidence hint: Export/import folder path, representative Markdown file path, and any conflict preview screenshot.

### Export vault

- Evidence row: `Obsidian And Import/Export QA / Export vault`
- Expected: Export creates an Obsidian-style folder tree with frontmatter ids and readable Markdown.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `obsidian-and-import-export-qa-export-vault`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Wikilinks

- Evidence row: `Obsidian And Import/Export QA / Wikilinks`
- Expected: Internal links export as usable wikilinks or readable fallbacks.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `obsidian-and-import-export-qa-wikilinks`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Attachments

- Evidence row: `Obsidian And Import/Export QA / Attachments`
- Expected: Image attachments export to portable paths and render after opening the vault folder.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `obsidian-and-import-export-qa-attachments`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### ReadAny cards

- Evidence row: `Obsidian And Import/Export QA / ReadAny cards`
- Expected: Built-in, custom, unsupported, and future-version cards degrade to readable Markdown fallback.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `obsidian-and-import-export-qa-readany-cards`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Re-export

- Evidence row: `Obsidian And Import/Export QA / Re-export`
- Expected: Re-export updates by stable document id and does not flatten folders or duplicate ambiguous titles.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `obsidian-and-import-export-qa-re-export`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Obsidian URI actions

- Evidence row: `Obsidian And Import/Export QA / Obsidian URI actions`
- Expected: Desktop conflict and import-review cards can open an exported file or search the selected vault through Obsidian URI actions, and show a visible failure toast if the platform cannot open the URI.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `obsidian-and-import-export-qa-obsidian-uri-actions`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Markdown import

- Evidence row: `Obsidian And Import/Export QA / Markdown import`
- Expected: Markdown file import shows confirmation proposals with destination paths before writing.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `obsidian-and-import-export-qa-markdown-import`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Vault import

- Evidence row: `Obsidian And Import/Export QA / Vault import`
- Expected: Linked-folder import surfaces modified, missing, unreadable, and conflict states before applying updates.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `obsidian-and-import-export-qa-vault-import`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

## Sync QA

Evidence hint: Two-device observation, sync backend/account, and before/after path/content/card evidence.

### Folder hierarchy

- Evidence row: `Sync QA / Folder hierarchy`
- Expected: Created and moved folders/documents arrive on the second device with the same paths.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `sync-qa-folder-hierarchy`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Body content

- Evidence row: `Sync QA / Body content`
- Expected: Tiptap JSON and Markdown projection sync without losing rich blocks.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `sync-qa-body-content`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Attachments

- Evidence row: `Sync QA / Attachments`
- Expected: Image attachment metadata and files arrive and render on the second device.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `sync-qa-attachments`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Links

- Evidence row: `Sync QA / Links`
- Expected: Internal links, source links, backlinks, and paths resolve after sync.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `sync-qa-links`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Card attrs

- Evidence row: `Sync QA / Card attrs`
- Expected: Card type, version, source attrs, structured data, and schema migrations survive sync.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `sync-qa-card-attrs`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Card templates

- Evidence row: `Sync QA / Card templates`
- Expected: Custom card template create/update/disable syncs without deleting existing card documents.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `sync-qa-card-templates`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

### Tombstones

- Evidence row: `Sync QA / Tombstones`
- Expected: Deleted documents do not reappear after sync unless explicitly recreated.
- Current status: (empty)
- Current evidence: (empty)
- Evidence anchor: `sync-qa-tombstones`
- [ ] Run the check.
- [ ] Record pass/fail/blocker status.
- [ ] Paste concrete evidence into `07-manual-qa-evidence.md`.

## Finalization

- [ ] Fill `Ready for PR review?`, `Blocking failures`, `Follow-up issues`, and `Reviewer notes`.
- [ ] Run `pnpm acceptance:knowledge:manual` without `--allow-incomplete`.
- [ ] Commit and push the filled evidence file only after the strict manual gate passes.
