# Tauri v2 Development Skill

> Build cross-platform desktop and mobile apps with web frontends and Rust backends.

| | |
|---|---|
| **Status** | Active |
| **Version** | 1.0.0 |
| **Last Updated** | 2025-12-31 |
| **Confidence** | 4/5 |
| **Production Tested** | https://v2.tauri.app/ |

## What This Skill Does

Provides expert assistance for Tauri v2 application development, covering the full development lifecycle from project setup to cross-platform deployment. Specializes in Rust backend commands, IPC patterns, security configuration, and frontend-backend communication.

### Core Capabilities

- Implement Rust commands with `#[tauri::command]` and proper error handling
- Configure IPC patterns (invoke, events, channels) for frontend-backend communication
- Set up security capabilities and permissions for plugins and APIs
- Build and deploy for desktop (macOS, Windows, Linux) and mobile (iOS, Android)
- Integrate Vite + TanStack Router frontends with Tauri backends
- Configure tauri.conf.json and Cargo.toml for cross-platform builds

## Auto-Trigger Keywords

### Primary Keywords
Exact terms that strongly trigger this skill:
- tauri
- tauri v2
- tauri.conf.json
- src-tauri
- #[tauri::command]
- tauri::invoke
- capabilities.json

### Secondary Keywords
Related terms that may trigger in combination:
- rust backend
- desktop app
- cross-platform app
- webview
- invoke command
- emit event
- app permissions
- bundle desktop

### Error-Based Keywords
Common error messages that should trigger this skill:
- "Command not found"
- "Permission denied" (in Tauri context)
- "Failed to invoke command"
- "Missing capability"
- "Cannot read property of undefined" (invoke result)
- "tauri build failed"
- "Missing Rust target"

## Known Issues Prevention

| Issue | Root Cause | Solution |
|-------|-----------|----------|
| Command not found | Missing from `generate_handler![]` | Register all commands in the macro |
| Permission denied | Missing capability configuration | Add required permissions to capabilities file |
| State access panic | Type mismatch in `State<T>` | Use exact type matching `.manage()` call |
| White screen | Frontend not building | Verify `beforeDevCommand` and `devUrl` |
| Mobile build fails | Missing Rust targets | Run `rustup target add <platform-targets>` |
| IPC timeout | Blocking in async command | Use non-blocking async or spawn threads |

## When to Use

### Use This Skill For
- Creating new Tauri v2 projects or commands
- Configuring permissions and capabilities
- Setting up IPC (invoke, events, channels)
- Debugging command invocation issues
- Cross-platform build configuration
- Plugin integration and configuration
- Mobile (iOS/Android) deployment setup

### Don't Use This Skill For
- Tauri v1 development (use migration guide then this skill)
- Pure frontend development without Tauri integration
- Native mobile development (Swift/Kotlin directly)
- Backend API development without Tauri

## Quick Usage

```bash
# Create new Tauri project
npm create tauri-app@latest

# Add Tauri to existing project
npm install -D @tauri-apps/cli@latest
npx tauri init

# Development
npm run tauri dev

# Build
npm run tauri build
```

## Token Efficiency

| Approach | Estimated Tokens | Time |
|----------|-----------------|------|
| Manual Implementation | ~15,000 | 2+ hours |
| With This Skill | ~6,000 | 30 min |
| **Savings** | **60%** | **~1.5 hours** |

## File Structure

```
tauri-v2/
├── SKILL.md        # Detailed instructions and patterns
├── README.md       # This file - discovery and quick reference
└── references/     # Supporting documentation
    ├── capabilities-reference.md
    └── ipc-patterns.md
```

## Dependencies

| Package | Version | Verified |
|---------|---------|----------|
| `@tauri-apps/cli` | ^2.0.0 | 2025-12-31 |
| `@tauri-apps/api` | ^2.0.0 | 2025-12-31 |
| `tauri` (Rust) | ^2.0.0 | 2025-12-31 |
| `tauri-build` (Rust) | ^2.0.0 | 2025-12-31 |

## Official Documentation

- [Tauri v2 Documentation](https://v2.tauri.app/)
- [Commands Reference](https://v2.tauri.app/develop/calling-rust/)
- [IPC Concepts](https://v2.tauri.app/concept/inter-process-communication/)
- [Capabilities & Permissions](https://v2.tauri.app/security/capabilities/)
- [Configuration Reference](https://v2.tauri.app/reference/config/)
- [Plugin Directory](https://v2.tauri.app/plugin/)

## Related Skills

- `tanstack-start-expert` - TanStack Router patterns for type-safe frontend routing
- `react-component-architect` - React component patterns for Tauri frontends
- `go-google-style-expert` - Alternative backend patterns (if using Go instead)

---

**License:** MIT
