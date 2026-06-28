use serde::{Deserialize, Serialize};

/// How foreground windows collapse into a single tracked "entity" (source_key).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WindowGrouping {
    /// One entity per application — every window/tab of the same process merges
    /// (Telegram chats, Zen tabs all become one). Titles ignored.
    App,
    /// Browsers split by domain, everything else by process. The default.
    Site,
    /// One entity per distinct window, after stripping volatile title noise
    /// (unread counts, the app's own name) so near-identical titles still merge.
    Window,
}

impl Default for WindowGrouping {
    fn default() -> Self {
        WindowGrouping::Site
    }
}

impl WindowGrouping {
    pub fn as_u8(self) -> u8 {
        match self {
            WindowGrouping::App => 0,
            WindowGrouping::Site => 1,
            WindowGrouping::Window => 2,
        }
    }

    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => WindowGrouping::App,
            2 => WindowGrouping::Window,
            _ => WindowGrouping::Site,
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "app" => WindowGrouping::App,
            "site" => WindowGrouping::Site,
            "window" => WindowGrouping::Window,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub day_start_hour: u8,
    pub afk_threshold_ms: u32,
    pub sample_interval_ms: u32,
    pub sample_retention_days: u16,
    pub paused: bool,
    /// Defaulted so settings persisted before this field deserialize cleanly.
    #[serde(default)]
    pub window_grouping: WindowGrouping,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            day_start_hour: 4,
            afk_threshold_ms: 5 * 60 * 1000,
            sample_interval_ms: 5_000,
            sample_retention_days: 7,
            paused: false,
            window_grouping: WindowGrouping::Site,
        }
    }
}
