# ReadAny CLI Command and Tool Spec

## CLI 命令

命令分为三类：

- 已实现：可以写入 README、help、测试和用户文档。
- 规划中：只写在设计文档，不进入 CLI help 和 MCP `tools/list`。
- 禁止类：不设计、不实现，例如任意 shell、任意 SQL。

### 基础命令

```bash
readany --version
readany doctor [--json]
readany agent setup [--user|--global] [--client generic|claude|cursor|codex|opencode|all] [--profile readonly|editor|publisher] [--json]
readany agent uninstall [--user|--global] [--json]
readany install [--global | --user]
readany uninstall [--global | --user]
```

`install` 和 `uninstall` 用于安装或卸载全局 CLI shim。客户端随包携带 CLI binary，但全局命令由 CLI 自己管理。

`agent setup` 是给外部 AI agent 使用的统一 bootstrap 命令，适合设置页直接复制给大模型执行：

```bash
readany agent setup --user --client codex --profile readonly --json
readany agent setup --user --client all --profile readonly --json
```

它会按安全顺序先校验 `profile/client`，再安装或修复本机 `readany` 命令 shim，安装或更新 `$AGENT_HOME/skills/readany/SKILL.md`，对 `codex` / `claude` / `cursor` / `opencode` 额外创建 ReadAny 管理的客户端 skill 链接，最后返回目标客户端的 MCP `snippet` 和下一步提示。`--client all` 会一次性创建所有已知 skill discovery 链接，包括 `~/.agents/skills/readany` 兼容目录。`generic` 不创建客户端 skill 链接。它不会静默写入 Claude/Cursor/Codex/OpenCode 等外部客户端配置；需要由用户或外部 agent 把返回的 `mcpConfigs[].snippet` 显式放到对应客户端配置里。默认建议只读 `readonly`，`editor` / `publisher` 必须由用户明确授权。

`agent uninstall` 会卸载 ReadAny 管理的 CLI shim 和 ReadAny skill；它不会修改外部客户端配置，返回结果会提醒用户删除曾经手动写入的 MCP 配置片段。

`doctor --json` 输出机器可读诊断，包含路径、profile、Node / native sqlite runtime、CLI distribution（Node script、是否 built bundle、是否桌面资源包、是否 native binary）、工具数量、MCP 默认启动参数、支持的 profile/client、Skill 状态和检查项。

### MCP 命令

```bash
readany mcp serve --profile readonly
readany mcp serve --profile assistant
readany mcp serve --profile editor
readany mcp serve --profile publisher
readany mcp config --profile readonly [--client generic|claude|cursor|codex|opencode] [--json]
```

默认使用 stdio。`mcp config` 只生成外部 agent 可复制的配置片段，不启动服务、不增加 MCP tool、不改变授权。`generic`、`claude`、`cursor` 的 `snippet` 是纯 JSON `mcpServers.readany`；`codex` 的 `snippet` 是可粘贴到 Codex `config.toml` 的 TOML 片段；`opencode` 的 `snippet` 是可粘贴到 OpenCode `opencode.json` 的 JSON `mcp.readany` 片段。`--json` 结果可以额外包含 `client`、`format`、`profile` 等元数据，但设置页复制时必须只复制 `snippet`。第一阶段不要求 daemon。

### Skill 命令

```bash
readany skill install
readany skill uninstall
readany skill status [--json]
readany skill update
```

默认安装到：

```text
$AGENT_HOME/skills/readany
~/.agent/skills/readany
```

`agent setup --client codex|claude|cursor|opencode` 会把这个通用 skill 以 symlink 形式挂到对应客户端的已知用户 skill 目录；`agent setup --client all` 还会额外写入 OpenCode 兼容的 `~/.agents/skills/readany`。

### 验收与归档命令

这些命令不进入 MCP `tools/list`，只作为 CLI 侧的验收、采证和归档工具：

