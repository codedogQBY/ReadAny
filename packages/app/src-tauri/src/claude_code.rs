use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Mutex,
};
use tauri::{Emitter, State, WebviewWindow};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::oneshot,
};

const EVENT_NAME: &str = "claude-code-chat-event";

#[derive(Default)]
pub struct ClaudeCodeState {
    cancels: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeChatRequest {
    request_id: String,
    prompt: String,
    system_prompt: String,
    effort: Option<String>,
    model: Option<String>,
    tools: Option<Vec<String>>,
    disallowed_tools: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ClaudeCodeChatEvent {
    request_id: String,
    kind: String,
    line: Option<String>,
    content: Option<String>,
    code: Option<i32>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeCheckResult {
    available: bool,
    version: Option<String>,
    error: Option<String>,
}

#[tauri::command]
pub async fn claude_code_check() -> Result<ClaudeCodeCheckResult, String> {
    let output = new_claude_command()
        .arg("--version")
        .output()
        .await
        .map_err(|err| err.to_string())?;
    let text = if output.stdout.is_empty() {
        String::from_utf8_lossy(&output.stderr).trim().to_string()
    } else {
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    };

    Ok(ClaudeCodeCheckResult {
        available: output.status.success(),
        version: output.status.success().then_some(text.clone()),
        error: (!output.status.success()).then_some(text),
    })
}

#[tauri::command]
pub async fn claude_code_abort(
    state: State<'_, ClaudeCodeState>,
    request_id: String,
) -> Result<(), String> {
    if let Some(cancel) = state
        .cancels
        .lock()
        .map_err(|err| err.to_string())?
        .remove(&request_id)
    {
        let _ = cancel.send(());
    }
    Ok(())
}

#[tauri::command]
pub async fn claude_code_chat(
    window: WebviewWindow,
    state: State<'_, ClaudeCodeState>,
    request: ClaudeCodeChatRequest,
) -> Result<(), String> {
    let mut command = new_claude_command();
    command
        .arg("-p")
        .arg("--input-format")
        .arg("text")
        .arg("--output-format")
        .arg("stream-json")
        .arg("--verbose")
        .arg("--include-partial-messages")
        .arg("--system-prompt")
        .arg(&request.system_prompt)
        .arg("--permission-mode")
        .arg("bypassPermissions")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(model) = request
        .model
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        command.arg("--model").arg(model);
    }

    if let Some(effort) = request
        .effort
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        command.arg("--effort").arg(effort);
    }

    if let Some(tools) = request.tools.as_ref().filter(|items| !items.is_empty()) {
        command.arg("--tools").arg(tools.join(","));
    }

    if let Some(disallowed_tools) = request
        .disallowed_tools
        .as_ref()
        .filter(|items| !items.is_empty())
    {
        command
            .arg("--disallowedTools")
            .arg(disallowed_tools.join(","));
    }

    let mut child = command.spawn().map_err(|err| {
        format!(
            "Failed to start Claude Code. Make sure the claude CLI is installed and available: {}",
            err
        )
    })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Claude Code stdout unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Claude Code stderr unavailable".to_string())?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Claude Code stdin unavailable".to_string())?;

    stdin
        .write_all(request.prompt.as_bytes())
        .await
        .map_err(|err| err.to_string())?;
    stdin.shutdown().await.map_err(|err| err.to_string())?;
    drop(stdin);

    let stdout_window = window.clone();
    let stdout_request_id = request.request_id.clone();
    let stdout_handle = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = emit_event(
                &stdout_window,
                ClaudeCodeChatEvent {
                    request_id: stdout_request_id.clone(),
                    kind: "stdout".to_string(),
                    line: Some(line),
                    content: None,
                    code: None,
                    error: None,
                },
            );
        }
    });

    let stderr_window = window.clone();
    let stderr_request_id = request.request_id.clone();
    let stderr_handle = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = emit_event(
                &stderr_window,
                ClaudeCodeChatEvent {
                    request_id: stderr_request_id.clone(),
                    kind: "stderr".to_string(),
                    line: None,
                    content: Some(line),
                    code: None,
                    error: None,
                },
            );
        }
    });

    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    state
        .cancels
        .lock()
        .map_err(|err| err.to_string())?
        .insert(request.request_id.clone(), cancel_tx);

    let mut cancelled = false;
    let status = tokio::select! {
        status = child.wait() => status.map_err(|err| err.to_string())?,
        _ = cancel_rx => {
            cancelled = true;
            let _ = child.kill().await;
            child.wait().await.map_err(|err| err.to_string())?
        }
    };

    let _ = state
        .cancels
        .lock()
        .map_err(|err| err.to_string())?
        .remove(&request.request_id);

    let _ = stdout_handle.await;
    let _ = stderr_handle.await;

    emit_event(
        &window,
        ClaudeCodeChatEvent {
            request_id: request.request_id.clone(),
            kind: "exit".to_string(),
            line: None,
            content: None,
            code: status.code(),
            error: None,
        },
    )
    .map_err(|err| err.to_string())?;

    if cancelled {
        return Ok(());
    }

    if !status.success() {
        return Err(format!(
            "Claude Code exited unsuccessfully with code {}",
            status
                .code()
                .map_or_else(|| "unknown".to_string(), |code| code.to_string())
        ));
    }

    Ok(())
}

fn emit_event(window: &WebviewWindow, event: ClaudeCodeChatEvent) -> tauri::Result<()> {
    window.emit(EVENT_NAME, event)
}

fn new_claude_command() -> Command {
    let executable = resolve_claude_executable();
    let mut command = if is_windows_command_script(&executable) {
        let mut command = Command::new("cmd");
        command.arg("/C").arg(executable);
        command
    } else {
        Command::new(executable)
    };
    configure_hidden_process(&mut command);
    command
}

#[cfg(target_os = "windows")]
fn configure_hidden_process(command: &mut Command) {
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn configure_hidden_process(_command: &mut Command) {}

#[cfg(target_os = "windows")]
fn is_windows_command_script(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "cmd" | "bat"))
        .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
fn is_windows_command_script(_path: &Path) -> bool {
    false
}

#[cfg(target_os = "windows")]
fn resolve_claude_executable() -> PathBuf {
    if let Ok(path) = std::env::var("CLAUDE_EXE") {
        let path = PathBuf::from(path);
        if path.exists() {
            return path;
        }
    }

    if let Ok(appdata) = std::env::var("APPDATA") {
        let npm_root = PathBuf::from(appdata).join("npm");
        let candidates = [
            npm_root.join("claude.exe"),
            npm_root
                .join("node_modules")
                .join("@anthropic-ai")
                .join("claude-code")
                .join("bin")
                .join("claude.exe"),
            npm_root.join("claude.cmd"),
            npm_root
                .join("node_modules")
                .join("@anthropic-ai")
                .join("claude-code")
                .join("bin")
                .join("claude.cmd"),
        ];
        for candidate in candidates {
            if candidate.exists() {
                return candidate;
            }
        }
    }

    PathBuf::from("claude.cmd")
}

#[cfg(not(target_os = "windows"))]
fn resolve_claude_executable() -> PathBuf {
    if let Ok(path) = std::env::var("CLAUDE_EXE") {
        let path = PathBuf::from(path);
        if path.exists() {
            return path;
        }
    }
    PathBuf::from("claude")
}
