use serde::Deserialize;

use crate::types::{AfkBehavior, Category};

const SEED_JSON: &str = include_str!("seed.json");

#[derive(Debug, Deserialize)]
pub struct SeedFile {
    #[allow(dead_code)]
    pub version: u32,
    pub process_rules: Vec<SeedRule>,
    pub domain_rules: Vec<SeedRule>,
    /// Exact source_key → category defaults (e.g. a browser's non-domain
    /// catch-all entity). Seeded into the tracker's override map below user rules.
    #[serde(default)]
    pub source_rules: Vec<SourceRule>,
}

#[derive(Debug, Deserialize)]
pub struct SourceRule {
    pub source_key: String,
    pub category: Category,
}

#[derive(Debug, Deserialize)]
pub struct SeedRule {
    pub pattern: String,
    pub category: Category,
    #[serde(default)]
    pub afk: Option<SeedAfk>,
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum SeedAfk {
    StaysActive,
    BecomesUnproductive,
}

impl From<SeedAfk> for AfkBehavior {
    fn from(value: SeedAfk) -> Self {
        match value {
            SeedAfk::StaysActive => AfkBehavior::StaysActive,
            SeedAfk::BecomesUnproductive => AfkBehavior::BecomesUnproductive,
        }
    }
}

pub fn load_seed() -> SeedFile {
    serde_json::from_str(SEED_JSON).expect("seed.json is malformed")
}
