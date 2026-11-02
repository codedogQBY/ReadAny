# 维护公告（草稿）

> 状态：草稿。仓库未开启 Discussions，本文放在 `docs/` 中，供维护者引用或稍后对外发布。
> 维护窗口尚未排期，文中写明的「待维护者确认」不要理解成具体星期或钟点。
> **v1.3.7 尚未发布。** 当前正式版仍是 [v1.3.6](https://github.com/codedogQBY/ReadAny/releases/tag/v1.3.6)。

英文摘要见 [English](#english)。

## 当前优先维护

维护者已批准两周作战计划。这两周里，处理顺序是：

1. 恢复核心阅读路径：书要能导入、能打开、能翻页、进度要能留下、同步不能悄悄丢数据。
2. 收口已确认的缺陷，尤其是同步、导入、阅读进度、打开失败。
3. 新功能、新的 AI provider、跨模块改造继续收集，但不进入这次维护版。

贡献方式见 [CONTRIBUTING.md](../CONTRIBUTING.md)。

## 计划中的 v1.3.7

v1.3.7 是一次**尚未发布**的维护版，不是新功能版。允许进入该版本的改动只限：

| 范围 | 包含 | 不包含 |
| --- | --- | --- |
| 同步（sync） | WebDAV / 已有同步路径上的失败、中断、数据丢失、冲突后无法收敛 | 新的同步后端、新的云服务 |
| 导入 | 已支持格式导入失败、导入后书库不可用 | 新格式、OPDS、新的书源 |
| 阅读进度 | 进度不保存、打开后回到错误位置、读完退出丢进度 | 新的统计维度、阅读报告 |
| 打开失败 | 书籍无法打开、打开即崩溃或卡死 | 新的阅读版式或渲染引擎替换 |

判断标准：用户靠现有能力完成「导入一本书 → 打开 → 翻页 → 进度还在 → 同步抽检」时被挡住，才考虑纳入。除此之外的 PR 请在描述里标明「不建议进入维护版」。

当前源码里的应用版本号是 1.3.7，这只表示维护版正在准备，**不等于已经发版**。请以 GitHub Releases 为准。

## Bug SLA

- 时区：**Asia/Shanghai**。
- 从 Bug Issue 创建时刻起，**7 天内**给出首次回复。
- 首次回复指维护者或 triage 志愿者的第一次公开回应，例如确认复现、标上 `status:needs-info`、说明是否属于 v1.3.7，或解释为何先不处理。
- 这不是 7 天内修复承诺，也不是功能建议的响应承诺。Feature / Suggestion 按维护余量处理。
- 安全问题请尽量减少敏感细节，并在标题注明安全相关。这类报告优先看，首次回复仍然不超过 7 天。

## 维护窗口

具体维护窗口：**待维护者确认**。

确认前，没有固定的星期、时刻或在线值班表。SLA 按 Issue 创建时间计算，不依赖该窗口是否已经公布。

## 征集 triage 志愿者

欢迎帮忙分拣 Issue，不要求写代码。适合做的事：

- 按模板补全平台、版本、复现步骤、期望与实际行为。
- 建议 `priority:*` 与 `area:*`。拿不准是不是 `priority:p0` 时不要猜，留言说明影响了多少人、是否丢数据、是否完全无法阅读。
- 指出重复 Issue，并标上已有的 `duplicate`。
- 帮助带 `status:needs-info` 的报告收成一条最小复现。

本仓库没有 Discussions。愿意持续参加的，请开一条标题以 `[Suggestion] triage volunteer` 开头的 Issue 做自我介绍；只想帮某一个问题的，直接在该 Issue 下留言即可。

## English

This file is a draft notice. Discussions are disabled, so the text lives in `docs/` until maintainers publish it elsewhere. The maintenance window is **pending maintainer confirmation**. Do not read a weekday or clock time into that phrase.

**v1.3.7 is not released.** The current release is [v1.3.6](https://github.com/codedogQBY/ReadAny/releases/tag/v1.3.6). A version string of 1.3.7 in the tree only means the patch is being prepared.

Maintainers approved a two-week maintenance push. Order of work: restore the core path (import, open, turn pages, keep progress, sync without silent data loss), then land confirmed fixes for sync, import, reading progress, and open failures. New features, new AI providers, and cross-cutting redesigns stay on the backlog.

Bug SLA: first public reply within **7 days** of issue creation, timezone **Asia/Shanghai**. A reply can be a reproduction note, a `status:needs-info` label, or a scope decision. It is not a promise to ship a fix in 7 days, and it does not cover feature suggestions. The clock does not wait for the maintenance window.

Triage volunteers are welcome and do not need to write code. Help complete platform, version, and reproduction details, suggest `priority:*` and `area:*` labels without guessing `priority:p0`, and flag duplicates. Introduce yourself in an issue titled `[Suggestion] triage volunteer`, or comment on the specific issue you can reproduce. See [CONTRIBUTING.md](../CONTRIBUTING.md).
