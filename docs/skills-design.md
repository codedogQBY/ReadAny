# Skill 系统升级设计

## 一、背景

当前 ReadAny 的 skill 是一套 **prompt-only AI 能力模板**。核心结构位于：

- `packages/core/src/types/skill.ts`
- `packages/core/src/ai/skills/builtin-skills.ts`
- `packages/core/src/db/skill-queries.ts`
- `packages/app/src/pages/Skills.tsx`
- `packages/app-expo/src/screens/SkillsScreen.tsx`

现有 `Skill` 类型包含：

```ts
interface Skill {
  id: string;
  name: string;
  description: string;
  icon?: string;
  enabled: boolean;
  parameters: SkillParameter[];
  prompt: string;
  builtIn: boolean;
  createdAt: number;
  updatedAt: number;
}
```

现有数据库 `skills` 表包含：

```sql
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT,
  enabled INTEGER DEFAULT 1,
  parameters TEXT DEFAULT '[]',
  prompt TEXT NOT NULL DEFAULT '',
  built_in INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

这套结构足够支撑内置技能、自定义 prompt 技能、启用/禁用、编辑 prompt，但还不够支撑下一阶段的目标：

- 用户通过自然语言创建 skill
- AI 根据细节不足主动追问
- skill 能知道 ReadAny 当前有哪些 AI tools / local tools
- skill 能访问本地阅读数据
- skill 能运行脚本，像真实本地自动化一样工作
- skill 能导入、导出、同步、版本化

## 二、设计参考

现有产品和规范里有几类值得借鉴：

- **Claude Skills / Agent Skills**：目录式 skill bundle，`SKILL.md` 加 `scripts/`、`references/`、`assets/`，并强调按需加载。参考：[Claude Skills overview](https://claude.com/docs/skills/overview)、[Agent Skills specification](https://agentskills.io/specification)。
- **OpenAI GPT Actions**：通过 schema 描述可用外部工具/API，让模型知道能调用什么。参考：[OpenAI GPT Actions](https://help.openai.com/en/articles/9442513-configuring-actions-in-gpts)。
- **Microsoft Copilot Declarative Agents**：manifest 声明 agent instructions、actions、capabilities。参考：[Declarative agent manifest](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/declarative-agent-manifest-1.4)。
- **Dify Plugin**：manifest 声明插件元信息、runner、权限、资源限制。参考：[Dify plugin manifest](https://docs.dify.ai/en/develop-plugin/features-and-specs/plugin-types/plugin-info-by-manifest)。
- **LangChain Tools**：工具由 name、description、input schema 和执行函数组成。参考：[LangChain tools](https://docs.langchain.com/oss/javascript/langchain/tools)。

ReadAny 应该采用：

```txt
目录式 skill bundle
+ 工具能力目录
+ 简单数据访问级别
+ 可选脚本运行时
+ 保留现有 prompt-only skill 兼容层
```

## 三、目标

### 目标

- 保持现有 skill 不坏，现有 `Skill` 类型、`skills` 表、内置技能数组继续可用。
- 支持用户在对话里说“帮我创建一个 xxx skill”，AI 能追问缺失细节并生成草稿。
- AI 创建 skill 时能看到当前 ReadAny 可用能力目录，包括阅读、划线、笔记、对话、技能、脚本、数据库等能力。
- 新 skill 可以是 prompt-only，也可以带 tools 和脚本。
- 用户界面保持简单，只展示“是否启用、是否允许脚本、数据访问级别、运行日志”等少量信息。
- 脚本能力尽早可用，支持本地数据读写和自动化。
- 为后续导入/导出 skill pack、同步、版本化、市场/分享保留结构。

### 非目标

- 第一阶段不做复杂的表级权限 UI。
- 第一阶段不做第三方 skill 市场。
- 第一阶段不要求脚本沙箱达到云平台多租户安全级别，因为数据和脚本都在用户本地。
- 第一阶段不强制把所有内置 skill 迁移成文件目录。

## 四、核心概念

### 1. Legacy Skill

现有 skill，只有 prompt 和 parameters。

```txt
Legacy Skill = 当前 Skill 类型 + skills 表记录
```

它继续存在，并被视为新系统里的 `kind = "prompt"`。

### 2. Skill Bundle

新一代 skill 的逻辑单位。一个 bundle 可以包含 manifest、prompt、脚本、参考资料、资源。

```txt
theme-reading-cards/
  SKILL.md
  readany.skill.json
  scripts/
    main.js
  references/
    output-format.md
  assets/
    card-template.md
