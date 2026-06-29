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
#[cfg(target_os = "macos")]
mod mac_permissions;

use std::sync::Arc;

use tauri::{Manager, WindowEvent};
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

    #[cfg(target_os = "macos")]
    mac_permissions::request_permissions();

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
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
            commands::quit_app,
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

            // Pre-declared secondary windows (history, settings) must hide on
            // close, not destroy — otherwise `get_webview_window(label)` returns
            // None on the second invocation and `open_history` / `open_settings`
            // fail with "window not declared". They also drop their topmost flag
            // on hide (set when shown so they raise above the topmost main).
            let app_handle = app.handle().clone();
            for label in ["history", "settings"] {
                if let Some(win) = app.get_webview_window(label) {
                    let win_clone = win.clone();
                    win.on_window_event(move |event| {
                        if let WindowEvent::CloseRequested { api, .. } = event {
                            api.prevent_close();
                            // Drop topmost as it hides so a later show re-raises cleanly;
                            // main keeps its own desired always-on-top untouched.
                            let _ = win_clone.set_always_on_top(false);
                            let _ = win_clone.hide();
                        }
                    });
                }
            }

            // Apply the persisted always-on-top preference to the main window.
            // tauri.conf.json declares it AOT-on; if the user previously turned
            // it off, this corrects the actual flag on boot.
            commands::sync_main_always_on_top(&app_handle);

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
