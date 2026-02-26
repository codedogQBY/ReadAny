pub mod schema;

use anyhow::Result;
use tauri::{AppHandle, Manager};

/// Initialize the SQLite database synchronously (called in setup before frontend loads)
pub fn init_database_sync(app: &AppHandle) -> Result<()> {
    let app_dir = app
        .path()
        .app_data_dir()
        .expect("failed to get app data dir");
    std::fs::create_dir_all(&app_dir)?;

    let db_path = app_dir.join("readany.db");
    schema::initialize(&db_path)?;

    Ok(())
}
