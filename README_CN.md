<p align="center">
  <img src="packages/app/public/logo.svg" alt="ReadAny Logo" width="120" height="120">
</p>

<h1 align="center">ReadAny</h1>

<p align="center">
  <strong>阅读无界，理解无限</strong>
</p>

<p align="center">
  一款 AI 驱动的桌面电子书阅读器，支持智能对话、语义搜索、标注笔记与知识管理。
</p>

<p align="center">
  <a href="#功能特性">功能特性</a> &bull;
  <a href="#应用截图">应用截图</a> &bull;
  <a href="#安装">安装</a> &bull;
  <a href="#开发">开发</a> &bull;
  <a href="README.md">English</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/版本-0.1.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/平台-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" alt="Platform">
  <img src="https://img.shields.io/badge/许可证-MIT-green" alt="License">
</p>

---

<!-- TODO: 替换为真实的产品截图或 GIF -->
<!-- ![ReadAny Hero](docs/screenshots/hero.png) -->

## 功能特性

### 多格式支持

支持主流电子书格式，开箱即用：

- **EPUB**、**PDF**、**MOBI**、**AZW**、**AZW3**、**FB2**、**FBZ**、**CBZ**

### AI 智能阅读

- **AI 对话助手** &mdash; 基于书籍内容的智能问答，AI 能感知你当前的阅读位置、选中文本、最近标注和章节信息。
- **多 AI 提供商** &mdash; 支持 OpenAI、Anthropic Claude（含深度思考）、Google Gemini，以及 OpenAI 兼容端点（Ollama、DeepSeek、vLLM 等）。
- **语义搜索 (RAG)** &mdash; 超越关键词搜索，按语义查找段落。自动向量化书籍，支持混合检索（向量相似度 + BM25 关键词匹配）。可使用 Hugging Face 本地嵌入模型或远程 API。
- **翻译功能** &mdash; 选中文本即时翻译，支持 AI 翻译和 DeepL API，覆盖 19 种语言。
- **AI 技能系统** &mdash; 可扩展的技能框架，内置分析、摘要、实体提取等技能，也可自定义创建。

### 标注与笔记

- **高亮标注** &mdash; 5 种颜色（黄、绿、蓝、粉、紫），有笔记时以波浪线标识
- **Markdown 笔记** &mdash; 基于 TipTap 的富文本 Markdown 编辑器
- **悬浮预览** &mdash; 鼠标悬停在标注上即可预览笔记内容
- **笔记面板** &mdash; 集中浏览、编辑和管理所有高亮与笔记
- **导出** &mdash; 支持导出为 Markdown、HTML、JSON、Obsidian、Notion 格式

### 书库管理

- **书籍整理** &mdash; 拖拽导入，自动提取元数据
- **搜索与筛选** &mdash; 按书名、作者、标签搜索；支持多种排序方式
- **进度追踪** &mdash; 自动保存阅读进度，下次打开自动定位

### 阅读统计

- 按会话和按书籍统计阅读时长，支持空闲检测
- 日期范围筛选和历史数据图表

### 个性化阅读

- **字体设置** &mdash; 字号（12&ndash;32px）、行高、边距、段间距可调
- **字体主题** &mdash; 5 种内置主题，良好的中日韩字体支持（系统默认、经典衬线、现代无衬线、雅致楷体、Literata）
- **阅读模式** &mdash; 翻页模式或连续滚动
- **明暗主题** &mdash; 支持亮色和暗色模式
- **多标签** &mdash; 同时打开多本书和多个对话
- **快捷键** &mdash; 键盘控制导航、搜索和阅读器操作
- **多语言** &mdash; 支持中文和英文界面

---

## 应用截图

<!-- TODO: 将截图添加到 docs/screenshots/ 目录，然后取消下方注释 -->

| 书库视图 | 阅读视图 | AI 对话 |
|:--------:|:--------:|:-------:|
| ![书库](docs/screenshots/library.png) | ![阅读器](docs/screenshots/reader.png) | ![AI 对话](docs/screenshots/chat.png) |

