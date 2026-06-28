use crate::config::WindowGrouping;
use crate::seed::{load_seed, SeedFile, SeedRule};
use crate::types::{AfkBehavior, Category, Sample};

const BROWSER_PROCESSES: &[&str] = &[
    "chrome.exe",
    "msedge.exe",
    "firefox.exe",
    "brave.exe",
    "vivaldi.exe",
    "opera.exe",
    "arc.exe",
    "zen.exe",
    "yandex.exe",
];

pub struct Classification {
    pub category: Category,
    pub source_key: String,
    pub afk: AfkBehavior,
}

pub struct Classifier {
    seed: SeedFile,
    user_rules: Vec<UserRule>,
}

#[derive(Clone)]
pub struct UserRule {
    pub pattern: String,
    pub match_type: MatchType,
    pub category: Category,
    pub afk: Option<AfkBehavior>,
}

#[derive(Clone, Copy)]
#[allow(dead_code)] // Process/Domain/TitleSubstring become reachable once M4 loads user rules from DB.
pub enum MatchType {
    Process,
    Domain,
    TitleSubstring,
}

impl Classifier {
    pub fn new() -> Self {
        Self {
            seed: load_seed(),
            user_rules: Vec::new(),
        }
    }

    #[allow(dead_code)]
    pub fn set_user_rules(&mut self, rules: Vec<UserRule>) {
        self.user_rules = rules;
    }

    pub fn classify(&self, sample: &Sample, grouping: WindowGrouping) -> Classification {
        let process = sample.process.as_deref().unwrap_or("");
        let title = sample.title.as_deref().unwrap_or("");
        let process_lc = process.to_ascii_lowercase();
        let title_lc = title.to_ascii_lowercase();
        let is_browser = BROWSER_PROCESSES.iter().any(|b| process_lc.ends_with(b));

        // Category, AFK behavior and the "site"-grain base key are decided by
        // the rules (unchanged). Grouping only remaps the final entity key.
        let (category, base_key, afk) = self.classify_inner(process, &process_lc, &title_lc, is_browser);
        Classification {
            category,
            source_key: entity_key(grouping, process, &base_key, title),
            afk,
        }
    }

    /// Returns `(category, site-grain source_key, afk)` — the historical behavior.
    fn classify_inner(
        &self,
        process: &str,
        process_lc: &str,
        title_lc: &str,
        is_browser: bool,
    ) -> (Category, String, AfkBehavior) {
        // 1. User rules win, in order of definition.
        for rule in &self.user_rules {
            if match_rule(&rule.match_type, &rule.pattern, process_lc, title_lc, is_browser) {
                return (
                    rule.category,
                    source_key_for(process, &rule.pattern, &rule.match_type),
                    rule.afk.unwrap_or(AfkBehavior::Default),
                );
            }
        }

        // 2. Built-in process rules.
        for seed in &self.seed.process_rules {
            if process_matches(&seed.pattern, process_lc) {
                return (
                    seed.category,
                    process.to_string(),
                    seed.afk.map(Into::into).unwrap_or(AfkBehavior::Default),
                );
            }
        }

        // 3. Built-in domain rules (browsers only — heuristic title-substring match).
        if is_browser {
            if let Some(hit) = self.find_domain(title_lc) {
                return (
                    hit.category,
                    format!("{}::{}", process, hit.pattern),
                    hit.afk.map(Into::into).unwrap_or(AfkBehavior::Default),
                );
            }
        }

        // 4. Unclassified.
        (
            Category::Unclassified,
            if process.is_empty() {
                "unknown".to_string()
            } else {
                process.to_string()
            },
            AfkBehavior::Default,
        )
    }

    fn find_domain(&self, title_lc: &str) -> Option<&SeedRule> {
        self.seed
            .domain_rules
            .iter()
            .find(|r| title_lc.contains(&r.pattern.to_ascii_lowercase()))
    }
}

fn process_matches(pattern: &str, process_lc: &str) -> bool {
    let p_lc = pattern.to_ascii_lowercase();
    process_lc == p_lc || process_lc.ends_with(&p_lc)
}

fn match_rule(
    mt: &MatchType,
    pattern: &str,
    process_lc: &str,
    title_lc: &str,
    is_browser: bool,
) -> bool {
    let p_lc = pattern.to_ascii_lowercase();
    match mt {
        MatchType::Process => process_matches(&p_lc, process_lc),
        MatchType::Domain => is_browser && title_lc.contains(&p_lc),
        MatchType::TitleSubstring => title_lc.contains(&p_lc),
    }
}

