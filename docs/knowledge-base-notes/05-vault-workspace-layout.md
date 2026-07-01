# Vault Workspace Layout

This document is the product and UI contract for the knowledge-base workspace.
The knowledge base is not a prettier notes list. It is a book-centered vault with
folders, documents, source links, attachments, and a WYSIWYG writing canvas.

## Design North Star

ReadAny's knowledge base should feel like this:

```text
Book -> Vault tree -> WYSIWYG document -> Sources / backlinks / AI context
```

The user should always understand three things:

- Where this document lives in the vault hierarchy.
- What document they are editing.
- Which book positions, highlights, notes, files, and AI outputs are connected
  to it.

The interface must avoid the old "form full of fields" feeling. A knowledge
document is a document, not a settings panel.

## Non-Negotiable Product Shape

These decisions are part of the feature contract, not implementation details:

- The knowledge base is a vault. A flat document list with filters is not enough.
- The folder tree is spatial navigation, like Obsidian. Tags and groups are
  secondary organization layers.
- The editor is a WYSIWYG writing canvas. Users should not feel like they are
  editing Markdown, JSON, or a large textarea.
- Desktop and mobile should share the same information model, but not the same
  layout.
- The workspace must look like a focused reader/writer tool, not a dashboard,
  settings page, or note-card wall.

### User Experience Correction

The knowledge-base UI must be judged by three simultaneous signals:

- Hierarchy is visible before content density. The user should immediately see
  folders, nested documents, the active path, and where a new document will be
  created.
- Writing is direct manipulation. The document body is a WYSIWYG canvas powered
  by Tiptap, not a Markdown textarea, JSON editor, or settings-style form.
- Layout supports the mental model. Desktop should feel like a vault sidebar
  plus writing canvas plus quiet inspector; mobile should feel like native vault
  browsing into a focused editor. A stacked card feed fails this feature even if
  the underlying data model is correct.

This means hierarchy, editor fidelity, and layout are inseparable acceptance
criteria. If any of them regresses, the feature has drifted back into the old
notes system.

### Workspace Mental Model

The workspace should be designed as a file-based vault, not as a notes database
with a nicer skin.

The user-facing model is:

```text
Knowledge Vault
├── Book Space
│   ├── Book Home.md
│   ├── Chapter Notes/
│   │   ├── Chapter 01.md
│   │   └── Chapter 02.md
│   ├── Ideas/
│   └── Reviews/
└── Global Space, later
```

Important implications:

- A path is a first-class product object. The tree path, breadcrumb, import
  preview, export path, sync reconciliation, and AI tool result must describe
  the same location.
- A folder is not a tag and not a group. It owns children in the tree.
- A document is not a card. It opens into a writing canvas.
- The active node can be root, folder, or document, and each state has a
  different UI: root/folder shows browsing rows; document shows WYSIWYG editing.
- Book-scoped knowledge is the v1 default. A global vault can arrive later, but
  it must use the same folder/document primitives instead of becoming another
  flat list.
- "Recently edited", tags, search, backlinks, and AI-generated collections are
  discovery views. They must always resolve back to a real folder/document path.

This is the Obsidian-like part of the feature. It is not about copying
Obsidian's visuals; it is about preserving the user's spatial memory.

### WYSIWYG Reading And Writing Standard

The editor should feel like a clean document, not like a Markdown textarea with
formatting buttons.

Rules:

- The title and body should feel continuous. The title can be a large editable
  heading at the top of the document canvas, not a form field floating above it.
- Markdown shortcuts are allowed, but they must immediately become rich blocks.
- Source references, AI output, callouts, reviews, diagrams, and custom cards
  should render as Tiptap node views inside the document. They should not open
  as unrelated forms unless a configuration sheet is needed.
- Display state and edit state should not be two separate modes for normal
  writing. Click, type, autosave.
- Metadata belongs around the document: path, tags, source links, backlinks,
  sync state, and AI context. It should not interrupt the document body.
