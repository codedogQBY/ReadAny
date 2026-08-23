# ReadAny CLI / External AI Access

这组文档定义 ReadAny 的本地 CLI、MCP 服务、Skill 安装器，以及桌面客户端中的外部 AI 访问入口和用户精排入口。

目标是把 ReadAny 的本地能力开放给外部 AI，但开放的是受控工具，不是裸数据、裸数据库、任意文件系统或任意 shell。用户自己编辑和 AI 自动编辑必须落在同一套 draft / history / diff 体系里。

文档目录：

- [00-overview-and-acceptance.md](00-overview-and-acceptance.md)
- [08-execution-guide.md](08-execution-guide.md)
- [01-product-scope.md](01-product-scope.md)
- [02-architecture-security.md](02-architecture-security.md)
- [03-implementation-roadmap.md](03-implementation-roadmap.md)
- [04-testing-acceptance.md](04-testing-acceptance.md)
- [05-command-and-tool-spec.md](05-command-and-tool-spec.md)
- [06-client-settings.md](06-client-settings.md)
- [07-delivery-playbook.md](07-delivery-playbook.md)
- [09-delivery-acceptance-contract.md](09-delivery-acceptance-contract.md)
- [10-feature-delivery-spec.md](10-feature-delivery-spec.md)
- [11-implementation-issue.md](11-implementation-issue.md)
- [12-delivery-blueprint.md](12-delivery-blueprint.md)
- [acceptance/TEMPLATE.md](acceptance/TEMPLATE.md)

建议阅读顺序：

1. 先读 [12-delivery-blueprint.md](12-delivery-blueprint.md)：这是一份可以直接执行的主蓝图，覆盖怎么做、需要什么功能、怎么测试、怎么验收、做到什么程度为止。
2. 再读 [00-overview-and-acceptance.md](00-overview-and-acceptance.md)：确认目标、功能范围、分层、测试、验收和停止线。
3. 开 issue 时读 [11-implementation-issue.md](11-implementation-issue.md)：可以直接复制为工程 issue 正文。
4. 做验收时读 [09-delivery-acceptance-contract.md](09-delivery-acceptance-contract.md) 和 [acceptance/TEMPLATE.md](acceptance/TEMPLATE.md)。

## 当前状态

分支：`feat/readany-cli`

已落地的最小能力：

