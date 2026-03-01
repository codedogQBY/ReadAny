<p align="center">
  <img src="packages/app/public/logo.svg" alt="ReadAny Logo" width="120" height="120">
</p>

<h1 align="center">ReadAny</h1>

<p align="center">
  <strong>Read Any, Understand More</strong>
</p>

<p align="center">
  An AI-powered desktop e-book reader with intelligent chat, semantic search, annotation, and knowledge management.
</p>

<p align="center">
  <a href="#features">Features</a> &bull;
  <a href="#screenshots">Screenshots</a> &bull;
  <a href="#installation">Installation</a> &bull;
  <a href="#development">Development</a> &bull;
  <a href="README_CN.md">中文文档</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" alt="Platform">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
</p>

---

<!-- TODO: Replace with a real hero screenshot or GIF -->
<!-- ![ReadAny Hero](docs/screenshots/hero.png) -->

## Features

### Multi-Format Support

Read your favorite e-books in any format:

- **EPUB**, **PDF**, **MOBI**, **AZW**, **AZW3**, **FB2**, **FBZ**, **CBZ**

### AI-Powered Reading

- **AI Chat Assistant** &mdash; Ask questions about your books with context-aware responses. The AI knows your current position, selected text, recent highlights, and chapter info.
- **Multiple AI Providers** &mdash; OpenAI, Anthropic Claude (with extended thinking), Google Gemini, and OpenAI-compatible endpoints (Ollama, DeepSeek, vLLM, etc.)
- **Semantic Search (RAG)** &mdash; Go beyond keyword search. Automatic book vectorization with hybrid retrieval (vector similarity + BM25). Supports local embeddings via Hugging Face Transformers or remote APIs.
- **Translation** &mdash; Translate selected text instantly via AI or DeepL API. 19 languages supported.
- **AI Skills** &mdash; Extensible skill system &mdash; built-in analysis, summarization, and entity extraction, or create your own with custom parameters and prompts.

### Annotation & Notes

- **Highlights** &mdash; 5 colors (yellow, green, blue, pink, purple) with wavy underline indicator for notes
- **Markdown Notes** &mdash; Rich note-taking with a TipTap-powered Markdown editor
- **Hover Tooltips** &mdash; Preview note content by hovering over annotated text
- **Notebook Panel** &mdash; Browse, edit, and manage all your highlights and notes in one place
- **Export** &mdash; Export annotations to Markdown, HTML, JSON, Obsidian, or Notion format

### Library Management

- **Book Organization** &mdash; Drag-and-drop import with automatic metadata extraction
- **Search & Filter** &mdash; By title, author, or tags; sort by title, author, date added, last opened, or progress
- **Progress Tracking** &mdash; Auto-save reading progress and resume where you left off

### Reading Statistics

- Per-session and per-book reading duration tracking with idle detection
- Date-range filtering and historical charts

### Customizable Reading Experience

- **Font Settings** &mdash; Adjustable font size (12&ndash;32px), line height, margins, and paragraph spacing
- **Font Themes** &mdash; 5 built-in themes with CJK support (System Default, Classic Serif, Modern Sans, Elegant Kai, Literata)
- **View Modes** &mdash; Paginated or continuous scroll
- **Themes** &mdash; Light and dark mode
- **Tabs** &mdash; Keep multiple books and chats open simultaneously
- **Keyboard Shortcuts** &mdash; Navigate, search, and control the reader from the keyboard
- **i18n** &mdash; English and Simplified Chinese interface

---

## Screenshots

<!-- TODO: Add screenshots to docs/screenshots/ directory, then uncomment below -->

| Library View | Reader View | AI Chat |
|:------------:|:-----------:|:-------:|
| ![Library](docs/screenshots/library.png) | ![Reader](docs/screenshots/reader.png) | ![AI Chat](docs/screenshots/chat.png) |

