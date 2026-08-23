# ReadAny CLI Delivery Playbook

这份文档是 ReadAny CLI / External AI Access 的执行手册。它回答四个问题：

1. 要做什么功能。
2. 按什么顺序做。
3. 怎么测试和留下验收证据。
4. 做到什么程度可以说这一阶段完成。

更严格的单工具 Definition of Done、milestone 停止线和验收记录格式见 [09-delivery-acceptance-contract.md](09-delivery-acceptance-contract.md)。

## 最终目标

ReadAny CLI 要成为 ReadAny 的本地能力网关，让外部 AI 可以在安全边界内使用 ReadAny 的能力：

```text
发现书库 -> 读取内容 -> 搜索知识 -> 生成建议 -> 创建草稿 -> 修改 EPUB -> 校验 -> 导出新产物
```

完整能力不是一次性交付。第一阶段只做只读外部 AI 入口；编辑、精排、导出必须在 draft-first 和权限模型稳定后再开放。

## 交付原则

- 能力先进入 `@readany/core` 或清晰的领域服务，再由 CLI/MCP 调用。
- MCP `tools/list` 只返回已经真实实现并有测试的工具。
- 默认 profile 是 `readonly`。
- 写入能力必须先落到 draft，不直接修改原始 EPUB。
- 导出、同步、批量修改、覆盖文件都必须有权限和确认。
- 测试必须使用临时 `READANY_HOME` / `AGENT_HOME`。
- 文档、命令、tool registry、测试必须保持一致。

## 功能清单

当前阶段判断以代码和 `tools/list` 为准。文档里写“后续”“必须完成”的工具，在真正实现、测试、注册之前，都不能出现在 MCP tool list 里。

### M1 - 只读外部 AI 入口

必须完成：

- 独立 `packages/cli` package。
- `readany --version`。
- `readany doctor --json`。
- `readany install` / `readany uninstall`。
- `readany skill install` / `readany skill uninstall` / `readany skill status --json`。
- `readany tools list --json`。
- 书籍、笔记、高亮、书签的只读 CLI 命令。
- indexed chapter view：`readany chapters list <book-id>`、`readany chapter get <book-id> <chapter-id>`。
- RAG 检索：`readany rag search <query> --book <book-id> --mode bm25|hybrid|vector`。BM25 总是可用；hybrid 在 embedding 未配置或失败时回退 BM25；vector 需要桌面端远程向量模型配置或 `READANY_EMBEDDING_MODEL` 环境配置。
- EPUB inspect：`readany epub inspect <book-id> --profile editor`。
- EPUB draft create：`readany epub draft create <book-id> --profile editor`。
- EPUB draft chapter read：`readany epub chapter read <draft-id> <chapter-id> --profile editor`。
- EPUB draft chapter patch：`readany epub chapter patch <draft-id> <chapter-id> --xhtml <file> --profile editor`。
- EPUB draft chapters batch patch：`readany epub chapters patch <draft-id> --patch <file> --profile editor`，先预检整个 JSON plan 的章节目标和 XHTML，再写入 draft，避免半批成功。
- EPUB draft metadata patch：`readany epub metadata patch <draft-id> --patch <file> --profile editor`。
- EPUB draft toc rebuild：`readany epub toc rebuild <draft-id> --profile editor`。
- EPUB draft history：`readany epub history <draft-id> --profile editor`。
- EPUB draft diff：`readany epub diff <draft-id> --profile editor`。
- EPUB draft validate：`readany epub validate <draft-id> --profile publisher`。
- EPUB draft export：`readany epub export <draft-id> --profile publisher --output <path>`。
- `readany mcp serve --profile readonly`。
- MCP `initialize`、`tools/list`、`tools/call`。
- MCP 只暴露真实实现的工具；当前除 `epub.inspect`、`epub.draft.create`、`epub.draft.discard`、`epub.chapter.read`、`epub.chapter.patch`、`epub.chapters.patch`、`epub.metadata.patch`、`epub.toc.rebuild`、`epub.history`、`epub.diff`、`epub.undo` 需要 editor profile，`notes.export`、`knowledge.export`、`epub.validate` 和 `epub.export` 需要 publisher profile 外，其余 MCP 工具都走 readonly profile。
- 最小审计日志：记录来源、动作、profile、是否成功、错误码，不记录正文。

M1 不包含：

- 后台 daemon。
- 移动端 CLI 管理。

完成线：

```text
外部 AI 可以发现 ReadAny，可以列书、搜书、读书籍元数据、搜笔记、高亮、已索引章节和 chunks。
readonly profile 无法调用任何写入工具。
```

