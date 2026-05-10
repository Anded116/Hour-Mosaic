use std::collections::HashMap;

use crate::types::{Category, MinuteCell};

/// Accumulator for one in-progress minute. When the wall-clock minute changes,
/// the accumulator is finalized into a `MinuteCell` and a new one is started.
pub struct Aggregator {
    current: Option<MinuteAccum>,
}

struct MinuteAccum {
    date_key: String,
    minute_of_day: u16,
    category_counts: HashMap<Category, u32>,
    source_counts: HashMap<String, (u32, Option<String>)>, // source_key -> (count, title sample)
}

#[derive(Debug, Clone)]
pub struct FinalizedMinute {
    pub date_key: String,
    pub cell: MinuteCell,
}

impl Aggregator {
    pub fn new() -> Self {
        Self { current: None }
    }

    /// Returns the finalized previous minute when a sample crosses a minute boundary.
    pub fn feed(
        &mut self,
        date_key: &str,
        minute_of_day: u16,
        category: Category,
        source_key: &str,
        source_title: Option<&str>,
    ) -> Option<FinalizedMinute> {
        let mut finalized: Option<FinalizedMinute> = None;

        let needs_new = match &self.current {
            Some(acc) => acc.date_key != date_key || acc.minute_of_day != minute_of_day,
            None => true,
        };

        if needs_new {
            if let Some(acc) = self.current.take() {
                finalized = Some(finalize(acc));
            }
            self.current = Some(MinuteAccum {
                date_key: date_key.to_string(),
                minute_of_day,
                category_counts: HashMap::new(),
                source_counts: HashMap::new(),
            });
        }

        let acc = self.current.as_mut().expect("just inserted");
        *acc.category_counts.entry(category).or_insert(0) += 1;
        let entry = acc
            .source_counts
            .entry(source_key.to_string())
            .or_insert((0, None));
        entry.0 += 1;
        if entry.1.is_none() {
            entry.1 = source_title.map(|s| s.to_string());
        }

        finalized
    }

    /// Flushes the in-progress minute without crossing a boundary.
    /// Used on shutdown or when tracking pauses.
    #[allow(dead_code)]
    pub fn flush(&mut self) -> Option<FinalizedMinute> {
        self.current.take().map(finalize)
    }
}

fn finalize(acc: MinuteAccum) -> FinalizedMinute {
    let category = acc
        .category_counts
        .iter()
        .max_by_key(|(_, c)| *c)
        .map(|(cat, _)| *cat)
        .unwrap_or(Category::Unclassified);

    let (source_key, source_title) = acc
        .source_counts
        .into_iter()
        .max_by_key(|(_, (c, _))| *c)
        .map(|(key, (_, title))| (Some(key), title))
        .unwrap_or((None, None));

    FinalizedMinute {
        date_key: acc.date_key,
        cell: MinuteCell {
            minute_of_day: acc.minute_of_day,
            category,
            source_key,
            source_title,
            locked: false,
            preset_id: None,
        },
    }
}
