// Draws a single hour-tile (60 minute cells, optional label, lock markers).

import type { Category, MinuteCell } from "../types";
import {
  type MosaicLayout,
  type Rect,
  minuteRect,
  tileRect,
} from "./layout";
import {
  type DetailLevel,
  showsAllHourLabels,
  showsCurrentHourLabel,
  showsMinuteDividers,
} from "./progressive";

export type HourState = "past" | "current" | "future";

export interface HourData {
  hourIndex: number;
  state: HourState;
  minutes: ReadonlyArray<MinuteCell | null>;
}

export interface Palette {
  bg: string;
  textMuted: string;
  textFaint: string;
  futureOutline: string;
  lock: string;
  accent: string;
  bright: Record<Category, string>;
  dim: Record<Category, string>;
  voidColor: string;
  fontMono: string;
}

const CATEGORY_KEYS: ReadonlyArray<Category> = [
  "productive",
  "unproductive",
  "neutral",
  "idle",
  "unclassified",
  "void",
];

export function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const get = (n: string): string => cs.getPropertyValue(n).trim();
  const bright = {} as Record<Category, string>;
  const dim = {} as Record<Category, string>;
  for (const cat of CATEGORY_KEYS) {
    bright[cat] = get(`--c-${cat}`);
    dim[cat] = get(`--c-${cat}-dim`);
  }
  return {
    bg: get("--c-bg"),
    textMuted: get("--c-text-muted"),
    textFaint: get("--c-text-faint"),
    futureOutline: get("--c-future-outline"),
    lock: get("--c-lock"),
    accent: get("--c-accent"),
    bright,
    dim,
    voidColor: get("--c-void"),
    fontMono: get("--font-mono") || "ui-monospace, Consolas, monospace",
  };
}

export function drawTile(
  ctx: CanvasRenderingContext2D,
  layout: MosaicLayout,
  hour: HourData,
  palette: Palette,
  dayStartHour: number,
  detail: DetailLevel,
  pulseAlpha: number,
): void {
  const rect = tileRect(layout, hour.hourIndex);

  if (hour.state === "future") {
    ctx.strokeStyle = palette.futureOutline;
    ctx.lineWidth = 1;
    strokeCrispRect(ctx, rect);
    drawHourLabel(ctx, rect, hour.hourIndex, dayStartHour, palette, detail, true);
    return;
  }

  ctx.save();
  if (hour.state === "current") {
    ctx.globalAlpha = pulseAlpha;
  }

  for (let minute = 0; minute < 60; minute++) {
    const cell = hour.minutes[minute] ?? null;
    const mr = minuteRect(layout, hour.hourIndex, minute);
    const color =
      cell == null
        ? palette.voidColor
        : hour.state === "current"
          ? palette.bright[cell.category]
          : palette.dim[cell.category];
    ctx.fillStyle = color;
    ctx.fillRect(mr.x, mr.y, Math.max(1, mr.w), Math.max(1, mr.h));
  }

  if (showsMinuteDividers(detail)) {
    ctx.strokeStyle = palette.bg;
    ctx.globalAlpha = (hour.state === "current" ? pulseAlpha : 1) * 0.6;
    ctx.lineWidth = 1;
    for (const mark of [15, 30, 45]) {
      const mr = minuteRect(layout, hour.hourIndex, mark);
      ctx.beginPath();
      ctx.moveTo(mr.x + 0.5, rect.y);
      ctx.lineTo(mr.x + 0.5, rect.y + rect.h);
      ctx.stroke();
    }
    ctx.globalAlpha = hour.state === "current" ? pulseAlpha : 1;
  }

  ctx.restore();

  drawLockMarkers(ctx, layout, hour, palette);
  drawHourLabel(ctx, rect, hour.hourIndex, dayStartHour, palette, detail, false);
}

function drawLockMarkers(
  ctx: CanvasRenderingContext2D,
  layout: MosaicLayout,
  hour: HourData,
  palette: Palette,
): void {
  let inLock = false;
  let runStart = 0;
  const finishRun = (endMinute: number) => {
    if (!inLock) return;
    const first = minuteRect(layout, hour.hourIndex, runStart);
    const last = minuteRect(layout, hour.hourIndex, endMinute);
    const xMin = Math.min(first.x, last.x);
    const yMin = Math.min(first.y, last.y);
    const xMax = Math.max(first.x + first.w, last.x + last.w);
    const yMax = Math.max(first.y + first.h, last.y + last.h);
    ctx.strokeStyle = palette.lock;
    ctx.globalAlpha = 0.65;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.strokeRect(xMin + 0.5, yMin + 0.5, xMax - xMin - 1, yMax - yMin - 1);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    inLock = false;
  };
  for (let m = 0; m < 60; m++) {
    const cell = hour.minutes[m];
    const locked = cell?.locked === true;
    if (locked && !inLock) {
      inLock = true;
      runStart = m;
    } else if (!locked && inLock) {
      finishRun(m - 1);
    }
  }
  finishRun(59);
}

function drawHourLabel(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  hourIndex: number,
  dayStartHour: number,
  palette: Palette,
  detail: DetailLevel,
  faint: boolean,
): void {
  if (!showsAllHourLabels(detail)) return;
  const wallHour = (dayStartHour + hourIndex) % 24;
  const label = `${String(wallHour).padStart(2, "0")}`;
  const size = Math.max(8, Math.min(11, Math.floor(Math.min(rect.w, rect.h) * 0.18)));
  ctx.font = `${size}px ${palette.fontMono}`;
  ctx.fillStyle = faint ? palette.textFaint : palette.textMuted;
  ctx.globalAlpha = 0.8;
  ctx.textBaseline = "top";
  ctx.fillText(label, rect.x + 3, rect.y + 2);
  ctx.globalAlpha = 1;
}

export function drawCurrentMinuteMarker(
  ctx: CanvasRenderingContext2D,
  layout: MosaicLayout,
  hourIndex: number,
  minuteInHour: number,
  palette: Palette,
): void {
  if (minuteInHour < 0 || minuteInHour > 59) return;
  const mr = minuteRect(layout, hourIndex, minuteInHour);
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 1;
  strokeCrispRect(ctx, mr);
}

export function drawCurrentHourBadge(
  ctx: CanvasRenderingContext2D,
  layout: MosaicLayout,
  hourIndex: number,
  dayStartHour: number,
  palette: Palette,
  detail: DetailLevel,
): void {
  if (!showsCurrentHourLabel(detail)) return;
  const rect = tileRect(layout, hourIndex);
  const wallHour = (dayStartHour + hourIndex) % 24;
  const label = `${String(wallHour).padStart(2, "0")}:00`;
  const size = detail === "spacious" ? 12 : detail === "normal" ? 11 : 10;
  ctx.font = `${size}px ${palette.fontMono}`;
  ctx.fillStyle = palette.accent;
  ctx.globalAlpha = 0.9;
  ctx.textBaseline = "bottom";
  ctx.fillText(label, rect.x + 3, rect.y + rect.h - 3);
  ctx.globalAlpha = 1;
}

function strokeCrispRect(ctx: CanvasRenderingContext2D, r: Rect): void {
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(1, r.w - 1), Math.max(1, r.h - 1));
}