当前状态：

- M1 主链路已经落地。
- 桌面设置页已经有 `外部 AI 访问` 入口。
- CLI 仍是 Node bundle，完整无 Node 依赖安装体验还需要后续 native binary 化或完整 runtime 打包。
- MCP 当前只暴露 `books.list`、`books.search`、`books.get`、`chapters.list`、`chapters.get`、`context.get`、`bookmarks.list`、`skills.list`、`notes.search`、`notes.export`、`knowledge.export`、`knowledge.search`、`highlights.search`、`rag.search`、`epub.inspect`、`epub.draft.create`、`epub.draft.discard`、`epub.chapter.read`、`epub.chapter.patch`、`epub.chapters.patch`、`epub.metadata.patch`、`epub.toc.rebuild`、`epub.history`、`epub.diff`、`epub.undo`、`epub.validate`、`epub.export`。

### M2 - 内容读取和知识检索

必须完成：

- `readany chapters list <book-id> --json`。
- `readany chapter get <book-id> <chapter-id> --chunk-start 1 --chunk-count 20 --json`。
- `readany context get --json`。
- `readany rag search <query> --book <book-id> --json`。
- MCP tools：`chapters.list`、`chapters.get`、`context.get`、`rag.search`。
- 当前书、当前章、选区上下文的资源表达。
- 大正文分页或范围读取，避免一次返回整本书。

完成线：

```text
外部 AI 可以基于真实章节内容和 RAG 结果回答问题，并能给出可回跳的引用位置。
```

其中 indexed chunks 章节视图、未索引 EPUB/PDF fallback、chunk range 读取、reader context snapshot 写入/读取、Reader AI 上下文摘要入口和 `rag.search` 的 BM25 / hybrid / vector 能力已经提前落地；桌面端 Chat 引用点击也已接入 Reader 回跳，支持 EPUB CFI、PDF `page:<n>` 和章节 fallback。M2 剩余重点是用真实 EPUB/PDF/RAG 样本补齐引用回跳端到端验收证据。

### M3 - AI 编辑和 EPUB 精排

必须完成：

- `readany epub draft create <book-id> --profile editor --json`。
- `readany epub chapter patch <draft-id> <chapter-id> --xhtml <file> --json`。
- `readany epub metadata patch <draft-id> --patch <file> --json`。
- `readany epub history <draft-id> --profile editor --json`。
- `readany epub diff <draft-id> --json`。
- `readany epub toc rebuild <draft-id> --json`。
- draft operation history。
- source/draft EPUB entry diff。
- patch 失败可回滚。
- batch chapter patch 必须先预检整批计划；任一章节目标或 XHTML 无效时不能写入任何章节。
- 原始 EPUB hash 不变。

完成线：

```text
AI 可以修当前章或全书 draft，用户可以查看 diff、撤销、继续编辑，原始文件不被修改。
```

### M4 - 导出和客户端集成

必须完成：

- `readany epub validate <draft-id> --json`。
- `readany epub export <draft-id> --output <path> --json`。
- `readany notes export <book-id> --output <path> --profile publisher --json`。
- knowledge export。
- 桌面客户端设置页：外部 AI 访问。
- 设置页可安装/卸载/修复 CLI。
- 设置页可安装/卸载 Skill。
- 设置页可复制 readonly MCP 配置。
- 设置页可查看 doctor 检查项和最近审计日志。
- 设置页可切换 profile，但高风险 profile 必须解释影响。

完成线：

```text
用户能从桌面客户端打开外部 AI 访问，完成 CLI/Skill/MCP 配置，并把 AI 修改后的 EPUB 导出为新文件。
```

### M5 - 完整可用

必须完成：

- macOS / Windows / Linux 安装体验稳定。
- 至少验证两个外部 agent，其中一个必须支持 MCP。
- 读、搜、整理、精排、导出闭环跑通。
- 审计日志可筛选、可查看失败原因。
- 文档和 UI 都明确解释权限边界。

完成线：

```text
普通用户不读命令行文档，也能在桌面客户端完成外部 AI 接入；高级用户和外部 agent 可以通过 CLI/MCP 使用完整能力。
```

最终交付归档建议：

- 需要把 strict M5 校验和 manifest / bundle 分开留痕时，用 `acceptance:finalize` + `acceptance:bundle`。
- 需要一条命令收口时，用 `acceptance:assemble`。它会先失败后停，不会在证据不完整时产出误导性的最终 bundle。

## 实现顺序

### 1. CLI 基础层

实现：

