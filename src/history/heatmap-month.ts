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

  /** Updates the rendered grid with the given summaries, anchored at `today`. */
  setData(summariesByKey: Map<string, DaySummary>, today: string): void {
    const cells: DayCell[] = [];
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
    const anchors = readAnchors(); // read palette once per render (respects theme)
    for (const cell of this.cells) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "hm-heatmap__cell";
      el.title = formatTitle(cell);
      el.style.background = colorFor(cell, anchors);
      if (cell.dateKey === this.selected) el.classList.add("hm-heatmap__cell--selected");
      el.addEventListener("click", () => this.options.onSelect(cell.dateKey));
      this.container.appendChild(el);
    }
  }
}

type Rgb = [number, number, number];

interface Anchors {
  productive: Rgb;
  unproductive: Rgb;
  neutral: Rgb;
}

/**
 * The cell color is a true weighted blend of the three category colors by their
 * share of the tracked day — productive→green, unproductive→red, neutral→grey
 * (unclassified folds into the neutral weight; void/untracked is excluded). The
 * mix is gamma-correct (linear sRGB), which keeps contested days warm and bright
 * instead of muddy. So a day that is mostly red+green reads as a vivid blend,
 * and only a genuinely low-activity day drifts toward grey.
 */
function colorFor(cell: DayCell, anchors: Anchors): string {
  const s = cell.summary;
  if (!s || s.tracked_minutes < 60) {
    return "var(--c-void)";
  }
  const greenW = s.productive_minutes;
  const redW = s.unproductive_minutes;
  const greyW = s.neutral_minutes + s.idle_minutes + s.unclassified_minutes;
  const total = greenW + redW + greyW;
  if (total <= 0) return "var(--c-void)";

  const [r, g, b] = mixLinear(
    [
      [anchors.productive, greenW / total],
      [anchors.unproductive, redW / total],
      [anchors.neutral, greyW / total],
    ],
  );
  return `rgb(${r}, ${g}, ${b})`;
}

/** Weighted average of colors in linear-light sRGB, returned as 0..255 sRGB. */
function mixLinear(parts: Array<[Rgb, number]>): Rgb {
  let lr = 0;
  let lg = 0;
  let lb = 0;
  for (const [[cr, cg, cb], w] of parts) {
    lr += srgbToLinear(cr) * w;
    lg += srgbToLinear(cg) * w;
    lb += srgbToLinear(cb) * w;
  }
  return [
    Math.round(linearToSrgb(lr) * 255),
    Math.round(linearToSrgb(lg) * 255),
    Math.round(linearToSrgb(lb) * 255),
  ];
}

function srgbToLinear(c255: number): number {
  const c = c255 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(l: number): number {
  const c = l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  return clamp01(c);
}

/** Reads the current palette's category colors (respects runtime theme overrides). */
function readAnchors(): Anchors {
  const cs = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: Rgb): Rgb =>
    parseColor(cs.getPropertyValue(name).trim()) ?? fallback;
  return {
    productive: read("--c-productive", [16, 255, 158]),
    unproductive: read("--c-unproductive", [255, 45, 85]),
    neutral: read("--c-neutral", [138, 138, 147]),
  };
}

/** Parses `#rgb`, `#rrggbb`, or `rgb()/rgba()` into 0..255 components. */
function parseColor(value: string): Rgb | null {
  const hex = value.replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return [
      parseInt(hex[0]! + hex[0]!, 16),
      parseInt(hex[1]! + hex[1]!, 16),
      parseInt(hex[2]! + hex[2]!, 16),
    ];
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  const m = value.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
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

/** Local YYYY-MM-DD (not UTC) — matches the backend's day-key arithmetic. */
function localKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Today's date-key in the same scheme the backend uses: local time shifted back
 * by `dayStartHour` so hours after midnight still belong to the previous day.
 * Must be local, not UTC, or the key is off by a day in non-UTC timezones.
 */
export function todayKey(dayStartHour = 4): string {
  const shifted = new Date(Date.now() - dayStartHour * 60 * 60 * 1000);
  return localKey(shifted);
}

export function dateKeyOffset(base: string, daysOffset: number): string {
  const d = new Date(`${base}T00:00:00`); // parsed as local midnight
  d.setDate(d.getDate() + daysOffset);
  return localKey(d);
}
