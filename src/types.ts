// Shared frontend types. Mirrors src-tauri/src/types.rs (serde rename_all = "lowercase").

export type Category =
  | "productive"
  | "unproductive"
  | "neutral"
  | "unclassified"
  | "void";

export const CATEGORIES: ReadonlyArray<Category> = [
  "productive",
  "unproductive",
  "neutral",
  "unclassified",
  "void",
];

export interface MinuteCell {
  minute_of_day: number;
  category: Category;
  source_key: string | null;
  source_title: string | null;
  locked: boolean;
  preset_id: number | null;
}

export interface DayData {
  date_key: string;
  day_start_hour: number;
  minutes: MinuteCell[];
}

export interface CurrentState {
  current_minute: number;
  current_activity: string | null;
  idle_ms: number;
  paused: boolean;
  always_on_top: boolean;
}

export interface Preset {
  id: number;
  name: string;
  category: Category;
  color: string | null;
}

export type RuleMatchType = "process" | "domain" | "title_substring";

export interface Rule {
  id: number;
  pattern: string;
  match_type: RuleMatchType;
  category: Category;
  source: "builtin" | "user";
  preset_id: number | null;
}
