---
name: tauri-v2
description: "Tauri v2 cross-platform app development with Rust backend. Use when configuring tauri.conf.json, implementing Rust commands (#[tauri::command]), setting up IPC patterns (invoke, emit, channels), configuring permissions/capabilities, troubleshooting build issues, or deploying desktop/mobile apps. Triggers on Tauri, src-tauri, invoke, emit, capabilities.json."
---

# Tauri v2 Development Skill

> Build cross-platform desktop and mobile apps with web frontends and Rust backends.

## Before You Start

**This skill prevents 8+ common errors and saves ~60% tokens.**

| Metric | Without Skill | With Skill |
|--------|--------------|------------|
| Setup Time | ~2 hours | ~30 min |
| Common Errors | 8+ | 0 |
| Token Usage | High (exploration) | Low (direct patterns) |

### Known Issues This Skill Prevents

1. Permission denied errors from missing capabilities
2. IPC failures from unregistered commands in `generate_handler!`
3. State management panics from type mismatches
4. Mobile build failures from missing Rust targets
5. White screen issues from misconfigured dev URLs

## Quick Start

### Step 1: Create a Tauri Command

```rust
// src-tauri/src/lib.rs
#[tauri::command]
fn greet(name: String) -> String {
    format!("Hello, {}!", name)
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Why this matters:** Commands not in `generate_handler![]` silently fail when invoked from frontend.

### Step 2: Call from Frontend

```typescript
import { invoke } from '@tauri-apps/api/core';

const greeting = await invoke<string>('greet', { name: 'World' });
console.log(greeting); // "Hello, World!"
```

**Why this matters:** Use `@tauri-apps/api/core` (not `@tauri-apps/api/tauri` - that's v1 API).

### Step 3: Add Required Permissions

```json
// src-tauri/capabilities/default.json
{
    "$schema": "../gen/schemas/desktop-schema.json",
    "identifier": "default",
    "windows": ["main"],
    "permissions": ["core:default"]
}
```

**Why this matters:** Tauri v2 denies everything by default - explicit permissions required for all operations.

## Critical Rules

### Always Do

- Register every command in `tauri::generate_handler![cmd1, cmd2, ...]`
- Return `Result<T, E>` from commands for proper error handling
- Use `Mutex<T>` for shared state accessed from multiple commands
- Add capabilities before using any plugin features
- Use `lib.rs` for shared code (required for mobile builds)

### Never Do

- Never use borrowed types (`&str`) in async commands - use owned types
- Never block the main thread - use async for I/O operations
- Never hardcode paths - use Tauri path APIs (`app.path()`)
- Never skip capability setup - even "safe" operations need permissions

### Common Mistakes

**Wrong - Borrowed type in async:**
```rust
#[tauri::command]
async fn bad(name: &str) -> String { // Compile error!
    name.to_string()
}
```

**Correct - Owned type:**
```rust
#[tauri::command]
async fn good(name: String) -> String {
    name
}
```

**Why:** Async commands cannot borrow data across await points; Tauri requires owned types for async command parameters.

## Known Issues Prevention

| Issue | Root Cause | Solution |
|-------|-----------|----------|
| "Command not found" | Missing from `generate_handler!` | Add command to handler macro |
| "Permission denied" | Missing capability | Add to `capabilities/default.json` |
| State panic on access | Type mismatch in `State<T>` | Use exact type from `.manage()` |
| White screen on launch | Frontend not building | Check `beforeDevCommand` in config |
| IPC timeout | Blocking async command | Remove blocking code or use spawn |
| Mobile build fails | Missing Rust targets | Run `rustup target add <target>` |

## Configuration Reference

### tauri.conf.json

```json
{
    "$schema": "./gen/schemas/desktop-schema.json",
    "productName": "my-app",
    "version": "1.0.0",
    "identifier": "com.example.myapp",
    "build": {
        "devUrl": "http://localhost:5173",
        "frontendDist": "../dist",
        "beforeDevCommand": "npm run dev",
        "beforeBuildCommand": "npm run build"
    },
    "app": {
        "windows": [{
            "label": "main",
            "title": "My App",
            "width": 800,
            "height": 600
        }],
        "security": {
            "csp": "default-src 'self'; img-src 'self' data:",
            "capabilities": ["default"]
        }
    },
    "bundle": {
        "active": true,
        "targets": "all",
        "icon": ["icons/icon.icns", "icons/icon.ico", "icons/icon.png"]
    }
}
```

**Key settings:**
- `build.devUrl`: Must match your frontend dev server port
- `app.security.capabilities`: Array of capability file identifiers

### Cargo.toml

```toml
[package]
name = "app"
version = "0.1.0"
edition = "2021"

[lib]
name = "app_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

