use anyhow::Result;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::commands::mark_break_now_impl;
use crate::store::AppState;

pub fn mark_break_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyB)
}

pub fn register<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let gs = app.global_shortcut();
    let shortcut = mark_break_shortcut();
    let app_clone = app.clone();
    gs.on_shortcut(shortcut, move |_app, _shortcut, event| {
        if event.state() != ShortcutState::Pressed {
            return;
        }
        let app = app_clone.clone();
        tokio::spawn(async move {
            if let Some(state) = app.try_state::<AppState>() {
                let state: tauri::State<AppState> = state;
                if let Err(err) = mark_break_now_impl(&app, &state) {
                    tracing::warn!(?err, "mark_break_now hotkey failed");
                }
            }
        });
    })
    .map_err(|e| anyhow::anyhow!("global shortcut register failed: {e}"))?;
    Ok(())
}
