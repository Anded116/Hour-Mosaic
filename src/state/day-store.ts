// In-memory store of the current day plus the current-minute pointer.
// Backed by Tauri IPC: data comes from `get_day` / `hm:tick` events.

import type { Category, DayData, MinuteCell } from "../types";

export interface DaySnapshot {
  day: DayData;
  currentMinute: number;
}

export type DaySubscriber = (snap: DaySnapshot) => void;

export interface DayStore {
  get(): DaySnapshot;
  subscribe(fn: DaySubscriber): () => void;
  setDay(day: DayData): void;
  setCurrentMinute(min: number): void;
  applyTick(minute: number, category: Category, sourceKey: string | null, sourceTitle: string | null): void;
  loadMock(): void;
}

export function createDayStore(dayStartHour = 4): DayStore {
  let snap: DaySnapshot = {
    day: emptyDay(dayStartHour),
    currentMinute: currentMinuteOfDay(dayStartHour),
  };
  const subs = new Set<DaySubscriber>();
  const emit = () => subs.forEach((fn) => fn(snap));
  return {
    get: () => snap,
    subscribe(fn) {
      subs.add(fn);
      fn(snap);
      return () => {
        subs.delete(fn);
      };
    },
    setDay(day) {
      snap = { ...snap, day };
      emit();
    },
    setCurrentMinute(min) {
      const v = clamp(min, 0, 1439);
      if (v === snap.currentMinute) return; // no-op when the minute hasn't rolled
      snap = { ...snap, currentMinute: v };
      emit();
    },
    applyTick(minute, category, sourceKey, sourceTitle) {
      const cell: MinuteCell = {
        minute_of_day: minute,
        category,
        source_key: sourceKey,
        source_title: sourceTitle,
        locked: false,
        preset_id: null,
      };
      const existing = snap.day.minutes;
      const next = upsertCell(existing, cell);
      snap = { day: { ...snap.day, minutes: next }, currentMinute: snap.currentMinute };
      emit();
    },
    loadMock() {
      snap = {
        day: buildMockDay(snap.day.day_start_hour, snap.currentMinute),
        currentMinute: snap.currentMinute,
      };
      emit();
    },
  };
}

function upsertCell(cells: MinuteCell[], next: MinuteCell): MinuteCell[] {
  const idx = cells.findIndex((c) => c.minute_of_day === next.minute_of_day);
  if (idx === -1) {
    return [...cells, next].sort((a, b) => a.minute_of_day - b.minute_of_day);
  }
  // Manual edits (locked) win — tracker writes do not overwrite them client-side either.
  if (cells[idx]!.locked) return cells;
  const copy = cells.slice();
  copy[idx] = next;
  return copy;
}

function emptyDay(dayStartHour: number): DayData {
  return {
    date_key: todayKey(dayStartHour),
    day_start_hour: dayStartHour,
    minutes: [],
  };
}

export function currentMinuteOfDay(dayStartHour: number): number {
  const now = new Date();
  const minutesIntoDay = now.getHours() * 60 + now.getMinutes();
  return (minutesIntoDay - dayStartHour * 60 + 1440) % 1440;
}

export function todayKey(dayStartHour: number): string {
  const now = new Date();
  const shifted = new Date(now.getTime() - dayStartHour * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// --- mock generation (retained for offline development / screenshots) -----

type CategoryWeight = readonly [Category, number];

function pickCategory(weights: ReadonlyArray<CategoryWeight>): Category {
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [c, w] of weights) {
    r -= w;
    if (r <= 0) return c;
  }
  return weights[weights.length - 1]![0];
}

function weightsForHour(hourIndex: number): ReadonlyArray<CategoryWeight> {
  if (hourIndex <= 2) return [["neutral", 4], ["productive", 1]];
  if (hourIndex <= 4) return [["productive", 4], ["neutral", 3], ["unclassified", 1]];
  if (hourIndex <= 9) return [["productive", 8], ["neutral", 1], ["unproductive", 0.5]];
  if (hourIndex === 10) return [["neutral", 6], ["unproductive", 1]];
  if (hourIndex <= 15) return [["productive", 5], ["unproductive", 2], ["neutral", 1.5], ["unclassified", 0.5]];
  if (hourIndex <= 19) return [["unproductive", 5], ["neutral", 2], ["productive", 1]];
  return [["neutral", 3], ["unproductive", 2]];
}

const HOUR_GAPS: ReadonlyArray<readonly [number, number]> = [
  [0, 60],
  [300, 360],
];

function isGap(minute: number): boolean {
  for (const [a, b] of HOUR_GAPS) {
    if (minute >= a && minute < b) return true;
  }
  return false;
}

function buildMockDay(dayStartHour: number, currentMinute: number): DayData {
  const minutes: MinuteCell[] = [];
  for (let m = 0; m <= currentMinute; m++) {
    if (isGap(m)) continue;
    const hourIndex = Math.floor(m / 60);
    minutes.push({
      minute_of_day: m,
      category: pickCategory(weightsForHour(hourIndex)),
      source_key: "mock",
      source_title: null,
      locked: m >= 720 && m < 740,
      preset_id: null,
    });
  }
  return {
    date_key: todayKey(dayStartHour),
    day_start_hour: dayStartHour,
    minutes,
  };
}