- `packages/cli` 是独立 package。
- CLI 可构建、可测试，并提供 `readany` bin。
- 已支持 `doctor`、`install`、`uninstall`、`skill install/update/uninstall/status`；`doctor --json` 会报告 Node runtime、`better-sqlite3` 可解析性和 CLI distribution（Node script、built bundle、桌面资源包、native binary 标记），便于区分“管理命令可用”、“书库/MCP 数据命令可用”和“当前分发形态是否满足 runtime/bundle 验收”。
- 已支持只读库查询：书籍、笔记、高亮、书签、skills。
- 已支持 chapter view：`readany chapters list`、`readany chapter get` 和 MCP `chapters.*` 会优先返回 indexed chunks；没有 chunks 且书籍是 EPUB/PDF 时，会 fallback 到真实 EPUB spine/manifest 或 PDF page text 读取章节目录和正文。
- 已支持 reader context snapshot：`readany context get` 和 MCP `context.get` 可只读返回桌面端写入的当前书、当前章、位置、选区、可见正文和最近高亮快照，并带内容长度限制。
- 已支持 RAG 检索：基于已有 chunks 索引的 `readany rag search --book <book-id> --mode bm25|hybrid|vector` 和 MCP `rag.search`。BM25 总是可用；hybrid 在没有 embedding 配置时会安全回退到 BM25；vector 需要桌面端远程向量模型配置或 `READANY_EMBEDDING_MODEL` 环境配置。
- 已支持 knowledge search：`readany knowledge search <query>` 和 MCP `knowledge.search` 可聚合搜索书籍 metadata、notes 和 highlights，返回有限 snippet 和 book/note/highlight/cfi 引用。
- 桌面端 Chat 引用点击已可打开对应书籍并回跳到 EPUB CFI、PDF `page:<n>` 或章节 fallback；后续还需要用真实样本补齐端到端验收记录。
- 已支持 EPUB inspect：`readany epub inspect <book-id> --profile editor` 和 MCP `epub.inspect` 可读取 EPUB package、metadata、manifest、spine、toc 结构。
- 已支持 EPUB draft create：`readany epub draft create <book-id> --profile editor` 和 MCP `epub.draft.create` 会复制原 EPUB 到受控 draft workspace，写入 manifest/history，不修改原文件。
- 已支持 EPUB draft chapter read：`readany epub chapter read <draft-id> <chapter-id> --profile editor` 和 MCP `epub.chapter.read` 默认可从 draft 读取可读文本，也可通过 `--format xhtml` / `contentFormat: "xhtml"` 读取完整 XHTML，带内容长度限制。
- 已支持 EPUB draft chapter patch：`readany epub chapter patch <draft-id> <chapter-id> --xhtml <file> --profile editor` 和 MCP `epub.chapter.patch` 可替换 draft 内单个 XHTML 章节资源，写入 history，不修改原文件。
- 已支持 EPUB draft chapters batch patch：`readany epub chapters patch <draft-id> --patch <file> --profile editor` 和 MCP `epub.chapters.patch` 可按受限 JSON plan 批量替换 draft 章节；每个章节仍通过 `epub.chapter.patch` history 路径记录，不修改原文件。
- 已支持 EPUB draft metadata patch：`readany epub metadata patch <draft-id> --patch <file> --profile editor` 和 MCP `epub.metadata.patch` 可修改 draft OPF metadata，写入 history，不修改原文件。
- 已支持 EPUB draft toc rebuild：`readany epub toc rebuild <draft-id> --profile editor` 和 MCP `epub.toc.rebuild` 可基于 spine XHTML 章节重建 EPUB3 nav 目录，写入 history，不修改原文件。
- 已支持 EPUB draft history：`readany epub history <draft-id> --profile editor` 和 MCP `epub.history` 可读取 draft operation history。
- 已支持 EPUB draft diff：`readany epub diff <draft-id> --profile editor` 和 MCP `epub.diff` 可比较 source/draft EPUB entry 的 hash 和 size。
- 已支持 EPUB draft undo：`readany epub undo <draft-id> <operation-id> --profile editor` 和 MCP `epub.undo` 可撤销最近的 chapter / metadata / toc patch，并写入 undo history。
- 已支持 EPUB draft validate：`readany epub validate <draft-id> --profile publisher` 和 MCP `epub.validate` 可校验 active draft 的结构、metadata、spine、toc 和资源引用，不修改文件、不导出文件。
- 已支持 EPUB draft export：`readany epub export <draft-id> --output <path> --profile publisher` 和 MCP `epub.export` 会先校验 active draft，再导出为新 EPUB，默认不覆盖已有文件、不修改原书。
- 已支持 notes export：`readany notes export <book-id> --output <path> --profile publisher` 和 MCP `notes.export` 可导出单本书的 notes / highlights 到 Markdown、JSON、Obsidian 或 Notion 格式。
- 已支持 knowledge export：`readany knowledge export --output <path> --profile publisher` 和 MCP `knowledge.export` 可导出全库书籍 metadata、notes、highlights 到 Markdown、JSON 或 Obsidian 文件，默认不覆盖已有文件，响应只返回输出元数据。
- 已支持 stdio MCP：`initialize`、`tools/list`、`tools/call`。
- 已支持 MCP 配置生成：`readany mcp config --profile readonly --client generic --json` 可输出外部 agent 可复制的 `mcpServers.readany` 片段；`--client codex` 可输出 Codex `config.toml` TOML snippet，`claude` / `cursor` 复用 JSON `mcpServers` 片段，`opencode` 输出 OpenCode `opencode.json` 可用的 `mcp.readany` 片段。该命令不启动服务、不改变授权、不出现在 MCP `tools/list`。
- 已支持一次性 agent bootstrap：`readany agent setup --user --client all --profile readonly --json` 安装 CLI / canonical skill，并把 skill 链接到 Codex、Claude、Cursor、OpenCode 和 `~/.agents` 兼容目录；MCP 配置仍按具体客户端使用返回的 `mcpConfigs[].snippet`。
- 已支持 MCP doctor 诊断：`readany doctor --json` 会输出默认 MCP serve args、支持的 profile/client 和工具数量，方便设置页、外部 agent 和打包矩阵采证。
- 已支持可复现外部 agent smoke：`pnpm --filter @readany/cli build && pnpm --filter @readany/cli smoke:agent` 会通过 built CLI 验证可复制 MCP 配置片段，并通过 stdio MCP 跑 readonly 发现/搜索、MCP tools/list 安全元数据、PDF fallback 章节读取、editor draft 批量章节修改、toc rebuild、publisher validate/export、原 EPUB hash 不变，以及导出 EPUB 重新入库后的 inspect / chapter read 检查。
- 已支持真实样本验收辅助脚本：`pnpm --filter @readany/cli acceptance:real -- --book <book-id> --rag-query <query> --evidence <file>` 会使用 built CLI 对指定真实书库样本执行 doctor、books/chapter/RAG/knowledge/context 检查，在 stdout 输出脱敏摘要，并在 evidence JSON 中记录运行环境、`doctor --json` 诊断、样本书文件路径、字节数、SHA-256、可回跳 citation targets 和仍需人工验收的 M5 清单；清单项带建议补证内容和命令。默认只读，只有显式 `--draft-export --export-dir <dir>` 才会创建 EPUB draft、validate、export、inspect 导出 EPUB，并默认 discard draft 清理工作区。
- 已支持真实外部 agent 验收采证：`pnpm --filter @readany/cli acceptance:agent -- --client Codex --client-version <version> --profile readonly/editor/publisher --uses-mcp --mcp-config <redacted-config> --tools-list-summary "<summary>" --tool-count <n> --read-flow "<summary>" --readonly-denial "<summary>" --draft-export-flow "<summary>" --evidence <file>` 会把 Codex / Claude Desktop / Cursor 等真实客户端的手工验收结果记录成结构化 evidence，并拦截明显未脱敏密钥。该证据只代表单个真实客户端，不替代至少两个外部 agent 的 strict M5 表格要求。
- 已支持桌面设置页验收采证：桌面端 `设置 -> 外部 AI 访问 -> 复制证据` 会复制 CLI、doctor distribution、Skill、MCP、tools 和最近操作的脱敏快照；`pnpm --filter @readany/cli acceptance:desktop -- --snapshot <snapshot.json> --screenshot <path> --evidence <file>` 可把这份快照整理成可校验 evidence。该证据用于关闭 `desktop-settings` 人工项，不替代真实外部 agent 或三平台打包矩阵。
- 已支持单平台打包验收采证：`pnpm --filter @readany/cli acceptance:packaged -- --package-source <artifact> --evidence <file>` 会对安装后 CLI 或指定 `--cli` 执行 version、doctor、tools list、MCP config、readonly MCP initialize/tools/list、skill status，并记录 runtime/distribution、MCP safety metadata 和平台来源；`--repair-bin-dir <tmp-bin>` 才会在临时 bin 目录里验证 CLI repair，避免默认碰真实用户 PATH；`--with-skill-install` 才会执行 skill install/status/uninstall，建议配临时 `--agent-home`；`--draft-export --book <epub-book-id> --export-dir <dir>` 才会额外创建 draft、validate、export、检查导出 EPUB 结构并清理 draft。该证据只补单平台矩阵，不替代真实样本、真实外部 agent 或最终 strict M5 记录。
- 已支持 acceptance workspace bootstrap：`pnpm --filter @readany/cli acceptance:init -- --workspace <dir>` 会搭好 `record.md`、`evidence/`、`bundle/`、`exports/` 和 `logs/`，并附带 README 与 `workspace.json`，把真实 M5 采证从“先手工搭目录”变成一个固定起手式。
- `acceptance:init` 支持在 `workspace.json` 里写入默认 `milestone`、`reviewer`、`release` 和 `desktopPackage`；后续 `acceptance:scaffold`、`acceptance:finalize`、`acceptance:bundle` 和 `acceptance:assemble` 会在未显式传参时继承这些默认值。
- `acceptance:real`、`acceptance:agent`、`acceptance:desktop` 和 `acceptance:packaged` 现在也支持 `--workspace <dir>`：它们会自动把输出写到 `workspace.json` 里约定的 evidence 文件，不再要求每次都手输 `--evidence` 路径。`agent` 会按客户端名自动落到 `agent-codex.json` 或 `agent-second-client.json`；`packaged` 会按 `--platform` 自动落到 macOS / Windows / Linux 对应 evidence。
- `acceptance:status` 在传 `--workspace <dir>` 时也会优先给出 workspace-first 的下一步命令：缺证据时推荐继续往同一个 workspace 里采证；证据齐全后推荐直接用 `acceptance:validate --workspace ... --strict-m5` 和 `acceptance:assemble --workspace ...` 收口。
- 已支持验收记录草稿生成：`pnpm --filter @readany/cli acceptance:scaffold -- --evidence <evidence.json> --output <record.md>` 会把真实 evidence 中的 SHA、citation、doctor distribution 和人工补证项写入 partial 记录草稿，减少手工填表漏锚点；如果再传 `--agent-evidence <agent.json>`、`--desktop-evidence <desktop.json>` 和 `--packaged-evidence <platform.json>`，还会把真实外部客户端、桌面设置页和单平台 packaged 证据分别预填到对应表格里，但不会把缺失客户端或 macOS / Windows / Linux 三平台自动判成通过。
- 已支持验收 readiness 汇总：`pnpm --filter @readany/cli acceptance:status -- --record <record.md> --evidence <evidence.json> ...` 会汇总当前 evidence 类型、外部 agent 客户端、MCP 覆盖和 packaged 平台覆盖情况，直接告诉你离 strict M5 还缺哪些证据，并给出建议的下一步命令，适合作为最终收口前的缺口扫描。
- 已支持验收记录校验脚本：`pnpm --filter @readany/cli acceptance:validate -- --record <record.md> --evidence <evidence.json>` 可检查验收记录和 evidence 结构，`--evidence` 可重复传入 real / agent / desktop / packaged 多类证据；最终 M5 记录必须加 `--strict-m5` 并传完整组合证据，阻止只靠 Markdown 表格或 partial record 被误当作完成。
- 已支持最终验收 manifest：`pnpm --filter @readany/cli acceptance:finalize -- --record <record.md> --evidence <evidence.json> ... --output <manifest.json>` 会先跑 strict M5 组合证据校验，只有通过后才写出包含 record/evidence SHA-256、git commit、验证结果和证据类型摘要的归档 manifest。
- 已支持最终验收包目录：`pnpm --filter @readany/cli acceptance:bundle -- --record <record.md> --manifest <manifest.json> --evidence <evidence.json> ... --output-dir <bundle-dir>` 会先校验 manifest 与 record/evidence 的 path/SHA-256/bytes 一致性，再把最终 record、manifest 和所有 evidence 复制到一个可归档目录，并生成带 source/target/SHA-256/bytes 清单的 `index.json`。
- 已支持归档包复验：`pnpm --filter @readany/cli acceptance:verify-bundle -- --bundle-dir <bundle-dir>` 会独立检查 bundle 目录里的 `index.json`、`record.md`、`manifest.json` 和 evidence 文件是否彼此匹配，并重跑 strict M5 复验；如果 `manifest.json` 里带有 bundle 复验信息，也会一并校验，适合交接、上传后抽检或 CI 二次校验。
- 已支持一键最终归档：`pnpm --filter @readany/cli acceptance:assemble -- --record <record.md> --evidence <evidence.json> ... --output-dir <bundle-dir>` 会先执行 strict M5 校验，再在 bundle 目录里生成 `final-manifest.json`，随后复制出最终 `record.md`、`manifest.json`、`index.json` 和全部 evidence，并自动跑一遍 `acceptance:verify-bundle`；复验结果也会写回 `final-manifest.json`，适合作为发布前最后一步。
- 已支持本地 release preflight：`pnpm cli:preflight` 会顺序执行 CLI check/test/build、built CLI external agent smoke、Tauri CLI bridge tests 和 `cargo check`；`pnpm cli:preflight:full` 会额外执行桌面 app build，后续 release CI 可以复用这个入口。
- MCP 当前只暴露真实实现的工具：`books.list`、`books.search`、`books.get`、`chapters.list`、`chapters.get`、`context.get`、`bookmarks.list`、`skills.list`、`notes.search`、`notes.export`、`knowledge.export`、`knowledge.search`、`highlights.search`、`rag.search`、`epub.inspect`、`epub.draft.create`、`epub.draft.discard`、`epub.chapter.read`、`epub.chapter.patch`、`epub.chapters.patch`、`epub.metadata.patch`、`epub.toc.rebuild`、`epub.history`、`epub.diff`、`epub.undo`、`epub.validate`、`epub.export`。
- 桌面客户端已增加 `设置 -> 外部 AI 访问`，可检测 CLI、运行 doctor、管理 Skill、通过受限 `mcp_config` action 复制 CLI 生成的 MCP 配置；这些管理动作会优先使用桌面包内的 CLI，用户还未安装全局 `readany` 时也能完成诊断和安装。默认 readonly，editor / publisher 需要用户显式选择并确认风险后才可复制。设置页也可查看最近 CLI/MCP 审计元数据，支持 source / failed / action prefix / date / limit 受限筛选和失败错误码摘要。
- Tauri 打包前置命令已改为先构建 `@readany/cli`，再构建 app；`packages/cli/dist/` 会作为 `readany-cli/` 资源进入桌面包，Rust preflight 测试会校验前置命令、资源映射和 bundle resolver 路径一致。
- 用户精排入口不放在设置页；书籍详情页已接入创建精排草稿，并可打开 EPUB draft 工作区查看 history、entry-level diff 和 validate 结果；工作区也可通过受限 action 执行章节 XHTML 读取/保存、元数据编辑、toc rebuild、undo、discard 和 export；设置页只负责接入和权限管理。

