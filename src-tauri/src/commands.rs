use chrono::{Datelike, Local, Timelike};
use tauri::{AppHandle, Manager, Runtime, State};

use crate::events::{emit_tick, TickPayload};
use crate::store::AppState;
use crate::types::{Category, CurrentState, DayData, DaySummary, DiscoveredApp};

#[tauri::command]
pub fn ping() -> &'static str {
    "pong"
}

#[tauri::command]
pub fn get_day(state: State<'_, AppState>, date_key: Option<String>) -> Result<DayData, String> {
    let settings = state.settings.lock();
    let day_start_hour = settings.day_start_hour;
    drop(settings);
    let key = date_key.unwrap_or_else(|| today_key(day_start_hour));
    state
        .db
        .load_day(&key, day_start_hour)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_day_range(
    state: State<'_, AppState>,
    start_key: String,
    end_key: String,
) -> Result<Vec<DaySummary>, String> {
    state
        .db
        .day_summaries(&start_key, &end_key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_current_state(state: State<'_, AppState>) -> Result<CurrentState, String> {
    let settings = state.settings.lock();
    let day_start_hour = settings.day_start_hour;
    drop(settings);
    let (_, minute) = day_coords_now(day_start_hour);
    Ok(CurrentState {
        current_minute: minute,
        current_activity: None,
        idle_ms: 0,
        paused: state.is_paused(),
    })
}

#[tauri::command]
pub fn pause_tracking(state: State<'_, AppState>) -> Result<(), String> {
    state.set_paused(true);
    Ok(())
}

#[tauri::command]
pub fn resume_tracking(state: State<'_, AppState>) -> Result<(), String> {
    state.set_paused(false);
    Ok(())
}

#[tauri::command]
pub fn list_unclassified(
    state: State<'_, AppState>,
    limit: Option<u32>,
) -> Result<Vec<DiscoveredApp>, String> {
    state
        .db
        .unclassified_apps(limit.unwrap_or(20))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_sources(
    state: State<'_, AppState>,
    limit: Option<u32>,
) -> Result<Vec<DiscoveredApp>, String> {
    state
        .db
        .list_sources(limit.unwrap_or(200))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reclassify_source(
    state: State<'_, AppState>,
    source_key: String,
    category: String,
) -> Result<usize, String> {
    let cat = Category::parse(&category).ok_or_else(|| format!("unknown category {category}"))?;
    state
        .db
        .reclassify_source(&source_key, cat)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn wipe_data(state: State<'_, AppState>) -> Result<(), String> {
    state.db.wipe_all().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<crate::config::Settings, String> {
    Ok(state.settings.lock().clone())
}

#[tauri::command]
pub fn set_settings(
    state: State<'_, AppState>,
    day_start_hour: Option<u8>,
) -> Result<(), String> {
    let mut s = state.settings.lock();
    if let Some(h) = day_start_hour {
        if h > 23 {
            return Err("day_start_hour must be 0..23".into());
        }
        s.day_start_hour = h;
    }
    let json = serde_json::to_string(&*s).map_err(|e| e.to_string())?;
    drop(s);
    state.db.set_setting("settings", &json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_segment(
    state: State<'_, AppState>,
    date_key: String,
    start_minute: u16,
    end_minute: u16,
    category: String,
    preset_id: Option<i64>,
) -> Result<(), String> {
    let cat = Category::parse(&category).ok_or_else(|| format!("unknown category {category}"))?;
    state
        .db
        .set_segment(&date_key, start_minute, end_minute, cat, preset_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_segment(
    state: State<'_, AppState>,
    date_key: String,
    start_minute: u16,
    end_minute: u16,
) -> Result<(), String> {
    state
        .db
        .clear_segment_lock(&date_key, start_minute, end_minute)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mark_break_now<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    mark_break_now_impl(&app, &state).map_err(|e| e.to_string())
}

/// Shared implementation so the global-shortcut handler can call into this without
/// going through the `tauri::command` invoke path.
pub fn mark_break_now_impl<R: Runtime>(
    app: &AppHandle<R>,
    state: &State<'_, AppState>,
) -> anyhow::Result<()> {
    let day_start_hour = state.settings.lock().day_start_hour;
    let (date_key, minute) = day_coords_now(day_start_hour);
    state
        .db
        .set_segment(&date_key, minute, minute, Category::Neutral, None)?;
    emit_tick(
        app,
        TickPayload {
            date_key,
            minute_of_day: minute,
            category: Category::Neutral.as_str(),
            source_key: Some("break".to_string()),
            source_title: None,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn open_history<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    open_or_focus(&app, "history", "history.html", "Hour Mosaic — History", 900.0, 700.0, false)
}

#[tauri::command]
pub fn open_settings<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    open_or_focus(&app, "settings", "settings.html", "Hour Mosaic — Settings", 820.0, 640.0, false)
}

fn open_or_focus<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    url: &str,
    title: &str,
    width: f64,
    height: f64,
    always_on_top: bool,
) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }
    let _win = tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App(url.into()))
        .title(title)
        .inner_size(width, height)
        .always_on_top(always_on_top)
        .decorations(true)
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_always_on_top<R: Runtime>(app: AppHandle<R>, on: bool) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.set_always_on_top(on).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn today_key(day_start_hour: u8) -> String {
    day_coords_now(day_start_hour).0
}

fn day_coords_now(day_start_hour: u8) -> (String, u16) {
    let now = Local::now() - chrono::Duration::hours(day_start_hour as i64);
    let date_key = format!("{:04}-{:02}-{:02}", now.year(), now.month(), now.day());
    let minute = (now.hour() * 60 + now.minute()) as u16;
    (date_key, minute)
}