```bash
pnpm --filter @readany/cli acceptance:real -- --book <book-id> --rag-query <query> --evidence <evidence.json>
pnpm --filter @readany/cli acceptance:real -- --workspace docs/readany-cli/acceptance/<workspace-dir> --book <book-id> --rag-query <query>
pnpm --filter @readany/cli acceptance:agent -- --client <Codex|Claude Desktop|Cursor> --client-version <version> --profile <profiles> --evidence <evidence.json>
pnpm --filter @readany/cli acceptance:agent -- --workspace docs/readany-cli/acceptance/<workspace-dir> --client <Codex|Claude Desktop|Cursor> --client-version <version> --profile <profiles>
pnpm --filter @readany/cli acceptance:desktop -- --snapshot <snapshot.json> --screenshot <path> --evidence <evidence.json>
pnpm --filter @readany/cli acceptance:desktop -- --workspace docs/readany-cli/acceptance/<workspace-dir> --snapshot <snapshot.json> --screenshot <path>
pnpm --filter @readany/cli acceptance:packaged -- --package-source <artifact> --evidence <evidence.json>
pnpm --filter @readany/cli acceptance:packaged -- --workspace docs/readany-cli/acceptance/<workspace-dir> --package-source <artifact> --platform <macOS|Windows|Linux>
pnpm --filter @readany/cli acceptance:init -- --workspace docs/readany-cli/acceptance/<workspace-dir>
pnpm --filter @readany/cli acceptance:scaffold -- --workspace docs/readany-cli/acceptance/<workspace-dir>
pnpm --filter @readany/cli acceptance:scaffold -- --evidence <real-sample.json> --output <record.md>
pnpm --filter @readany/cli acceptance:status -- --record <record.md> --evidence <evidence.json>
pnpm --filter @readany/cli acceptance:status -- --workspace docs/readany-cli/acceptance/<workspace-dir>
pnpm --filter @readany/cli acceptance:validate -- --workspace docs/readany-cli/acceptance/<workspace-dir> [--strict-m5]
pnpm --filter @readany/cli acceptance:validate -- --record <record.md> --evidence <evidence.json> [--strict-m5]
pnpm --filter @readany/cli acceptance:finalize -- --workspace docs/readany-cli/acceptance/<workspace-dir>
pnpm --filter @readany/cli acceptance:finalize -- --record <record.md> --evidence <evidence.json>... --output <manifest.json>
pnpm --filter @readany/cli acceptance:bundle -- --workspace docs/readany-cli/acceptance/<workspace-dir> --release <label>
pnpm --filter @readany/cli acceptance:bundle -- --record <record.md> --manifest <manifest.json> --evidence <evidence.json>... --output-dir <bundle-dir>
pnpm --filter @readany/cli acceptance:assemble -- --workspace docs/readany-cli/acceptance/<workspace-dir>
pnpm --filter @readany/cli acceptance:verify-bundle -- --workspace docs/readany-cli/acceptance/<workspace-dir>
pnpm --filter @readany/cli acceptance:verify-bundle -- --bundle-dir <bundle-dir>
pnpm --filter @readany/cli acceptance:assemble -- --record <record.md> --evidence <evidence.json>... --output-dir <bundle-dir>
```

补充约定：

