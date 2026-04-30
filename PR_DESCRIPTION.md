## 🎯 概述

本 PR 引入了两个主要的 AI 驱动功能，以提升阅读体验：

1. **苏格拉底式预热系统**：智能的读前对话系统，帮助读者在深入阅读之前建立思维框架
2. **AI 微评引擎**：生成简洁、上下文相关的书籍微评（≤65 字符），支持智能缓存和持久化

## ✨ 新增功能

### 1. 苏格拉底式预热系统

#### 三种预热策略
- **自动模式**：每次打开书籍时都显示预热对话框
- **智能模式**：每个用户会话仅显示一次，然后记住选择（持久化存储）
- **手动模式**：在聊天面板中提供按钮，按需触发预热

#### 核心组件
- `PreheatingDialog.tsx`：简洁友好的对话框，隐藏 AI 提示词
- `SocraticReaderWrapper.tsx`：管理预热状态和策略逻辑
- `use-preheating.ts`：预热工作流程的自定义 Hook
- 自定义事件系统：实现无缝的手动触发，无需页面刷新

#### 实现细节
- 使用 Zustand store 配合文件系统备份实现完整的状态持久化
- 智能策略使用 `hasShownPreheatingDialog` 标志避免重复显示
- 手动触发使用自定义事件（`trigger-preheating`）实现流畅的用户体验
- AI 系统提示词对用户隐藏（通过 `customPrompt` 参数发送）

### 2. AI 微评引擎

#### 核心功能
- 生成简洁的书籍微评（验证 ≤65 字符）
- 三种微评类型：`hook`（引子）、`question`（问题）、`resonance`（共鸣）
- 智能缓存，支持强制刷新
- SQLite 持久化，自动迁移（v3-v9）
- 加载时自动过滤无效微评（>65 字符）

#### 技术实现
- `book-mini-review.ts`：主服务，包含缓存管理
- `mini-review-queries.ts`：数据库操作
- 通过 `forceRefresh` 参数实现强制刷新机制
- 内容清理：验证前移除引号和前缀
- 增强的错误处理，带重试逻辑（15 秒超时，1 秒重试间隔）

#### 缓存策略
- 三层架构：内存缓存 → Settings Store → SQLite
- 字数验证确保质量（≤65 字符）
- 初始化时自动过滤无效内容
- 已验证跨重启持久化

### 3. 数据库迁移

添加了完整的迁移脚本（v3-v9）以确保正确的表结构：
- v3：创建 `mini_reviews` 表
- v4-v8：各种架构改进
- v9：添加 `type` 和 `is_pinned` 列

迁移在应用启动时通过 `main.tsx` 自动运行。

### 4. 设置持久化增强

增强了所有 store 以确保完全持久化：
- `settings-store.ts`：为所有字段添加带默认值的迁移函数
- `vector-model-store.ts`：完整的迁移实现
- 所有新设置字段都正确初始化为默认值

## 🔧 技术变更

### 新增文件
- `packages/app/src/components/chat/PreheatingDialog.tsx`
- `packages/app/src/components/reader/SocraticReaderWrapper.tsx`
- `packages/app/src/hooks/use-preheating.ts`
- `packages/app/src/lib/book-mini-review.ts`
- `packages/core/src/db/mini-review-queries.ts`
- `test-deepseek-api.js`（API 连通性测试）

### 修改的文件
- `packages/core/src/stores/settings-store.ts`：添加 `hasShownPreheatingDialog` 和迁移
- `packages/core/src/stores/vector-model-store.ts`：添加迁移函数
- `packages/app/src/lib/db/migrations.ts`：添加 v3-v9 迁移
- `packages/app/src/main.tsx`：集成启动时的迁移
- `packages/app/src/components/chat/ChatPanel.tsx`：添加手动预热触发按钮
- `packages/app/src/components/home/BookCard.tsx`：更新超时和 forceRefresh 使用

### 配置更新
- 增加 AI 请求超时：8 秒 → 15 秒
- 增加重试间隔：0.5 秒 → 1 秒
- 放宽字数验证：50-60 → ≤65 字符（提示词仍要求 50-60）

## 🧪 测试

所有功能都已经过全面测试：

✅ 微评生成和缓存
✅ 字数验证（≤65 字符）
✅ 强制刷新机制
✅ 数据库迁移（v1-v9）
✅ 三种预热策略（自动/智能/手动）
✅ 跨重启的状态持久化
✅ 手动触发无弹窗刷新
✅ AI 提示词从 UI 隐藏
✅ 所有字段的设置持久化

## 📊 影响

- **新增代码行数**：约 1,400+ 行
- **修改文件数**：16 个文件
- **新功能**：2 个主要功能（预热 + 微评）
- **数据库**：7 个新迁移版本
- **用户体验**：显著增强 AI 交互流程

## 🔄 兼容性

- 与上游 main 分支完全兼容（已成功合并）
- 对现有 API 无破坏性更改
- 向后兼容现有数据库架构
- AI 服务不可用时优雅降级

## 🚀 使用示例

### 微评生成
```typescript
const review = await miniReviewService.generateReview(book, {
  type: 'hook',
  forceRefresh: true, // 绕过缓存
  timeout: 15000
});
```

### 预热策略配置
```typescript
// 在设置中
aiConfig.socraticSettings.preheatingStrategy = 'smart'; // auto | smart | manual
```

## 🙏 说明

- 本 PR 包含功能添加和 bug 修复
- 所有 TypeScript 类型都已正确定义
- 全面的控制台日志便于调试
- 遵循现有的代码风格和模式