/// Remaps the site-grain base key to the configured grouping granularity.
fn entity_key(grouping: WindowGrouping, process: &str, base_key: &str, title: &str) -> String {
    let process = if process.is_empty() { "unknown" } else { process };
    match grouping {
        // Collapse everything to the application, ignoring domain/title.
        WindowGrouping::App => process.to_string(),
        // Current behavior: browsers per-domain, others per-process.
        WindowGrouping::Site => base_key.to_string(),
        // One entity per distinct window, with volatile title noise stripped.
        WindowGrouping::Window => {
            let norm = normalize_title(title, process);
            if norm.is_empty() {
                process.to_string()
            } else {
                format!("{process}::{norm}")
            }
        }
    }
}

/// Strips volatile parts of a window title so near-identical windows merge:
/// leading unread counts (`(3) `, `[3] `), bullet/marker prefixes, and the
/// app's own name appended/prepended as ` — App` / `App — `.
fn normalize_title(title: &str, process: &str) -> String {
    let app = process
        .strip_suffix(".exe")
        .or_else(|| process.strip_suffix(".EXE"))
        .unwrap_or(process)
        .trim()
        .to_ascii_lowercase();

    let mut s = strip_leading_count(title.trim());
    s = s
        .trim_start_matches(|c: char| matches!(c, '•' | '*' | '·' | '‣' | '▸') || c.is_whitespace());

    let mut out = s.trim().to_string();
    if !app.is_empty() {
        let lc = out.to_ascii_lowercase();
        for sep in [" — ", " - ", " | ", " · ", " – "] {
            let suffix = format!("{sep}{app}");
            if lc.ends_with(&suffix) {
                out.truncate(out.len() - suffix.len());
                break;
            }
            let prefix = format!("{app}{sep}");
            if lc.starts_with(&prefix) {
                out = out[prefix.len()..].to_string();
                break;
            }
        }
    }
    out.trim().to_ascii_lowercase()
}

/// Drops a leading `(123) ` or `[123] ` unread-count group, if present.
fn strip_leading_count(s: &str) -> &str {
    let (open, close) = match s.as_bytes().first() {
        Some(b'(') => ('(', ')'),
        Some(b'[') => ('[', ']'),
        _ => return s,
    };
    if let Some(end) = s.find(close) {
        let inner = &s[open.len_utf8()..end];
        if !inner.is_empty() && inner.bytes().all(|b| b.is_ascii_digit()) {
            return s[end + close.len_utf8()..].trim_start();
        }
    }
    s
}

fn source_key_for(process: &str, pattern: &str, mt: &MatchType) -> String {
    match mt {
        MatchType::Process => process.to_string(),
        MatchType::Domain => format!("{}::{}", process, pattern),
        MatchType::TitleSubstring => format!("{}::title:{}", process, pattern),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_unread_count_and_app_suffix() {
        assert_eq!(normalize_title("(3) Saved Messages — Telegram", "Telegram.exe"), "saved messages");
        assert_eq!(normalize_title("[12] Project - Code", "Code.exe"), "project");
        assert_eq!(normalize_title("• Inbox", "whatever.exe"), "inbox");
        assert_eq!(normalize_title("YouTube", "zen.exe"), "youtube");
    }

    #[test]
    fn keeps_distinct_titles_distinct() {
        assert_ne!(
            normalize_title("Alpha doc — Word", "WINWORD.exe"),
            normalize_title("Beta doc — Word", "WINWORD.exe")
        );
    }

    #[test]
    fn count_inside_title_is_not_stripped() {
        // Only a *leading* parenthesised count is volatile noise.
        assert_eq!(normalize_title("Build (3) results", "app.exe"), "build (3) results");
    }

    #[test]
    fn entity_key_respects_grouping() {
        // App collapses to the process regardless of the site-grain base key.
        assert_eq!(
            entity_key(WindowGrouping::App, "chrome.exe", "chrome.exe::youtube.com", "x"),
            "chrome.exe"
        );
        // Site keeps the historical base key.
        assert_eq!(
            entity_key(WindowGrouping::Site, "chrome.exe", "chrome.exe::youtube.com", "x"),
            "chrome.exe::youtube.com"
        );
        // Window keys by the normalized title.
        assert_eq!(
            entity_key(WindowGrouping::Window, "Telegram.exe", "Telegram.exe", "(3) Chat — Telegram"),
            "Telegram.exe::chat"
        );
        // Empty title falls back to the process.
        assert_eq!(
            entity_key(WindowGrouping::Window, "app.exe", "app.exe", ""),
            "app.exe"
        );
    }
}
