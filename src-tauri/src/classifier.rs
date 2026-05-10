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

    pub fn classify(&self, sample: &Sample) -> Classification {
        let process = sample.process.as_deref().unwrap_or("");
        let title = sample.title.as_deref().unwrap_or("");
        let process_lc = process.to_ascii_lowercase();
        let title_lc = title.to_ascii_lowercase();
        let is_browser = BROWSER_PROCESSES.iter().any(|b| process_lc.ends_with(b));

        // 1. User rules win, in order of definition.
        for rule in &self.user_rules {
            if match_rule(&rule.match_type, &rule.pattern, &process_lc, &title_lc, is_browser) {
                return Classification {
                    category: rule.category,
                    source_key: source_key_for(process, &rule.pattern, &rule.match_type),
                    afk: rule.afk.unwrap_or(AfkBehavior::Default),
                };
            }
        }

        // 2. Built-in process rules.
        for seed in &self.seed.process_rules {
            if process_matches(&seed.pattern, &process_lc) {
                return Classification {
                    category: seed.category,
                    source_key: process.to_string(),
                    afk: seed.afk.map(Into::into).unwrap_or(AfkBehavior::Default),
                };
            }
        }

        // 3. Built-in domain rules (browsers only — heuristic title-substring match).
        if is_browser {
            if let Some(hit) = self.find_domain(&title_lc) {
                return Classification {
                    category: hit.category,
                    source_key: format!("{}::{}", process, hit.pattern),
                    afk: hit.afk.map(Into::into).unwrap_or(AfkBehavior::Default),
                };
            }
        }

        // 4. Unclassified.
        Classification {
            category: Category::Unclassified,
            source_key: if process.is_empty() {
                "unknown".to_string()
            } else {
                process.to_string()
            },
            afk: AfkBehavior::Default,
        }
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

fn source_key_for(process: &str, pattern: &str, mt: &MatchType) -> String {
    match mt {
        MatchType::Process => process.to_string(),
        MatchType::Domain => format!("{}::{}", process, pattern),
        MatchType::TitleSubstring => format!("{}::title:{}", process, pattern),
    }
}
