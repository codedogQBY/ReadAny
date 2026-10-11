//! Native WebDAV file transfer for large book/cover files.
//!
//! Streams directly between disk and the HTTP server inside Rust so
//! multi-megabyte payloads never enter the webview's JS heap — plugin-http
//! serializes request bodies as JS number arrays on the renderer main
//! thread, which froze the whole app during library sync.

use std::collections::HashMap;
use std::time::Duration;

use tauri::ipc::Channel;
use tauri_plugin_http::reqwest;

/// Floor for a transfer's total budget. Requests without a size hint (and every
/// small payload: sync JSONs, covers) keep the historical 5-minute cap.
const TRANSFER_TIMEOUT_FLOOR_SECS: u64 = 300;
/// Worst-case throughput we are willing to wait out before calling a transfer
/// dead. A 100 MiB book therefore gets floor + ~53 min instead of a flat 5 min.
const TRANSFER_MIN_RATE_BYTES_PER_SEC: u64 = 32 * 1024;
/// Hard ceiling so a pathological size never yields an unbounded wait.
const TRANSFER_TIMEOUT_CEIL_SECS: u64 = 3 * 60 * 60;
/// Idle guard used by the DOWNLOAD client only: a single stalled body read (no
/// bytes for this long) aborts the transfer, which is what lets downloads run
/// without a total cap.
///
/// Must NOT be applied to uploads: reqwest polls its read timeout while awaiting
/// the response (see `PendingRequest::poll` in reqwest 0.12), and a server only
/// answers a PUT once the whole body has arrived — so a read timeout on an upload
/// silently becomes an upload deadline. That is exactly how the first iteration of
/// this fix re-broke long uploads (every book cut at 120s).
const TRANSFER_IDLE_TIMEOUT_SECS: u64 = 120;
/// Establishing the connection should fail fast (unreachable host / wrong port).
const CONNECT_TIMEOUT_SECS: u64 = 15;

/// Total request budget for a transfer carrying `payload_bytes`.
///
/// WHY (2026-09-26 incident): this used to be a flat `timeout(300s)`. reqwest's
/// client timeout covers the whole exchange including the request body, so a
/// book that needed more than 5 minutes to upload was aborted *mid-body*. The
/// server (pfm) saw a truncated PUT — `write staging: unexpected EOF` → HTTP 500
/// — and sync retried the same file forever: 3 books, 16 failed attempts, every
/// single one cut at ~5 minutes, while smaller books finished in seconds.
/// A size-aware budget lets slow-but-progressing transfers finish.
fn transfer_budget(payload_bytes: Option<u64>) -> Duration {
    let secs = match payload_bytes {
        Some(bytes) if bytes > 0 => {
            let needed = bytes / TRANSFER_MIN_RATE_BYTES_PER_SEC;
            TRANSFER_TIMEOUT_FLOOR_SECS
                .saturating_add(needed)
                .min(TRANSFER_TIMEOUT_CEIL_SECS)
        }
        _ => TRANSFER_TIMEOUT_FLOOR_SECS,
    };
    Duration::from_secs(secs)
}

/// Shared client options for both transfer directions.
fn base_builder(allow_insecure: Option<bool>) -> reqwest::ClientBuilder {
    let mut builder =
        reqwest::Client::builder().connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS));
    if allow_insecure.unwrap_or(false) {
        builder = builder
            .danger_accept_invalid_certs(true)
            .danger_accept_invalid_hostnames(true);
    }
    builder
}

/// Client for uploads: a size-aware total budget, and deliberately NO read
/// timeout (a read timeout would fire while waiting for the response, i.e. while
/// the body is still uploading — see [`TRANSFER_IDLE_TIMEOUT_SECS`]).
fn build_upload_client(
    allow_insecure: Option<bool>,
    payload_bytes: u64,
) -> Result<reqwest::Client, String> {
    base_builder(allow_insecure)
        .timeout(transfer_budget(Some(payload_bytes)))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))
}