- package 构建。
- bin 入口。
- 命令解析。
- JSON/text 输出。
- 统一 `CommandResult`。
- path/profile 解析。

验收：

```bash
pnpm --filter @readany/cli check
pnpm --filter @readany/cli test
pnpm --filter @readany/cli build
node packages/cli/dist/bin/readany.js --version
node packages/cli/dist/bin/readany.js doctor --json
```

### 2. 数据读取层

实现：

- CLI 通过 Node platform adapter 调用 `@readany/core`。
- 只读命令使用真实本地数据库或测试 fixture。
- 返回结果分页，字段稳定。

验收：

```bash
node packages/cli/dist/bin/readany.js books list --json
node packages/cli/dist/bin/readany.js books search "keyword" --json
node packages/cli/dist/bin/readany.js book get <book-id> --json
node packages/cli/dist/bin/readany.js notes search "keyword" --json
node packages/cli/dist/bin/readany.js highlights search "keyword" --json
node packages/cli/dist/bin/readany.js rag search "keyword" --book <book-id> --json
```

### 3. Tool Registry 和 MCP

实现：

- 每个 tool 声明 name、description、scopes、risk、inputSchema。
- MCP `tools/list` 从 registry 生成。
- MCP `tools/call` 统一走权限检查。
- 未实现工具不能注册。

验收：

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n' \
  | node packages/cli/dist/bin/readany.js mcp serve --profile readonly

printf '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n' \
  | node packages/cli/dist/bin/readany.js mcp serve --profile readonly
