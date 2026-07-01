# Manual QA Evidence

Use this file as the final manual evidence record for the knowledge-base branch.
Automated checks prove the shared contracts; this checklist proves the runtime
experience that still needs real desktop and mobile interaction.

Do not mark the feature ready for PR review until every required row is `Pass`
or has an explicit owner-approved exception, and
`pnpm acceptance:knowledge:manual` passes.

## Session Metadata

| Field | Value |
| --- | --- |
| Branch | `feat/knowledge-base-notes-research` |
| Commit under test | `4a901716` |
| Tester | Codex automated baseline |
| Test date | 2026-06-15 |
| `pnpm acceptance:knowledge` result | Pass on 2026-06-15 for commit `4a901716`: 34 core test files / 501 tests, core TS, desktop TS, desktop production bundle, mobile TS, generated WebView bundle, workspace/chat/editor/browser-preview contract checks, standalone chat citation navigation contract, optional Obsidian URI actions, mobile Markdown import picker file names, compact summary source-fingerprint/background-queue maintenance contracts, persistent proposal-apply failure states with localized conflict reasons, confirmation-required proposal write-safety status, grouped custom-card field sections, imported custom-card group visibility rules, localized custom-card default option labels, notes-scoped custom-card field translations, knowledge notes UI source-key translation coverage, dynamic knowledge chat UI key coverage, custom-card field width layout markers, AI tool write-safety status, AI search match-field explanations, vault import conflict resolution guidance, and whitespace check passed. |
| Desktop platform/build | macOS local automated desktop production bundle via `pnpm acceptance:knowledge`; browser-preview smoke on `http://127.0.0.1:5174/` showed the app shell and no current-port warn/error logs after the startup/update-check window; interactive Tauri desktop QA still pending. |
| Mobile platform/build | Expo TypeScript and generated WebView editor bundle via `pnpm acceptance:knowledge`; mobile knowledge workspace/editor contracts include the document editor keyboard-avoidance entry point, shared keyboard inset usage, visible WebView failure states, and draft restore affordances; real-device iOS/Android QA still pending. |
| Second sync device/build | Pending manual QA. |
| Sync backend and account | Pending manual QA. |
| AI provider/model | Pending manual QA. |
| Obsidian/export test folder | Pending manual QA. |

## Evidence Rules

- Status values: `Pass`, `Fail`, `Blocked`, `N/A`.
- Each `Pass` should include a screenshot, short video, log excerpt, exported
  file path, or clear written observation.
- Each `Fail` should include reproduction steps and an issue or follow-up task.
- Each `Blocked` should explain the missing device, account, credential, test
  data, or external service.
- `Blocked` and `N/A` rows that are accepted for final PR review must include an
  owner-approved exception note, for example `Exception approved: ...`.
- Set `Ready for PR review?` to `Yes` and `Blocking failures` to `None` only
  after all required rows are complete.
- Keep this file updated on the branch so the final PR can link to one source of
  truth.

## Automated Baseline

| Check | Expected | Status | Evidence |
| --- | --- | --- | --- |
| Clean branch | Worktree is clean and pushed before manual QA starts. | Pass | Runtime commit `4a901716` was tested by the automated gate; this evidence refresh records that baseline and should be pushed before manual QA starts. |
| Full automated gate | `pnpm acceptance:knowledge` passes. | Pass | Passed on 2026-06-15 for commit `4a901716`: 34 core test files / 501 tests plus core TS, desktop TS, desktop production bundle, mobile TS, WebView bundle, workspace/chat/editor/browser-preview contract checks, standalone chat citation navigation contract, optional Obsidian URI actions, mobile Markdown import picker file names, compact summary source-fingerprint/background-queue maintenance contracts, persistent proposal-apply failure states with localized conflict reasons, confirmation-required proposal write-safety status, grouped custom-card field sections, imported custom-card group visibility rules, localized custom-card default option labels, notes-scoped custom-card field translations, knowledge notes UI source-key translation coverage, dynamic knowledge chat UI key coverage, custom-card field width layout markers, AI tool write-safety status, AI search match-field explanations, vault import conflict resolution guidance, and whitespace check. |
| Bundle warnings reviewed | Existing Vite chunk/dynamic import warnings are non-blocking and no new error appears. | Pass | The desktop Vite production bundle completed successfully; warnings were the known dynamic-import/chunk-size warnings documented as non-blocking in the runbook. |
| Browser preview smoke | Opening the desktop Vite shell directly in a browser should not trigger Tauri-only `invoke` errors before manual QA can start. | Pass | Local smoke on 2026-06-15: started `pnpm --filter app exec vite --host 127.0.0.1 --port 5174 --strictPort false`, opened `http://127.0.0.1:5174/`, waited 6.5s past startup/update-check timing, DOM showed the ReadAny shell/sidebar/empty library, and page console warn/error logs were `[]`. |

## Desktop QA

Use the desktop app with a book that already has highlights and notes.