- `acceptance:real` 生成真实样本 evidence，默认只读；只有显式 `--draft-export` 才会创建 draft、validate、export 并清理草稿。
- `acceptance:agent`、`acceptance:desktop`、`acceptance:packaged` 只记录对应人工或半自动证据，不替代 strict M5 的完整组合证据。
- `acceptance:init` 会先搭好一个本地 acceptance workspace，包含 `record.md`、`evidence/`、`bundle/`、`exports/` 和 `logs/`，适合作为真实 M5 采证起点。
- `acceptance:init --reviewer <name> --release <label>` 会把收口默认值写进 `workspace.json`；后续 `acceptance:scaffold`、`acceptance:finalize`、`acceptance:bundle` 和 `acceptance:assemble` 会自动继承。只有 workspace 没有默认值，或本次要覆盖默认值时，才需要继续显式传 `--reviewer` / `--release`。
- `TBD`、空串或缺失字段不是有效 workspace 默认值；命令建议仍会提示显式传入 reviewer/release，避免占位符进入最终 manifest 或 bundle index。
- `acceptance:real`、`acceptance:agent`、`acceptance:desktop`、`acceptance:packaged` 也支持 `--workspace`：real 会写入 `real-sample.json`，agent 会按客户端名写入 `agent-codex.json` 或 `agent-second-client.json`，desktop 会写入 `desktop-settings.json`，packaged 会按 `--platform` 写入 `packaged-macos.json` / `packaged-windows.json` / `packaged-linux.json`。
- `acceptance:scaffold` 生成 partial 验收草稿，用于减少手工填表漏项，不把 pending/TBD 伪装成通过。
- `acceptance:status` 是验收收口助手，会汇总当前 record/evidence 距离 strict M5 还缺什么，并给出下一步建议命令；如果已经用 `acceptance:init` 建好了 workspace，也可以直接传 `--workspace` 让它自动读取 `workspace.json` 里的 record/evidence 约定。
- `acceptance:status --workspace <dir>` 给出的 next steps 也会继续用 `--workspace` 形式推荐 `acceptance:real` / `acceptance:agent` / `acceptance:desktop` / `acceptance:packaged` / `acceptance:validate` / `acceptance:assemble`，减少在收口时反复切回手工路径模式。
- `acceptance:scaffold`、`acceptance:validate`、`acceptance:finalize`、`acceptance:bundle`、`acceptance:verify-bundle` 和 `acceptance:assemble` 现在也支持 `--workspace`，这样最终收口可以围绕同一套 acceptance workspace 进行，而不是重复手输整组 record/evidence/output 路径。
- `acceptance:validate --strict-m5` 是最终 M5 的机器闸门。
- `acceptance:finalize` 会先跑 strict M5，再写出最终 manifest。
- `acceptance:bundle` 把 record、manifest 和 evidence 整理成归档目录。
- `acceptance:verify-bundle` 独立复验 bundle 目录里的 `index.json`、record、manifest 和 evidence 是否匹配，并重跑 strict M5；如果 bundle manifest 里记录了复验元数据，也会一并核对，适合交接或 CI 二次校验。
- `acceptance:assemble` 是 `acceptance:finalize + acceptance:bundle + acceptance:verify-bundle` 的一键入口，会先卡 strict M5，再在 bundle 目录下写出 `final-manifest.json` 和对外交付用的 `manifest.json`，最后自动复验 bundle。

### 只读数据命令

已实现：

```bash
readany tools list [--json]
readany books list [--limit 50] [--json]
readany books search <query> [--json]
readany book get <book-id> [--json]
readany chapters list <book-id> [--json]
readany chapter get <book-id> <chapter-id> [--chunk-start 1] [--chunk-count 20] [--limit 12000] [--json]
readany context get [--json] [--limit 12000] [--include-selection true|false] [--include-surrounding-text true|false] [--include-highlights true|false]
readany notes search <query> [--book <book-id>] [--json]
readany highlights search <query> [--book <book-id>] [--json]
readany knowledge search <query> [--book <book-id>] [--limit 20] [--json]
readany bookmarks list <book-id> [--json]
readany skills list [--json]
readany rag search <query> --book <book-id> [--mode bm25|hybrid|vector] [--limit 5] [--json]
readany epub inspect <book-id> [--profile editor] [--json]
readany epub draft create <book-id> [--profile editor] [--json]
readany epub chapter read <draft-id> <chapter-id> [--profile editor] [--limit 12000] [--format text|xhtml] [--json]
readany epub chapter patch <draft-id> <chapter-id> --xhtml <file> [--profile editor] [--json]
readany epub chapters patch <draft-id> --patch <file> [--profile editor] [--json]
readany epub metadata patch <draft-id> --patch <file> [--profile editor] [--json]
readany epub toc rebuild <draft-id> [--profile editor] [--json]
readany epub history <draft-id> [--profile editor] [--json]
readany epub diff <draft-id> [--profile editor] [--json]
readany epub validate <draft-id> [--profile publisher] [--json]
readany epub export <draft-id> --output <path> [--profile publisher] [--overwrite] [--json]
```