```

必须检查：

- 返回列表只包含真实工具。
- `readonly` profile 调写工具返回 `permission_denied`。
- 错误响应可被外部 agent 解析。

### 4. Skill 安装器

实现：

- 安装到 `$AGENT_HOME/skills/readany` 或 `~/.agent/skills/readany`。
- `agent setup --client codex|claude|cursor|opencode` 额外验证客户端目录的 managed symlink；`agent setup --client all` 验证所有已知 symlink 和 `~/.agents` 兼容链接。
- Skill 内容包含 MCP 配置、权限边界、draft-first 规则。
- 卸载只删除 ReadAny 管理的文件。

验收：

```bash
AGENT_HOME="$(mktemp -d)" node packages/cli/dist/bin/readany.js skill install
AGENT_HOME="$(mktemp -d)" node packages/cli/dist/bin/readany.js skill status --json
AGENT_HOME="$(mktemp -d)" node packages/cli/dist/bin/readany.js skill uninstall
```

### 5. Desktop 设置页

实现：

- 入口：`设置 -> 外部 AI 访问`。
- 调用 Tauri command 或随包 CLI 执行 doctor/install/skill 命令。
- 展示 CLI、Skill、MCP、profile、审计日志状态。
- 提供 readonly MCP 配置复制。
- install/uninstall 优先使用桌面包资源中的 CLI，再回退到开发仓库 CLI 和 PATH。

验收：

- 未安装 CLI 时显示可安装状态。
- 已安装 CLI 时显示版本。
- `doctor --json` 失败项可读。
- Skill 可安装和卸载。
- MCP 配置复制后可在外部 agent 使用。
- 未全局安装 `readany` 时，桌面端仍可通过随包 CLI 安装用户级 shim。

当前工程状态：

- Tauri 已配置把 `packages/cli/dist/` 打包到 `readany-cli/` 资源目录。
- Tauri `beforeBuildCommand` 已配置先构建 `@readany/cli` 再构建 app，避免打包资源缺少 CLI dist；Rust preflight 测试会校验这个命令、资源映射和 `readany-cli/bin/readany.js` resolver 路径。
- 受限 Tauri command 会优先解析 `READANY_DESKTOP_CLI_BIN`、bundle resource、开发仓库 CLI，然后才使用 PATH 中的 `readany`。
- CLI 仍是 Node bundle。管理命令已经懒加载数据层，不需要 `better-sqlite3`；书库读取和 MCP 数据工具仍需要 Node / native module 运行时，完整无 Node 依赖的用户体验需要后续 native binary 化。

### 6. Draft 和 Export

实现：

- EPUB inspect 先读结构，不改文件。
- draft create 复制受控资源到 draft workspace。
- patch 只改 draft。
- validate 通过后才能 export。
- export 默认输出新文件，不覆盖原文件。

验收：

```bash
ORIGINAL_HASH="$(shasum -a 256 sample.epub)"
readany epub draft create <book-id> --profile editor --json
readany epub chapter patch <draft-id> <chapter-id> --xhtml chapter.xhtml --json
readany epub metadata patch <draft-id> --patch metadata.json --json
readany epub validate <draft-id> --json
readany epub export <draft-id> --output exported.epub --json
shasum -a 256 sample.epub
```

必须确认：

- 原始 hash 不变。
- draft history 有记录。
- diff 可查看。
- 导出 EPUB 可重新导入 ReadAny。

## 测试策略

### 单元测试

覆盖：

- 命令解析。
- profile/scope 权限。
- path 解析。
- tool registry schema。
- skill 安装/卸载。
- draft operation 记录。

要求：

- 不访问真实用户目录。
- 不依赖真实书库。
- 对错误码做断言。

### 集成测试

覆盖：

- CLI 调 core 查询。
- MCP stdio 请求/响应。
- readonly 权限拒绝写工具。
- Skill 安装到临时 `AGENT_HOME`。
- 审计日志写入临时 `READANY_HOME`。

要求：

- 测试 seed 数据可重复。
- 测试不能因为本机已有 ReadAny 数据而通过。

### E2E 测试

覆盖：

- 安装/卸载 CLI。
- doctor。
- MCP tools/list 和 tools/call。
- 设置页外部 AI 访问。
- draft patch。
- EPUB validate/export。

建议 fixtures：

```text
packages/cli/fixtures/library/
packages/cli/fixtures/books/minimal.epub
packages/cli/fixtures/books/broken-toc.epub
packages/cli/fixtures/patches/chapter-title.patch.json
```

### 手工验收

每个 milestone 至少留一份验收记录：

```text
docs/readany-cli/acceptance/YYYY-MM-DD-Mx.md
```

记录内容：

- 分支和 commit。
- 操作系统。
- Node/pnpm 版本。
- 执行命令。
- 结果摘要。
- 已知问题。
- 是否通过。

M5 结束前不要只停在 Markdown 记录；还需要：

- 用 `acceptance:validate --strict-m5` 跑完整组合 evidence
- 用 `acceptance:finalize` 产出最终 manifest

## 必须保留的验收证据

M1：

- `pnpm --filter @readany/cli check` 输出通过。
- `pnpm --filter @readany/cli test` 输出通过。
- `pnpm --filter @readany/cli build` 输出通过。
- build smoke 覆盖构建后 CLI 的 MCP stdio `initialize`、`tools/list`、`tools/call`。
- `tools/list` 不包含未实现工具。
- readonly 权限拒绝写工具的测试。

M2：

- sample EPUB 章节列表和章节正文读取结果。
- RAG 搜索结果包含引用位置。
- vector / hybrid RAG 模式有配置和失败回退测试。
- 大正文分页测试。

M3：

- 原始 EPUB hash 前后一致。
- draft history 样例。
- patch diff 样例。
- rollback/undo 测试。

M4：

- 导出 EPUB 重新导入成功。
- 设置页截图或测试记录。
- MCP 配置复制后在外部 agent 成功列 tools。

## 不通过条件

出现以下任一情况，本阶段不算完成：

- MCP 暴露规划中但未实现的工具。
- 文档说已支持，但 CLI help、registry 或测试没有对应实现。
- 测试读取真实用户书库。
- `readonly` profile 能写入、导出或同步。
- patch 直接修改原始 EPUB。
- export 默认覆盖原始文件。
- Skill 卸载删除非 ReadAny 管理内容。
- 审计日志记录完整正文、密钥或同步凭证。
- 设置页让用户误以为安装 Skill 等于授权写入。

## Issue 拆分建议

建议按 milestone 拆 issue，不要把完整 CLI 放进一个巨大 issue。

### Issue 1 - M1 readonly CLI and MCP

范围：

- CLI package。
- doctor/install/uninstall。
- readonly data commands。
- BM25 RAG search over existing chunks。
- MCP initialize/tools/list/tools/call。
- skill install/status/uninstall。

验收：

- CLI check/test/build 通过。
- MCP readonly smoke 通过。
- tools/list 只包含真实工具。

建议 issue 正文：

```md
## 背景

ReadAny 需要一个本地 CLI/MCP 入口，让外部 AI 在 readonly profile 下安全读取书库、笔记和高亮。

## 范围

- `packages/cli`
- `readany doctor/install/uninstall`
- `readany skill install/uninstall/status`
- `readany books/list/search`
- `readany book get`
- `readany notes search`
- `readany highlights search`
- `readany rag search --book <book-id>`
- `readany mcp serve --profile readonly`
- 最小审计日志

## 不做