```

### 3. Capability Catalog

ReadAny 暴露给 AI 创建器和 skill runtime 的能力目录。

它不是裸数据库实现，而是稳定工具 API：

```txt
reader.getCurrentBook
books.search
books.get
highlights.listByBook
notes.create
notes.update
messages.search
skills.create
db.query
```

### 4. Skill Runtime

负责运行 skill：

- prompt-only skill：按现有 `skillToTool` 方式转为 AI tool。
- agent skill：加载 prompt，并限制它只能使用 manifest 声明的 tools。
- script skill：运行脚本，并给脚本注入 `readany` API。

### 5. Access Level

用户侧只展示简单访问级别：

```txt
none  不访问本地数据
read  只读取阅读数据
write 读取并修改阅读数据
full  完全访问，包括原始数据库查询和脚本能力
```

内部再映射到工具权限：

```ts
type ToolAccess = "none" | "read" | "write" | "full";
```

## 五、目标目录结构

运行时推荐目录结构：

```txt
<dataRoot>/skills/
  builtin/
    summarizer/
      SKILL.md
      readany.skill.json

  user/
    theme-reading-cards/
      SKILL.md
      readany.skill.json
      scripts/
        main.js
      references/
        examples.md

  imported/
    novel-assistant-pack/
      character-tracker/
        SKILL.md
        readany.skill.json
        scripts/
          main.js
