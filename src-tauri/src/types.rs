#![allow(dead_code)] // populated incrementally across M3+; the FFI consumers land later.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    Productive,
    Unproductive,
    Neutral,
    Unclassified,
    Void,
}

impl Category {
    pub fn as_str(self) -> &'static str {
        match self {
            Category::Productive => "productive",
            Category::Unproductive => "unproductive",
            Category::Neutral => "neutral",
            Category::Unclassified => "unclassified",
            Category::Void => "void",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "productive" => Category::Productive,
            "unproductive" => Category::Unproductive,
            "neutral" => Category::Neutral,
            "unclassified" => Category::Unclassified,
            "void" => Category::Void,
            _ => return None,
        })
    }
}

/// What happens to a sample when the user is idle > AFK threshold and the foreground
/// process matches an AFK rule.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AfkBehavior {
    /// Default: idle → neutral (used when foreground has no AFK exception).
    Default,
    /// E.g. Google Meet — stay in foreground's category despite idle input.
    StaysActive,
    /// E.g. mpv/VLC — counted as unproductive (passive consumption).
    BecomesUnproductive,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinuteCell {
    pub minute_of_day: u16,
    pub category: Category,
    pub source_key: Option<String>,
    pub source_title: Option<String>,
    pub locked: bool,
    pub preset_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DayData {
    pub date_key: String,
    pub day_start_hour: u8,
    pub minutes: Vec<MinuteCell>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurrentState {
    pub current_minute: u16,
    pub current_activity: Option<String>,
    pub idle_ms: u64,
    pub paused: bool,
    /// User's desired always-on-top for the main window (the persisted value,
    /// not the temporarily-overridden effective flag). Lets the frontend menu
    /// reflect the real choice on boot.
    pub always_on_top: bool,
}

#[derive(Debug, Clone)]
pub struct Sample {
    pub ts: i64, // unix seconds
    pub process: Option<String>,
    pub title: Option<String>,
    pub browser_domain: Option<String>,
    pub idle_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaySummary {
    pub date_key: String,
    pub productive_minutes: u32,
    pub unproductive_minutes: u32,
    pub neutral_minutes: u32,
    pub unclassified_minutes: u32,
    pub tracked_minutes: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredApp {
    pub source_key: String,
    pub sample_title: Option<String>,
    pub first_seen_ts: i64,
    pub minutes_seen: u32,
    /// Dominant stored category for this source — what the classification UI shows.
    pub current_category: Category,
}
