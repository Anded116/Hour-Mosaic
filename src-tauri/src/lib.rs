mod aggregator;
mod classifier;
mod commands;
mod config;
mod db;
mod events;
mod hotkey;
mod seed;
mod store;
mod tracker;
mod types;

use std::sync::Arc;

use tauri::Manager;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

use crate::config::Settings;
use crate::db::Db;
use crate::store::AppState;
use crate::tracker::start_tracker;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::registry()
        .with(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,hour_mosaic=debug,app_lib=debug")),
        )
        .with(fmt::layer())
        .init();

    tracing::info!("Hour Mosaic starting");

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::get_day,
            commands::get_day_range,
            commands::get_current_state,
            commands::pause_tracking,
            commands::resume_tracking,
            commands::list_unclassified,
            commands::set_segment,
            commands::clear_segment,
            commands::mark_break_now,
            commands::open_history,
            commands::open_settings,
            commands::set_always_on_top,
            commands::list_sources,
            commands::reclassify_source,
            commands::wipe_data,
            commands::get_settings,
            commands::set_settings,
        ])
        .setup(|app| {
            let db_path = app
                .path()
                .app_data_dir()
                .map(|p| p.join("hour-mosaic.db"))
                .unwrap_or_else(|_| std::path::PathBuf::from("hour-mosaic.db"));

            tracing::info!(path = %db_path.display(), "opening database");
            let db = Arc::new(Db::open(&db_path)?);

            let settings = load_persisted_settings(&db);
            let state = AppState::new(db.clone(), settings.clone());
            let handle = start_tracker(app.handle().clone(), db.clone(), settings);
            *state.tracker.lock() = Some(handle);
            app.manage(state);

            if let Err(err) = hotkey::register(app.handle()) {
                tracing::warn!(?err, "global shortcut registration failed");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn load_persisted_settings(db: &Db) -> Settings {
    match db.get_setting("settings") {
        Ok(Some(json)) => serde_json::from_str(&json).unwrap_or_default(),
        _ => Settings::default(),
    }
}