- Raw Markdown is an export/import/debug affordance, not the default authoring
  experience.

The visual quality bar is closer to a native writing app plus an Obsidian-style
vault tree than to a CRUD management page.

### Layout Redesign Target

The layout should be optimized around one question per zone:

| Zone | Question | Primary UI |
| --- | --- | --- |
| Left / browser | Where am I? | Vault tree, folder rows, search, create/move. |
| Center / canvas | What am I writing? | Breadcrumb, title, WYSIWYG body, folder browser. |
| Right / inspector | What is connected? | Sources, backlinks, outline, AI memory, export state. |

The center canvas must remain visually dominant. The left tree can be dense, and
the right inspector can be useful, but neither should make the document feel
like a small card embedded in a dashboard.

When reviewing any implementation, reject it if:

- The first screen looks like a dashboard, metrics panel, or card grid.
- The folder hierarchy is only implied through filters, chips, or grouped
  headings.
- The editor looks like a settings form with title/body/metadata fields stacked
  together.
- Folder views show empty editor chrome instead of child folders/documents.
- Mobile compresses vault browsing, editing, tags, sources, backlinks, and AI
  context into one long scroll.

### Layout Correction After Review

The product should be reviewed as a vault workspace before it is reviewed as a
notes feature. A user opening the knowledge base should not wonder whether the
documents are flat notes, grouped tags, or a settings page. The first visible
structure must communicate "this is a folder tree and I am editing a real
document inside it."

Concrete correction:

- Directory hierarchy is not optional polish. It is the main navigation model,
  like Obsidian's file explorer.
- The root, folders, documents, and orphaned documents must be shown as a
  spatial tree with indentation, active ancestry, and child counts where useful.
- Folder overview screens are browsing screens. They should feel like opening a
  folder in a file-based note app, not like a dashboard section.
- Document screens are writing screens. Title and body should read as one
  WYSIWYG document, with metadata and context staying quiet.
- If a layout makes folders look like tags, documents look like cards, or the
  editor look like a form, the layout is wrong even if the data model is
  technically correct.
- Mobile may use sheets and stacked screens, but it must still preserve the
  same mental model: vault browser first, focused WYSIWYG editor second,
  context/actions in sheets.

### Visual Acceptance Rules

The hierarchy must be visible in the interface language, not only in the data
model.

- Breadcrumbs should read like file paths, with lightweight separators. They
  should not look like unrelated tags or status chips.
- The vault navigator should look and behave like a file explorer: indentation,
  active ancestry, folder disclosure, and quiet row actions.
- Folder screens should look like an opened folder. Use clear folder/document
  rows and section dividers; avoid dashboard cards, metric tiles, or form-like
  panels.
- Document screens should look like a writing canvas. Title and body should be
  directly editable, with metadata, tags, sources, and AI context kept around
  the edges.
- Mobile should not compress everything into one scroll of cards. Browsing the
  vault and writing a document are separate modes with the same underlying
  path.

### Runtime Layout Correction

The runtime UI should reinforce the vault model through its physical structure:

- Desktop uses the full knowledge workspace width for three zones. Avoid a
  centered page shell around the whole feature; that makes the vault feel like a
  settings subpage instead of a workspace.
- Root and folder screens use file-browser rows with quiet metadata such as
  document type, child count, excerpt, and updated date. They should not look
  like a dashboard grid or repeated marketing cards.
- Document screens keep the editable title and Tiptap body visually continuous.
  Tags, path, sync state, and context stay around the document instead of
  becoming a form above it.
- Mobile uses two explicit modes: vault browsing and focused document editing.
  The vault view should feel like a native file explorer with a path trail,
  tree, and opened-folder rows. The document view should feel like one WYSIWYG
  writing surface with temporary actions in sheets.
- Path affordances should read as lightweight file paths. They may be tappable,
  but they should not look like unrelated filter chips.

