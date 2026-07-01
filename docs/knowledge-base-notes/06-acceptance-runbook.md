# Acceptance Runbook

This runbook turns the knowledge-base design docs into evidence that can be
checked before the branch is considered ready. Passing one narrow test is not
enough; the feature is accepted only when the data model, desktop UX, mobile UX,
sync/export, AI tools, and ReadAny cards all preserve the same vault document
model.

## Release Gate

The branch is ready for final PR review when all of these are true:

- The worktree is clean and pushed.
- Core knowledge, AI, sync, export, desktop, and mobile TypeScript checks pass.
- The desktop Vite production bundle builds successfully.
- `07-manual-qa-evidence.md` is filled with the commit under test, platforms,
  screenshots/logs/exports, and pass/fail/blocker status for all required
  manual checks.
- `pnpm acceptance:knowledge:manual` passes after `07-manual-qa-evidence.md`
  is filled.
- Desktop and mobile both show a vault hierarchy before editing.
- Folder nodes open folder browsers, not empty document editors.
- Document nodes open a WYSIWYG Tiptap surface with quiet autosave.
- The same document path appears in tree rows, breadcrumbs, search results,
  import/export previews, AI results, proposal cards, and failure cards.
- AI write tools create confirmation-required proposals only; applying a
  proposal is the first database write.
- ReadAny cards preserve type, version, source attrs, structured data, schema
  migrations, and Markdown fallback on desktop, mobile, export, and AI context.
- Unsupported or future card versions render safe fallback cards instead of raw
  JSON or disappearing content.

## Automated Evidence

Run these before each stable commit:

```bash
pnpm acceptance:knowledge
```

The script above runs the full automated gate. Expanded manually, it is:

```bash
pnpm --filter @readany/core exec vitest run \
  src/db/__tests__/knowledge-queries.test.ts \
  src/db/__tests__/knowledge-source-writeback.test.ts \
  src/db/__tests__/db-core.test.ts \
  src/db/__tests__/highlight-queries.test.ts \
  src/db/__tests__/note-queries.test.ts \
  src/sync/__tests__/simple-sync.integration.test.ts \
  src/sync/__tests__/sync-files.test.ts \
  src/knowledge/document-utils.test.ts \
  src/knowledge/vault-path-fidelity.test.ts \
  src/knowledge/editor-profile.test.ts \
  src/knowledge/editor-projection.test.ts \
  src/knowledge/editor-draft.test.ts \
  src/knowledge/mobile-editor-bridge.test.ts \
  src/knowledge/rich-text-preservation.test.ts \
  src/knowledge/card-registry.test.ts \
  src/knowledge/attachments.test.ts \
  src/knowledge/internal-links.test.ts \
  src/knowledge/source-links.test.ts \
  src/knowledge/proposals.test.ts \
  src/knowledge/compact-summary.test.ts \
  src/i18n/locales.test.ts \
  src/ai/__tests__/system-prompt.test.ts \
  src/ai/__tests__/streaming.test.ts \
  src/ai/__tests__/reading-agent-tools.test.ts \
  src/ai/__tests__/tools.test.ts \
  src/ai/__tests__/knowledge-context.test.ts \
  src/ai/__tests__/knowledge-memory.test.ts \
  src/ai/__tests__/tool-call-state.test.ts \
  src/ai/__tests__/knowledge-tool-result.test.ts \
  src/ai/__tests__/tool-result.test.ts \
  src/ai/tools/knowledge-tools.test.ts \
  src/export/knowledge-exporter.test.ts \
  src/export/knowledge-importer.test.ts \
  src/export/obsidian-uri.test.ts

pnpm --filter @readany/core exec tsc --noEmit
pnpm --filter app exec tsc --noEmit
pnpm --filter app exec vite build
# The acceptance script also scans packages/app/dist for required desktop
# knowledge editor, AI proposal/result, card, link, export, and attachment
# fragments.
pnpm --filter @readany/app-expo exec tsc --noEmit
pnpm --filter @readany/app-expo exec node scripts/build-knowledge-editor.js
git diff --exit-code -- packages/app-expo/assets/editor/knowledge-editor.html
# The acceptance script also checks the generated WebView bundle for required
# bridge messages, commands, cards, internal/source links, and image attachment
# fallbacks, including the card-to-normal-text conversion control and custom
# card structured-field rendering.
# The acceptance script also checks the desktop knowledge editor source for
# ReadAny card editing controls, card-to-normal-text conversion, and custom card
# field schema editing.
# The acceptance script also checks the mobile knowledge editor source for
# custom card field schema editing before WebView insertion.
# The acceptance script also checks the desktop and mobile chat renderer sources
# for knowledge proposal, result, failure-card, path, and confirmation-write UI
# contracts.
# The acceptance script also checks desktop and mobile knowledge workspace
# source contracts for vault trees, root/folder browser surfaces, WYSIWYG
# document editors, path-aware creation/search, and import/review surfaces.
# It also checks that the desktop Vite browser-preview runtime is guarded from
# Tauri-only platform services, so UI smoke checks can load without false
# `invoke` console errors when the app is opened outside the Tauri shell.
git diff --check
```

