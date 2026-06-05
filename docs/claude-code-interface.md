# Claude Code Local Reading Assistant Interface

This document describes the desktop-only interface used by the ReadAny AI panel
when it is backed by the local Claude Code CLI. The goal is to keep the existing
chat UI and `StreamingChat` API stable while replacing the model execution path.

## Scope

- Desktop Tauri only.
- No local HTTP bridge is started.
- The frontend still calls `StreamingChat.stream(options)`.
- `StreamingChat` routes to `streamClaudeCodeAgent`, which calls a platform
  service method implemented by the Tauri desktop adapter.
- Claude Code model/provider configuration stays outside ReadAny. In practice,
  DeepSeek is selected through the user's local Claude Code environment or
  Claude Code configuration. ReadAny does not store provider API keys.

## Frontend entry point

The public chat surface remains:

```ts
new StreamingChat().stream({
  thread,
  book,
  semanticContext,
  enabledSkills,
  isVectorized,
  aiConfig,
  deepThinking,
  spoilerFree,
  getAvailableTools,
  onToken,
  onComplete,
  onAbort,
  onError,
  onToolCall,
  onToolResult,
  onReasoning,
  onCitation,
});
```

`StreamingChat.stream` converts ReadAny chat state into a Claude Code prompt and
maps Claude Code stream events back to the existing callbacks:

| Agent event | Existing callback |
| --- | --- |
| `token` | `onToken(content)` |
| `reasoning` | `onReasoning(content, stepType)` |
| `tool_call` | `onToolCall(name, args)` |
| `tool_result` | `onToolResult(name, result)` |
| `citation` | `onCitation(citation)` |
| `error` | `onError(error)` |

## Platform service contract

`IPlatformService` exposes the optional desktop-only methods below.

```ts
export interface ClaudeCodeChatRequest {
  requestId: string;
  prompt: string;
  systemPrompt: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  model?: string;
  tools?: string[];
  disallowedTools?: string[];
}

export interface ClaudeCodeChatHandlers {
  signal?: AbortSignal;
  onStdoutLine: (line: string) => void;
  onStderr?: (content: string) => void;
}

export interface IPlatformService {
  runClaudeCodeChat?(
    request: ClaudeCodeChatRequest,
    handlers: ClaudeCodeChatHandlers,
  ): Promise<void>;
  abortClaudeCodeChat?(requestId: string): Promise<void>;
  checkClaudeCode?(): Promise<{ available: boolean; version?: string; error?: string }>;
  extractBookChapter?(filePath: string, chapterIndex: number): Promise<ExtractedBookChapter | null>;
}
```

Mobile and web builds do not implement these methods. They should either keep
the previous AI route or show a clear unsupported-local-mode error.

## Tauri command interface

The desktop adapter calls three Tauri commands:

| Command | Purpose |
| --- | --- |
| `claude_code_check` | Runs `claude --version` and reports availability. |
| `claude_code_chat` | Starts one Claude Code CLI request and emits stream events. |
| `claude_code_abort` | Cancels a running request by `requestId` and kills the child process. |

`claude_code_chat` receives the camelCase `ClaudeCodeChatRequest` object from
TypeScript. Rust deserializes it as:

```rust
pub struct ClaudeCodeChatRequest {
    request_id: String,
    prompt: String,
    system_prompt: String,
    effort: Option<String>,
    model: Option<String>,
    tools: Option<Vec<String>>,
    disallowed_tools: Option<Vec<String>>,
}
```

It starts Claude Code with:

```text
claude -p
  --input-format text
  --output-format stream-json
  --verbose
  --include-partial-messages
  --system-prompt <systemPrompt>
  --permission-mode bypassPermissions
  --tools <comma-separated tools when provided>
```

The current reading assistant passes only:

```ts
tools: ["WebSearch", "WebFetch"]
```

This allows web lookup while avoiding file-editing and shell-style tools inside
the reading assistant.

On Windows, the child process is started with `CREATE_NO_WINDOW`, so Claude Code
does not open an extra console window.

## Tauri event stream

The Rust command emits `claude-code-chat-event` through the Tauri window.

```ts
type ClaudeCodeChatEvent = {
  requestId: string;
  kind: "stdout" | "stderr" | "exit";
  line?: string;
  content?: string;
  code?: number;
  error?: string;
};
```