### Directory And WYSIWYG Gate

Every runtime review should pass this gate before any secondary polish is
accepted:

- A document must always have an address. Tree rows, folder rows, breadcrumbs,
  move targets, search results, AI proposals, export previews, and sync
  conflict messages must show or preserve the same vault path.
- Opening a folder should feel like opening a folder, not opening an empty note.
  The main title is the real folder name, and the content area is a file list
  with child folders/documents, counts, updated state, and quiet row actions.
- Opening a document should feel like writing in a document, not filling a
  settings form. The title and Tiptap body are the primary surface; tags,
  sources, backlinks, summaries, and AI memory stay in surrounding context.
- WYSIWYG is the default contract. Markdown textareas are acceptable only for
  emergency recovery, import/export previews, or explicit debug/power-user
  affordances.
- Mobile must keep the same address model as desktop. It can use a native
  vault-browse screen and focused editor screen, but it cannot flatten folders
  into chips, cards, or one long note feed.

If a feature cannot answer "where is this document in the vault?" and "am I
editing the rendered document directly?", it is not ready to merge.

### Workspace Information Architecture Gate

The knowledge-base layout must be reviewed as an information architecture, not
as a beautified note screen.

Required screen states:

| Active target | Desktop center | Mobile state | What must be visible |
| --- | --- | --- | --- |
| Vault root | Folder browser | Vault browser | Book vault path, root children, create-in-root actions. |
| Folder | Folder browser | Vault browser inside folder | Folder path, child folders first, child documents second, create-in-folder actions. |
| Document | WYSIWYG canvas | Focused editor | File path, editable title, rendered Tiptap body, quiet save/sync state. |
| Search / AI result | Result rows | Result rows/sheet | Matching document title plus full vault path. |
| Import / export | Preview rows | Review sheet | Destination path, source path, conflict state, and stable document ID when known. |

This gate exists because a flat list can still store `parent_id`, but users will
not build spatial memory from invisible hierarchy. The runtime must make the
directory address obvious before the user edits, moves, links, exports, imports,
or accepts an AI proposal.

The default authoring surface is equally strict:

- Users write in the rendered Tiptap document.
- Markdown is a projection for interoperability, import/export, and debugging.
- Title, body, source cards, AI cards, reviews, callouts, and custom cards are
  document blocks or surrounding context, not a stack of unrelated form fields.
- Autosave is the normal save model. Explicit save buttons may exist only for
  recovery, conflict resolution, or batch import/export review.

The first visible impression should be "I am inside a book vault and writing a
document at this path." If it instead feels like a settings form, dashboard,
card feed, or Markdown textarea, the implementation is off direction.

### Obsidian-Like Hierarchy Review

The hierarchy must be reviewed as a real document address system, not as a
decorative grouping layer.

- The left desktop tree and the mobile vault browser are the source of spatial
  memory. They should show nested folders, active ancestry, and sibling
  documents before showing secondary filters such as tags or recents.
- Folder opening is a navigation state. The screen should look like an opened
  directory with rows for child folders and child documents, not like a card
  dashboard, empty editor, or metadata panel.
- Breadcrumbs should read as file paths. They can be clickable, but they should
  stay visually lightweight and must not become unrelated chips or pills.
- Document editing is WYSIWYG first. The title and body are the document
  surface; Markdown text, raw JSON, import previews, and export paths are
  supporting projections.
- Mobile is allowed to use native screens and sheets, but its hierarchy should
  still feel like "browse folder -> open document -> write", not "scroll cards
  until the right note appears".

### Path Fidelity Acceptance

The vault path must survive every surface where a document leaves the current
screen. This is how ReadAny avoids becoming a flat note list with decorative
folders.

- Internal document links should display a friendly title, but target the stable
  document ID or exported vault path behind the scenes.
- Obsidian export should render wikilinks with the resolved file path, not only
  `[[Title]]`, because two folders may contain documents with the same title.