After the runtime manual checks are complete, run the strict manual evidence
gate:

```bash
pnpm acceptance:knowledge:manual
```

While evidence is still being collected, this non-blocking command can show the
remaining missing rows without failing the shell:

```bash
pnpm acceptance:knowledge:manual -- --allow-incomplete
```

To generate the guided manual QA run sheet from the evidence table, run:

```bash
pnpm acceptance:knowledge:manual:plan
```

The generated `08-manual-qa-run-sheet.md` is only an execution checklist. Copy
the real pass/fail/blocker status and concrete evidence back into
`07-manual-qa-evidence.md`; the run sheet alone does not satisfy the manual
gate.

`pnpm acceptance:knowledge` compares the mobile WebView editor bundle before and
after rebuilding it. If the generated HTML changes, commit
`packages/app-expo/assets/editor/knowledge-editor.html` and rerun the gate.
It also verifies that the generated HTML still contains the RN bridge entry
point, ready/error/content/selection messages, command routing, ReadAny cards,
internal/source links, and image attachment fallback UI.
It also checks the desktop knowledge editor source and mobile WebView bundle for
the ReadAny card conversion control so AI/card blocks can be turned back into
ordinary editable content instead of becoming permanent special blocks.
Custom card field schema editing is checked in the desktop and mobile editor
sources, including text, long-text, number, checkbox, single-choice, and
multi-choice fields with required markers, help text, options, defaults,
simple visibility rules, optional field group labels, group-level visibility
rules, and lightweight field width layout rules. The WebView bundle is checked
for structured-field rendering, including grouped section headings and
field-width markers, so
synced custom cards can be edited without dropping to raw JSON. The core card,
projection, export, and AI context tests also verify that visible structured
field values, group labels, and choice labels stay readable in Markdown/Obsidian
output and prompt previews, while width metadata survives the HTML/WebView
surfaces and hidden fields stay out of readable exports.
The desktop production bundle check scans the built browser assets for the
knowledge editor shell, AI proposal/result renderers, ReadAny cards,
internal/source links, Obsidian export markers, and portable attachment URIs.
The desktop and mobile chat renderer contract checks scan the chat renderer
sources for AI knowledge proposal/result/failure cards, visible vault paths,
search match-field explanations, current-workspace document open actions from
result and applied proposal cards, safe no-write hints, visible write-safety
status for read-only, memory-write, skipped, and failed tool calls,
confirmation-required proposal write-safety status, confirmation-required apply
behavior, and persistent proposal-apply failure
states with retry affordances and localized conflict reasons instead of raw
internal error codes.
The desktop chat contract also checks that standalone AI citations open the
matching reader tab with the registered CFI instead of only logging the click,
so citations produced outside the reader sidebar still lead back to source text.
The desktop and mobile knowledge workspace contract checks scan the runtime UI
sources for the vault tree, root/folder browser, document editor, breadcrumb/path,
search, create target, import review, desktop vault-import conflict resolution
guidance, and keyboard-safe mobile editor entry points that make the vault mental
model visible before editing.
The desktop browser-preview runtime contract checks that direct Vite/browser
loads use a non-persistent preview platform service and defer Tauri-only fetch,
vector DB, data-root migration, and fallback-content-provider setup until a real
Tauri runtime is present. This keeps browser smoke testing useful without
weakening the production desktop path.
They also check that saved and imported knowledge documents keep the compact
AI-memory maintenance path wired through source fingerprints and background
summary queues on both desktop and mobile, so long-form notes do not become
stale retrieval sources after ordinary editing or Markdown import.
The mobile workspace contract also checks that Markdown import review keeps file
picker display names available, so review cards do not expose cache-only picker
URIs as the user's source file identity.
The desktop knowledge workspace contract also checks that optional Obsidian URI
actions stay wired through shared URI helpers and the platform external-URL
opener, so opening a file or searching the vault remains a convenience layer
rather than a sync dependency.
`pnpm acceptance:knowledge:manual` checks that `07-manual-qa-evidence.md`
contains session metadata, allowed status values, non-empty evidence for passing
rows, owner-approved exception notes for `Blocked`/`N/A` rows, and a final
ready decision with no blocking failures.