```

注意：

- 第一阶段可以不真实落盘所有内置 skill。
- 用户创建 skill 时，数据库是同步源，目录是 bundle 展示/导出/运行时物化结果。
- 导入第三方 skill 时，先写入 bundle 文件，再解析 manifest 写入 DB。

## 六、Manifest 设计

`readany.skill.json` 是 ReadAny 自己的 manifest。

```json
{
  "schemaVersion": 1,
  "id": "theme-reading-cards",
  "kind": "script",
  "source": "user",
  "name": "主题读书卡片",
  "description": "读取当前书的划线，按主题整理成读书卡片并保存到笔记",
  "icon": "BookOpen",
  "enabled": true,
  "trusted": true,
  "access": "write",
  "parameters": [
    {
      "name": "style",
      "type": "string",
      "description": "卡片风格",
      "required": false,
      "default": "concise"
    }
  ],
  "tools": [
    "reader.getCurrentBook",
    "highlights.listByBook",
    "notes.create"
  ],
  "prompt": {
    "path": "SKILL.md"
  },
  "script": {
    "enabled": true,
    "runtime": "readany-js",
    "entry": "scripts/main.js",
    "timeoutMs": 10000
  },
  "createdAt": 1760000000000,
  "updatedAt": 1760000000000
}
```

### 字段说明

| 字段 | 说明 |
| --- | --- |
| `schemaVersion` | manifest 版本 |
| `id` | 全局唯一 skill id |
| `kind` | `prompt` / `agent` / `script` |
| `source` | `builtin` / `user` / `imported` |
| `trusted` | 是否允许脚本和高权限能力 |
| `access` | 用户可理解的数据访问级别 |
| `tools` | skill 可以调用的工具白名单 |
| `prompt.path` | prompt 文档位置 |
| `script` | 可选脚本入口和运行限制 |

## 七、兼容现有 Skill

兼容原则：

```txt
旧接口不删除
旧表不破坏
旧 UI 不必一次性重写
旧内置 skill 仍能直接使用
```

### 1. Legacy Skill 映射到 Manifest

现有 skill 可以自动映射：

```ts
function legacySkillToManifest(skill: Skill): SkillManifest {
  return {
    schemaVersion: 1,
    id: skill.id,
    kind: "prompt",
    source: skill.builtIn ? "builtin" : "user",
    name: skill.name,
    description: skill.description,
    icon: skill.icon,
    enabled: skill.enabled,
    trusted: true,
    access: "none",
    parameters: skill.parameters,
    tools: [],
    prompt: { inline: skill.prompt },
    script: { enabled: false },
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt
  };
}
```

### 2. Manifest 映射回 Legacy Skill

新 skill 也必须能给旧 UI 和旧 tool 层使用：

```ts
function manifestToLegacySkill(manifest: SkillManifest, prompt: string): Skill {
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    icon: manifest.icon,
    enabled: manifest.enabled,
    parameters: manifest.parameters ?? [],
    prompt,
    builtIn: manifest.source === "builtin",
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt
  };
}
```

### 3. 第一阶段 DB 扩展

第一阶段不拆掉 `skills` 表，只追加 nullable/default 字段：

```sql
ALTER TABLE skills ADD COLUMN kind TEXT NOT NULL DEFAULT 'prompt';
ALTER TABLE skills ADD COLUMN source TEXT NOT NULL DEFAULT 'user';
ALTER TABLE skills ADD COLUMN trusted INTEGER NOT NULL DEFAULT 1;
ALTER TABLE skills ADD COLUMN access TEXT NOT NULL DEFAULT 'none';
ALTER TABLE skills ADD COLUMN tools TEXT NOT NULL DEFAULT '[]';
ALTER TABLE skills ADD COLUMN script TEXT NOT NULL DEFAULT '{}';
ALTER TABLE skills ADD COLUMN bundle_path TEXT;
ALTER TABLE skills ADD COLUMN manifest_json TEXT;
```

现有查询 `getSkills(): Promise<Skill[]>` 继续只读旧字段。

新增查询：

```ts
getSkillManifests(): Promise<SkillManifest[]>
getSkillManifest(id: string): Promise<SkillManifest | null>
upsertSkillManifest(manifest: SkillManifest, files?: SkillFile[]): Promise<void>
```

### 4. 第二阶段 DB 扩展

脚本和 bundle 文件要可同步，建议加虚拟文件表：

```sql
CREATE TABLE IF NOT EXISTS skill_files (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  media_type TEXT,
  content_text TEXT,
  content_blob BLOB,
  hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(skill_id, path)
);
```

运行日志：

```sql
CREATE TABLE IF NOT EXISTS skill_runs (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  status TEXT NOT NULL,
  input TEXT,
  output TEXT,
  error TEXT,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL
);
```

## 八、Capability Catalog 设计

AI 创建 skill 时，需要知道当前可用能力，但不应该直接读内部代码。

统一提供：

```ts
interface SkillToolDescriptor {
  name: string;
  description: string;
  access: "none" | "read" | "write" | "full";
  inputSchema: unknown;
  outputSchema?: unknown;
  platforms: Array<"desktop" | "mobile">;
}
```

示例：

```ts
const skillToolCatalog: SkillToolDescriptor[] = [
  {
    name: "reader.getCurrentBook",
    description: "获取当前正在阅读的书籍",
    access: "read",
    inputSchema: {},
    platforms: ["desktop", "mobile"]
  },
  {
    name: "highlights.listByBook",
    description: "读取指定书籍的划线",
    access: "read",
    inputSchema: {
      type: "object",
      properties: { bookId: { type: "string" } },
      required: ["bookId"]
    },
    platforms: ["desktop", "mobile"]
  },
  {
    name: "notes.create",
    description: "创建一条笔记",
    access: "write",
    inputSchema: {
      type: "object",
      properties: {
        bookId: { type: "string" },
        title: { type: "string" },
        content: { type: "string" }
      },
      required: ["title", "content"]
    },
    platforms: ["desktop", "mobile"]
  },
  {
    name: "db.query",
    description: "执行本地数据库查询。只应在用户授权 full access 时使用。",
    access: "full",
    inputSchema: {
      type: "object",
      properties: { sql: { type: "string" }, params: { type: "array" } },
      required: ["sql"]
    },
    platforms: ["desktop", "mobile"]
  }
];
```

### 第一批建议工具

```txt
reader.getCurrentBook
reader.getSelection
books.search
books.get
books.list
highlights.listByBook
highlights.search
notes.listByBook
notes.search
notes.create
notes.update
tags.list
tags.create
messages.search
skills.create
skills.update
db.query
db.execute
```

## 九、AI 创建 Skill 流程

用户不需要填表，交互应该像这样：

```txt
用户：帮我创建一个把当前书划线整理成主题卡片的 skill

