use tauri::Manager;

mod commands;
mod db;
mod epub;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let app_handle = app.handle().clone();
            // Initialize database synchronously before frontend loads
            // This ensures schema is ready when the SQL plugin connects
            if let Err(e) = db::init_database_sync(&app_handle) {
                eprintln!("Failed to initialize database: {}", e);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::book::import_book,
            commands::book::get_books,
            commands::book::get_book,
            commands::book::delete_book,
            commands::book::update_book_progress,
            commands::rag::vectorize_book,
            commands::rag::search_book,
            commands::rag::get_vectorize_status,
            commands::reading::start_session,
            commands::reading::end_session,
            commands::reading::get_reading_stats,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
