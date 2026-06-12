<p align="center">
  <img src="packages/app/public/logo.svg" alt="ReadAny Logo" width="120" height="120">
</p>

<h1 align="center">ReadAny</h1>

<p align="center">
  <strong>Read Any, Understand More</strong>
</p>

<p align="center">
  <em>"Why do I forget what I read? Why are my notes scattered? Why can I only search by keywords?"</em>
</p>

<p align="center">
  An AI-powered e-book reader with semantic search, intelligent chat, and knowledge management
</p>

<p align="center">
  <a href="https://github.com/codedogQBY/ReadAny/releases/latest">
    <img src="https://img.shields.io/github/v/release/codedogQBY/ReadAny?color=blue&label=Download" alt="Release">
  </a>
  <a href="https://github.com/codedogQBY/ReadAny/stargazers">
    <img src="https://img.shields.io/github/stars/codedogQBY/ReadAny?color=yellow" alt="Stars">
  </a>
  <a href="https://github.com/codedogQBY/ReadAny/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/codedogQBY/ReadAny?color=green" alt="License">
  </a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20iOS%20%7C%20Android-blue" alt="Platform">
  <a href="README_CN.md">
    <img src="https://img.shields.io/badge/lang-中文-red" alt="Chinese">
  </a>
</p>

---

<p align="center">
  <a href="https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=ReadAny">
    <img src="assets/atlas-cloud-logo.png" alt="Atlas Cloud" width="200">
  </a>
</p>