- `stdout.line` is one `stream-json` line from Claude Code.
- `stderr.content` contains diagnostics and is not treated as failure by itself.
- `exit.code` is emitted after the child exits.
- A non-zero process exit becomes a user-visible error unless the request was
  cancelled.

## Claude Code stream mapping

The parser accepts Claude Code `stream-json` lines and emits ReadAny agent
events.

| Claude Code stream-json payload | ReadAny event |
| --- | --- |
| `content_block_delta` with `text_delta` | `token` |
| `content_block_delta` with `thinking_delta` | `reasoning` |
| `content_block_start` with `tool_use` | `tool_call` |
| `user.message.content[].type === "tool_result"` | `tool_result` |
| `result.is_error === true` | `error` |
| final `result.result` without streamed text | fallback `token` |

Partial assistant messages are de-duplicated by message id so cumulative text is
not rendered twice.

## ReadAny tool protocol

ReadAny library operations are not Claude Code MCP tools. They are a local
protocol interpreted by `streamClaudeCodeAgent`.

Claude Code may request ReadAny operations by ending a response with either:

````text
```readany
search-book: <bookId-or-title>=<query>
list-highlights: <bookId-or-title>
list-notes: <bookId-or-title>
```
````

or:

````text
```readany-ops
list-skills
```
````

Supported operation examples:

| Operation | Meaning |
| --- | --- |
| `search-book: bookId=query` | Search vectorized book chunks. |
| `list-highlights: bookId` | List highlights for one book. |
| `list-notes: bookId` | List notes for one book. |
| `list-bookmarks: bookId` | List bookmarks for one book. |
| `list-threads: bookId` | List chat threads for one book. |
| `add-note: bookId=title|content` | Add a book note. |
| `add-bookmark: bookId=label` | Add a bookmark. |
| `list-skills` | List enabled reading skills. |

Book references are resolved in this order:

1. `current`, `current-book`, or the current book title maps to the open book id.
2. Direct `getBook(reference)` lookup.
3. Exact title match.
4. Unique partial title match.

## Sync behavior

Claude Code conversations are stored through the same ReadAny chat tables as the
original AI panel:

- `threads`
- `messages`

Per-book reading memory is stored in:

- `book_memories`

Full-section translation output is stored as first-class SQL data in:

- `chapter_translations`

These tables are part of the normal WebDAV/S3/LAN sync snapshot, so Claude Code
chat history, per-book memory, and completed full-section translations sync the
same way as built-in reading data. Paragraph-level translation KV cache remains
a local compatibility and speed layer; when legacy cached chapter translations
are restored, ReadAny migrates them into `chapter_translations` so future syncs
use the durable record.

After operations execute, ReadAny emits visible tool cards, appends the results
to a continuation prompt, and calls Claude Code again. The agent can run up to
three ReadAny operation rounds for one user message. Repeated identical
operations are skipped.

## Reading context injection

For reading requests, the agent attempts to include richer local context before
calling Claude Code:

- current book metadata and `Book ID`;
- selected text quotes;
- visible reading context;
- current chapter text from local chunks when available;
- extracted chapter text from the local book file as a fallback;
- per-book memory.

When `spoilerFree` is enabled, context should not include content beyond the
current reading position.

## Per-book memory

Each book can have one compacted memory row in `book_memories`.

The prompt-facing shape is:

```ts
export interface BookMemory {
  bookId: string;
  summary: string;
  focus: string[];
  openQuestions: string[];
  recentQuestions: string[];
  lastChapterTitle?: string;
  lastChapterIndex?: number;
  lastPositionPercent?: number;
  totalMessages: number;
  lastCompactedAt: number;
  compactedMessageCount: number;
  updatedAt: number;
}
```

Memory is updated after an exchange through `updateBookMemoryAfterExchange`.
It is compacted when it exceeds configured list/summary limits or after 24
messages since the last compaction. This keeps repeated reading sessions useful
without allowing the prompt to grow unbounded.

## Security notes

- Do not commit provider API keys.
- ReadAny should not persist DeepSeek or Anthropic API keys for this local mode.
- Claude Code credentials and model routing are owned by the user's local Claude
  Code installation.
- The reading assistant should keep `tools` restricted to web-read tools unless
  a future feature explicitly needs a broader permission model.
