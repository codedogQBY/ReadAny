# 贡献指南 / Contributing

ReadAny 当前以维护为先。维护者已批准两周作战计划，重点准备维护版 **v1.3.7**。该版本**尚未发布**（当前正式版为 [v1.3.6](https://github.com/codedogQBY/ReadAny/releases/tag/v1.3.6)），只修同步、导入、阅读进度和打开失败。安排、SLA 与志愿者征集见 [维护公告（草稿）](docs/MAINTENANCE.md)。

英文说明见 [English](#english)。

## 如何提 Issue

1. 先搜索 [已有 Issue](https://github.com/codedogQBY/ReadAny/issues)，避免重复。
2. 使用模板，不要留空标题：
   - **Bug**：平台、应用版本、复现步骤、期望行为、实际行为。
   - **Feature / Suggestion**：动机，以及这次希望做的范围（包含什么、不包含什么）。
3. 版本写你正在使用的版本。正式安装包请写关于页中的版本号（当前正式版为 v1.3.6）。关于页若显示 1.3.7，请说明这是源码构建，并附上分支或提交。不要把未发布的 v1.3.7 当成已经发行的安装包。
4. 不要粘贴 API Key、WebDAV 密码、账号或私人笔记正文。截图请打码。

信息不足时，维护者或 triage 志愿者会标 `status:needs-info`。补全平台、版本和最小复现后，Issue 才能继续判断。

## PR 范围

- 一个 PR 只做一件事，并保持小步。顺手重构、无关格式化和大范围重命名请拆出去。
- 关联已有 Issue，在描述里写 `Fixes #编号`（或 `Refs #编号`，若该 PR 不能单独关闭 Issue）。没有 Issue 的小修（错别字、注释）可以例外，并在 PR 里说明。
- 新的 AI provider，以及跨多个模块的大功能，**先开 Issue 并附上设计，再写代码**。见下一节。
- 只有同步、导入、阅读进度、打开失败的修复才适合建议进入 v1.3.7。功能、新 provider 和重构走常规版本。v1.3.7 尚未发布，PR 只表示「建议纳入」，不能当成已经进版。

## 手测冒烟

改动阅读、书库、导入、进度或同步时，至少走通这条路径，并把结果写进 PR：

1. **导入一本书**（EPUB 即可；若 PR 只影响某一种格式，改用该格式）。
2. **翻页**，确认能离开首页。
3. **进度保存**：退出书籍或应用后再打开，仍停在刚才的位置。
4. **同步抽检**：若本次改动涉及同步、导入、进度或打开书籍，对可用的同步后端做一次小范围上传/下载检查。没有同步环境时，写明未测以及原因。

纯文档、纯测试或不触及上述路径的改动，可以说明为何不需要这条冒烟。提交前在能够运行的环境里执行 `pnpm lint`。

## 新 AI provider 与大功能

接入新的模型服务商，或改动会跨阅读器、同步、AI、书库等多个模块时：

1. 先开 **Feature / Suggestion** Issue，写清动机和范围（含非目标）。
2. 在同一 Issue 或 `docs/` 中附上短设计：要解决的问题、建议做法、不做什么、影响的包、风险。
3. 设计未写清时，Issue 会标 `status:needs-design`。在此之前不要提交实现 PR。
4. 设计对齐后，再按小步拆 PR，每步仍关联该 Issue。

## 脏 PR 需要 rebase

分支与 `main` 冲突，或被标上 `status:needs-rebase` 时：

1. 把该 PR 分支 rebase 到最新 `main`。
2. 解决冲突后推送分支，并留言说明已 rebase。
3. 冲突未解决前，不要继续堆功能提交。

维护者默认要求 rebase，而不是把 `main` 合并进功能分支来掩盖冲突。rebase 完成、冲突消失后，由维护者去掉 `status:needs-rebase`。

## 标签约定

标签由维护者或 triage 志愿者添加。报告者不必自己打全；拿不准 `priority:p0` 时不要猜，留言说明影响范围即可。

| 标签 | 含义 |
| --- | --- |
| `priority:p0` | 应用不可用、数据丢失，或核心流程对很多用户中断 |
| `priority:p1` | 重要功能损坏，或主要平台 / 工作流回退 |
| `priority:p2` | 范围明确的修复或改进，可排期 |
| `priority:p3` | 打磨、长期想法、待确认，或已有处理方式 |
| `status:needs-rebase` | PR 有冲突或已落后到无法审阅，作者需先 rebase |
| `status:needs-design` | 实现前需要设计说明 |
| `status:needs-info` | 等待报告者补充信息 |
| `status:stale` | 长期无活动 |
| `type:regression` | 以前可用，某次改动后损坏 |
| `type:crash` | 崩溃、卡死或被系统杀掉 |
| `type:security` | 安全漏洞或敏感数据风险 |
| `bug` / `enhancement` | 缺陷 / 功能或建议 |
| `area:*` | 模块。现有：`ai`、`sync`、`reader`、`tts`、`mobile`、`desktop`、`library`、`annotation`、`ui`、`import`、`stats`、`translation`、`pdf`、`i18n`、`progress` |

一条 Issue 通常是一个 `priority:*`、一个或多个 `area:*`，需要时再加 `type:*` 或 `status:*`。

## 本地开发

环境要求与命令以 [README.md](README.md) 的 Development 一节为准：Node.js ≥ 18、pnpm ≥ 9，桌面端另需 Rust。桌面开发用 `pnpm tauri dev`，移动端使用 Expo development build（不是 Expo Go）。

## English

The project is in a maintenance-first window. Maintainers approved a two-week push aimed at patch **v1.3.7**. That version **is not released**. The latest release is [v1.3.6](https://github.com/codedogQBY/ReadAny/releases/tag/v1.3.6). v1.3.7 only fixes sync, import, reading progress, and books that fail to open. See the [draft notice](docs/MAINTENANCE.md).

### Issues

Search existing issues, then use the Bug or Feature/Suggestion template. Bugs need platform, app version, reproduction steps, expected behavior, and actual behavior. Suggestions need motivation and scope, including non-goals. Report the version you run. The current GitHub release is v1.3.6. If the About page shows 1.3.7, say that you built from source and include the branch or commit. Do not describe unreleased v1.3.7 as a shipped installer. Never paste API keys, WebDAV passwords, account data, or private note text.

### Pull requests

Keep each PR small and tied to one concern. Link an issue with `Fixes #n` or `Refs #n`. A new AI provider or a feature that crosses several modules needs an issue plus a short design (problem, approach, non-goals, packages touched, risks) before implementation. Those issues may be labeled `status:needs-design`. Only fixes for sync, import, progress, or open failures should be proposed for v1.3.7. That proposal does not mean the release has shipped.

### Smoke test

For reader, library, import, progress, or sync changes, record this path in the PR: import one book, turn pages, reopen it and confirm progress was saved, then spot-check sync when the change touches sync, import, progress, or opening a book. If you cannot run sync, say why. Run `pnpm lint` when your environment can.

### Rebase

If the branch conflicts with `main`, or it carries `status:needs-rebase`, rebase onto latest `main`, push, and leave a comment. Do not merge `main` into the feature branch to hide conflicts, and do not add feature commits on top of an unresolved conflict.

### Labels

Maintainers and triage volunteers apply labels. Do not guess `priority:p0`.

- `priority:p0` to `priority:p3`: critical outage or data loss, high-impact breakage, planned scoped work, then polish or unconfirmed ideas.
- `status:needs-rebase`: author must rebase before review.
- `status:needs-design`: design is required before code.
- `status:needs-info`: waiting on the reporter.
- `status:stale`: idle.
- `area:*`: `ai`, `sync`, `reader`, `tts`, `mobile`, `desktop`, `library`, `annotation`, `ui`, `import`, `stats`, `translation`, `pdf`, `i18n`, `progress`.
- `type:regression`, `type:crash`, `type:security`, plus `bug` and `enhancement`.

Setup commands live in the Development section of [README.md](README.md).
