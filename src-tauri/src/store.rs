use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;

use crate::config::Settings;
use crate::db::Db;
use crate::tracker::TrackerHandle;

/// Shared application state — handed to every Tauri command via `tauri::State`.
pub struct AppState {
    pub db: Arc<Db>,
    pub settings: Mutex<Settings>,
    pub tracker: Mutex<Option<TrackerHandle>>,
    /// User's desired always-on-top for the main window. We may temporarily
    /// override the actual window flag to `false` while a secondary window
    /// (settings / history) is visible, so the secondary can sit above the
    /// otherwise-AOT main. This field remembers the value to restore, and is
    /// persisted to the `settings` table so the choice survives a restart.
    desired_main_aot: AtomicBool,
}

/// Key in the `settings` key-value table holding the persisted main-window
/// always-on-top preference ("true" / "false").
const AOT_SETTING_KEY: &str = "main_always_on_top";

impl AppState {
    pub fn new(db: Arc<Db>, settings: Settings) -> Self {
        // Default to AOT-on; only an explicit persisted "false" turns it off.
        let desired_aot = db
            .get_setting(AOT_SETTING_KEY)
            .ok()
            .flatten()
            .map(|v| v != "false")
            .unwrap_or(true);
        Self {
            db,
            settings: Mutex::new(settings),
            tracker: Mutex::new(None),
            desired_main_aot: AtomicBool::new(desired_aot),
        }
    }

    pub fn desired_main_aot(&self) -> bool {
        self.desired_main_aot.load(Ordering::Relaxed)
    }

    pub fn set_desired_main_aot(&self, on: bool) {
        self.desired_main_aot.store(on, Ordering::Relaxed);
        let value = if on { "true" } else { "false" };
        if let Err(err) = self.db.set_setting(AOT_SETTING_KEY, value) {
            tracing::warn!(?err, "failed to persist main_always_on_top");
        }
    }

    pub fn is_paused(&self) -> bool {
        match &*self.tracker.lock() {
            Some(t) => *t.paused.lock(),
            None => true,
        }
    }

    pub fn set_paused(&self, paused: bool) {
        if let Some(t) = &*self.tracker.lock() {
            *t.paused.lock() = paused;
        }
    }
}
