//! Native WebDAV file transfer for large book/cover files.
//!
//! Streams directly between disk and the HTTP server inside Rust so
//! multi-megabyte payloads never enter the webview's JS heap — plugin-http
//! serializes request bodies as JS number arrays on the renderer main
//! thread, which froze the whole app during library sync.

use std::collections::HashMap;

use tauri::ipc::Channel;
use tauri_plugin_http::reqwest;

const TRANSFER_TIMEOUT_SECS: u64 = 300;

fn build_client(allow_insecure: Option<bool>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(TRANSFER_TIMEOUT_SECS));
    if allow_insecure.unwrap_or(false) {
        builder = builder
            .danger_accept_invalid_certs(true)
            .danger_accept_invalid_hostnames(true);
    }
    builder
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))
}

fn to_header_map(headers: &HashMap<String, String>) -> reqwest::header::HeaderMap {
    let mut map = reqwest::header::HeaderMap::new();
    for (key, value) in headers {
        if let (Ok(name), Ok(value)) = (
            reqwest::header::HeaderName::from_bytes(key.as_bytes()),
            reqwest::header::HeaderValue::from_str(value),
        ) {
            map.insert(name, value);
        }
    }
    map
}

#[derive(Clone, serde::Serialize)]
pub struct TransferProgress {
    loaded: u64,
    total: u64,
}

/// Stream a local file to the server via PUT. The file is read on the Rust
/// side; the webview only receives success/failure.
#[tauri::command(async)]
pub async fn webdav_upload_file(
    url: String,
    file_path: String,
    headers: HashMap<String, String>,
    allow_insecure: Option<bool>,
) -> Result<(), String> {
    let client = build_client(allow_insecure)?;
    let data = tokio::fs::read(&file_path)
        .await
        .map_err(|e| format!("failed to read {file_path}: {e}"))?;
    let response = client
        .put(&url)
        .headers(to_header_map(&headers))
        .body(data)
        .send()
        .await
        .map_err(|e| format!("WebDAV PUT failed for {url}: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("WebDAV PUT failed for {url}: {status}"));
    }
    Ok(())
}

/// Stream a server file to local disk via GET, reporting progress over the
/// IPC channel (the JS side throttles UI updates).
#[tauri::command(async)]
pub async fn webdav_download_file(
    url: String,
    file_path: String,
    headers: HashMap<String, String>,
    allow_insecure: Option<bool>,
    on_progress: Channel<TransferProgress>,
) -> Result<(), String> {
    let client = build_client(allow_insecure)?;
    let mut response = client
        .get(&url)
        .headers(to_header_map(&headers))
        .send()
        .await
        .map_err(|e| format!("WebDAV GET failed for {url}: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("WebDAV GET failed for {url}: {status}"));
    }

    let total = response.content_length().unwrap_or(0);
    if let Some(parent) = std::path::Path::new(&file_path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("failed to create {parent:?}: {e}"))?;
    }
    let mut file = tokio::fs::File::create(&file_path)
        .await
        .map_err(|e| format!("failed to create {file_path}: {e}"))?;

    let mut loaded: u64 = 0;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("download read failed: {e}"))?
    {
        {
            use tokio::io::AsyncWriteExt;
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("download write failed: {e}"))?;
        }
        loaded += chunk.len() as u64;
        let _ = on_progress.send(TransferProgress { loaded, total });
    }
    {
        use tokio::io::AsyncWriteExt;
        file.flush()
            .await
            .map_err(|e| format!("download flush failed: {e}"))?;
    }
    Ok(())
}
