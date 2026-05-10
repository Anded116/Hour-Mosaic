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
}

impl AppState {
    pub fn new(db: Arc<Db>, settings: Settings) -> Self {
        Self {
            db,
            settings: Mutex::new(settings),
            tracker: Mutex::new(None),
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