当前 `chapters.*` 优先基于 indexed chunks 返回章节视图；没有 chunks 且书籍是 EPUB 时，会 fallback 到真实 EPUB spine/manifest；没有 chunks 且书籍是 PDF 时，会 fallback 到 page text，章节 id 形如 `page-1`。indexed 章节支持 chunk range 和 content limit；EPUB/PDF fallback 章节支持 content limit，避免一次返回超大正文。`epub inspect` 是只读结构检查，需要 `editor` profile 或更高权限；`epub draft create` 只复制原 EPUB 到受控 draft workspace，写入 manifest/history，不修改章节、不导出文件；`epub chapter read` 默认读取 draft 章节可读文本，`--format xhtml` 可读取完整 XHTML 供受控章节编辑器保存回 draft。

### Draft 编辑命令

已实现：

```bash
readany epub draft create <book-id> [--profile editor] [--json]
readany epub chapter read <draft-id> <chapter-id> [--profile editor] [--limit 12000] [--format text|xhtml] [--json]
readany epub chapter patch <draft-id> <chapter-id> --xhtml <file> [--profile editor] [--json]
readany epub metadata patch <draft-id> --patch <file> [--profile editor] [--json]
readany epub toc rebuild <draft-id> [--profile editor] [--json]
readany epub history <draft-id> [--profile editor] [--json]
readany epub diff <draft-id> [--profile editor] [--json]
readany epub undo <draft-id> <operation-id> [--profile editor] [--json]
readany epub validate <draft-id> [--profile publisher] [--json]
readany epub export <draft-id> --output <path> [--profile publisher] [--overwrite] [--json]
```

补充约定：

- `epub.chapter.read` 默认返回可读文本；`--format xhtml` 返回完整 XHTML，供桌面 draft 工作区或外部 AI 在受控 draft 中编辑。
- `epub.chapter.patch` 只修改 draft 中的单个章节资源，不能直接改原始书文件。
- `epub.chapters.patch` 只接受 1-50 个 `{ chapterId, xhtml }` 章节替换计划；每项仍通过单章 patch/history 路径落盘，不能直接改原始书文件。
- `epub.metadata.patch` 只修改 draft 中的 metadata。
- `epub.toc.rebuild` 只修改 draft 中的 EPUB3 nav 目录，基于 spine XHTML 章节生成一级目录。
- `epub.history` 只读取 draft 的 operation history，不修改文件。
- `epub.diff` 只比较 source/draft EPUB entry 的 hash 和 size，不返回完整正文。
- `epub.undo` 只撤销已记录且资源未被后续改动覆盖的 patch。
- `epub.validate` 只做结构和引用校验，不自动修改内容。
- `epub.export` 默认生成新文件，不覆盖源 EPUB。
- 用户编辑入口和 AI 编辑入口使用同一套 draft/history/diff。
- 用户编辑入口应该在书籍详情或 draft 工作区；AI 编辑入口通过 MCP / CLI tool 调用。

## MCP Tool 命名

Tool 命名使用资源域前缀：

```text
books.list
books.search
books.get
chapters.list
chapters.get
context.get
bookmarks.list
skills.list
notes.search
notes.export
knowledge.export
knowledge.search
highlights.search
rag.search
epub.inspect
epub.draft.create
epub.draft.discard
epub.chapter.read
epub.chapter.patch
epub.chapters.patch
epub.metadata.patch
epub.toc.rebuild
epub.history
epub.diff
epub.undo
epub.validate
epub.export
```

当前 `tools/list` 只允许返回：

```text
books.list
books.search
books.get
chapters.list
chapters.get
context.get
bookmarks.list
skills.list
notes.search
notes.export
knowledge.export
knowledge.search
highlights.search
rag.search
epub.inspect
epub.draft.create
epub.draft.discard
epub.chapter.read
epub.chapter.patch
epub.chapters.patch
epub.metadata.patch
epub.toc.rebuild
epub.history
epub.diff
epub.undo
epub.validate
epub.export
```