> 🎁 Powered by **[Atlas Cloud](https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=ReadAny)** — a full-modal, OpenAI-compatible AI inference platform. Plug it into ReadAny as a drop-in chat backend to reach DeepSeek, Qwen, GLM, Kimi, MiniMax and more through a single `/v1/chat/completions` endpoint, no multi-vendor setup needed. Budget-friendly [coding plan](https://www.atlascloud.ai/console/coding-plan) available.

In ReadAny, pick **Atlas Cloud** in the AI provider dropdown (settings or onboarding), then use:

```env
# Base URL is already versioned (no extra /v1 needed)
Base URL = https://api.atlascloud.ai/v1
API Key   = <your-atlascloud-api-key>
Model     = deepseek-ai/deepseek-v4-pro
```

`deepseek-ai/deepseek-v4-pro` is a reasoning model — give it enough `max_tokens` (>= 512), otherwise tokens are spent on the reasoning chain first and `content` may come back empty with `finish_reason=length`.

<details>
<summary>All Atlas Cloud chat models (59, OpenAI-compatible)</summary>

- **Anthropic (Claude):** `anthropic/claude-haiku-4.5-20251001`, `anthropic/claude-opus-4.8`, `anthropic/claude-sonnet-4.6`
- **OpenAI (GPT):** `openai/gpt-5.4`, `openai/gpt-5.5`
- **Google (Gemini):** `google/gemini-3.1-flash-lite`, `google/gemini-3.1-pro-preview`, `google/gemini-3.5-flash`
- **Alibaba (Qwen):** `qwen/qwen2.5-7b-instruct`, `Qwen/Qwen3-235B-A22B-Instruct-2507`, `qwen/qwen3-235b-a22b-thinking-2507`, `qwen/qwen3-30b-a3b`, `Qwen/Qwen3-30B-A3B-Instruct-2507`, `qwen/qwen3-30b-a3b-thinking-2507`, `qwen/qwen3-32b`, `qwen/qwen3-8b`, `Qwen/Qwen3-Coder`, `qwen/qwen3-coder-next`, `qwen/qwen3-max-2026-01-23`, `Qwen/Qwen3-Next-80B-A3B-Instruct`, `Qwen/Qwen3-Next-80B-A3B-Thinking`, `Qwen/Qwen3-VL-235B-A22B-Instruct`, `qwen/qwen3-vl-235b-a22b-thinking`, `qwen/qwen3-vl-30b-a3b-instruct`, `qwen/qwen3-vl-30b-a3b-thinking`, `qwen/qwen3-vl-8b-instruct`, `qwen/qwen3.5-122b-a10b`, `qwen/qwen3.5-27b`, `qwen/qwen3.5-35b-a3b`, `qwen/qwen3.5-397b-a17b`, `qwen/qwen3.6-35b-a3b`, `qwen/qwen3.6-plus`
- **DeepSeek:** `deepseek-ai/deepseek-ocr`, `deepseek-ai/deepseek-r1-0528`, `deepseek-ai/DeepSeek-V3-0324`, `deepseek-ai/DeepSeek-V3.1`, `deepseek-ai/DeepSeek-V3.1-Terminus`, `deepseek-ai/deepseek-v3.2`, `deepseek-ai/DeepSeek-V3.2-Exp`, `deepseek-ai/deepseek-v4-flash`, `deepseek-ai/deepseek-v4-pro`
- **Moonshot (Kimi):** `moonshotai/Kimi-K2-Instruct`, `moonshotai/Kimi-K2-Instruct-0905`, `moonshotai/Kimi-K2-Thinking`, `moonshotai/kimi-k2.5`, `moonshotai/kimi-k2.6`
- **Zhipu (GLM):** `zai-org/GLM-4.6`, `zai-org/glm-4.7`, `zai-org/glm-5`, `zai-org/glm-5-turbo`, `zai-org/glm-5.1`, `zai-org/glm-5v-turbo`
- **MiniMax:** `MiniMaxAI/MiniMax-M2`, `minimaxai/minimax-m2.1`, `minimaxai/minimax-m2.5`, `minimaxai/minimax-m2.7`
- **xAI:** `xai/grok-4.3`
- **Kuaishou (KAT):** `kwaipilot/kat-coder-pro-v2`
- **Other:** `owl`

</details>

---

> 🚀 **v2.0 Update**: Mobile apps (iOS/Android) now available! See [Mobile](#mobile-apps) section below.

## Why ReadAny?

| Problem | Traditional Readers | ReadAny |
|---------|---------------------|---------|
| Search content | Keywords only | **Semantic search** that understands your intent |
| Ask questions | Find answers yourself | **AI answers directly + locates sources** |
| Take notes | Manual copy-paste | **Select to highlight**, one-click export |
| Knowledge management | Scattered notes | **Unified management**, multi-format export |
| Privacy | Upload to cloud | **Local vector store**, fully offline capable |

### Comparison with Alternatives

| Feature | ReadAny | Calibre | KOReader | Apple Books |
|---------|---------|---------|----------|-------------|
| AI Chat | ✅ | ❌ | ❌ | ❌ |
| Semantic Search (RAG) | ✅ | ❌ | ❌ | ❌ |
| Local Vector Store | ✅ | - | - | ❌ |
| TTS (Text-to-Speech) | ✅ | ❌ | Limited | Limited |
| Reading Stats | ✅ | ❌ | ❌ | Limited |
| WebDAV Sync | ✅ | ❌ | ❌ | ❌ |
| Skills System | ✅ | ❌ | ❌ | ❌ |
| Format Support | 10+ | 15+ | 10+ | 2 |
| Note Export | 5 formats | Limited | Limited | Limited |
| Open Source | ✅ | ✅ | ✅ | ❌ |

---

## Screenshots

### Hero

<div align="center">
  <img src="assets/hero-screenshot.png" width="80%" alt="ReadAny Hero">
</div>

### AI-Powered Chat

<div align="center">
  <img src="assets/ai-chat-desktop.png" width="60%" alt="AI Chat - Desktop">
  <img src="assets/ai-chat-mobile.png" width="20%" alt="AI Chat - Mobile">
</div>

### Notes & Highlights

<div align="center">
  <img src="assets/notes-desktop.png" width="60%" alt="Notes - Desktop">
  <img src="assets/notes-mobile.png" width="20%" alt="Notes - Mobile">
</div>

### Text-to-Speech

<div align="center">
  <img src="assets/tts-desktop.png" width="60%" alt="TTS - Desktop">
  <img src="assets/tts-mobile.png" width="20%" alt="TTS - Mobile">
</div>

### Reading Statistics

<div align="center">
  <img src="assets/stats-desktop.png" width="60%" alt="Stats - Desktop">
  <img src="assets/stats-mobile.png" width="20%" alt="Stats - Mobile">
</div>

### Cross-Device Sync

<div align="center">
  <img src="assets/sync-desktop.png" width="60%" alt="Sync - Desktop">
  <img src="assets/sync-mobile.png" width="20%" alt="Sync - Mobile">
</div>

---

## Core Features

### 🤖 AI-Powered Reading

- **Intelligent Chat** - Ask questions about your books, AI knows your position, selected text, and highlights
- **Semantic Search** - Beyond keywords, vector retrieval + BM25 hybrid search
- **Instant Translation** - AI translation or DeepL, 19 languages supported
- **Multiple AI Providers** - OpenAI, Claude, Gemini, Ollama, DeepSeek, Atlas Cloud
- **Skills System** - Built-in skills (summarizer, concept explainer, character tracker, etc.) + create custom skills

### 📝 Annotation & Knowledge Management

- **5-Color Highlights** - Yellow/Green/Blue/Pink/Purple, hover to preview notes
- **Markdown Notes** - Rich text editor with toolbar, WYSIWYG
- **Multi-format Export** - Markdown, HTML, JSON, Obsidian, Notion

### 🔊 Text-to-Speech (TTS)

- **Multiple Engines** - Edge TTS, Browser TTS, DashScope (通义千问)
- **Voice Selection** - 100+ voices in multiple languages
- **Speed Control** - Adjustable playback speed
- **Background Playback** - Listen while doing other things

### 📊 Reading Statistics

- **Reading Heatmap** - Visualize your reading habits like GitHub contributions
- **Trend Charts** - Track daily/weekly/monthly reading time
- **Streak Tracking** - Longest consecutive reading days
- **Book Statistics** - Time spent per book, completion rate

### ☁️ Cross-Device Sync

- **WebDAV Support** - Sync your library, highlights, and notes across devices
- **Auto Sync** - Automatic background synchronization
- **Conflict Resolution** - Smart merge for concurrent edits

### 📚 Multi-Format Support

**EPUB** · **PDF** · **MOBI** · **AZW** · **AZW3** · **FB2** · **FBZ** · **CBZ** · **TXT** · **UMD**

TXT and UMD are imported by converting them to EPUB for reading, notes, search, and sync.

### 🎨 Customizable Experience

- 5 font themes (CJK optimized)
- Light/Dark mode
- Paginated/Continuous scroll
- Keyboard shortcuts
- English/Chinese interface

---

## Quick Start

### Download

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | [Download .dmg](https://github.com/codedogQBY/ReadAny/releases/latest) |
| macOS (Intel) | [Download .dmg](https://github.com/codedogQBY/ReadAny/releases/latest) |
| Windows | [Download .msi](https://github.com/codedogQBY/ReadAny/releases/latest) |
| Linux | [Download .AppImage](https://github.com/codedogQBY/ReadAny/releases/latest) |
| iOS | App Store (Coming Soon) |
| Android | [Download .apk](https://github.com/codedogQBY/ReadAny/releases/latest) |

#### Homebrew (macOS)

```bash
brew tap codedogQBY/readany
brew install --cask readany
```

### 3 Steps to Get Started

1. **Import Books** - Drag and drop files into library
2. **Start Reading** - Double-click to open, immersive experience
3. **Configure AI** (Optional) - Settings → AI → Enter API Key

### Mobile Apps

ReadAny is now available on mobile devices!

**Expo (React Native) Version:**
```bash
# Clone and setup
git clone https://github.com/codedogQBY/ReadAny.git
cd ReadAny
pnpm install

# Run iOS
pnpm expo:ios

# Run Android
pnpm expo:android
```

Mobile app source lives in [`packages/app-expo`](packages/app-expo).

### AI Configuration

| Provider | Get API Key |
|----------|-------------|
| OpenAI | [platform.openai.com](https://platform.openai.com/) |
| Anthropic Claude | [console.anthropic.com](https://console.anthropic.com/) |
| Google Gemini | [aistudio.google.com](https://aistudio.google.com/) |
| Atlas Cloud | [atlascloud.ai](https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=ReadAny) (OpenAI-compatible; suggested model `deepseek-ai/deepseek-v4-pro`) |
| Ollama / DeepSeek | Local or custom endpoint |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop | [Tauri 2](https://tauri.app/) (Rust) |
| Mobile | [Expo](https://expo.dev/) (React Native) + Tauri Mobile |
| Frontend | [React 19](https://react.dev/) + TypeScript |
| Build | [Vite 7](https://vite.dev/) |
| Styling | [Tailwind CSS 4](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/) |
| State | [Zustand](https://zustand.docs.pmnd.rs/) |
| Database | SQLite |
| E-Book | [foliate-js](https://github.com/johnfactotum/foliate-js) |
| AI/LLM | [LangChain.js](https://js.langchain.com/) + [LangGraph](https://langchain-ai.github.io/langgraphjs/) |
| Embeddings | [Transformers.js](https://huggingface.co/docs/transformers.js) |

---

## Development

```bash
# Clone
git clone https://github.com/codedogQBY/ReadAny.git
cd ReadAny

# Install
pnpm install

# Dev (Desktop)
pnpm tauri dev

# Dev (Mobile - Expo)
pnpm expo:start

# Build
pnpm tauri build
```

**Requirements:** Node.js ≥18, pnpm ≥9, Rust (for Tauri)

---

## Roadmap

- [x] **Mobile apps** — iOS and Android versions available
- [x] **TTS (Text-to-Speech)** — Edge TTS, multiple voices
- [x] **Reading Statistics** — Heatmap, trends, streaks
- [x] **Skills System** — Built-in + custom AI skills
- [x] **WebDAV Sync** — Cross-device synchronization
- [ ] More AI models (Qwen, GLM, Llama)
- [ ] PDF reflow/re-render
- [ ] Plugin system
- [ ] Cloud sync (official service)

---

## Contributing

Contributions welcome! Bug reports, feature requests, pull requests all appreciated.

1. Fork → 2. Branch → 3. PR

Please run `pnpm lint` before submitting to ensure code style consistency.

---

## License

[GPL-3.0](LICENSE) © 2024 ReadAny Team

This project is open source under the GNU General Public License v3.0. You are free to use, modify, and distribute the code, but any derivative works must also be open source under the same license.

**Note:** While the source code is freely available, the official app store versions may be offered for a fee to support ongoing development and cover certificate costs. You can always build the app yourself at no cost.

---

## Acknowledgments

- [foliate-js](https://github.com/johnfactotum/foliate-js) - E-book rendering engine
- [Tauri](https://tauri.app/) - Cross-platform desktop framework
- [Expo](https://expo.dev/) - React Native development platform
- [LangChain.js](https://js.langchain.com/) - AI orchestration framework
- [Radix UI](https://www.radix-ui.com/) - Accessible UI components
- [Lucide](https://lucide.dev/) - Icon library

---

## Community

Thanks to [linux.do](https://linux.do/) — a vibrant Chinese tech community where you can learn about AI, development, and more.

---

<p align="center">
  Made with ❤️ by the ReadAny Team
</p>

<p align="center">
  <a href="https://github.com/codedogQBY/ReadAny/discussions">💬 Discussions</a> •
  <a href="https://github.com/codedogQBY/ReadAny/issues">🐛 Issues</a>
</p>

<p align="center">
  <img src="assets/小红书群.jpg" width="200" alt="小红书群">
  <img src="assets/微信群.jpg" width="200" alt="微信群">
</p>

## ☕ Support the Project

If you find ReadAny helpful, consider buying me a coffee to support ongoing development!

<p align="center">
  <img src="assets/微信赞赏码.jpg" width="200" alt="微信赞赏码">
  <img src="assets/支付宝收款码.jpg" width="200" alt="支付宝收款码">
</p>

<p align="center">
  <a href="https://ifdian.net/a/codedogQBY">Dining Table on Afdian</a>
</p>

---

## Star History

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=codedogQBY/ReadAny&type=Date&theme=dark" />
  <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=codedogQBY/ReadAny&type=Date" />
  <img alt="Star History Chart" src="https://api.star-history.com/image?repos=codedogQBY/ReadAny&type=Date" />
</picture>