| Notes Panel | Mindmap | Settings |
|:-----------:|:-------:|:--------:|
| ![Notes](docs/screenshots/notes.png) | ![Mindmap](docs/screenshots/mindmap.png) | ![Settings](docs/screenshots/settings.png) |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Runtime | [Tauri 2](https://tauri.app/) (Rust) |
| Frontend | [React 19](https://react.dev/) + [TypeScript 5](https://www.typescriptlang.org/) |
| Build | [Vite 7](https://vite.dev/) |
| Styling | [Tailwind CSS 4](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/) |
| State | [Zustand](https://zustand.docs.pmnd.rs/) |
| Database | SQLite via [tauri-plugin-sql](https://github.com/nicepkg/tauri-plugin-sql) |
| E-Book Rendering | [foliate-js](https://github.com/johnfactotum/foliate-js) |
| AI / LLM | [LangChain.js](https://js.langchain.com/) + [LangGraph](https://langchain-ai.github.io/langgraphjs/) |
| Embeddings | [Hugging Face Transformers.js](https://huggingface.co/docs/transformers.js) |
| Markdown | [TipTap](https://tiptap.dev/) + [marked](https://marked.js.org/) |
| i18n | [i18next](https://www.i18next.com/) |
| Icons | [Lucide](https://lucide.dev/) |

---

## Installation

### Download

Download the latest release for your platform:

<!-- TODO: Update download links when releases are available -->
- [macOS (Apple Silicon)](https://github.com/xxx/ReadAny/releases)
- [macOS (Intel)](https://github.com/xxx/ReadAny/releases)
- [Windows](https://github.com/xxx/ReadAny/releases)
- [Linux](https://github.com/xxx/ReadAny/releases)

### Build from Source

#### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 9
- [Rust](https://www.rust-lang.org/tools/install)
- Platform-specific Tauri dependencies &mdash; see the [Tauri Prerequisites Guide](https://v2.tauri.app/start/prerequisites/)

#### Steps

```bash
# Clone the repository
git clone https://github.com/xxx/ReadAny.git
cd ReadAny

# Install dependencies
pnpm install

# Build the application
pnpm tauri build
```

The built application will be in `packages/app/src-tauri/target/release/bundle/`.

---

## Development

### Quick Start

```bash
# Install dependencies
pnpm install

# Start full Tauri desktop app in dev mode
pnpm tauri dev
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start the Vite dev server (web only) |
| `pnpm tauri dev` | Start the full Tauri desktop app in dev mode |
| `pnpm tauri build` | Build the production desktop application |
| `pnpm lint` | Lint all code with Biome |
| `pnpm lint:fix` | Auto-fix lint issues |

### Project Structure

```
ReadAny/
├── packages/
│   ├── app/                    # Main Tauri + React application
│   │   ├── src/
│   │   │   ├── components/     # React components by feature
│   │   │   │   ├── reader/     # Reading interface
│   │   │   │   ├── chat/       # AI chat UI
│   │   │   │   ├── annotation/ # Highlights & notes
│   │   │   │   ├── home/       # Library / homepage
│   │   │   │   ├── notes/      # Notes view
│   │   │   │   ├── settings/   # Settings
│   │   │   │   ├── stats/      # Statistics
│   │   │   │   ├── layout/     # App layout, sidebar, tabs
│   │   │   │   └── ui/         # Reusable UI primitives
│   │   │   ├── pages/          # Page-level components
│   │   │   ├── stores/         # Zustand state management
│   │   │   ├── lib/            # Core libraries
│   │   │   │   ├── ai/         # LLM providers, agents, skills, tools
│   │   │   │   ├── rag/        # Vectorization, chunking, search
│   │   │   │   ├── reader/     # Book loading, font themes, progress
│   │   │   │   ├── translation/# Translation providers
│   │   │   │   ├── db/         # SQLite database layer
│   │   │   │   ├── export/     # Export utilities
│   │   │   │   └── stats/      # Reading statistics
│   │   │   ├── hooks/          # Custom React hooks
│   │   │   ├── types/          # TypeScript type definitions
│   │   │   ├── i18n/           # Internationalization (en / zh)
│   │   │   └── styles/         # Global CSS
│   │   ├── src-tauri/          # Rust backend & Tauri config
│   │   └── public/             # Static assets (logo, fonts, vendor)
│   └── foliate-js/             # E-book rendering engine (fork)
├── package.json                # pnpm workspace root
├── pnpm-workspace.yaml
└── biome.json                  # Linter & formatter config
```

---

## Configuration

### AI Providers

Configure your AI providers in **Settings > AI**:

| Provider | What You Need |
|----------|--------------|
| OpenAI | API key from [platform.openai.com](https://platform.openai.com/) |
| Anthropic Claude | API key from [console.anthropic.com](https://console.anthropic.com/) |
| Google Gemini | API key from [aistudio.google.com](https://aistudio.google.com/) |
| Ollama / DeepSeek / vLLM | Custom endpoint URL (OpenAI-compatible) |

### Embedding Models

For semantic search (RAG), you can choose:

- **Local models** (default) &mdash; Runs entirely offline using Hugging Face Transformers.js
- **Remote API** &mdash; Use OpenAI or other embedding APIs

### Translation

- **AI Translation** &mdash; Uses your configured LLM directly, no extra setup
- **DeepL** &mdash; Requires a DeepL API key from [deepl.com/pro-api](https://www.deepl.com/pro-api)

---

## Contributing

Contributions are welcome! Whether it's bug reports, feature requests, or pull requests.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Before submitting, please run `pnpm lint` and follow the existing code style.

---

## License

This project is licensed under the MIT License &mdash; see the [LICENSE](LICENSE) file for details.

The bundled [foliate-js](packages/foliate-js/) library is licensed under MIT by [John Factotum](https://github.com/johnfactotum/foliate-js).

---

## Acknowledgments

- [foliate-js](https://github.com/johnfactotum/foliate-js) &mdash; E-book rendering engine
- [Tauri](https://tauri.app/) &mdash; Cross-platform desktop runtime
- [LangChain.js](https://js.langchain.com/) &mdash; AI/LLM orchestration
- [Radix UI](https://www.radix-ui.com/) &mdash; Accessible UI primitives
- [Lucide](https://lucide.dev/) &mdash; Icon library

---

<p align="center">
  Made with &#10084; by the ReadAny Team
</p>