- Import previews, move dialogs, AI tool results, search rows, backlinks, and
  sync conflict messages should all describe the same folder/document path.
- A document title is never a unique address. The path plus document ID is the
  durable address.
- Folder `README.md` files, book home documents, and standalone notes must all
  participate in the same path rules.

## Directory Model

The directory hierarchy is a first-class product model, similar to Obsidian.

Rules:

- Folders and documents are siblings in the same tree.
- A folder can contain folders and documents.
- A normal document cannot contain children.
- Each book has a pinned `book_home` document at the top of its vault.
- `parent_id` is the single source of truth for hierarchy.
- Tags and groups are filters/metadata. They must not fake folder structure.
- Search works across the whole vault, even inside collapsed folders.
- Missing parents after sync/import become visible orphaned roots.
- Moves and renames preserve stable document IDs so sync and Obsidian reconcile
  by identity, not only by path text.

The tree should support:

- Expand/collapse.
- Indentation and subtle connector lines.
- Active document and active path.
- Create inside current folder.
- Move to another folder.
- Rename inline where it feels natural.
- Context actions without overwhelming every row.

### Obsidian-Like Hierarchy Expectations

Users should be able to build a mental map of their book knowledge:

```text
Book Knowledge Vault
├── Book Home
├── Chapter Notes
│   ├── Chapter 01.md
│   ├── Chapter 02.md
│   └── Themes
│       └── Fate and Choice.md
├── Characters
│   ├── Main Characters.md
│   └── Relationships.md
└── Reading Reviews
    └── First Read.md
```

Implications:

- The breadcrumb, tree indentation, export path, and sync path must all describe
  the same hierarchy.
- Creating a document while a folder is selected creates it inside that folder.
- Moving a folder moves the whole subtree and must update visible paths
  immediately.
- Duplicate names are allowed in different folders, but not ambiguous inside the
  same folder unless the UI clearly disambiguates them.
- Deleted or missing parents after sync are shown in an orphan area instead of
  silently flattening the document.
- Obsidian export should preserve this tree as real folders and Markdown files,
  not only as frontmatter fields.

### Vault Navigation Contract

The vault tree is the primary navigation surface. It should never be treated as
a decorative filter beside a flat notes list.

Interaction rules:

- Selecting the vault root opens the root folder browser.
- Selecting a folder opens that folder browser and expands its branch in the
  tree.
- Selecting a document opens the WYSIWYG document editor immediately.
- Returning from a document on mobile goes back to the vault browser with the
  same document highlighted in the tree; it must not insert a large intermediate
  "current document" card.
- The active path is visible in three places: tree ancestry, breadcrumb/path
  text, and export/import destination previews.
- Create actions always inherit the current folder context. If a document is
  active, create beside that document under its parent folder.
- Create affordances must name the real destination folder. If a document is
  active, the UI should show the parent folder as the target, not imply that
  documents can contain children.
- Move actions show the real folder tree and reject cycles before writing.
- Tags, groups, search results, and recent documents are secondary views. They
  can help discovery, but they must route back to a real folder/document path.

The user should be able to answer "where will this document live if I create it
now?" before pressing the create button.

### WYSIWYG Product Contract

ReadAny should feel like a modern writing app with book-aware evidence, not like
a Markdown field with better CSS.

Editor rules:

- The default document body is Tiptap-rendered rich content.
- The title behaves like the top of the document, not like a settings field.
- Source cards, AI cards, callouts, images, review cards, and custom ReadAny
  cards render as document blocks with readable fallback text.
- Markdown shortcuts are allowed only when they immediately transform into
  rich blocks.
- Raw Markdown/source mode can be an advanced mode later, but it cannot be the
  default knowledge authoring surface.
- Empty documents show a writing placeholder and insert affordance, not setup
  cards.

This is the dividing line between a knowledge base and a prettier notes CRUD
page.

## WYSIWYG Contract

