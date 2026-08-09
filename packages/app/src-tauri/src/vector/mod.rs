use crate::storage;
use anyhow::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VectorRecord {
    pub id: String,
    pub book_id: String,
    pub embedding: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VectorSearchResult {
    pub id: String,
    pub book_id: String,
    pub score: f32,
}

pub struct VectorDB {
    conn: Connection,
    dimension: usize,
}

fn dimension_from_vec_schema(sql: &str) -> Option<usize> {
    let start = sql.find("float[")? + "float[".len();
    let end = sql[start..].find(']')? + start;
    sql[start..end].parse().ok()
}

fn parse_embedding_blob(blob: &[u8]) -> Vec<f32> {
    let chunk_size = std::mem::size_of::<f32>();
    if blob.len() % chunk_size != 0 {
        return Vec::new();
    }
    let count = blob.len() / chunk_size;
    let mut result = Vec::with_capacity(count);
    for i in 0..count {
        let start = i * chunk_size;
        let end = start + chunk_size;
        let bytes: [u8; 4] = blob[start..end].try_into().unwrap_or([0; 4]);
        result.push(f32::from_le_bytes(bytes));
    }
    result
}

impl VectorDB {
    pub fn new(db_path: &PathBuf, dimension: usize) -> Result<Self> {
        // Register sqlite-vec as auto-extension before opening the connection.
        // This ensures vec0 virtual table is available regardless of global state.
        unsafe {
            rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
                sqlite_vec::sqlite3_vec_init as *const (),
            )));
        }

        let conn = Connection::open(db_path)?;

        // Immediately cancel the auto-extension so it doesn't affect other connections
        unsafe {
            rusqlite::ffi::sqlite3_cancel_auto_extension(Some(std::mem::transmute(
                sqlite_vec::sqlite3_vec_init as *const (),
            )));
        }

        conn.busy_timeout(Duration::from_millis(5000))?;
        let _: String = conn.query_row("PRAGMA journal_mode=WAL", [], |row| row.get(0))?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS id_mapping (
                rowid INTEGER PRIMARY KEY AUTOINCREMENT,
                chunk_id TEXT UNIQUE NOT NULL,
                book_id TEXT NOT NULL
            )",
            [],
        )?;

        // A vec0 table's dimension is fixed at creation. On startup, opening a
        // persisted table must never discard vectors merely because the fallback
        // dimension changed (for example, a 1024d remote model vs. 384d builtin).
        // The vectorization path can explicitly reinitialize an *empty* table.
        let table_exists: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='vec_embeddings'",
            [],
            |row| row.get(0),
        )?;

        let actual_dimension = if table_exists {
            let existing_sql: String = conn.query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='vec_embeddings'",
                [],
                |row| row.get(0),
            )?;
            dimension_from_vec_schema(&existing_sql).ok_or_else(|| {
                anyhow::anyhow!("Could not determine existing vec_embeddings dimension")
            })?
        } else {
            conn.execute(
                &format!(
                    "CREATE VIRTUAL TABLE vec_embeddings USING vec0(
                        embedding float[{}]
                    )",
                    dimension
                ),
                [],
            )?;
            dimension
        };

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_id_mapping_book ON id_mapping(book_id)",
            [],
        )?;

        let version: String = conn.query_row("SELECT vec_version()", [], |row| row.get(0))?;
        println!(
            "[VectorDB] sqlite-vec version: {}, dimension: {}",
            version, actual_dimension
        );

        Ok(Self {
            conn,
            dimension: actual_dimension,
        })
    }

    pub fn insert(&self, records: &[VectorRecord]) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;

        for record in records {
            let embedding_bytes: Vec<u8> = record
                .embedding
                .iter()
                .flat_map(|f| f.to_le_bytes())
                .collect();

            self.conn.execute(
                "INSERT INTO id_mapping(chunk_id, book_id) VALUES (?, ?)",
                params![record.id, record.book_id],
            )?;

            let rowid: i64 = self.conn.last_insert_rowid();

            self.conn.execute(
                "INSERT INTO vec_embeddings(rowid, embedding) VALUES (?, ?)",
                params![rowid, embedding_bytes],
            )?;
        }

        tx.commit()?;
        Ok(())
    }

    pub fn delete_by_book_id(&self, book_id: &str) -> Result<()> {
        let rowids: Vec<i64> = self.conn
            .prepare("SELECT rowid FROM id_mapping WHERE book_id = ?")?
            .query_map(params![book_id], |row| row.get(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        for rowid in &rowids {
            self.conn.execute(
                "DELETE FROM vec_embeddings WHERE rowid = ?",
                params![rowid],
            )?;
        }

        self.conn.execute(
            "DELETE FROM id_mapping WHERE book_id = ?",
            params![book_id],
        )?;

        Ok(())
    }

    pub fn clear_all(&self) -> Result<()> {
        self.conn.execute("DELETE FROM vec_embeddings", [])?;
        self.conn.execute("DELETE FROM id_mapping", [])?;
        Ok(())
    }

    pub fn rebuild_from_main_db(&self, main_db_path: &PathBuf) -> Result<usize> {
        println!("[VectorDB] Rebuilding from main database: {:?}", main_db_path);
        
        let main_conn = Connection::open(main_db_path)?;
        
        let mut stmt = main_conn.prepare(
            "SELECT id, book_id, embedding FROM chunks WHERE embedding IS NOT NULL"
        )?;
        
        let rows = stmt.query_map([], |row| {
            let id: String = row.get(0)?;
            let book_id: String = row.get(1)?;
            let embedding_blob: Option<Vec<u8>> = row.get(2)?;
            Ok((id, book_id, embedding_blob))
        })?;
        
        self.clear_all()?;
        
        let tx = self.conn.unchecked_transaction()?;
        let mut count = 0;
        
        for row_result in rows {
            let (id, book_id, embedding_blob) = row_result?;
            if let Some(blob) = embedding_blob {
                let embedding = parse_embedding_blob(&blob);
                if embedding.len() != self.dimension {
                    continue;
                }
                
                let embedding_bytes: Vec<u8> = embedding.iter().flat_map(|f| f.to_le_bytes()).collect();
                
                self.conn.execute(
                    "INSERT INTO id_mapping(chunk_id, book_id) VALUES (?, ?)",
                    params![id, book_id],
                )?;
                
                let rowid: i64 = self.conn.last_insert_rowid();
                
                self.conn.execute(
                    "INSERT INTO vec_embeddings(rowid, embedding) VALUES (?, ?)",
                    params![rowid, embedding_bytes],
                )?;
                
                count += 1;
            }
        }
        
        tx.commit()?;
        println!("[VectorDB] Rebuilt {} vectors from main database", count);
        Ok(count)
    }

    pub fn search(
        &self,
        query: &[f32],
        book_id: &str,
        top_k: usize,
    ) -> Result<Vec<VectorSearchResult>> {
        let query_bytes: Vec<u8> = query.iter().flat_map(|f| f.to_le_bytes()).collect();

        let mut stmt = self.conn.prepare(
            "SELECT m.chunk_id, m.book_id, v.distance 
             FROM vec_embeddings v
             JOIN id_mapping m ON v.rowid = m.rowid
             WHERE v.embedding MATCH ? AND m.book_id = ?
             ORDER BY v.distance LIMIT ?",
        )?;

        let results = stmt
            .query_map(params![query_bytes, book_id, top_k as i32], |row| {
                Ok(VectorSearchResult {
                    id: row.get(0)?,
                    book_id: row.get(1)?,
                    score: row.get::<_, f64>(2)? as f32,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(results)
    }

    pub fn reinit(&mut self, dimension: usize) -> Result<()> {
        if dimension == self.dimension {
            println!("[VectorDB] reinit skipped — dimension already {}", dimension);
            return Ok(());
        }
        println!("[VectorDB] reinit: {} → {}", self.dimension, dimension);

        self.conn.execute("DROP TABLE IF EXISTS vec_embeddings", [])?;
        self.conn.execute("DELETE FROM id_mapping", [])?;

        self.conn.execute(
            &format!(
                "CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
                    embedding float[{}]
                )",
                dimension
            ),
            [],
        )?;

        self.dimension = dimension;
        println!("[VectorDB] reinit complete — new dimension: {}", dimension);
        Ok(())
    }

    pub fn get_stats(&self) -> Result<(usize, usize)> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM id_mapping",
            [],
            |row| row.get(0),
        )?;

        Ok((count as usize, self.dimension))
    }
}

#[cfg(test)]
mod tests {
    use super::dimension_from_vec_schema;

    #[test]
    fn reads_dimension_from_existing_vec0_schema() {
        assert_eq!(
            dimension_from_vec_schema(
                "CREATE VIRTUAL TABLE vec_embeddings USING vec0(embedding float[1024])"
            ),
            Some(1024),
        );
    }

    #[test]
    fn rejects_a_schema_without_an_embedding_dimension() {
        assert_eq!(
            dimension_from_vec_schema("CREATE TABLE vec_embeddings (id TEXT)"),
            None
        );
    }
}

pub struct VectorDBState {
    pub db: Mutex<Option<VectorDB>>,
}

pub fn init_vector_db(app: &AppHandle, dimension: usize) -> Result<()> {
    let state = app.state::<VectorDBState>();

    {
        let db_guard = state.db.lock().unwrap();
        if db_guard.is_some() {
            println!("[VectorDB] Already initialized");
            return Ok(());
        }
    }

    let app_dir = storage::resolve_data_root(app).expect("failed to resolve data root");
    std::fs::create_dir_all(&app_dir)?;
    let db_path = app_dir.join("vectors.db");

    let vector_db = VectorDB::new(&db_path, dimension)?;

    {
        let mut db_guard = state.db.lock().unwrap();
        *db_guard = Some(vector_db);
    }

    println!("[VectorDB] State initialized");
    Ok(())
}

#[tauri::command]
pub fn vector_insert(app: AppHandle, records: Vec<VectorRecord>) -> Result<(), String> {
    let state = app.state::<VectorDBState>();
    let db_guard = state.db.lock().unwrap();

    if let Some(db) = db_guard.as_ref() {
        db.insert(&records).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Vector database not initialized".to_string())
    }
}

#[tauri::command]
pub fn vector_delete_by_book(app: AppHandle, book_id: String) -> Result<(), String> {
    let state = app.state::<VectorDBState>();
    let db_guard = state.db.lock().unwrap();

    if let Some(db) = db_guard.as_ref() {
        db.delete_by_book_id(&book_id).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Vector database not initialized".to_string())
    }
}

#[tauri::command]
pub fn vector_search(
    app: AppHandle,
    query: Vec<f32>,
    book_id: String,
    top_k: usize,
) -> Result<Vec<VectorSearchResult>, String> {
    let state = app.state::<VectorDBState>();
    let db_guard = state.db.lock().unwrap();

    if let Some(db) = db_guard.as_ref() {
        db.search(&query, &book_id, top_k).map_err(|e| e.to_string())
    } else {
        Err("Vector database not initialized".to_string())
    }
}

#[tauri::command]
pub fn vector_get_stats(app: AppHandle) -> Result<(usize, usize), String> {
    let state = app.state::<VectorDBState>();
    let db_guard = state.db.lock().unwrap();

    if let Some(db) = db_guard.as_ref() {
        db.get_stats().map_err(|e| e.to_string())
    } else {
        Err("Vector database not initialized".to_string())
    }
}

#[tauri::command]
pub fn vector_rebuild(app: AppHandle) -> Result<usize, String> {
    let state = app.state::<VectorDBState>();
    let db_guard = state.db.lock().unwrap();

    if let Some(db) = db_guard.as_ref() {
        let app_dir = storage::resolve_data_root(&app)?;
        let main_db_path = app_dir.join("readany.db");
        db.rebuild_from_main_db(&main_db_path).map_err(|e| e.to_string())
    } else {
        Err("Vector database not initialized".to_string())
    }
}

#[tauri::command]
pub fn vector_reinit(app: AppHandle, dimension: usize) -> Result<(), String> {
    let state = app.state::<VectorDBState>();
    let mut db_guard = state.db.lock().unwrap();

    if let Some(db) = db_guard.as_mut() {
        db.reinit(dimension).map_err(|e| e.to_string())
    } else {
        Err("Vector database not initialized".to_string())
    }
}

#[tauri::command]
pub fn vector_shutdown(app: AppHandle) -> Result<(), String> {
    let state = app.state::<VectorDBState>();
    let mut db_guard = state.db.lock().unwrap();
    *db_guard = None;
    Ok(())
}