尚未落地的能力不能出现在 MCP `tools/list` 中：

- `notes.export` 只导出单本书的 notes/highlights；`knowledge.export` 只导出全库知识文件；`epub.toc.rebuild` 只重建 EPUB3 nav 目录；`epub.inspect` 只是只读结构检查；`epub.draft.create` 只创建受控 draft；`epub.draft.discard` 只标记 draft inactive；`epub.chapter.read` 默认读取 draft 可读文本，`xhtml` 模式才返回完整章节 XHTML；`epub.chapter.patch` 只替换 draft 内单章 XHTML；`epub.chapters.patch` 只接受 1-50 个章节替换计划并逐章写入普通 `epub.chapter.patch` history；`epub.metadata.patch` 只修改 draft OPF metadata；`epub.history` 只读取 operation history；`epub.diff` 只比较 source/draft EPUB entry 的 hash 和 size；`epub.undo` 只撤销已记录且未被后续改动覆盖的 patch；`epub.validate` 只做结构和引用校验；`epub.export` 只导出 active valid draft 为新 EPUB，不生成内容级 diff、不覆盖原书。
- 随桌面安装包携带并注册 CLI binary。
- native binary / runtime bundle 安装体验。
- 真实 EPUB/PDF/RAG 样本的端到端验收记录；`acceptance:real` 会记录样本文件 SHA-256，但不能替代真实样本来源说明、外部 agent 和打包矩阵记录。
- Codex / Claude Desktop / Cursor 等真实外部 agent 手工验收。
- macOS / Windows / Linux 打包后安装、Skill、MCP、draft export 的完整矩阵验收。