AI：可以。我需要确认两点：
1. 卡片按主题整理，还是按章节整理？
2. 结果保存到笔记，还是只在对话里展示？

用户：按主题，保存到笔记

AI：我会创建这个 skill：

名称：主题读书卡片
作用：读取当前书划线，按主题生成读书卡片，并保存到笔记
访问：读取并修改阅读数据
脚本：启用
工具：reader.getCurrentBook, highlights.listByBook, notes.create

是否创建？
```

### 创建器判断信息是否足够

AI 创建 skill 前至少需要确定：

- 这个 skill 要做什么
- 输入来自哪里：当前书 / 全部书 / 当前对话 / 用户选择
- 输出到哪里：对话 / 笔记 / 标签 / 文件 / 新 skill
- 是否需要脚本
- 是否需要读写本地数据

缺少关键项时，只问 1 到 3 个问题。

### 创建工具

新增内部 tool：

```ts
createSkillDraft(args): SkillDraft
confirmCreateSkill(args): SkillManifest
```

或简化为一个工具：

```ts
skills.create({
  manifest,
  files
});
```

AI 只有在用户确认后才能调用 `skills.create`。

## 十、脚本运行时设计

第一阶段建议支持 `readany-js`：

```js
export default async function run(ctx, readany) {
  const book = await readany.reader.getCurrentBook();
  const highlights = await readany.highlights.listByBook({ bookId: book.id });

  const grouped = await readany.ai.groupByTheme({
    items: highlights,
    instruction: "按主题整理成读书卡片"
  });

  await readany.notes.create({
    bookId: book.id,
    title: `${book.title} 主题读书卡片`,
    content: grouped.markdown
  });

  return {
    ok: true,
    noteTitle: `${book.title} 主题读书卡片`
  };
}
```

### 脚本上下文

```ts
interface SkillRunContext {
  skillId: string;
  threadId?: string;
  bookId?: string;
  chapterIndex?: number;
  selectedText?: string;
  args: Record<string, unknown>;
}
```

### 注入 API

```ts
interface ReadAnySkillAPI {
  reader: ReaderAPI;
  books: BooksAPI;
  highlights: HighlightsAPI;
  notes: NotesAPI;
  tags: TagsAPI;
  messages: MessagesAPI;
  skills: SkillsAPI;
  db: DatabaseAPI;
  ai: SkillAIAPI;
  log: SkillLogger;
}
```

### 运行限制

为了避免误操作，不是为了阻止用户：

- 默认超时 10 秒
- 每次运行记录日志
- 写操作默认事务包裹
- 脚本报错时写入 `skill_runs.error`
- `full` access 才允许 `db.query` / `db.execute`
- 第三方导入 skill 默认 `trusted = false`，未信任前不运行脚本

## 十一、运行模式

### 1. Prompt Skill

兼容当前逻辑：

```txt
Skill.prompt + Skill.parameters -> skillToTool(skill)
```

适合：

- 摘要
- 概念解释
- 论证分析
- 翻译

### 2. Agent Skill

有 prompt，也声明 tools，但没有脚本。

```txt
prompt + allowed tools -> model decides tool calls
```

适合：

- 根据当前书和划线生成读书会问题
- 查找历史对话后给出建议
- 基于 RAG 查上下文

### 3. Script Skill

有 prompt，也有脚本入口。

```txt
script(ctx, readany) -> deterministic local automation
```

适合：

- 整理笔记
- 批量清理标签
- 从对话创建 skill
- 生成周期性报告
- 迁移或修复用户数据

## 十二、UI 设计

用户侧保持简单：

```txt
技能详情

