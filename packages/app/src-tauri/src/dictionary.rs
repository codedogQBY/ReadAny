use rusqlite::{params_from_iter, types::ValueRef, Connection, OpenFlags};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use tauri::Manager;

fn pack_path(directory: &Path, path: &Path) -> Result<PathBuf, String> {
    let directory = directory.canonicalize().map_err(|e| e.to_string())?;
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    if path.parent() != Some(directory.as_path()) {
        return Err("Dictionary path must be inside the dictionaries directory".into());
    }
    Ok(path)
}

fn query_pack(
    path: &Path,
    query: &str,
    values: &[String],
) -> Result<Vec<Map<String, Value>>, String> {
    // Opening read-only also avoids journal-mode changes invalidating the pack checksum.
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    let mut statement = connection.prepare(query).map_err(|e| e.to_string())?;
    if !statement.readonly() {
        return Err("Dictionary queries must be read-only".into());
    }
    let columns: Vec<String> = statement
        .column_names()
        .iter()
        .map(|name| name.to_string())
        .collect();
    let mut rows = statement
        .query(params_from_iter(values))
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut object = Map::new();
        for (index, name) in columns.iter().enumerate() {
            let value = match row.get_ref(index).map_err(|e| e.to_string())? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(value) => Value::from(value),
                ValueRef::Real(value) => Value::from(value),
                ValueRef::Text(value) => {
                    Value::from(std::str::from_utf8(value).map_err(|e| e.to_string())?)
                }
                ValueRef::Blob(_) => return Err("Unexpected binary dictionary value".into()),
            };
            object.insert(name.clone(), value);
        }
        result.push(object);
    }
    Ok(result)
}

#[tauri::command]
pub async fn dictionary_query(
    app: tauri::AppHandle,
    path: String,
    query: String,
    values: Vec<String>,
) -> Result<Vec<Map<String, Value>>, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("dictionaries");
    tauri::async_runtime::spawn_blocking(move || {
        let path = pack_path(&directory, Path::new(&path))?;
        query_pack(&path, &query, &values)
    })
    .await
    .map_err(|e| e.to_string())?
}

const MAX_PACK_BYTES: u64 = 150 * 1024 * 1024;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    received_bytes: u64,
    total_bytes: Option<u64>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadReport {
    bytes: u64,
    elapsed_ms: u128,
}

fn download_path(directory: &Path, path: &Path) -> Result<PathBuf, String> {
    let directory = directory.canonicalize().map_err(|e| e.to_string())?;
    let parent = path
        .parent()
        .ok_or("Dictionary download has no directory")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if parent != directory
        || !path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.ends_with(".sqlite.download"))
    {
        return Err("Dictionary downloads must be staged inside the dictionaries directory".into());
    }
    Ok(parent.join(
        path.file_name()
            .ok_or("Dictionary download has no filename")?,
    ))
}

async fn download_pack(
    url: &str,
    path: &Path,
    mut on_progress: impl FnMut(DownloadProgress),
) -> Result<DownloadReport, String> {
    use std::time::{Duration, Instant};
    use tokio::io::AsyncWriteExt;
    let started = Instant::now();
    let client = tauri_plugin_http::reqwest::Client::builder()
        .https_only(url.starts_with("https://"))
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let total_bytes = response.content_length();
    if total_bytes.is_some_and(|size| size > MAX_PACK_BYTES) {
        return Err("Dictionary download is too large".into());
    }
    // Never follow an existing staging-file symlink or overwrite another download.
    let file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .await
        .map_err(|e| e.to_string())?;
    let result = async {
        let mut writer = tokio::io::BufWriter::with_capacity(1024 * 1024, file);
        let mut received_bytes = 0;
        let mut last_progress = Instant::now();
        on_progress(DownloadProgress {
            received_bytes,
            total_bytes,
        });
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            received_bytes += chunk.len() as u64;
            if received_bytes > MAX_PACK_BYTES {
                return Err("Dictionary download is too large".to_string());
            }
            writer.write_all(&chunk).await.map_err(|e| e.to_string())?;
            if last_progress.elapsed() >= Duration::from_millis(100) {
                on_progress(DownloadProgress {
                    received_bytes,
                    total_bytes,
                });
                last_progress = Instant::now();
            }
        }
        writer.flush().await.map_err(|e| e.to_string())?;
        on_progress(DownloadProgress {
            received_bytes,
            total_bytes,
        });
        Ok(DownloadReport {
            bytes: received_bytes,
            elapsed_ms: started.elapsed().as_millis(),
        })
    }
    .await;
    if result.is_err() {
        // The writer has dropped, releasing its handle before Windows cleanup.
        let _ = tokio::fs::remove_file(path).await;
    }
    result
}

