use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct BookMeta {
    pub id: String,
    pub title: String,
    pub author: String,
    pub file_path: String,
    pub progress: f64,
    pub is_vectorized: bool,
    pub added_at: i64,
    pub last_opened_at: Option<i64>,
}

/// Import an EPUB book into the library
#[tauri::command]
pub async fn import_book(file_path: String) -> Result<BookMeta, String> {
    // TODO: Parse EPUB, extract metadata, store in DB
    let _ = file_path;
    Err("Not implemented".into())
}

/// Get all books in the library
#[tauri::command]
pub async fn get_books() -> Result<Vec<BookMeta>, String> {
    // TODO: Query database for all books
    Ok(vec![])
}

/// Get a single book by ID
#[tauri::command]
pub async fn get_book(book_id: String) -> Result<BookMeta, String> {
    let _ = book_id;
    Err("Not implemented".into())
}

/// Delete a book from the library
#[tauri::command]
pub async fn delete_book(book_id: String) -> Result<(), String> {
    let _ = book_id;
    Err("Not implemented".into())
}

/// Update reading progress for a book
#[tauri::command]
pub async fn update_book_progress(
    book_id: String,
    progress: f64,
    cfi: String,
) -> Result<(), String> {
    let _ = (book_id, progress, cfi);
    Err("Not implemented".into())
}