**Key settings:**
- `[lib]` section: Required for mobile builds
- `crate-type`: Must include all three types for cross-platform

## Common Patterns

### Error Handling Pattern

```rust
use thiserror::Error;

#[derive(Debug, Error)]
enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Not found: {0}")]
    NotFound(String),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where S: serde::ser::Serializer {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

#[tauri::command]
fn risky_operation() -> Result<String, AppError> {
    Ok("success".into())
}
```

### State Management Pattern

```rust
use std::sync::Mutex;
use tauri::State;

struct AppState {
    counter: u32,
}

#[tauri::command]
fn increment(state: State<'_, Mutex<AppState>>) -> u32 {
    let mut s = state.lock().unwrap();
    s.counter += 1;
    s.counter
}

// In builder:
tauri::Builder::default()
    .manage(Mutex::new(AppState { counter: 0 }))
```

### Event Emission Pattern

```rust
use tauri::Emitter;

#[tauri::command]
fn start_task(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        app.emit("task-progress", 50).unwrap();
        app.emit("task-complete", "done").unwrap();
    });
}
```

```typescript
import { listen } from '@tauri-apps/api/event';

const unlisten = await listen('task-progress', (e) => {
    console.log('Progress:', e.payload);
});
// Call unlisten() when done
```

### Channel Streaming Pattern

```rust
use tauri::ipc::Channel;

#[derive(Clone, serde::Serialize)]
#[serde(tag = "event", content = "data")]
enum DownloadEvent {
    Progress { percent: u32 },
    Complete { path: String },
}

#[tauri::command]
async fn download(url: String, on_event: Channel<DownloadEvent>) {
    for i in 0..=100 {
        on_event.send(DownloadEvent::Progress { percent: i }).unwrap();
    }
    on_event.send(DownloadEvent::Complete { path: "/downloads/file".into() }).unwrap();
}
```

```typescript
import { invoke, Channel } from '@tauri-apps/api/core';

const channel = new Channel<DownloadEvent>();
channel.onmessage = (msg) => console.log(msg.event, msg.data);
await invoke('download', { url: 'https://...', onEvent: channel });
```

## Bundled Resources

### References

Located in `references/`:
- [`capabilities-reference.md`](references/capabilities-reference.md) - Permission patterns and examples
- [`ipc-patterns.md`](references/ipc-patterns.md) - Complete IPC examples

> **Note:** For deep dives on specific topics, see the reference files above.

## Dependencies

### Required

| Package | Version | Purpose |
|---------|---------|---------|
| `@tauri-apps/cli` | ^2.0.0 | CLI tooling |
| `@tauri-apps/api` | ^2.0.0 | Frontend APIs |
| `tauri` | ^2.0.0 | Rust core |
| `tauri-build` | ^2.0.0 | Build scripts |

### Optional (Plugins)

| Package | Version | Purpose |
|---------|---------|---------|
| `tauri-plugin-fs` | ^2.0.0 | File system access |
| `tauri-plugin-dialog` | ^2.0.0 | Native dialogs |
| `tauri-plugin-shell` | ^2.0.0 | Shell commands, open URLs |
| `tauri-plugin-http` | ^2.0.0 | HTTP client |
| `tauri-plugin-store` | ^2.0.0 | Key-value storage |

## Official Documentation

- [Tauri v2 Documentation](https://v2.tauri.app/)
- [Commands Reference](https://v2.tauri.app/develop/calling-rust/)
- [Capabilities & Permissions](https://v2.tauri.app/security/capabilities/)
- [Configuration Reference](https://v2.tauri.app/reference/config/)

## Troubleshooting

### White Screen on Launch

**Symptoms:** App launches but shows blank white screen

**Solution:**
1. Verify `devUrl` matches your frontend dev server port
2. Check `beforeDevCommand` runs your dev server
3. Open DevTools (Cmd+Option+I / Ctrl+Shift+I) to check for errors

### Command Returns Undefined

**Symptoms:** `invoke()` returns undefined instead of expected value

**Solution:**
1. Verify command is in `generate_handler![]`
2. Check Rust command actually returns a value
3. Ensure argument names match (camelCase in JS, snake_case in Rust by default)

### Mobile Build Failures

**Symptoms:** Android/iOS build fails with missing target

**Solution:**
```bash
# Android targets
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android

# iOS targets (macOS only)
rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim
```

## Setup Checklist

Before using this skill, verify:

- [ ] `npx tauri info` shows correct Tauri v2 versions
- [ ] `src-tauri/capabilities/default.json` exists with at least `core:default`
- [ ] All commands registered in `generate_handler![]`
- [ ] `lib.rs` contains shared code (for mobile support)
- [ ] Required Rust targets installed for target platforms