| 笔记面板 | 思维导图 | 设置 |
|:--------:|:--------:|:----:|
| ![笔记](docs/screenshots/notes.png) | ![思维导图](docs/screenshots/mindmap.png) | ![设置](docs/screenshots/settings.png) |

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面运行时 | [Tauri 2](https://tauri.app/)（Rust） |
| 前端 | [React 19](https://react.dev/) + [TypeScript 5](https://www.typescriptlang.org/) |
| 构建工具 | [Vite 7](https://vite.dev/) |
| 样式 | [Tailwind CSS 4](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/) |
| 状态管理 | [Zustand](https://zustand.docs.pmnd.rs/) |
| 数据库 | SQLite via [tauri-plugin-sql](https://github.com/nicepkg/tauri-plugin-sql) |
| 电子书渲染 | [foliate-js](https://github.com/johnfactotum/foliate-js) |
| AI / LLM | [LangChain.js](https://js.langchain.com/) + [LangGraph](https://langchain-ai.github.io/langgraphjs/) |
| 向量嵌入 | [Hugging Face Transformers.js](https://huggingface.co/docs/transformers.js) |
| Markdown | [TipTap](https://tiptap.dev/) + [marked](https://marked.js.org/) |
| 国际化 | [i18next](https://www.i18next.com/) |
| 图标 | [Lucide](https://lucide.dev/) |

---

## 安装

### 下载

根据你的平台下载最新版本：

<!-- TODO: 发布后更新下载链接 -->
- [macOS (Apple Silicon)](https://github.com/xxx/ReadAny/releases)
- [macOS (Intel)](https://github.com/xxx/ReadAny/releases)
- [Windows](https://github.com/xxx/ReadAny/releases)
- [Linux](https://github.com/xxx/ReadAny/releases)

### 从源码构建

#### 环境要求

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 9
- [Rust](https://www.rust-lang.org/tools/install)
- 平台相关 Tauri 依赖 &mdash; 参阅 [Tauri 环境准备指南](https://v2.tauri.app/start/prerequisites/)

#### 构建步骤

```bash
# 克隆仓库
git clone https://github.com/xxx/ReadAny.git
cd ReadAny

# 安装依赖
pnpm install

# 构建应用
pnpm tauri build
```

构建产物位于 `packages/app/src-tauri/target/release/bundle/`。

---

## 开发

### 快速开始

```bash
# 安装依赖
pnpm install

# 以开发模式启动完整 Tauri 桌面应用
pnpm tauri dev
```

### 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动 Vite 开发服务器（仅 Web） |
| `pnpm tauri dev` | 以开发模式启动完整 Tauri 桌面应用 |
| `pnpm tauri build` | 构建生产版本桌面应用 |
| `pnpm lint` | 使用 Biome 检查代码 |
| `pnpm lint:fix` | 自动修复 lint 问题 |

### 项目结构

```
ReadAny/
├── packages/
│   ├── app/                    # 主 Tauri + React 应用
│   │   ├── src/
│   │   │   ├── components/     # 按功能组织的 React 组件
│   │   │   │   ├── reader/     # 阅读界面
│   │   │   │   ├── chat/       # AI 对话 UI
│   │   │   │   ├── annotation/ # 高亮与笔记
│   │   │   │   ├── home/       # 书库 / 首页
│   │   │   │   ├── notes/      # 笔记视图
│   │   │   │   ├── settings/   # 设置
│   │   │   │   ├── stats/      # 统计
│   │   │   │   ├── layout/     # 应用布局、侧边栏、标签页
│   │   │   │   └── ui/         # 可复用 UI 基础组件
│   │   │   ├── pages/          # 页面级组件
│   │   │   ├── stores/         # Zustand 状态管理
│   │   │   ├── lib/            # 核心库
│   │   │   │   ├── ai/         # LLM 提供商、Agent、技能、工具
│   │   │   │   ├── rag/        # 向量化、分块、搜索
│   │   │   │   ├── reader/     # 书籍加载、字体主题、进度
│   │   │   │   ├── translation/# 翻译服务
│   │   │   │   ├── db/         # SQLite 数据库层
│   │   │   │   ├── export/     # 导出工具
│   │   │   │   └── stats/      # 阅读统计
│   │   │   ├── hooks/          # 自定义 React Hooks
│   │   │   ├── types/          # TypeScript 类型定义
│   │   │   ├── i18n/           # 国际化（en / zh）
│   │   │   └── styles/         # 全局样式
│   │   ├── src-tauri/          # Rust 后端 & Tauri 配置
│   │   └── public/             # 静态资源（Logo、字体、第三方库）
│   └── foliate-js/             # 电子书渲染引擎（fork）
├── package.json                # pnpm 工作区根配置
├── pnpm-workspace.yaml
└── biome.json                  # 代码检查与格式化配置
```

---

## 配置

### AI 提供商

在 **设置 > AI** 中配置：

| 提供商 | 所需配置 |
|--------|---------|
| OpenAI | [platform.openai.com](https://platform.openai.com/) 获取 API Key |
| Anthropic Claude | [console.anthropic.com](https://console.anthropic.com/) 获取 API Key |
| Google Gemini | [aistudio.google.com](https://aistudio.google.com/) 获取 API Key |
| Ollama / DeepSeek / vLLM | 自定义端点 URL（OpenAI 兼容） |

### 向量嵌入模型

用于语义搜索（RAG），可选择：

- **本地模型**（默认）&mdash; 使用 Hugging Face Transformers.js，完全离线运行
- **远程 API** &mdash; 使用 OpenAI 或其他嵌入 API

### 翻译

- **AI 翻译** &mdash; 直接使用已配置的 LLM，无需额外设置
- **DeepL** &mdash; 需在 [deepl.com/pro-api](https://www.deepl.com/pro-api) 获取 API Key

---

## 贡献

欢迎贡献！无论是 Bug 报告、功能建议还是代码提交，都非常感谢。

1. Fork 本仓库
2. 创建功能分支（`git checkout -b feature/amazing-feature`）
3. 提交更改（`git commit -m 'Add amazing feature'`）
4. 推送到分支（`git push origin feature/amazing-feature`）
5. 发起 Pull Request

提交前请运行 `pnpm lint` 并遵循现有代码风格。

---

## 许可证

本项目基于 MIT 许可证开源 &mdash; 详见 [LICENSE](LICENSE) 文件。

内置的 [foliate-js](packages/foliate-js/) 库由 [John Factotum](https://github.com/johnfactotum/foliate-js) 开发，同样基于 MIT 许可证。

---

## 致谢

- [foliate-js](https://github.com/johnfactotum/foliate-js) &mdash; 电子书渲染引擎
- [Tauri](https://tauri.app/) &mdash; 跨平台桌面运行时
- [LangChain.js](https://js.langchain.com/) &mdash; AI/LLM 编排框架
- [Radix UI](https://www.radix-ui.com/) &mdash; 无障碍 UI 组件
- [Lucide](https://lucide.dev/) &mdash; 图标库

---

<p align="center">
  由 ReadAny 团队用 &#10084; 打造
</p>