| Check | Expected | Status | Evidence |
| --- | --- | --- | --- |
| Open knowledge entry | The first visible structure is left vault tree, center workspace, and quiet right context panel. |  |  |
| Root browser | Selecting the vault root shows child folders/documents, not an editor. |  |  |
| Folder browser | Selecting a folder shows child folders before child documents, not an empty document editor. |  |  |
| Create inside folder | Creating a folder and note from a folder uses that folder as the destination. |  |  |
| Move consistency | After moving a note, tree row, breadcrumb, search result, and move target preview show the same path. |  |  |
| WYSIWYG editing | Opening a document gives direct title/body editing in Tiptap, not raw Markdown or JSON by default. |  |  |
| Rich blocks | Headings, lists, quote/callout/source cards, image, internal link, and custom ReadAny card insert and render. |  |  |
| Card editing safety | Editing card source attrs/data works, and invalid JSON shows an inline error without corrupting the last valid card. |  |  |
| Autosave state | Quiet saving/saved/pending state matches edits without requiring an explicit save button. |  |  |
| Context panel | Sources, backlinks, outline, and AI memory/context stay attached to the active document path. |  |  |

## Mobile QA

Use a real iOS or Android device. Simulator-only evidence is not enough for
keyboard, WebView focus, safe area, or sync acceptance.

| Check | Expected | Status | Evidence |
| --- | --- | --- | --- |
| Open knowledge area | The first mode is vault browsing, not one long stacked dashboard. |  |  |
| Navigate folder | Path remains visible, and folder rows show child folders before child documents. |  |  |
| Open document | The document view becomes focused, WYSIWYG, and keyboard-aware. |  |  |
| Long editing | Long body edits, toolbar actions, link, image, source reference, and ReadAny card insertion remain usable. |  |  |
| Card details | Editing card attrs/data in WebView works; invalid JSON shows an error and preserves previous valid attrs. |  |  |
| Keyboard and safe area | Keyboard never covers editor controls or chat input, including Chinese and system keyboards. |  |  |
| Background recovery | Backgrounding and reopening offers the latest draft instead of silently losing unsaved content. |  |  |
| Mobile import review | Markdown import previews destination paths and readable picker file names before applying writes; it should not show cache-only picker URIs as the source identity. |  |  |

## AI Knowledge QA

Run on desktop and mobile with an AI configuration that can call tools.

| Check | Expected | Status | Evidence |
| --- | --- | --- | --- |
| Search knowledge | AI search returns document rows with titles and full vault paths. |  |  |
| Exact document read | Reading a specific knowledge document shows the document id/path and does not mutate data. |  |  |
| Book knowledge read | Book-scoped knowledge is available in context with bounded summaries. |  |  |
| Create proposal | AI create tool renders a confirmation-required proposal card with target path and preview. |  |  |
| Update proposal | AI update tool renders changed fields and path before applying. |  |  |
| Tag proposal | AI tag update remains a proposal and does not write until confirmed. |  |  |
| Link proposal | AI link creation remains a proposal and shows the involved document path(s). |  |  |
| Apply proposal | Applying a proposal is the first database write, and the card changes to applied/saved. |  |  |
| Failed tool card | A failing knowledge tool renders a visible failure card with tool name, reason, safe no-write hint, and path when available. |  |  |
| Summary compression | Compact summaries update retrieval memory without rewriting user-authored content. |  |  |

## Obsidian And Import/Export QA

| Check | Expected | Status | Evidence |
| --- | --- | --- | --- |
| Export vault | Export creates an Obsidian-style folder tree with frontmatter ids and readable Markdown. |  |  |
| Wikilinks | Internal links export as usable wikilinks or readable fallbacks. |  |  |
| Attachments | Image attachments export to portable paths and render after opening the vault folder. |  |  |
| ReadAny cards | Built-in, custom, unsupported, and future-version cards degrade to readable Markdown fallback. |  |  |
| Re-export | Re-export updates by stable document id and does not flatten folders or duplicate ambiguous titles. |  |  |
| Obsidian URI actions | Desktop conflict and import-review cards can open an exported file or search the selected vault through Obsidian URI actions, and show a visible failure toast if the platform cannot open the URI. |  |  |
| Markdown import | Markdown file import shows confirmation proposals with destination paths before writing. |  |  |
| Vault import | Linked-folder import surfaces modified, missing, unreadable, and conflict states before applying updates. |  |  |

## Sync QA

Use two real app instances and the selected sync backend.

| Check | Expected | Status | Evidence |
| --- | --- | --- | --- |
| Folder hierarchy | Created and moved folders/documents arrive on the second device with the same paths. |  |  |
| Body content | Tiptap JSON and Markdown projection sync without losing rich blocks. |  |  |
| Attachments | Image attachment metadata and files arrive and render on the second device. |  |  |
| Links | Internal links, source links, backlinks, and paths resolve after sync. |  |  |
| Card attrs | Card type, version, source attrs, structured data, and schema migrations survive sync. |  |  |
| Card templates | Custom card template create/update/disable syncs without deleting existing card documents. |  |  |
| Tombstones | Deleted documents do not reappear after sync unless explicitly recreated. |  |  |

## Final Decision

| Decision | Value |
| --- | --- |
| Ready for PR review? |  |
| Blocking failures |  |
| Follow-up issues |  |
| Reviewer notes |  |
