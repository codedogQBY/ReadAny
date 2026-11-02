## 关联 Issue / Linked issue

Fixes #

没有对应 Issue 的小修（错别字、注释）请改写为 `Refs` 并说明原因。新的 AI provider 或大功能需要先有 Issue 和设计说明。

## 改动范围 / Scope

-

涉及的模块（可删去无关项）：sync / 导入 / 阅读进度 / 打开失败 / 其他

## 手测步骤 / Manual test

阅读、书库、导入、进度或同步改动请勾选实际走过的步骤，并写一句结果。未测的步骤不要勾选，改在下面说明原因。

- [ ] 导入一本书 / Import one book
- [ ] 翻页 / Turn pages
- [ ] 退出后重新打开，进度仍在 / Reopen and confirm progress was saved
- [ ] 同步抽检 / Sync spot-check（本次若涉及同步、导入、进度或打开书籍）

未测说明：

## 是否建议进入维护版 v1.3.7 / Maintenance patch?

v1.3.7 **尚未发布**。只有同步、导入、阅读进度、打开失败的修复才适合建议进入，且不能夹带新功能或新的 AI provider。勾选「建议进入」只表示范围符合，不表示已经进版。

- [ ] 建议进入：本次只修上述范围
- [ ] 不建议进入：功能、重构或其他改动，走常规版本

## 检查 / Checks

- [ ] 改动保持小步，并已关联 Issue（或已说明例外）
- [ ] 若与 `main` 冲突，或带有 `status:needs-rebase`，已 rebase 到最新 `main`
- [ ] 已运行 `pnpm lint`，或已说明为何不能运行