## 设计原则

- 暂不实现任意 shell 执行。
- 暂不开放裸数据库直连给外部 AI。
- 默认只读，写入必须走 draft / profile / confirmation。
- MCP 工具清单必须诚实，只暴露已经真实接线的能力。
- 原始书籍、数据库、同步配置和凭证不会被默认写入或暴露。
- CLI 是独立 package，支持自安装、自卸载和自诊断；Skill 只安装到通用 agent 目录，不进入项目目录。

## 最终交付线

- 用户安装桌面客户端后，可以通过设置页安装、卸载、修复 CLI。
- CLI 可以独立运行 `doctor`、`mcp serve`、`skill install`、`skill update`、`skill uninstall`。
- 外部 AI 可以通过 MCP 读取书库、内容、笔记和知识库。
- 外部 AI 可以在授权 profile 下创建 draft、修改 draft、导出新文件。
- 用户可以在 draft 工作区里手动改章节、改元数据、看 diff、撤销修改，再交给 AI 继续编辑。
- 所有写入、导出、同步类动作都有权限、确认和审计。

## 本轮文档要回答的问题

1. 我们要做哪些功能。
2. 每个功能该放在哪一层做。
3. 每一阶段怎么实现。
4. 每一阶段怎么测试。
5. 到什么程度算验收通过。

如果只读一份文档，先读 [00-overview-and-acceptance.md](00-overview-and-acceptance.md)。如果要直接拆任务、写测试和验收记录，读 [10-feature-delivery-spec.md](10-feature-delivery-spec.md)。如果要把这件事贴成一个工程 issue，读 [11-implementation-issue.md](11-implementation-issue.md)。
