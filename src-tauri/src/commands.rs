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
        always_on_top: state.desired_main_aot(),
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
pub fn reclassify_source<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    source_key: String,
    category: String,
) -> Result<usize, String> {
    let cat = Category::parse(&category).ok_or_else(|| format!("unknown category {category}"))?;
    let updated = state
        .db
        .reclassify_source(&source_key, cat)
        .map_err(|e| e.to_string())?;

    // Apply the override live so the tracker classifies future minutes the same way.
    if let Some(t) = &*state.tracker.lock() {
        t.overrides.lock().insert(source_key, cat);
    }
    // Past minutes were recolored — nudge open windows to re-fetch.
    crate::events::emit_day_changed(&app);
    Ok(updated)
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
    window_grouping: Option<String>,
    afk_threshold_ms: Option<u32>,
) -> Result<(), String> {
    let mut s = state.settings.lock();
    if let Some(h) = day_start_hour {
        if h > 23 {
            return Err("day_start_hour must be 0..23".into());
        }
        s.day_start_hour = h;
    }
    if let Some(g) = &window_grouping {
        let parsed = crate::config::WindowGrouping::parse(g)
            .ok_or_else(|| format!("unknown window_grouping `{g}`"))?;
        s.window_grouping = parsed;
    }
    if let Some(ms) = afk_threshold_ms {
        // Floor at 5s so the tracker can't thrash on every sample.
        s.afk_threshold_ms = ms.max(5_000);
    }
    let json = serde_json::to_string(&*s).map_err(|e| e.to_string())?;
    let afk_value = s.afk_threshold_ms;
    drop(s);

    // Propagate live settings to the running tracker so they take effect immediately.
    if let Some(t) = &*state.tracker.lock() {
        if let Some(parsed) = window_grouping.as_deref().and_then(crate::config::WindowGrouping::parse) {
            t.grouping
                .store(parsed.as_u8(), std::sync::atomic::Ordering::Relaxed);
        }
        if afk_threshold_ms.is_some() {
            t.afk_threshold
                .store(afk_value, std::sync::atomic::Ordering::Relaxed);
        }
    }

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
    open_or_focus(&app, "history")
}

#[tauri::command]
pub fn open_settings<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    open_or_focus(&app, "settings")
}

fn open_or_focus<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<(), String> {
    // The window is pre-declared in tauri.conf.json with `visible: false`, so we
    // just unhide and focus it here.
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        tracing::info!(label, "showing pre-declared window");
        sync_main_always_on_top(app, None);
        return Ok(());
    }
    Err(format!("window `{label}` not declared in tauri.conf.json"))
}

#[tauri::command]
pub fn set_always_on_top<R: Runtime>(app: AppHandle<R>, on: bool) -> Result<(), String> {
    if let Some(state) = app.try_state::<AppState>() {
        state.set_desired_main_aot(on);
    }
    sync_main_always_on_top(&app, None);
    Ok(())
}

/// Reconcile the actual `alwaysOnTop` flag on the main window with the user's
/// desired value, with one override: if any secondary window (history /
/// settings) is currently visible, force main to non-AOT so the secondary can
/// sit above it. Called from every show/hide/toggle path.
///
/// `closing` is the label of a window that is being hidden right now (from its
/// `CloseRequested` handler). Its `is_visible()` may still report `true` until
/// the platform applies the `hide()`, so we treat it as already-gone instead of
/// relying on the timing of the hide.
pub fn sync_main_always_on_top<R: Runtime>(app: &AppHandle<R>, closing: Option<&str>) {
    let desired = app
        .try_state::<AppState>()
        .map(|s| s.desired_main_aot())
        .unwrap_or(true);
    let any_secondary_visible = ["history", "settings"]
        .iter()
        .filter(|label| closing != Some(**label))
        .any(|label| {
            app.get_webview_window(label)
                .and_then(|w| w.is_visible().ok())
                .unwrap_or(false)
        });
    let effective = desired && !any_secondary_visible;
    if let Some(main) = app.get_webview_window("main") {
        if let Err(err) = main.set_always_on_top(effective) {
            tracing::warn!(?err, "failed to set main always_on_top");
        }
    }
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