Evidence mapping:

| Contract | Evidence |
| --- | --- |
| Knowledge tables, queries, tombstones, and sync metadata exist. | `knowledge-queries.test.ts`, `simple-sync.integration.test.ts` |
| Legacy highlight/note projections keep old UI compatible while knowledge documents become primary. | `knowledge-source-writeback.test.ts`, `highlight-queries.test.ts`, `note-queries.test.ts`, `document-utils.test.ts` |
| Knowledge attachment files upload, download, and reconcile manifest paths during file sync. | `sync-files.test.ts` |
| Vault paths survive folders, moves, orphans, search, AI, import, and export. | `document-utils.test.ts`, `vault-path-fidelity.test.ts`, `knowledge-tools.test.ts`, `knowledge-importer.test.ts` |
| Missing or cyclic parents surface as visible orphaned roots in desktop and mobile root browsers. | `document-utils.test.ts`, desktop/mobile knowledge workspace contract checks, desktop and mobile TypeScript checks |
| Vault roots and folder documents open browsing surfaces; ordinary documents open editor surfaces. | `document-utils.test.ts`, desktop/mobile knowledge workspace contract checks, desktop and mobile TypeScript checks |
| Create and Markdown import actions inherit the current vault root, folder, or sibling context consistently. Folder-level `README.md` and `index.md` links resolve back to the manifest document id, linked-vault import conflicts surface safe resolution guidance before any write, and mobile import review keeps picker file names visible instead of cache-only URIs. | `document-utils.test.ts`, `knowledge-importer.test.ts`, desktop/mobile knowledge workspace contract checks, desktop and mobile TypeScript checks |
| Optional Obsidian URI actions encode open/new/search paths safely and surface desktop open/search actions from conflict and import-review cards. | `obsidian-uri.test.ts`, desktop knowledge workspace contract check, core/desktop/mobile TypeScript checks |
| Knowledge and card UI strings and interpolation placeholders stay available across supported locales. | `locales.test.ts`, desktop and mobile TypeScript checks |
| Desktop knowledge workspace code is included in a valid production browser bundle. | Desktop production bundle contract check |
| Desktop/mobile editor profiles expose the right rich-text features by scenario. | `editor-profile.test.ts`, TypeScript checks |
| Tiptap JSON projects to Markdown/HTML without losing supported rich blocks. | `editor-projection.test.ts`, `rich-text-preservation.test.ts` |
| Draft recovery, mobile WebView messages, and error states are typed and present in the generated bundle. | `editor-draft.test.ts`, `mobile-editor-bridge.test.ts`, mobile WebView bundle contract check, `app-expo` TypeScript |
| Attachments and source/internal links remain portable through editor, sync, and export paths. | `attachments.test.ts`, `internal-links.test.ts`, `source-links.test.ts`, `rich-text-preservation.test.ts` |
| AI reads knowledge safely, keeps prompt/exact-read outgoing links, backlinks, relation labels, CFIs, relation directions, vault paths, search match-field explanations, and write-safety state visible, can open matching result/applied-proposal documents in the current knowledge workspace, keeps saved/imported documents queued for compact-memory maintenance, and writes only through confirmation proposals or explicit compact-memory tools. | `system-prompt.test.ts`, `streaming.test.ts`, `reading-agent-tools.test.ts`, `knowledge-context.test.ts`, `knowledge-tool-result.test.ts`, `knowledge-tools.test.ts`, `proposals.test.ts`, desktop production bundle contract check, desktop/mobile AI knowledge chat contract checks, desktop/mobile knowledge workspace contract checks |
| Non-vectorized books keep fallback exploration and validated citations available. | `system-prompt.test.ts`, `reading-agent-tools.test.ts`, `tools.test.ts` |
| Failed tool calls become visible failure cards with tool names, reasons, no-write hints, and available vault paths instead of endless loading states, and export as readable Obsidian callouts. | `tool-call-state.test.ts`, `tool-result.test.ts`, `knowledge-tool-result.test.ts`, `knowledge-exporter.test.ts`, desktop production bundle contract check, desktop/mobile AI knowledge chat contract checks |
| Compact summaries are retrieval memory, not user-content rewrites. | `compact-summary.test.ts`, `knowledge-memory.test.ts`, `tools.test.ts`, `knowledge-tools.test.ts` |
| ReadAny cards preserve attrs, data, schema migrations, fallback rendering, unknown versions, conversion back to normal editable content, user-authored structured field schemas, field groups, group-level visibility, field-width layout metadata, sync-safe disabled templates for existing cards, and readable field values in export/AI context. | `card-registry.test.ts`, `knowledge-queries.test.ts`, `editor-projection.test.ts`, `knowledge-context.test.ts`, `knowledge-exporter.test.ts`, `rich-text-preservation.test.ts`, desktop knowledge editor contract check, mobile knowledge editor contract check, mobile WebView bundle contract check |

