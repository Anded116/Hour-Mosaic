// History window entry — month heatmap, aggregated metrics, day drill-down.

import { DayReadonlyView } from "./history/day-readonly";
import {
  MonthHeatmap,
  dateKeyOffset,
  todayKey as monthTodayKey,
} from "./history/heatmap-month";
import { aggregate } from "./history/metrics";
import { ipc, type DaySummary } from "./state/ipc";

const HEATMAP_DAYS = 30;

const heatmapEl = document.getElementById("month-heatmap");
const dayCanvas = document.getElementById("day-canvas") as HTMLCanvasElement | null;
const dayLabel = document.getElementById("day-label");
const prevBtn = document.getElementById("day-prev") as HTMLButtonElement | null;
const nextBtn = document.getElementById("day-next") as HTMLButtonElement | null;
const metricAvg = document.getElementById("metric-avg");
const metricBest = document.getElementById("metric-best");
const metricWorst = document.getElementById("metric-worst");
const metricStreak = document.getElementById("metric-streak");

if (!heatmapEl || !dayCanvas) throw new Error("history shell missing");

const drill = new DayReadonlyView(dayCanvas);
const heatmap = new MonthHeatmap(heatmapEl, {
  days: HEATMAP_DAYS,
  onSelect: (dateKey) => {
    selectedDate = dateKey;
    heatmap.setSelected(dateKey);
    void loadDrill(dateKey);
  },
});

let summariesByKey = new Map<string, DaySummary>();
let dayStartHour = 4;
let today = monthTodayKey(dayStartHour);
let minKey = dateKeyOffset(today, -(HEATMAP_DAYS - 1));
let selectedDate = today;

window.addEventListener("resize", () => drill.resize());

prevBtn?.addEventListener("click", () => {
  const prev = dateKeyOffset(selectedDate, -1);
  selectedDate = prev < minKey ? minKey : prev; // don't escape the 30-day window
  heatmap.setSelected(selectedDate);
  void loadDrill(selectedDate);
});
nextBtn?.addEventListener("click", () => {
  const next = dateKeyOffset(selectedDate, 1);
  selectedDate = next > today ? today : next; // can't go past today
  heatmap.setSelected(selectedDate);
  void loadDrill(selectedDate);
});

window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") prevBtn?.click();
  if (e.key === "ArrowRight") nextBtn?.click();
});

void boot();

async function boot(): Promise<void> {
  // Align the day-key scheme with the backend's configured day-start hour.
  try {
    const settings = await ipc.getSettings();
    dayStartHour = settings.day_start_hour;
  } catch (err) {
    console.warn("getSettings failed, assuming day start 04:00", err);
  }
  today = monthTodayKey(dayStartHour);
  minKey = dateKeyOffset(today, -(HEATMAP_DAYS - 1));
  selectedDate = today;

  try {
    const summaries = await ipc.getDayRange(minKey, today);
    summariesByKey = new Map(summaries.map((s) => [s.date_key, s]));
    heatmap.setData(summariesByKey, today);
    heatmap.setSelected(selectedDate);
    renderMetrics(summaries);
  } catch (err) {
    console.error("getDayRange failed", err);
  }
  await loadDrill(selectedDate);
}

async function loadDrill(dateKey: string): Promise<void> {
  if (dayLabel) dayLabel.textContent = dateKey;
  try {
    const day = await ipc.getDay(dateKey);
    drill.show(day);
  } catch (err) {
    console.warn("getDay failed", err);
  }
}

function renderMetrics(summaries: DaySummary[]): void {
  const agg = aggregate(summaries);
  if (metricAvg) metricAvg.textContent = `${agg.avgProductiveMin}m`;
  if (metricBest) metricBest.textContent = agg.bestDay
    ? `${agg.bestDay.date_key} · ${agg.bestDay.productive_minutes}m`
    : "—";
  if (metricWorst) metricWorst.textContent = agg.worstDay
    ? `${agg.worstDay.date_key} · ${agg.worstDay.unproductive_minutes}m`
    : "—";
  if (metricStreak) metricStreak.textContent = `${agg.deepWorkStreak}d`;
}