The primary editing surface must be WYSIWYG. Markdown is an export and
interoperability projection, not the UI the user writes in by default.

Required behavior:

- Desktop and mobile knowledge documents use the Tiptap document model.
- The title is edited as a real document title, not as a small form input.
- Headings, lists, quotes, images, source cards, callouts, AI cards, and custom
  ReadAny cards render as real editor blocks.
- Placeholder and empty states should look like a writing canvas, not a textarea.
- Toolbar actions should be contextual: compact top toolbar, slash menu, floating
  bubble menu, or focused insert sheet depending on platform.
- Autosave is the default. Save status is quiet and never competes with writing.
- Unsupported cards render readable fallback blocks rather than raw JSON.

Do not expose arbitrary font, color, layout, raw HTML, or iframe editing in v1.
Those make mobile editing, sync, Obsidian export, and AI retrieval unreliable.

### WYSIWYG Interaction Expectations

The editor should behave like a modern document editor:

- Click in the body and type directly.
- Use a small floating toolbar for selected text.
- Use a slash menu or insert button for blocks: heading, quote, list, divider,
  image, source card, AI card, review card, callout, and custom ReadAny cards.
- Drag or use block handles for block reordering on desktop when feasible.
- Mobile uses a keyboard-aware insert toolbar and focused bottom sheets for
  block configuration.
- Markdown shortcuts are welcome, but they transform into rich blocks
  immediately.
- Markdown source view can exist later as an advanced/export/debug mode, never
  as the default authoring experience.

## Desktop Workspace

