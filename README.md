<p align="center">
  <img src="packages/app/public/logo.svg" alt="ReadAny Logo" width="120" height="120">
</p>

<h1 align="center">ReadAny</h1>

<p align="center">
  <strong>Local-first AI e-book reader for desktop and mobile</strong>
</p>

<p align="center">
  <em>"Why do I forget what I read? Why are my notes scattered? Why can I only search by keywords?"</em>
</p>

<p align="center">
  ReadAny helps you ask questions about books, find ideas by meaning, and build a private reading knowledge base with RAG chat, semantic search, highlights, TTS, and WebDAV sync.
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

> 🚀 **v2.0 Update**: Mobile apps (iOS/Android) now available! See [Mobile](#mobile-apps) section below.

## AI-Native Reading Workflow

- **Chat with your library** - Ask questions about the current book or selected passages, with answers grounded in your reading context
- **Find ideas semantically** - Hybrid vector retrieval + BM25 search helps you find concepts even when the exact keyword is missing
- **Keep knowledge private** - Local embeddings and a local vector store keep your books, highlights, and notes offline-capable
- **Use your preferred model** - Connect OpenAI, Claude, Gemini, Ollama, DeepSeek, OrcaRouter, or custom-compatible providers

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
- **Multiple AI Providers** - OpenAI, Claude, Gemini, Ollama, DeepSeek, OrcaRouter
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
| iOS | [Join TestFlight](https://testflight.apple.com/join/qNdvNv2p) |
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

# Install/run the development build on iOS
pnpm expo:ios

# Install/run the development build on iOS Simulator
pnpm expo:ios:simulator

# Install/run the development build on Android
# Start an Android emulator first, or connect a device.
pnpm expo:android

# Start Metro for the installed development build
pnpm expo:start
```

Mobile development uses an Expo development build with `expo-dev-client`, not
Expo Go. Expo Go cannot load ReadAny's native modules and app configuration. Use
`pnpm expo:ios`, `pnpm expo:ios:simulator`, or `pnpm expo:android` the first
time, or whenever native dependencies/configuration change, then use
`pnpm expo:start` for daily JS debugging in the installed ReadAny development
app.

For simulators, use `pnpm expo:ios:simulator` on iOS. For Android, start an
Android emulator first, then run `pnpm expo:android`.

Mobile app source lives in [`packages/app-expo`](packages/app-expo).

### AI Configuration

| Provider | Get API Key |
|----------|-------------|
| OpenAI | [platform.openai.com](https://platform.openai.com/) |
| Anthropic Claude | [console.anthropic.com](https://console.anthropic.com/) |
| Google Gemini | [aistudio.google.com](https://aistudio.google.com/) |
| Ollama / DeepSeek | Local or custom endpoint |
| OrcaRouter | [orcarouter.ai](https://www.orcarouter.ai/) |

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

# Dev (Mobile - Expo development build, not Expo Go)
# First install/run the native development build:
pnpm expo:ios
pnpm expo:ios:simulator
pnpm expo:android

# Then start Metro for the installed development app:
pnpm expo:start

# Build
pnpm tauri build
```

Mobile development uses `expo-dev-client`, so Expo Go is not supported. Re-run
`pnpm expo:ios`, `pnpm expo:ios:simulator`, or `pnpm expo:android` after
changing native dependencies, `app.config.js`, permissions, schemes, or build
plugins.

**Requirements:** Node.js ≥18, pnpm ≥9, Rust (for Tauri), plus Xcode for iOS or
Android Studio/SDK for Android mobile development.

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