/// Client for downloads: no total budget (the payload size is unknown until the
/// response headers arrive, and a large book must not be killed by a fixed cap),
/// bounded instead by the per-read idle guard.
fn build_download_client(allow_insecure: Option<bool>) -> Result<reqwest::Client, String> {
    base_builder(allow_insecure)
        .read_timeout(Duration::from_secs(TRANSFER_IDLE_TIMEOUT_SECS))
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

/// Same retry policy as the JS layer: retry transient failures (network
/// errors, 429, 5xx) up to 3 times with exponential backoff; 4xx fails fast.
async fn send_with_retry(
    client: &reqwest::Client,
    method: reqwest::Method,
    url: &str,
    headers: reqwest::header::HeaderMap,
    body: Option<Vec<u8>>,
) -> Result<reqwest::Response, String> {
    const MAX_ATTEMPTS: u32 = 3;
    const BASE_DELAY_MS: u64 = 500;
    let mut last_error = String::new();
    for attempt in 0..MAX_ATTEMPTS {
        if attempt > 0 {
            let delay = BASE_DELAY_MS * 2u64.pow(attempt - 1);
            tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
        }
        let request = if method == reqwest::Method::PUT {
            client.put(url)
        } else if method == reqwest::Method::GET {
            client.get(url)
        } else {
            client.request(method.clone(), url)
        };
        let request = request.headers(headers.clone());
        let request = if let Some(data) = &body {
            request.body(data.clone())
        } else {
            request
        };
        let response = match request.send().await {
            Ok(response) => response,
            Err(e) => {
                last_error = format!("WebDAV {method} failed for {url}: {e}");
                continue;
            }
        };
        let status = response.status();
        if status.is_success() {
            return Ok(response);
        }
        if status.as_u16() == 429 || status.is_server_error() {
            last_error = format!("WebDAV {method} failed for {url}: {status}");
            continue;
        }
        return Err(format!("WebDAV {method} failed for {url}: {status}"));
    }
    Err(last_error)
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
    let data = tokio::fs::read(&file_path)
        .await
        .map_err(|e| format!("failed to read {file_path}: {e}"))?;
    // Size-aware budget: the whole body must fit inside the client timeout,
    // otherwise reqwest aborts mid-upload and the server sees a truncated PUT.
    let client = build_upload_client(allow_insecure, data.len() as u64)?;
    send_with_retry(
        &client,
        reqwest::Method::PUT,
        &url,
        to_header_map(&headers),
        Some(data),
    )
    .await
    .map(|_| ())
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
    // No total timeout for downloads: the payload size is unknown until the
    // response headers arrive, and a large book must not be killed by a fixed
    // cap. `read_timeout` (see build_download_client) aborts a stalled transfer.
    let client = build_download_client(allow_insecure)?;
    let mut response = send_with_retry(
        &client,
        reqwest::Method::GET,
        &url,
        to_header_map(&headers),
        None,
    )
    .await?;

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

#[cfg(test)]
mod tests {
    use super::*;

    /// Regression for the 2026-09-26 incident: a flat 300s client timeout cut
    /// large uploads off mid-body, the server saw a truncated PUT (HTTP 500),
    /// and sync retried the same books forever.
    #[test]
    fn budget_keeps_floor_for_tiny_or_unknown_payloads() {
        assert_eq!(
            transfer_budget(None),
            Duration::from_secs(TRANSFER_TIMEOUT_FLOOR_SECS)
        );
        assert_eq!(
            transfer_budget(Some(0)),
            Duration::from_secs(TRANSFER_TIMEOUT_FLOOR_SECS)
        );
        // Smaller than one second of worst-case throughput → still the floor.
        assert_eq!(
            transfer_budget(Some(TRANSFER_MIN_RATE_BYTES_PER_SEC - 1)),
            Duration::from_secs(TRANSFER_TIMEOUT_FLOOR_SECS)
        );
    }

    #[test]
    fn budget_grows_with_payload_size() {
        // 1 MiB → floor + 32s (1 MiB / 32 KiB per second).
        assert_eq!(
            transfer_budget(Some(1024 * 1024)),
            Duration::from_secs(TRANSFER_TIMEOUT_FLOOR_SECS + 32)
        );
        // 100 MiB → floor + 3200s, i.e. no longer a 5-minute cap.
        let budget = transfer_budget(Some(100 * 1024 * 1024));
        assert_eq!(budget, Duration::from_secs(TRANSFER_TIMEOUT_FLOOR_SECS + 3200));
        assert!(budget > Duration::from_secs(TRANSFER_TIMEOUT_FLOOR_SECS));
    }

    #[test]
    fn budget_is_capped() {
        assert_eq!(
            transfer_budget(Some(u64::MAX / 2)),
            Duration::from_secs(TRANSFER_TIMEOUT_CEIL_SECS)
        );
    }
}