Desktop should use a calm three-zone workspace.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Book switcher / vault title / search / compact actions                      │
├───────────────┬───────────────────────────────────────┬─────────────────────┤
│ Vault tree    │ WYSIWYG document canvas               │ Context panel       │
│ folders/docs  │ breadcrumb, title, body, blocks        │ sources, backlinks  │
│ search/move   │ folder overview when folder selected   │ outline, AI memory  │
└───────────────┴───────────────────────────────────────┴─────────────────────┘
```

### Left: Vault Navigator

Purpose: answer "where am I?"

The left zone contains:

- Current book knowledge vault.
- Document/folder tree.
- Search.
- Create button with document type menu.
- Move and delete row actions.
- Optional book switcher when space allows.

Visual direction:

- Dense but breathable rows.
- Small icons, not oversized decorative icons.
- Active row uses theme primary subtly.
- Folders show child counts only when useful.
- Row actions appear on hover/focus.
- No giant hero card above the tree.
- Width should be stable, roughly 240-300px, with graceful collapse on small
  desktop windows.
- The tree is the primary navigation, not a side decoration.

### Center: Document Canvas

Purpose: answer "what am I writing?"

The center zone contains:

- Breadcrumb path.
- Large inline title.
- Compact metadata line: document type, book, sync/save state.
- Tags as quiet chips when relevant.
- Tiptap WYSIWYG canvas.
- Folder overview when the active node is a folder.

Visual direction:

- The editor should feel like a page on the app background, not a card nested
  inside more cards.
- Keep the main writing width readable, around 680-820px.
- The outer shell can have borders, but the editable document should not feel
  boxed in.
- Use CSS variables from the app theme for all colors.
- Avoid marketing-style hero sections, large metrics blocks, and decorative
  panels inside the writing path.
- Empty documents should show one elegant writing placeholder and focused insert
  affordances, not a stack of setup cards.
- Folder nodes should show a compact folder overview with child rows; they must
  not show a blank editor pretending to be a note.

### Right: Context Panel

Purpose: answer "what is connected?"

The right zone contains:

- Source links and CFI/highlight references.
- Backlinks.
- Document outline for long documents.
- AI memory/summary state.
- Selected card details.
- Export/import conflict notices when needed.

Rules:

- The right panel is supportive and collapsible.
- It should not steal vertical space from the document.
- On smaller desktop widths, collapse it behind a context button.
- The right panel should feel like an inspector, not another feed. Keep it
  quiet, scannable, and secondary to the document.

### Desktop Layout Anti-Patterns

Do not ship a desktop knowledge layout that:

- Starts with a large dashboard/header card instead of the vault tree and
  current document.
- Shows every document as a card grid while hiding hierarchy.
- Puts the editor inside multiple nested cards.
- Treats title, tags, source, and body as a long settings form.
- Uses oversized empty states that push the editor below the fold.
- Makes the right context panel visually heavier than the writing canvas.

## Mobile Workspace

Mobile should not mirror the desktop grid. It needs a native, focused flow.

```text
Vault Browser -> Document Editor -> Context / Insert Sheets
```

### Screen 1: Vault Browser

Purpose: navigate the hierarchy quickly.

The browser screen contains:

- Compact book header.
- Current vault path.
- Search.
- Native tree/list with folder indentation.
- Create button.
- Folder overview and children.
- Recently edited documents can be a small section, but never replace the tree.

Visual direction:

- No large knowledge hero card.
- Avoid stacking explorer, editor, relations, and AI cards in one long scroll.
- Use rows and grouped sections, not a dashboard.
- Create/move actions use bottom sheets.
- The current path should be visible and horizontally scrollable when long.
- The create sheet should display the actual target folder path before the user
  chooses a document type.
- Folder rows open into the folder; document rows open into the editor.

### Screen 2: Document Editor

Purpose: write without distractions.

The editor screen contains:

- Sticky compact header with back, path, title, status, and more actions.
- Full-screen WYSIWYG WebView editor.
- Keyboard-aware toolbar.
- Insert card/image/link actions through focused sheets.
- Tags and source/context can live in a secondary sheet, not above the editor.

Rules:

- Editing should feel like a document screen, not a form.
- The keyboard must not cover editor controls.
- Title editing can be inline, but long-form body editing owns most of the
  viewport.
- Folder nodes open a folder browser, not an empty editor.
- Context, tags, sources, backlinks, and AI actions open from a compact header
  action or bottom sheet. They should not sit above the writing surface as a
  permanent block.

### Mobile Layout Anti-Patterns

Do not ship a mobile knowledge layout that:

- Stacks vault navigation, document body, sources, AI, tags, and stats in one
  long scroll.
- Uses desktop-like side panels squeezed into mobile.
- Forces long-form body editing through a tiny modal input.
- Lets the keyboard cover the editor toolbar or the active line.
- Hides the user's folder path while they are browsing.
- Uses decorative hero/metric cards before the user can reach their documents.

## Folder View

A folder is a browsing surface, not a document editor pretending to be empty.

Folder view should show:

- Folder title and path.
- Child folders first, then documents, using rows that preserve the same
  indentation and icons as the vault tree.
- Root folder views may pin the book home document first, then separate child
  folders and documents into quiet file-browser sections.
- Small metadata per child: type, updated time or excerpt.
- Empty state with two direct actions: new folder, new note.
- Create destination preview, for example `Create in Chapter Notes / Themes`.
- Path-aware actions: rename, move, export this folder, and create inside.

The visual sectioning matters. A mixed flat list makes folders feel like tags;
folder and document sections make the hierarchy readable before the user opens
anything.

It should not show:

- A giant decorative icon block.
- Blank editor space.
- Heavy cards that make the folder feel like a dashboard.
- A fake "current document" panel when no document is selected.

### Document View

A document is the writing surface.

Document view should show:

- File-path breadcrumb above the title.
- A large editable title that reads as the first line of the document.
- Quiet status text for autosave/sync and document type.
- The Tiptap body as the main surface.
- Inline source/card blocks where they belong in the body.
- Optional context panel on desktop or context sheet on mobile.

It should not show:

- Title, author, tags, body, and source as one long form.
- A second "preview" mode that users must enter before the document feels
  polished.
- Nested cards around the editor.
- Persistent metadata panels that push the writing area below the fold.

### Mobile Interaction Shape

Mobile should feel like two native modes sharing the same vault model:

- Vault browser mode: browse folders, search, create, move, and open documents.
- Document editor mode: write in a focused WYSIWYG editor with keyboard-aware
  toolbar and compact path/title header.

Mobile sheets are for temporary actions:

- Create folder/document.
- Move to folder.
- Insert block/card/image.
- Edit card options.
- View sources/backlinks/AI context.

Sheets should not replace the main editor. Long-form editing must happen in the
document editor, not inside a tiny bottom-sheet textarea.

## Layout Quality Bar

The knowledge workspace should feel closer to a quiet writing app with a
powerful vault sidebar than to a CRUD admin page.

Quality requirements:

- The first screen must make hierarchy obvious within two seconds.
- The current document title and body must be visually dominant.
- The editor body should preserve readable line length and calm whitespace.
- Navigation density should be high enough for real libraries, but never cramped.
- Metadata appears as supporting context, not as the main content.
- Every editable affordance should be discoverable through placement, hover,
  focus, or a small icon button with accessible label.
- Visual states must be clear: active folder, active document, unsaved/synced,
  collapsed, orphaned, missing attachment, and conflict.
- Desktop should support keyboard-heavy users; mobile should support thumb-first
  navigation and keyboard-aware editing.

## Implementation Order for Layout

Build the workspace in this order so the feature does not drift back into a
flat notes page:

1. Lock the data hierarchy: folder nodes, document nodes, path/breadcrumb,
   move/rename/delete, orphan handling, and export path projection.
2. Build the desktop vault shell: left tree, center canvas, right inspector,
   responsive collapse.
3. Build the mobile vault browser and focused editor as separate screens.
4. Replace form-like editing with Tiptap WYSIWYG block editing and contextual
   toolbars.
5. Add custom ReadAny cards and attachment rendering inside the editor canvas.
6. Add Obsidian export/import polish once hierarchy and editor state are stable.

## Visual Principles

Use a quiet reader/productivity style:

- Semantic theme variables only.
- 8px radius or the app's existing radius tokens.
- Fine borders and restrained shadows.
- Primary color as accent, not a full-page wash.
- Compact typography in navigation; comfortable typography in document body.
- Real empty states, not feature explanations.
- No nested cards around cards.
- No decorative orbs, blobs, or marketing visuals in the workspace.

The strongest visual moment should be the document itself: title, readable body,
source cards, and custom knowledge cards.

## Implementation Implications

Current MVP pieces are useful, but the layout should move toward this structure:

- Keep the existing `parent_id`, folder document type, tree builder, breadcrumbs,
  and move validation.
- Desktop should reduce card nesting around the editor and make the document
  canvas the center of the page.
- Mobile should split the current single scrolling knowledge page into a vault
  browser and a focused editor screen.
- The mobile knowledge hero/metric treatment should be removed or reduced to a
  compact book header.
- Context panels/cards should move out of the main writing flow where possible.
- Attachment sync must make image blocks reliable across devices before local
  image insertion is advertised as complete.

## Acceptance Checklist

Before this ships:

- Creating folders and documents produces a visible hierarchy.
- Moving a document updates the tree, breadcrumb, export path, and sync state.
- The active path is visible in the desktop vault sidebar, desktop document
  canvas, and mobile vault browser.
- Selecting a folder behaves like browsing a folder; selecting a document opens
  a real writing surface.
- Search finds documents inside collapsed folders.
- Desktop can edit a document while seeing the vault tree and context.
- Mobile can browse the vault and open a focused WYSIWYG editor.
- Folder screens never look like broken empty document screens.
- Export to Obsidian preserves folder paths and stable IDs.
- Imported Obsidian changes reconcile by document ID where possible.
- The editor never exposes raw Markdown or JSON as the default writing surface.
