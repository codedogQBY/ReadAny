# ReadAny CLI Manual Verification

Date: 2026-06-18

Goal: manually exercise the full `readany` CLI surface against real and isolated environments instead of relying on unit tests alone.

## Environments

- Real desktop library:
  `/Users/tuntuntutu/Library/Application Support/com.readany.app`
- Real installed command:
  `/Users/tuntuntutu/.local/bin/readany`
- Isolated write-test library:
  temporary copies of the real desktop library via `rsync -a ...`
- Repo build:
  `pnpm --filter @readany/cli build`

## Real library facts verified first

- `readany doctor --json` reports `readanyHome` as `com.readany.app`
- `readany books list --json` returns 35 books
- Current reader context is available and points at `代码整洁之道`
- Real library has:
  - highlights: 60 total
  - notes: 0 total
  - bookmarks on multiple books

## Command-by-command manual checks

### Core CLI

- `readany --version`
  - expected: print CLI version
  - actual: `0.1.0`
- `readany --help`
  - expected: print full command list
  - actual: usage text includes all documented commands
- `readany doctor --json`
  - expected: show resolved paths/runtime/tool count
  - actual: reports correct data root, runtime, and 28 tools

### Install / Repair / Uninstall

- `readany install --user --user-bin-dir <tmp>`
  - actual: created symlink to repo `dist/bin/readany.js`
- `readany repair --user --user-bin-dir <tmp>`
  - actual: returned `repaired: true`
- `readany uninstall --user --user-bin-dir <tmp>`
  - actual: removed symlink
- `readany install --global --global-bin-dir <tmp>`
  - actual: created symlink
- `readany uninstall --global --global-bin-dir <tmp>`
  - actual: removed symlink

### Skill management

- `readany skill status --json`
  - actual: reports install state correctly
- `readany skill install --json`
  - actual: creates managed `SKILL.md`
- `readany skill update --json`
  - actual: updates managed skill file
- `readany skill uninstall --json`
  - actual: removes managed skill file

### Tool registry

- `readany tools list --json`
  - actual: returns 28 tools
  - actual: returns recent CLI actions
  - actual: returns failed entries only

### Book/library read commands against real data

- `readany books list --json --limit 5`
  - actual: non-empty result, includes `代码整洁之道`
- `readany books search 整洁 --json`
  - actual: returns `代码整洁之道`
- `readany book get 2d1c4b06-01c9-4464-8fe6-15583b6f94ec --json`
  - actual: returns expected metadata
- `readany chapters list 2d1c4b06-01c9-4464-8fe6-15583b6f94ec --json`
  - actual: returns indexed chapter list
- `readany chapter get 2d1c4b06-01c9-4464-8fe6-15583b6f94ec 7 --json --limit 1200`
  - actual: returns expected chapter content
- `readany context get --json --limit 800`
  - actual: returns active reader context
- `readany bookmarks list 76fc5d6d-f63d-45f6-a67a-74e1a92f9aae --json`
  - actual: returns 6 bookmarks
- `readany skills list --json`
  - actual: command succeeds; result shape correct

### Notes / highlights / knowledge / rag

- `readany notes search 代码 --json --limit 5`
  - actual: succeeds; real library currently has zero notes, so result is empty as expected
- `readany highlights search 完美 --json --book 76fc5d6d-f63d-45f6-a67a-74e1a92f9aae --limit 5`
  - actual: returns 5 real highlight matches
- `readany knowledge search 行动 --json --book 76fc5d6d-f63d-45f6-a67a-74e1a92f9aae --limit 5 --content-limit 120`
  - actual: returns a real book match
- `readany rag search clean --book 2d1c4b06-01c9-4464-8fe6-15583b6f94ec --json --limit 3`
  - actual: returns RAG results

### Export commands

- `readany notes export 2d1c4b06-01c9-4464-8fe6-15583b6f94ec --output <tmp>/notes.md --json --profile publisher --overwrite`
  - actual: markdown export written
- `readany notes export 76fc5d6d-f63d-45f6-a67a-74e1a92f9aae --output <tmp>/notes-obsidian.md --json --profile publisher --format obsidian --overwrite`
  - actual: obsidian export written, includes 12 highlights
