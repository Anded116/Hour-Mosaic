import { invoke } from "@tauri-apps/api/core";

import type { Category, CurrentState, DayData } from "../types";

export interface DaySummary {
  date_key: string;
  productive_minutes: number;
  unproductive_minutes: number;
  neutral_minutes: number;
  unclassified_minutes: number;
  tracked_minutes: number;
}

export interface DiscoveredApp {
  source_key: string;
  sample_title: string | null;
  first_seen_ts: number;
  minutes_seen: number;
}

export interface SettingsPayload {
  day_start_hour: number;
  afk_threshold_ms: number;
  sample_interval_ms: number;
  sample_retention_days: number;
  paused: boolean;
}

export const ipc = {
  ping: () => invoke<string>("ping"),
  getDay: (dateKey?: string) => invoke<DayData>("get_day", { dateKey: dateKey ?? null }),
  getDayRange: (startKey: string, endKey: string) =>
    invoke<DaySummary[]>("get_day_range", { startKey, endKey }),
  getCurrentState: () => invoke<CurrentState>("get_current_state"),
  pauseTracking: () => invoke<void>("pause_tracking"),
  resumeTracking: () => invoke<void>("resume_tracking"),
  listUnclassified: (limit = 20) => invoke<DiscoveredApp[]>("list_unclassified", { limit }),
  listSources: (limit = 200) => invoke<DiscoveredApp[]>("list_sources", { limit }),
  reclassifySource: (sourceKey: string, category: Category) =>
    invoke<number>("reclassify_source", { sourceKey, category }),
  wipeData: () => invoke<void>("wipe_data"),
  getSettings: () => invoke<SettingsPayload>("get_settings"),
  setSettings: (patch: Partial<Pick<SettingsPayload, "day_start_hour">>) =>
    invoke<void>("set_settings", patch),
  setSegment: (
    dateKey: string,
    startMinute: number,
    endMinute: number,
    category: Category,
    presetId: number | null = null,
  ) =>
    invoke<void>("set_segment", {
      dateKey,
      startMinute,
      endMinute,
      category,
      presetId,
    }),
  clearSegment: (dateKey: string, startMinute: number, endMinute: number) =>
    invoke<void>("clear_segment", { dateKey, startMinute, endMinute }),
};
