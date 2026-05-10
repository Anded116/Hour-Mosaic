// 30-day GitHub-style heatmap. Each cell = one day; color depends on dominant category.

import type { DaySummary } from "../state/ipc";

export interface DayCell {
  dateKey: string;
  summary: DaySummary | null;
}

export interface MonthHeatmapOptions {
  days: number;
  onSelect: (dateKey: string) => void;
}

export class MonthHeatmap {
  private cells: DayCell[] = [];
  private selected: string | null = null;
  private readonly container: HTMLElement;

  constructor(container: HTMLElement, private readonly options: MonthHeatmapOptions) {
    this.container = container;
    this.container.classList.add("hm-heatmap");
  }

  /** Updates the rendered grid with the given summaries (subset of last `days`). */
  setData(summariesByKey: Map<string, DaySummary>): void {
    const cells: DayCell[] = [];
    const today = todayKey();
    for (let i = this.options.days - 1; i >= 0; i--) {
      const dateKey = dateKeyOffset(today, -i);
      cells.push({ dateKey, summary: summariesByKey.get(dateKey) ?? null });
    }
    this.cells = cells;
    this.render();
  }

  setSelected(dateKey: string | null): void {
    this.selected = dateKey;
    this.render();
  }

  private render(): void {
    this.container.innerHTML = "";
    for (const cell of this.cells) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "hm-heatmap__cell";
      el.title = formatTitle(cell);
      el.style.background = colorFor(cell);
      if (cell.dateKey === this.selected) el.classList.add("hm-heatmap__cell--selected");
      el.addEventListener("click", () => this.options.onSelect(cell.dateKey));
      this.container.appendChild(el);
    }
  }
}

function colorFor(cell: DayCell): string {
  if (!cell.summary || cell.summary.tracked_minutes < 60) {
    return "var(--c-void)";
  }
  const { productive_minutes: p, unproductive_minutes: u, tracked_minutes: t } = cell.summary;
  const pShare = p / t;
  const uShare = u / t;
  if (p >= u) {
    return lerpAlpha("var(--c-productive)", clamp01(0.2 + pShare * 0.8));
  }
  if (u > p) {
    return lerpAlpha("var(--c-unproductive)", clamp01(0.2 + uShare * 0.8));
  }
  return lerpAlpha("var(--c-neutral)", 0.4);
}

function lerpAlpha(color: string, alpha: number): string {
  // For CSS, we use color-mix to blend with bg. Safer cross-browser than rgba on a CSS var.
  const a = Math.round(alpha * 100);
  return `color-mix(in srgb, ${color} ${a}%, var(--c-bg))`;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function formatTitle(cell: DayCell): string {
  if (!cell.summary) return `${cell.dateKey} — no data`;
  const { productive_minutes: p, unproductive_minutes: u, neutral_minutes: n, tracked_minutes: t } =
    cell.summary;
  return `${cell.dateKey}\nproductive ${p}m · unproductive ${u}m · neutral ${n}m\ntracked ${t}m`;
}

export function todayKey(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export function dateKeyOffset(base: string, daysOffset: number): string {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString().slice(0, 10);
}