- `readany notes export 76fc5d6d-f63d-45f6-a67a-74e1a92f9aae --output <tmp>/notes-notion.json --json --profile publisher --format notion --overwrite`
  - actual: notion export written
- `readany notes export 2d1c4b06-01c9-4464-8fe6-15583b6f94ec --output <tmp>/notes.json --json --profile publisher --format json --overwrite`
  - actual: JSON export written
- `readany knowledge export --output <tmp>/knowledge.md --json --profile publisher --overwrite --limit 20`
  - actual: markdown export written
- `readany knowledge export --output <tmp>/knowledge.json --json --profile publisher --format json --overwrite --limit 10`
  - actual: JSON export written

### EPUB read/edit flow in isolated libraries

- `readany epub inspect <book-id> --json --profile editor`
  - actual: works on real EPUB books
- `readany epub draft create <book-id> --json --profile editor`
  - actual: creates draft workspace
- `readany epub chapter read <draft-id> <chapter-id> --json --profile editor --format text`
  - actual: returns text content
- `readany epub chapter read <draft-id> <chapter-id> --json --profile editor --format xhtml`
  - actual: returns XHTML content
- `readany epub chapter patch <draft-id> <chapter-id> --xhtml <file> --json --profile editor`
  - actual: patch succeeds and history entry recorded
- `readany epub chapters patch <draft-id> --patch <file> --json --profile editor`
  - actual: valid batch patch succeeds
- invalid batch patch payload
  - actual: fails with `epub chapters patch requires every patch to include chapterId`
- `readany epub metadata patch <draft-id> --patch <file> --json --profile editor`
  - actual: metadata patch succeeds
- `readany epub history <draft-id> --json --profile editor`
  - actual: returns entries including draft create and patch actions
- `readany epub diff <draft-id> --json --profile editor`
  - actual: reports changed resources accurately
- `readany epub undo <draft-id> <operation-id> --json --profile editor`
  - actual: undo succeeds
- `readany epub draft discard <draft-id> --json --profile editor --reason finished`
  - actual: discard succeeds

### EPUB validate / export

- Real-book validation on isolated copies:
  - `代码整洁之道` draft validate fails with 1 source-book issue:
    missing `kindle:embed:...` resource reference
  - `陰の実力者になりたくて！ ０７` draft validate fails with 2 source-book issues:
    missing manifest items `p-colophon2` and `p-bookwalker`
  - conclusion: CLI behavior matches expectation because export correctly refuses invalid drafts

- Successful validate/export path:
  - verified via `pnpm --filter @readany/cli smoke:agent`
  - smoke result includes:
    - `publisher validate and export`
    - `exported EPUB reimport inspect and chapter reads`

### MCP manual verification

- `readany mcp config --json --profile readonly --client generic`
  - actual: JSON snippet returned
- `readany mcp config --json --profile readonly --client claude`
  - actual: JSON snippet returned
- `readany mcp config --json --profile readonly --client cursor`
  - actual: JSON snippet returned
- `readany mcp config --json --profile editor --client codex`
  - actual: TOML snippet returned
- `readany mcp serve --profile readonly`
  - manual JSON-RPC verified:
    - `initialize` -> success
    - `notifications/initialized` -> returns `{}` and no longer errors
    - `tools/list` -> returns all tools with safety metadata
    - `tools/call books.search` -> success with real data
    - `tools/call epub.draft.create` under readonly -> permission denied as expected

## Additional automated evidence used only as supporting proof

- `pnpm --filter @readany/cli test`
  - actual: `122 passed`
- `pnpm --filter @readany/cli smoke:agent`
  - actual: passed end-to-end smoke including MCP, draft edit, validate, export, and re-import checks

## Changes made while verifying

- Fixed default desktop data root from `ReadAny` to `com.readany.app`
- Accepted MCP `notifications/initialized` instead of recording it as a JSON-RPC error

## Remaining product boundaries observed

- `epub.toc.rebuild` requires an EPUB3 nav document and will reject EPUB2 books
- `epub.validate/export` correctly refuses drafts when the source EPUB already contains structural/resource errors
