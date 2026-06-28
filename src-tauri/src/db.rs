use std::path::Path;

use anyhow::{Context, Result};
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};

use crate::types::{Category, DayData, DaySummary, DiscoveredApp, MinuteCell, Sample};

const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS minutes (
  date_key       TEXT NOT NULL,
  minute_of_day  INTEGER NOT NULL,
  category       TEXT NOT NULL,
  source_key     TEXT,
  source_title   TEXT,
  locked         INTEGER NOT NULL DEFAULT 0,
  preset_id      INTEGER,
  PRIMARY KEY (date_key, minute_of_day)
);
CREATE INDEX IF NOT EXISTS idx_minutes_date ON minutes(date_key);

CREATE TABLE IF NOT EXISTS rules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern    TEXT NOT NULL,
  match_type TEXT NOT NULL,
  category   TEXT NOT NULL,
  source     TEXT NOT NULL,
  preset_id  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rules_pattern ON rules(pattern);

CREATE TABLE IF NOT EXISTS presets (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,
  category  TEXT NOT NULL,
  color     TEXT
);

CREATE TABLE IF NOT EXISTS samples (
  ts             INTEGER NOT NULL,
  process        TEXT,
  title          TEXT,
  browser_domain TEXT,
  idle_ms        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_samples_ts ON samples(ts);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"#;

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("failed to create db dir {:?}", parent))?;
        }
        let mut conn = Connection::open(path).with_context(|| format!("opening {:?}", path))?;
        migrate(&mut conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn insert_sample(&self, sample: &Sample) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO samples (ts, process, title, browser_domain, idle_ms) VALUES (?,?,?,?,?)",
            params![
                sample.ts,
                sample.process,
                sample.title,
                sample.browser_domain,
                sample.idle_ms as i64
            ],
        )?;
        Ok(())
    }

    /// Writes one finalized minute. Locked minutes are never overwritten by the tracker.
    pub fn upsert_minute(&self, date_key: &str, cell: &MinuteCell) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO minutes (date_key, minute_of_day, category, source_key, source_title, locked, preset_id)
             VALUES (?,?,?,?,?,0,?)
             ON CONFLICT(date_key, minute_of_day) DO UPDATE SET
               category    = excluded.category,
               source_key  = excluded.source_key,
               source_title= excluded.source_title
             WHERE locked = 0",
            params![
                date_key,
                cell.minute_of_day as i64,
                cell.category.as_str(),
                cell.source_key,
                cell.source_title,
                cell.preset_id,
            ],
        )?;
        Ok(())
    }

    /// Writes a manual segment, locking every minute in the range.
    pub fn set_segment(
        &self,
        date_key: &str,
        start_minute: u16,
        end_minute: u16,
        category: Category,
        preset_id: Option<i64>,
    ) -> Result<()> {
        let conn = self.conn.lock();
        let tx = conn.unchecked_transaction()?;
        for m in start_minute..=end_minute {
            tx.execute(
                "INSERT INTO minutes (date_key, minute_of_day, category, source_key, source_title, locked, preset_id)
                 VALUES (?,?,?,NULL,NULL,1,?)
                 ON CONFLICT(date_key, minute_of_day) DO UPDATE SET
                   category   = excluded.category,
                   locked     = 1,
                   preset_id  = excluded.preset_id",
                params![date_key, m as i64, category.as_str(), preset_id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Clears the lock on a range (does not delete the minute data — just opens it back up).
    pub fn clear_segment_lock(&self, date_key: &str, start_minute: u16, end_minute: u16) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE minutes SET locked = 0, preset_id = NULL
             WHERE date_key = ? AND minute_of_day BETWEEN ? AND ?",
            params![date_key, start_minute as i64, end_minute as i64],
        )?;
        Ok(())
    }

    pub fn load_day(&self, date_key: &str, day_start_hour: u8) -> Result<DayData> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT minute_of_day, category, source_key, source_title, locked, preset_id
             FROM minutes WHERE date_key = ? ORDER BY minute_of_day",
        )?;
        let rows = stmt.query_map(params![date_key], |row| {
            let cat: String = row.get(1)?;
            Ok(MinuteCell {
                minute_of_day: row.get::<_, i64>(0)? as u16,
                category: Category::parse(&cat).unwrap_or(Category::Unclassified),
                source_key: row.get(2)?,
                source_title: row.get(3)?,
                locked: row.get::<_, i64>(4)? != 0,
                preset_id: row.get(5)?,
            })
        })?;
        let minutes = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(DayData {
            date_key: date_key.to_string(),
            day_start_hour,
            minutes,
        })
    }

    pub fn day_summaries(&self, start_key: &str, end_key: &str) -> Result<Vec<DaySummary>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT date_key, category, COUNT(*) FROM minutes
             WHERE date_key BETWEEN ? AND ?
             GROUP BY date_key, category",
        )?;
        let mut by_day: std::collections::BTreeMap<String, DaySummary> = Default::default();
        let mut rows = stmt.query(params![start_key, end_key])?;
        while let Some(row) = rows.next()? {
            let day: String = row.get(0)?;
            let cat: String = row.get(1)?;
            let count: i64 = row.get(2)?;
            let entry = by_day.entry(day.clone()).or_insert_with(|| DaySummary {
                date_key: day,
                productive_minutes: 0,
                unproductive_minutes: 0,
                neutral_minutes: 0,
                idle_minutes: 0,
                unclassified_minutes: 0,
                tracked_minutes: 0,
            });
            let count = count.max(0) as u32;
            entry.tracked_minutes += count;
            match Category::parse(&cat) {
                Some(Category::Productive) => entry.productive_minutes += count,
                Some(Category::Unproductive) => entry.unproductive_minutes += count,
                Some(Category::Neutral) => entry.neutral_minutes += count,
                Some(Category::Idle) => entry.idle_minutes += count,
                Some(Category::Unclassified) => entry.unclassified_minutes += count,
                Some(Category::Void) | None => {}
            }
        }
        Ok(by_day.into_values().collect())
    }

    pub fn list_sources(&self, limit: u32) -> Result<Vec<DiscoveredApp>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT m.source_key, MIN(m.source_title), 0, COUNT(*),
                    (SELECT category FROM minutes m2
                     WHERE m2.source_key = m.source_key
                     GROUP BY category ORDER BY COUNT(*) DESC LIMIT 1)
             FROM minutes m
             WHERE m.source_key IS NOT NULL
             GROUP BY m.source_key
             ORDER BY COUNT(*) DESC
             LIMIT ?",
        )?;
        let rows = stmt.query_map(params![limit as i64], |row| {
            let cat: Option<String> = row.get(4)?;
            Ok(DiscoveredApp {
                source_key: row.get(0)?,
                sample_title: row.get(1)?,
                first_seen_ts: row.get::<_, i64>(2)?,
                minutes_seen: row.get::<_, i64>(3)? as u32,
                current_category: cat
                    .as_deref()
                    .and_then(Category::parse)
                    .unwrap_or(Category::Unclassified),
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// User classification overrides (source_key → category) for the tracker to
    /// apply to future samples. Stored by `reclassify_source`.
    pub fn load_overrides(&self) -> Result<Vec<(String, Category)>> {
        let conn = self.conn.lock();
        let mut stmt =
            conn.prepare("SELECT pattern, category FROM rules WHERE source = 'user'")?;
        let rows = stmt.query_map([], |row| {
            let key: String = row.get(0)?;
            let cat: String = row.get(1)?;
            Ok((key, cat))
        })?;
        let mut out = Vec::new();
        for r in rows {
            let (key, cat) = r?;
            if let Some(c) = Category::parse(&cat) {
                out.push((key, c));
            }
        }
        Ok(out)
    }

    /// Distinct (source_key, source_title) among still-unclassified, unlocked
    /// minutes — the work-list for the startup backfill pass.
    pub fn unclassified_source_pairs(&self) -> Result<Vec<(String, Option<String>)>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT DISTINCT source_key, source_title
             FROM minutes
             WHERE category = 'unclassified' AND locked = 0 AND source_key IS NOT NULL",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Recolors still-unclassified, unlocked minutes of one (source_key, title)
    /// — used by the backfill pass to apply seed/override classification to
    /// history without touching manual edits or already-classified minutes.
    pub fn apply_category(
        &self,
        source_key: &str,
        title: Option<&str>,
        category: Category,
    ) -> Result<usize> {
        let conn = self.conn.lock();
        let n = match title {
            Some(t) => conn.execute(
                "UPDATE minutes SET category = ? WHERE source_key = ? AND source_title = ?
                 AND category = 'unclassified' AND locked = 0",
                params![category.as_str(), source_key, t],
            )?,
            None => conn.execute(
                "UPDATE minutes SET category = ? WHERE source_key = ? AND source_title IS NULL
                 AND category = 'unclassified' AND locked = 0",
                params![category.as_str(), source_key],
            )?,
        };
        Ok(n)
    }

    pub fn reclassify_source(&self, source_key: &str, category: Category) -> Result<usize> {
        let conn = self.conn.lock();
        let tx = conn.unchecked_transaction()?;
        let updated = tx.execute(
            "UPDATE minutes SET category = ? WHERE source_key = ? AND locked = 0",
            params![category.as_str(), source_key],
        )?;
        // Persist as a user rule so future samples get the same treatment.
        tx.execute(
            "DELETE FROM rules WHERE pattern = ? AND source = 'user'",
            params![source_key],
        )?;
        tx.execute(
            "INSERT INTO rules (pattern, match_type, category, source) VALUES (?,'process',?,'user')",
            params![source_key, category.as_str()],
        )?;
        tx.commit()?;
        Ok(updated)
    }

    pub fn wipe_all(&self) -> Result<()> {
        let conn = self.conn.lock();
        let tx = conn.unchecked_transaction()?;
        tx.execute("DELETE FROM minutes", [])?;
        tx.execute("DELETE FROM samples", [])?;
        tx.execute("DELETE FROM rules WHERE source = 'user'", [])?;
        tx.commit()?;
        Ok(())
    }

    pub fn unclassified_apps(&self, limit: u32) -> Result<Vec<DiscoveredApp>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT source_key, MIN(source_title), CAST(strftime('%s', 'now') AS INTEGER), COUNT(*)
             FROM minutes
             WHERE category = 'unclassified' AND source_key IS NOT NULL
             GROUP BY source_key
             ORDER BY COUNT(*) DESC
             LIMIT ?",
        )?;
        let rows = stmt.query_map(params![limit as i64], |row| {
            Ok(DiscoveredApp {
                source_key: row.get(0)?,
                sample_title: row.get(1)?,
                first_seen_ts: row.get::<_, i64>(2)?,
                minutes_seen: row.get::<_, i64>(3)? as u32,
                current_category: Category::Unclassified,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn prune_samples_before(&self, cutoff_ts: i64) -> Result<usize> {
        let conn = self.conn.lock();
        let n = conn.execute("DELETE FROM samples WHERE ts < ?", params![cutoff_ts])?;
        Ok(n)
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock();
        let v = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?",
                params![key],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(v)
    }

    #[allow(dead_code)]
    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?,?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }
}

fn migrate(conn: &mut Connection) -> Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version < 1 {
        conn.execute_batch(SCHEMA_V1)?;
        conn.execute_batch("PRAGMA user_version = 1")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Category, MinuteCell};

    fn temp_db() -> Db {
        let mut p = std::env::temp_dir();
        p.push(format!("hm-test-db-{}.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&p);
        Db::open(&p).expect("open temp db")
    }

    fn cell(min: u16, cat: Category, key: &str) -> MinuteCell {
        MinuteCell {
            minute_of_day: min,
            category: cat,
            source_key: Some(key.to_string()),
            source_title: Some("title".into()),
            locked: false,
            preset_id: None,
        }
    }

    #[test]
    fn source_listings_and_overrides_round_trip() {
        let db = temp_db();
        db.upsert_minute("2026-06-28", &cell(0, Category::Productive, "Code.exe")).unwrap();
        db.upsert_minute("2026-06-28", &cell(1, Category::Productive, "Code.exe")).unwrap();
        db.upsert_minute("2026-06-28", &cell(2, Category::Unclassified, "mystery.exe")).unwrap();

        let sources = db.list_sources(50).unwrap();
        assert!(sources
            .iter()
            .any(|s| s.source_key == "Code.exe" && s.current_category == Category::Productive));

        // Regression: strftime('%s','now') is TEXT — reading it as i64 used to error
        // out the whole query, surfacing as "Failed to load classification list".
        let unclassified = db.unclassified_apps(50).unwrap();
        assert!(unclassified.iter().any(|s| s.source_key == "mystery.exe"));

        // A user override persists as a rule and reloads for the tracker.
        db.reclassify_source("mystery.exe", Category::Neutral).unwrap();
        let overrides = db.load_overrides().unwrap();
        assert!(overrides
            .iter()
            .any(|(k, c)| k == "mystery.exe" && *c == Category::Neutral));
    }
}
