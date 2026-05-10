use serde::Serialize;
use tauri::Emitter;

#[derive(Debug, Clone, Serialize)]
pub struct TickPayload {
    pub date_key: String,
    pub minute_of_day: u16,
    pub category: &'static str,
    pub source_key: Option<String>,
    pub source_title: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CurrentActivityPayload {
    pub process: Option<String>,
    pub title: Option<String>,
    pub category: &'static str,
    pub source_key: String,
    pub idle_ms: u32,
    pub paused: bool,
}

pub fn emit_tick<R: tauri::Runtime>(app: &tauri::AppHandle<R>, payload: TickPayload) {
    if let Err(err) = app.emit("hm:tick", payload) {
        tracing::warn!(?err, "emit hm:tick failed");
    }
}

pub fn emit_current_activity<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    payload: CurrentActivityPayload,
) {
    if let Err(err) = app.emit("hm:current-activity", payload) {
        tracing::warn!(?err, "emit hm:current-activity failed");
    }
}