#[tauri::command]
pub async fn dictionary_download(
    app: tauri::AppHandle,
    url: String,
    path: String,
    on_progress: tauri::ipc::Channel<DownloadProgress>,
) -> Result<DownloadReport, String> {
    let parsed = tauri_plugin_http::reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "https" {
        return Err("Dictionary download URL must use HTTPS".into());
    }
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("dictionaries");
    let path = download_path(&directory, Path::new(&path))?;
    download_pack(&url, &path, |progress| {
        // Closing a dialog should not cancel an installation already in progress.
        let _ = on_progress.send(progress);
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_directory() -> PathBuf {
        let directory =
            std::env::temp_dir().join(format!("readany-download-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        directory
    }

    fn serve_once(status: &str, length: usize, body: Vec<u8>) -> String {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let header =
            format!("HTTP/1.1 {status}\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n");
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            let _ = stream.read(&mut request);
            if stream.write_all(header.as_bytes()).is_ok() {
                let _ = stream.write_all(&body);
            }
        });
        format!("http://{address}/pack")
    }

    #[tokio::test]
    async fn streams_native_bytes_and_limits_progress_updates() {
        let directory = test_directory();
        let path = directory.join("pack.sqlite.download");
        let bytes = vec![42; 2 * 1024 * 1024];
        let url = serve_once("200 OK", bytes.len(), bytes.clone());
        let mut updates = Vec::new();
        let report = download_pack(&url, &path, |progress| updates.push(progress))
            .await
            .unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert_eq!(report.bytes, bytes.len() as u64);
        assert_eq!(updates.first().unwrap().received_bytes, 0);
        assert_eq!(updates.last().unwrap().received_bytes, report.bytes);
        assert!(updates.len() as u128 <= report.elapsed_ms / 100 + 2);
        std::fs::rename(&path, directory.join("done.sqlite")).unwrap();
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn rejects_failed_and_oversized_responses_and_cleans_partial_downloads() {
        let directory = test_directory();
        let path = directory.join("pack.sqlite.download");
        for (status, length, bytes) in [
            ("404 Not Found", 0, vec![]),
            ("200 OK", MAX_PACK_BYTES as usize + 1, vec![]),
            ("200 OK", 10, vec![1, 2, 3]),
        ] {
            let url = serve_once(status, length, bytes);
            assert!(download_pack(&url, &path, |_| {}).await.is_err());
            assert!(!path.exists());
        }
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn preserves_existing_staging_files_and_restricts_destination() {
        let directory = test_directory();
        let path = directory.join("pack.sqlite.download");
        assert!(download_path(&directory, &path).is_ok());
        assert!(download_path(&directory, &directory.join("active.sqlite")).is_err());
        assert!(download_path(&directory, &directory.join("../outside.sqlite.download")).is_err());
        std::fs::write(&path, b"existing").unwrap();
        let url = serve_once("200 OK", 1, vec![1]);
        assert!(download_pack(&url, &path, |_| {}).await.is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"existing");
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn reads_bound_values_without_changing_pack_and_releases_handles() {
        let directory =
            std::env::temp_dir().join(format!("readany-dictionary-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("test.sqlite");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE entries (headword TEXT); INSERT INTO entries VALUES ('hello');",
            )
            .unwrap();
        drop(connection);
        let before = std::fs::read(&path).unwrap();
        let rows = query_pack(
            &path,
            "SELECT headword FROM entries WHERE headword = ?",
            &["hello".into()],
        )
        .unwrap();
        assert_eq!(rows[0]["headword"], "hello");
        assert!(query_pack(&path, "DELETE FROM entries", &[]).is_err());
        assert_eq!(before, std::fs::read(&path).unwrap());
        assert!(pack_path(&directory.join("missing"), &path).is_err());
        assert!(pack_path(&directory, &path).is_ok());
        assert!(pack_path(&std::env::temp_dir(), &path).is_err());
        std::fs::rename(&path, directory.join("moved.sqlite")).unwrap();
        std::fs::remove_dir_all(directory).unwrap();
    }
}