名称
描述
启用开关
允许脚本开关
数据访问：不访问 / 只读 / 可写 / 完全访问
最近运行
运行日志
编辑提示词
编辑脚本
导出
删除
```

创建 skill 时只展示摘要：

```txt
这个 skill 将会：

- 读取当前书
- 读取划线
- 创建笔记
- 运行本地脚本

访问级别：读取并修改阅读数据
```

不展示复杂表权限。

## 十三、同步与导入导出

### 同步

第一阶段：

- `skills` 表继续参与现有同步。
- `prompt` 和 manifest 关键字段存在 DB 中。
- 脚本内容可以先存在 `skill_files`，后续随数据库同步。

第二阶段：

- binary assets 通过文件同步。
- `skill_files.hash` 用于冲突判断。

### 导出

导出为目录或 zip：

```txt
theme-reading-cards.skill.zip
  SKILL.md
  readany.skill.json
  scripts/main.js
  references/examples.md
```

### 导入

导入流程：

- 解压/读取 manifest
- 检查 schemaVersion
- 展示名称、描述、访问级别、是否带脚本
- 用户确认信任后启用脚本
- 写入 `skills` 和 `skill_files`

## 十四、实现路线

### Phase 0：当前补强

- 内置 skill 启用/禁用可持久化。
- prompt-only skill 继续稳定工作。

### Phase 1：Manifest 兼容层

- 新增 `SkillManifest`、`SkillKind`、`SkillAccess` 类型。
- 新增 legacy <-> manifest adapter。
- `skills` 表追加新字段，但旧查询不变。
- 新增 `getSkillManifests` / `upsertSkillManifest`。

### Phase 2：Capability Catalog

- 建立 `skillToolCatalog`。
- 把现有 AI tools 和本地 DB 操作包装成稳定工具描述。
- AI 创建 skill 时注入 catalog。

### Phase 3：对话创建 Skill

- 新增 skill creator prompt / tool。
- 支持缺信息时追问。
- 支持用户确认后保存。
- 保存后可立即运行测试。

### Phase 4：Script Runtime

- 支持 `readany-js`。
- 注入 `readany` API。
- 增加 timeout、事务、运行日志。
- 桌面端和移动端都先支持无 Node import 的纯 JS。

### Phase 5：Bundle 文件与导入导出

- 新增 `skill_files`。
- 支持导出 zip。
- 支持导入第三方 skill。
- 对 imported skill 加信任状态。

### Phase 6：高级能力

- skill pack
- 版本升级
- 定时运行
- 自动运行触发器
- 分享/市场

## 十五、开放问题

- `readany-js` 是否使用 JS `Function` / `eval`，还是引入 QuickJS 这类隔离 runtime？
- 移动端是否允许 `db.execute`，还是第一版只允许封装好的 write API？
- full access 是否默认只给用户自己通过对话创建的 skill？
- AI 生成脚本后是否必须先 dry-run？
- skill 运行结果要不要进入 chat messages，还是只写 skill_runs？

## 十六、推荐决策

推荐第一版采用：

```txt
旧 Skill 类型保留
skills 表追加字段
新增 SkillManifest 兼容层
Capability Catalog 先做
AI 创建 skill 先落地
脚本 runtime 第二步跟进
目录式 bundle 作为导入导出格式和长期目标
```

这样能保证：

- 现在的内置 skill 和自定义 skill 不坏。
- 用户很快能通过对话创建新 skill。
- 后续脚本、工具、权限、同步、导入导出都有位置可放。
- UI 不会被复杂权限系统拖垮。
