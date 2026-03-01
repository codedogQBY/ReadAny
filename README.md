<p align="center">
  <img src="packages/app/public/logo.svg" alt="ReadAny Logo" width="120" height="120">
</p>

<h1 align="center">ReadAny</h1>

<p align="center">
  <strong>Read Any, Understand More</strong>
</p>

<p align="center">
  An AI-powered desktop e-book reader with intelligent annotation, note-taking, and knowledge management.
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#screenshots">Screenshots</a> •
  <a href="#installation">Installation</a> •
  <a href="#development">Development</a> •
  <a href="README_CN.md">中文文档</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" alt="Platform">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
</p>

---

## Features

### 📖 Multi-Format Support
Read your favorite e-books in any format:
- EPUB, PDF, MOBI, AZW, AZW3, FB2, FBZ

### 🤖 AI-Powered Reading
- **AI Chat Assistant** - Ask questions about your books with context-aware responses
- **Multiple AI Providers** - Support for OpenAI, Anthropic Claude, and Google Gemini
- **Deep Thinking Mode** - Extended reasoning for complex analysis
- **Translation** - Built-in translation for selected text
- **Semantic Search (RAG)** - Vector-based search with local or remote embedding models

### ✍️ Annotation & Notes
- **Highlights** - Multiple colors (yellow, green, blue, pink, purple)
- **Notes** - Add Markdown notes to highlighted text
- **Export** - Export annotations to Markdown, JSON, Obsidian, or Notion format

### 📚 Library Management
- **Book Organization** - Import, organize, and search your book collection
- **Progress Tracking** - Auto-save reading progress and resume where you left off
- **Reading Statistics** - Track your reading time, streaks, and activity

### 🧠 Knowledge Management
- **Mindmap View** - Visualize book structure and concepts
- **Skills System** - Customizable AI tool extensions
- **Notebook Panel** - Centralized management of all your highlights and notes

### 🎨 Customizable Reading
- **Font Settings** - Adjustable font size, line height, and font themes
- **View Modes** - Paginated or continuous scroll
- **Themes** - Light and dark mode support
- **Multi-language** - English and Chinese interface

---

## Screenshots

<!-- Add your screenshots here -->
> **Note**: Add screenshots to `docs/screenshots/` directory

| Library View | Reader View | AI Chat |
|:------------:|:-----------:|:-------:|
| ![Library](docs/screenshots/library.png) | ![Reader](docs/screenshots/reader.png) | ![AI Chat](docs/screenshots/chat.png) |

| Notes Panel | Mindmap | Settings |
|:-----------:|:-------:|:--------:|
| ![Notes](docs/screenshots/notes.png) | ![Mindmap](docs/screenshots/mindmap.png) | ![Settings](docs/screenshots/settings.png) |

---

## Tech Stack

### Frontend
| Technology | Purpose |
|------------|---------|
| React 19 | UI Framework |
| TypeScript | Type Safety |
| Vite 7 | Build Tool |
| Tailwind CSS 4 | Styling |
| Zustand | State Management |
| Radix UI | UI Components |
| i18next | Internationalization |

### Desktop
| Technology | Purpose |
|------------|---------|
| Tauri v2 | Native Desktop Framework |
| Rust | Backend Logic |
| SQLite | Local Database |

### AI & LLM
| Technology | Purpose |
|------------|---------|
| LangChain | LLM Orchestration |
| OpenAI / Claude / Gemini | AI Providers |
| Hugging Face Transformers | Local Embeddings |

---

## Installation

### Download

Download the latest release for your platform:

- [macOS (Apple Silicon)](https://readany.app/download/mac-arm64)
- [macOS (Intel)](https://readany.app/download/mac-x64)
- [Windows](https://readany.app/download/windows)
- [Linux](https://readany.app/download/linux)

### Build from Source

#### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 8
- [Rust](https://www.rust-lang.org/) >= 1.70
- Platform-specific dependencies:
  - **macOS**: Xcode Command Line Tools
  - **Windows**: Microsoft Visual Studio C++ Build Tools
  - **Linux**: `webkit2gtk`, `openssl`, `curl`, `wget`

#### Build Steps

```bash
# Clone the repository
git clone https://github.com/yourusername/readany.git
cd readany

# Install dependencies
pnpm install

# Build the application
pnpm --filter app tauri build
```

---

## Development

### Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm --filter app tauri dev
```

### Project Structure

```
ReadAny/
├── packages/
│   ├── app/                    # Main Tauri application
│   │   ├── src/                # React frontend
│   │   │   ├── components/     # UI components
│   │   │   ├── hooks/          # React hooks
│   │   │   ├── lib/            # Core libraries
│   │   │   │   ├── ai/         # AI integration
│   │   │   │   ├── rag/        # RAG implementation
│   │   │   │   └── reader/     # Reader logic
│   │   │   ├── stores/         # Zustand stores
│   │   │   └── types/          # TypeScript types
│   │   ├── src-tauri/          # Rust backend
│   │   └── public/             # Static assets
│   └── foliate-js/             # E-book rendering library
└── .claude/                    # AI assistant skills
```

### Available Scripts

```bash
# Development
pnpm --filter app dev           # Start frontend dev server
pnpm --filter app tauri dev     # Start full app in dev mode

# Build
pnpm --filter app build         # Build frontend
pnpm --filter app tauri build   # Build production app

# Type checking
pnpm --filter app tsc --noEmit  # Run TypeScript checks
```

---

## Configuration

### AI Providers

Configure your AI providers in Settings:

1. **OpenAI** - Requires API key
2. **Anthropic Claude** - Requires API key
3. **Google Gemini** - Requires API key

### Embedding Models

For semantic search (RAG), you can choose:

- **Local Models** (default) - Runs entirely offline
- **Remote API** - Use OpenAI or other embedding APIs

---

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- [foliate](https://github.com/johnfactotum/foliate) - E-book rendering inspiration
- [Tauri](https://tauri.app/) - Cross-platform desktop framework
- [LangChain](https://langchain.com/) - LLM orchestration

---

<p align="center">
  Made with ❤️ by the ReadAny Team
</p>