`audit.list` 当前已经可用，但它只读取最近 CLI/MCP 审计元数据，不返回工具参数正文、密钥或大内容。`notes.export` 当前已经可用，但它只导出单本书 notes/highlights 文件，默认不覆盖已有文件，也不把完整导出内容塞进 MCP 响应。`epub.inspect` 当前已经可用，但它只是只读结构检查。`epub.draft.create` 当前已经可用，但它只创建受控 draft workspace。`epub.draft.discard` 当前已经可用，但它只标记 draft inactive。`epub.chapter.read` 当前已经可用，默认读取 draft 可读文本，也支持 `--format xhtml` 返回完整 XHTML。`epub.chapter.patch` 当前已经可用，但它只替换 draft 内单个 XHTML 章节资源。`epub.chapters.patch` 当前已经可用，但它只接受 1-50 个结构化章节替换计划，并把每个章节作为普通 `epub.chapter.patch` 写入 history。`epub.metadata.patch` 当前已经可用，但它只修改 draft OPF metadata。`epub.toc.rebuild` 当前已经可用，但它只重建 EPUB3 nav 目录。`epub.history` 当前已经可用，但它只读取 draft operation history。`epub.diff` 当前已经可用，但它只比较 source/draft EPUB entry 的 hash 和 size，不返回完整正文。`epub.undo` 当前已经可用，但它只撤销已记录且资源未被后续改动覆盖的 draft patch。`epub.validate` 当前已经可用，但它只校验 active draft 的结构和引用，不自动修改。`epub.export` 当前已经可用，但它只在 validate 通过后导出新 EPUB，默认不覆盖已有文件、不覆盖源 EPUB。其余 `epub.*` 写入工具接入真实实现前只能保留在设计文档里。`chapters.*` 当前已支持 indexed chunks 优先、未索引 EPUB fallback 和未索引 PDF page fallback。`context.get` 当前已可用，但它只读取桌面端写入的 reader context snapshot，不修改阅读状态、不读取裸 UI 内存。`rag.search` 当前支持 BM25、hybrid 和 vector；BM25 总是可用，hybrid 在 embedding 未配置或失败时回退到 BM25，vector 需要桌面端远程向量模型配置或 `READANY_EMBEDDING_MODEL` / `READANY_EMBEDDING_BASE_URL` / `READANY_EMBEDDING_API_KEY` 环境配置。

未来补齐时，`tools/list` 仍然要遵循一个原则：先完成真实实现、权限、测试和文档，再把工具放进列表。不能为了“让 AI 知道能力存在”而提前注册。

## Tool 输出规则

所有工具输出都必须：

- 可 JSON 序列化。
- 明确 success / error。
- 大结果分页。
- 不输出敏感配置。
- 不默认输出超大正文。

建议响应结构：

```ts
type ToolResult<T> = {
  ok: true;
  data: T;
  cursor?: string;
  warnings?: string[];
} | {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};
```

MCP `tools/call` 返回 MCP content：

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"ok\":true,\"data\":{}}"
    }
  ],
  "isError": false
}
```

其中 `text` 内容是 ReadAny `CommandResult` JSON。

## Tool Registry

每个 tool 必须声明：

```ts
type ReadAnyTool = {
  name: string;
  description: string;
  scopes: string[];
  risk: "low" | "medium" | "high";
};
```

MCP `tools/list` 会把 `risk`、`scopes` 和由 scope 推导出的 `minimumProfile` 写入 `_meta`，并在 description 中附加人类可读摘要。外部 agent 应先读取这些字段，再决定是否提示用户提升 profile。

风险等级：

- `low`：只读。
- `medium`：写 draft、创建笔记、修改知识库。
- `high`：导出、同步、备份、批量修改。

## 第一批 Tool

当前已实现：

```text
books.list
books.search
books.get
chapters.list
chapters.get
notes.search
notes.export
highlights.search
rag.search
epub.inspect
epub.draft.create
epub.draft.discard
epub.chapter.read
epub.chapter.patch
epub.chapters.patch
epub.metadata.patch
epub.toc.rebuild
epub.history
epub.diff
epub.undo
epub.validate
epub.export
```

当前已实现：

```text
knowledge.search
```

当前已实现：

```text
knowledge.export
```

用户精排入口不在 MCP tool list 里，它在客户端 UI 和 draft 工作区里；MCP 只负责让外部 AI 通过受控工具修改 draft。

不做：

```text
shell.exec
sql.query
filesystem.read.any
filesystem.write.any
sync.run
admin.backup
```

`sync.run` 和 `admin.backup` 不是永远不做，而是不进入默认外部 AI 能力；未来只能放进 `admin` profile，并且必须用户确认。
