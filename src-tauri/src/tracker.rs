use std::sync::Arc;
use std::time::Duration;

use chrono::{Datelike, Local, Timelike};
use parking_lot::Mutex;
use tokio::sync::watch;

use crate::aggregator::Aggregator;
use crate::classifier::Classifier;
use crate::config::Settings;
use crate::db::Db;
use crate::events::{emit_current_activity, emit_tick, CurrentActivityPayload, TickPayload};
use crate::types::{AfkBehavior, Category, Sample};

#[cfg(target_os = "windows")]
fn read_idle_ms() -> u32 {
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    unsafe {
        let mut lii = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut lii) != 0 {
            GetTickCount().wrapping_sub(lii.dwTime)
        } else {
            0
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn read_idle_ms() -> u32 {
    0
}

fn read_active_window() -> Option<(String, String)> {
    match active_win_pos_rs::get_active_window() {
        Ok(w) => {
            let process = w
                .process_path
                .file_name()
                .and_then(|s| s.to_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| w.app_name.clone());
            Some((process, w.title))
        }
        Err(_) => None,
    }
}

pub struct TrackerHandle {
    pub paused: Arc<Mutex<bool>>,
    #[allow(dead_code)]
    pub shutdown: watch::Sender<bool>,
}

pub fn start_tracker<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: Arc<Db>,
    settings: Settings,
) -> TrackerHandle {
    let paused = Arc::new(Mutex::new(settings.paused));
    let (shutdown_tx, mut shutdown_rx) = watch::channel(false);

    let classifier = Arc::new(Mutex::new(Classifier::new()));
    let aggregator = Arc::new(Mutex::new(Aggregator::new()));
    let interval = Duration::from_millis(settings.sample_interval_ms.max(1000) as u64);
    let afk_threshold = settings.afk_threshold_ms;
    let day_start_hour = settings.day_start_hour;
    let retention_days = settings.sample_retention_days as i64;

    {
        let db = db.clone();
        tauri::async_runtime::spawn(async move {
            let cutoff = (chrono::Utc::now().timestamp()) - retention_days * 86_400;
            if let Err(err) = db.prune_samples_before(cutoff) {
                tracing::warn!(?err, "sample prune failed");
            }
        });
    }

    let paused_for_loop = paused.clone();

    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                _ = ticker.tick() => {},
                _ = shutdown_rx.changed() => {
                    if *shutdown_rx.borrow() { break; }
                }
            }

            if *paused_for_loop.lock() {
                continue;
            }

            let now = Local::now();
            let idle_ms = read_idle_ms();
            let active = read_active_window();

            let (process, title) = match active {
                Some(p) => (Some(p.0), Some(p.1)),
                None => (None, None),
            };

            let sample = Sample {
                ts: now.timestamp(),
                process: process.clone(),
                title: title.clone(),
                browser_domain: None,
                idle_ms,
            };

            if let Err(err) = db.insert_sample(&sample) {
                tracing::warn!(?err, "insert_sample failed");
            }

            let classifier_guard = classifier.lock();
            let classification = classifier_guard.classify(&sample);
            drop(classifier_guard);

            let effective_category =
                apply_afk(classification.category, classification.afk, idle_ms, afk_threshold);

            emit_current_activity(
                &app,
                CurrentActivityPayload {
                    process: process.clone(),
                    title: title.clone(),
                    category: effective_category.as_str(),
                    source_key: classification.source_key.clone(),
                    idle_ms,
                    paused: false,
                },
            );

            let (date_key, minute_of_day) = day_coords(now, day_start_hour);
            let finalized = aggregator.lock().feed(
                &date_key,
                minute_of_day,
                effective_category,
                &classification.source_key,
                title.as_deref(),
            );

            if let Some(fin) = finalized {
                if let Err(err) = db.upsert_minute(&fin.date_key, &fin.cell) {
                    tracing::warn!(?err, "upsert_minute failed");
                } else {
                    emit_tick(
                        &app,
                        TickPayload {
                            date_key: fin.date_key.clone(),
                            minute_of_day: fin.cell.minute_of_day,
                            category: fin.cell.category.as_str(),
                            source_key: fin.cell.source_key.clone(),
                            source_title: fin.cell.source_title.clone(),
                        },
                    );
                }
            }
        }
        tracing::info!("tracker loop exited");
    });

    TrackerHandle {
        paused,
        shutdown: shutdown_tx,
    }
}

fn apply_afk(
    base: Category,
    afk: AfkBehavior,
    idle_ms: u32,
    threshold_ms: u32,
) -> Category {
    if idle_ms <= threshold_ms {
        return base;
    }
    match afk {
        AfkBehavior::StaysActive => base,
        AfkBehavior::BecomesUnproductive => Category::Unproductive,
        AfkBehavior::Default => Category::Neutral,
    }
}

/// Computes `(date_key, minute_of_day)` for the given local time and configured day-start hour.
fn day_coords(now: chrono::DateTime<Local>, day_start_hour: u8) -> (String, u16) {
    let shift = chrono::Duration::hours(day_start_hour as i64);
    let shifted = now - shift;
    let date_key = format!(
        "{:04}-{:02}-{:02}",
        shifted.year(),
        shifted.month(),
        shifted.day()
    );
    let minute_of_day = (shifted.hour() * 60 + shifted.minute()) as u16;
    (date_key, minute_of_day)
}
