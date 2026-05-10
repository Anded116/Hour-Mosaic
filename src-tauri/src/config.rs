use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub day_start_hour: u8,
    pub afk_threshold_ms: u32,
    pub sample_interval_ms: u32,
    pub sample_retention_days: u16,
    pub paused: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            day_start_hour: 4,
            afk_threshold_ms: 5 * 60 * 1000,
            sample_interval_ms: 5_000,
            sample_retention_days: 7,
            paused: false,
        }
    }
}