- vector / hybrid RAG
- EPUB draft/edit/export
- 任意 shell
- 任意 SQL

## 验收

- `pnpm --filter @readany/cli check`
- `pnpm --filter @readany/cli test`
- `pnpm --filter @readany/cli build`
- `readany tools list --json` 只包含真实工具
- readonly profile 无写入能力
- 测试使用临时 `READANY_HOME` / `AGENT_HOME`
```

### Issue 2 - Desktop External AI Access settings

范围：

- 设置页入口。
- CLI/Skill/MCP 状态。
- doctor 结果展示。
- readonly MCP 配置复制。

验收：

- 用户能在桌面客户端完成 M1 配置。

建议 issue 正文：

```md
## 背景

用户不应该手写复杂配置。桌面客户端需要提供外部 AI 访问入口，管理 CLI、Skill 和 readonly MCP 配置。

## 范围

- `设置 -> 外部 AI 访问`
- CLI doctor/install/uninstall
- Skill install/uninstall/status
- readonly MCP 配置复制
- 清楚解释权限边界

## 不做

- 移动端安装 CLI
- editor/publisher profile 默认开放
- 常驻 daemon

## 验收

- 设置页能运行 doctor
- 设置页能安装/卸载 Skill
- 设置页能复制 readonly MCP 配置
- 未全局安装 CLI 时，桌面端优先使用随包 CLI
- 页面明确说明安装 Skill 不等于授权写入
```

### Issue 3 - Content and RAG

范围：

- 章节目录。
- 章节正文。
- RAG search。
- 引用定位。

验收：

- 外部 AI 可基于真实正文和引用回答问题。

建议 issue 正文：

```md
## 背景

只读元数据不足以支撑外部 AI 深度阅读。M2 需要开放真实章节内容和完整 RAG 检索，但仍保持 readonly。当前 indexed chunks 章节视图和未索引 EPUB/PDF fallback 已经可用，剩余重点是更完整的上下文资源和 vector / hybrid RAG。

## 范围

- 未索引 PDF 的 fallback 页级或章节级正文
- `chapters.list`、`chapters.get` 的未索引 EPUB fallback 回归覆盖
- `readany rag search <query> --book <book-id>` 的 vector / hybrid 模式
- MCP: `chapters.list`、`chapters.get` 的 fallback 回归覆盖，以及 `rag.search` 的完整模式
- 分页、范围读取、引用定位

## 不做

- 修改章节
- 生成 draft
- 导出 EPUB

## 验收

- 工具返回真实 EPUB fallback、PDF fallback 或索引内容，不返回 mock
- RAG 结果包含 book/chapter/chunk 引用
- BM25 模式保持可用，vector / hybrid 模式有配置和回退测试
- 大正文有分页或范围控制
- `tools/list` 只在实现和测试通过后新增工具
```

### Issue 4 - EPUB draft editing

范围：

- inspect 后续增强。
- draft create。
- chapter/metadata/toc patch。
- diff/undo/history。

验收：

- AI 能修改 draft，原 EPUB 不变。

建议 issue 正文：

```md
## 背景

外部 AI 要能修当前章或修全书，但不能直接覆盖原始 EPUB。所有编辑必须 draft-first。

## 范围

- `epub.inspect` 已有只读结构检查版本；本 issue 范围是把它接入 draft 编辑链路，并补齐后续 draft/diff/history 能力
- `epub.draft.create`
- `epub.chapter.patch`
- `epub.chapters.patch`
- `epub.metadata.patch`
- `epub.toc.rebuild`
- `epub.diff`
- operation history

## 不做

- 默认覆盖原文件
- 未授权导出
- 批量静默修改真实书库

## 验收

- 原始 EPUB hash 不变
- 每次 patch 有 history
- 用户能查看 diff
- readonly profile 调写工具失败
- patch 失败可以回滚或丢弃 draft
```

### Issue 5 - Export and publish

范围：

- validate。
- export。
- `notes.export`。
- knowledge export。

验收：

- 修改后的 EPUB 可导出并重新导入。

建议 issue 正文：

```md
## 背景

draft 编辑完成后，用户需要校验并导出新文件，形成完整出版闭环。

## 范围

- `epub.validate`
- `epub.export`
- `notes.export`
- knowledge export
- 导出审计

## 不做

- 默认覆盖源文件
- 无确认写入任意目录
- 暴露同步凭证或本地敏感路径

## 验收

- 导出 EPUB 可重新导入 ReadAny
- 导出默认生成新文件
- 审计日志记录导出
- publisher profile 才能导出
- 设置页能让用户理解导出风险
```
