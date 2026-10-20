---
draft: false
title: AI Chat
description: Chat with AI about your books for deeper understanding.
---

## Overview

ReadAny's AI Chat lets you have context-aware conversations about the book you're reading. The AI knows your current chapter, selected text, and reading progress.

## Getting Started

1. Open a book and click the **AI Chat** icon in the sidebar
2. Type your question or select text and click "Ask AI"
3. The AI will respond with context from the book

## What You Can Ask

- **Summarize** — "Summarize this chapter"
- **Explain** — "Explain the concept of X mentioned here"
- **Discuss** — "What is the author's argument about Y?"
- **Compare** — "Compare the themes in chapters 3 and 5"
- **Translate** — "Translate the selected paragraph to Chinese"

## Context Awareness

The AI automatically receives:
- The text of your current chapter
- Any text you've selected
- Your reading position and progress
- Book metadata (title, author)

This context enables precise, relevant answers without needing to re-explain what you're reading.

## Configuring AI Providers

See [AI Providers](/ReadAny/support/ai/providers/) for setup instructions.


## Web search on desktop

Ask “Search the web for background on this author” or “Read https://example.org/article”
to use [Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp).
Search uses Fast mode and needs no Parallel account or API key. Configure your
usual AI model first; web results return to that model for the answer. Sources
appear as ordinary Markdown links, separate from book citation markers.

Parallel is the built-in provider for explicit web requests on desktop. Ordinary
book questions continue to use local book tools. In **Settings → AI → Web search
(Parallel)**, turn off web search to prevent these requests. Your AI model and
saved endpoint settings are kept. Mobile web search is not supported yet.

Web tool queries and URLs are sent to Parallel, along with an opaque conversation
ID and your configured model name. The agent is instructed to use short public
topic queries and avoid private book passages, highlights, and notes. Avoid asking
for web searches about sensitive text. See [Parallel's privacy policy](https://parallel.ai/privacy-policy).
The free service has usage limits; if a request fails, the assistant reports the
failure rather than silently switching providers. You can cancel a request with
Stop; a web request times out after 25 seconds.
