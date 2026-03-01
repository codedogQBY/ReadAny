<p align="center">
  <img src="packages/app/public/logo.svg" alt="ReadAny Logo" width="120" height="120">
</p>

<h1 align="center">ReadAny</h1>

<p align="center">
  <strong>阅读无界，理解无限</strong>
</p>

<p align="center">
  一款 AI 驱动的桌面电子书阅读器，支持智能标注、笔记和知识管理。
</p>

<p align="center">
  <a href="#功能特性">功能特性</a> •
  <a href="#应用截图">应用截图</a> •
  <a href="#安装">安装</a> •
  <a href="#开发">开发</a> •
  <a href="README.md">English</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/版本-0.1.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/平台-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" alt="Platform">
  <img src="https://img.shields.io/badge/许可证-MIT-green" alt="License">
</p>

---

## 功能特性

### 📖 多格式支持
支持多种主流电子书格式：
- EPUB、PDF、MOBI、AZW、AZW3、FB2、FBZ

### 🤖 AI 智能阅读
- **AI 对话助手** - 基于书籍内容的智能问答
- **多 AI 提供商** - 支持 OpenAI、Anthropic Claude、Google Gemini
- **深度思考模式** - 针对复杂问题的深度分析推理
- **翻译功能** - 内置选中文本翻译
- **语义搜索 (RAG)** - 基于向量检索的智能搜索，支持本地或远程嵌入模型

### ✍️ 标注与笔记
- **高亮标注** - 多种颜色（黄色、绿色、蓝色、粉色、紫色）
- **笔记功能** - 为高亮文本添加 Markdown 笔记
- **导出功能** - 支持导出为 Markdown、JSON、Obsidian、Notion 格式

### 📚 书库管理
- **书籍组织** - 导入、整理和搜索您的书籍
- **进度追踪** - 自动保存阅读进度，下次继续阅读
- **阅读统计** - 追踪阅读时间、连续阅读天数和活动记录

### 🧠 知识管理
- **思维导图** - 可视化书籍结构和概念
- **技能系统** - 可定制的 AI 工具扩展
- **笔记面板** - 集中管理所有高亮和笔记

### 🎨 个性化阅读
- **字体设置** - 可调节字号、行高和字体主题
- **阅读模式** - 翻页模式或连续滚动
- **主题切换** - 支持亮色和暗色模式
- **多语言** - 支持中英文界面

---

## 应用截图

<!-- 请在此处添加截图 -->
> **提示**：请将截图添加到 `docs/screenshots/` 目录

| 书库视图 | 阅读视图 | AI 对话 |
|:--------:|:--------:|:-------:|
| ![书库](docs/screenshots/library.png) | ![阅读器](docs/screenshots/reader.png) | ![AI对话](docs/screenshots/chat.png) |

| 笔记面板 | 思维导图 | 设置 |
|:--------:|:--------:|:----:|
| ![笔记](docs/screenshots/notes.png) | ![思维导图](docs/screenshots/mindmap.png) | ![设置](docs/screenshots/settings.png) |

---

## 技术栈

### 前端
| 技术 | 用途 |
|------|------|
| React 19 | UI 框架 |
| TypeScript | 类型安全 |
| Vite 7 | 构建工具 |
| Tailwind CSS 4 | 样式 |
| Zustand | 状态管理 |
| Radix UI | UI 组件 |
| i18next | 国际化 |

### 桌面端
| 技术 | 用途 |
|------|------|
| Tauri v2 | 原生桌面框架 |
| Rust | 后端逻辑 |
| SQLite | 本地数据库 |

### AI & LLM
| 技术 | 用途 |
|------|------|
| LangChain | LLM 编排 |
| OpenAI / Claude / Gemini | AI 提供商 |
| Hugging Face Transformers | 本地向量模型 |

---

## 安装

### 下载安装

根据您的平台下载最新版本：

- [macOS (Apple Silicon)](https://readany.app/download/mac-arm64)
- [macOS (Intel)](https://readany.app/download/mac-x64)
- [Windows](https://readany.app/download/windows)
- [Linux](https://readany.app/download/linux)

### 从源码构建

#### 环境要求

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 8
- [Rust](https://www.rust-lang.org/) >= 1.70
- 平台特定依赖：
  - **macOS**: Xcode Command Line Tools
  - **Windows**: Microsoft Visual Studio C++ Build Tools
  - **Linux**: `webkit2gtk`, `openssl`, `curl`, `wget`

#### 构建步骤

```bash
# 克隆仓库
git clone https://github.com/yourusername/readany.git
cd readany

# 安装依赖
pnpm install

# 构建应用
pnpm --filter app tauri build
```

---

## 开发

### 快速开始

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm --filter app tauri dev
```

### 项目结构

```
ReadAny/
├── packages/
│   ├── app/                    # 主 Tauri 应用
│   │   ├── src/                # React 前端
│   │   │   ├── components/     # UI 组件
│   │   │   ├── hooks/          # React Hooks
│   │   │   ├── lib/            # 核心库
│   │   │   │   ├── ai/         # AI 集成
│   │   │   │   ├── rag/        # RAG 实现
│   │   │   │   └── reader/     # 阅读器逻辑
│   │   │   ├── stores/         # Zustand 状态
│   │   │   └── types/          # TypeScript 类型
│   │   ├── src-tauri/          # Rust 后端
│   │   └── public/             # 静态资源
│   └── foliate-js/             # 电子书渲染库
└── .claude/                    # AI 助手技能
```

### 常用命令

```bash
# 开发
pnpm --filter app dev           # 启动前端开发服务器
pnpm --filter app tauri dev     # 启动完整应用开发模式

# 构建
pnpm --filter app build         # 构建前端
pnpm --filter app tauri build   # 构建生产版本

# 类型检查
pnpm --filter app tsc --noEmit  # 运行 TypeScript 检查
```

---

## 配置

### AI 提供商

在设置中配置您的 AI 提供商：

1. **OpenAI** - 需要 API Key
2. **Anthropic Claude** - 需要 API Key
3. **Google Gemini** - 需要 API Key

### 向量模型

语义搜索 (RAG) 可选择：

- **本地模型**（默认）- 完全离线运行
- **远程 API** - 使用 OpenAI 或其他嵌入 API

---

## 贡献

欢迎贡献代码！请阅读 [贡献指南](CONTRIBUTING.md) 了解详情。

---

## 许可证

本项目基于 MIT 许可证开源 - 详见 [LICENSE](LICENSE) 文件。

---

## 致谢

- [foliate](https://github.com/johnfactotum/foliate) - 电子书渲染灵感来源
- [Tauri](https://tauri.app/) - 跨平台桌面框架
- [LangChain](https://langchain.com/) - LLM 编排框架

---

<p align="center">
  由 ReadAny 团队用 ❤️ 打造
</p>