## Desktop Manual Checks

Use the desktop app with a book that has existing highlights and notes.
Record the result in `07-manual-qa-evidence.md` before final PR review.

1. Open the notes/knowledge entry for the book.
2. Confirm the first visible structure is a left vault tree, center workspace,
   and quiet right context panel.
3. Select the vault root. The center should show child folders/documents.
4. Create a folder, then create a standalone note inside it. The create target
   must show that folder path.
5. Create another folder and move the note into it. The tree, breadcrumb, search
   result, and move target preview should all update to the same path.
6. Open a document and edit the title/body directly in the WYSIWYG surface.
   Markdown source or JSON should not be the default editing UI.
7. Insert headings, lists, quote/callout/source cards, an image block, an
   internal link, and a custom ReadAny card.
8. Expand the ReadAny card details and edit source title, source id, CFI, and
   structured data. Invalid JSON should show an inline error and not corrupt the
   card.
9. Trigger AI knowledge tools from chat: search, exact get, propose create,
   propose update, tag update, link create, and summary compression.
10. Confirm successful proposals render confirmation cards, and failed tool calls
    render visible failure cards with tool name, reason, path when available,
    and a no-write hint.
11. Export an Obsidian vault and open it. Wikilinks, frontmatter IDs, folder
    paths, images, and ReadAny card fallbacks should be readable.

## Mobile Manual Checks

Use a real iOS or Android device because keyboard, safe area, and WebView focus
are part of the acceptance criteria.
Record the result in `07-manual-qa-evidence.md` before final PR review.

1. Open the book knowledge area from the mobile notes screen.
2. Confirm the first mode is vault browsing, not one long stacked dashboard.
3. Navigate into a folder. The path should remain visible and rows should show
   child folders before child documents.
4. Open a document. The editor should become focused, WYSIWYG, and
   keyboard-aware.
5. Type long body content, use the toolbar, insert a link, image, source
   reference, and ReadAny card.
6. Open card details in the WebView editor and edit source attrs/data. Invalid
   JSON should show an error and preserve the previous valid attrs.
7. Background and reopen the app. Draft recovery should offer the latest unsaved
   content instead of silently losing it.
8. Run AI chat with a knowledge proposal and a failing knowledge tool. Proposal
   cards and failure cards should be visible and actionable on mobile.
9. Sync with a second device. Folder hierarchy, content JSON/Markdown, links,
   attachments metadata, card templates, and card attrs should arrive with the
   same document paths.

## Regression Traps

Reject the branch if any of these appear:

- Folder hierarchy is hidden behind tags, groups, or filters.
- A folder opens a blank editor.
- The body editor looks like a raw Markdown textarea by default.
- A create/move/import/AI proposal does not show its destination path.
- AI says a document was saved before the user confirms the proposal.
- Tool failures spin forever or disappear without a failure card.
- Custom card data can be replaced by invalid JSON.
- Unsupported card versions lose their metadata.
- Mobile keyboard covers the editor controls.
- Obsidian export flattens folders or makes duplicate titles ambiguous.
