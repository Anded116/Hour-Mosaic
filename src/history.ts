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
  onSelect: (dateKey) => selectDay(dateKey),
});

let summariesByKey = new Map<string, DaySummary>();
let dayStartHour = 4;
let today = monthTodayKey(dayStartHour);
let minKey = dateKeyOffset(today, -(HEATMAP_DAYS - 1));
let selectedDate = today;

/** Selects a day, clamped to the visible [minKey, today] window. */
function selectDay(dateKey: string): void {
  const clamped = dateKey < minKey ? minKey : dateKey > today ? today : dateKey;
  updateNav();
  if (clamped === selectedDate) return;
  selectedDate = clamped;
  heatmap.setSelected(selectedDate);
  updateNav();
  void loadDrill(selectedDate);
}

/** Disables the arrows at the ends of the window. */
function updateNav(): void {
  if (prevBtn) prevBtn.disabled = selectedDate <= minKey;
  if (nextBtn) nextBtn.disabled = selectedDate >= today;
}

window.addEventListener("resize", () => drill.resize());

prevBtn?.addEventListener("click", () => selectDay(dateKeyOffset(selectedDate, -1)));
nextBtn?.addEventListener("click", () => selectDay(dateKeyOffset(selectedDate, 1)));

window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") selectDay(dateKeyOffset(selectedDate, -1));
  if (e.key === "ArrowRight") selectDay(dateKeyOffset(selectedDate, 1));
});

// Wheel over the day row scrolls through days (down = older, up = newer),
// throttled so a trackpad doesn't fly through the window.
let lastWheel = 0;
heatmapEl.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const now = performance.now();
    if (now - lastWheel < 80) return;
    lastWheel = now;
    selectDay(dateKeyOffset(selectedDate, e.deltaY > 0 ? -1 : 1));
  },
  { passive: false },
);

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
  updateNav();

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
