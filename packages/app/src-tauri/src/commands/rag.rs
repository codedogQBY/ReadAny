use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResult {
    pub chunk_id: String,
    pub content: String,
    pub score: f64,
    pub chapter_title: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VectorizeStatus {
    pub book_id: String,
    pub total_chunks: u32,
    pub processed_chunks: u32,
    pub status: String,
}

/// Start vectorization for a book
#[tauri::command]
pub async fn vectorize_book(book_id: String) -> Result<(), String> {
    // TODO: Chunk book content, generate embeddings, store in DB
    let _ = book_id;
    Err("Not implemented".into())
}

/// Search book content using RAG
#[tauri::command]
pub async fn search_book(
    book_id: String,
    query: String,
    mode: String,
    top_k: u32,
) -> Result<Vec<SearchResult>, String> {
    let _ = (book_id, query, mode, top_k);
    Ok(vec![])
}

/// Get vectorization status for a book
#[tauri::command]
pub async fn get_vectorize_status(book_id: String) -> Result<VectorizeStatus, String> {
    let _ = &book_id;
    Ok(VectorizeStatus {
        book_id,
        total_chunks: 0,
        processed_chunks: 0,
        status: "idle".into(),
    })
}
