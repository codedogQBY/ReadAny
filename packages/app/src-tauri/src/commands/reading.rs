use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ReadingSessionInfo {
    pub id: String,
    pub book_id: String,
    pub total_active_time: i64,
    pub pages_read: i32,
    pub started_at: i64,
    pub ended_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReadingStatsInfo {
    pub book_id: String,
    pub total_reading_time: i64,
    pub total_sessions: i32,
    pub total_pages_read: i32,
}

/// Start a new reading session
#[tauri::command]
pub async fn start_session(book_id: String) -> Result<ReadingSessionInfo, String> {
    let _ = &book_id;
    // TODO: Create session in database
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    Ok(ReadingSessionInfo {
        id: format!("session-{}", now),
        book_id,
        total_active_time: 0,
        pages_read: 0,
        started_at: now,
        ended_at: None,
    })
}

/// End a reading session
#[tauri::command]
pub async fn end_session(session_id: String) -> Result<(), String> {
    let _ = session_id;
    // TODO: Update session in database
    Err("Not implemented".into())
}

/// Get reading stats for a book
#[tauri::command]
pub async fn get_reading_stats(book_id: String) -> Result<ReadingStatsInfo, String> {
    let _ = &book_id;
    Ok(ReadingStatsInfo {
        book_id,
        total_reading_time: 0,
        total_sessions: 0,
        total_pages_read: 0,
    })
}
