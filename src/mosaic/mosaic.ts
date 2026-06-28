// Top-level Canvas orchestrator for the day mosaic.

import type { Category, DayData, MinuteCell } from "../types";
import { minuteRect, solveLayout, type MosaicLayout } from "./layout";
import { detailLevel } from "./progressive";
import {
  type HourData,
  drawCurrentHourBadge,
  drawCurrentMinuteMarker,
  drawCurrentMinuteProgress,
  drawTile,
  readPalette,
  type Palette,
} from "./tiles";

export interface MosaicSnapshot {
  day: DayData;
  /** Minute of day (0..1439), relative to day_start_hour. */
  currentMinute: number;
}

export interface MosaicSelection {
  hour: number;
  startMinute: number;
  endMinute: number;
}

export class MosaicRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private snapshot: MosaicSnapshot | null = null;
  private hours: HourData[] = [];
  private pulseAlpha = 1;
  private cachedPalette: Palette | null = null;
  private renderQueued = false;
  private selection: MosaicSelection | null = null;
  /** Absolute minutes (0..1439) of the activity run under the cursor, framed together. */
  private hoverRun: number[] | null = null;
  /** Live category of the in-progress minute — colors its progress fill. */
  private currentActivityCategory: Category | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
  }

  setSnapshot(snap: MosaicSnapshot): void {
    this.snapshot = snap;
    this.hours = buildHourData(snap);
    this.scheduleRender();
  }

  setPulseAlpha(alpha: number): void {
    this.pulseAlpha = alpha;
    this.scheduleRender();
  }

  setSelection(selection: MosaicSelection | null): void {
    this.selection = selection;
    this.scheduleRender();
  }

  /** Highlights a contiguous activity run with a single unifying frame. */
  setHoverRun(minutes: number[] | null): void {
    this.hoverRun = minutes && minutes.length > 0 ? minutes : null;
    this.scheduleRender();
  }

  /** Live category of the current activity — used to color the minute progress fill. */
  setCurrentActivityCategory(category: Category | null): void {
    this.currentActivityCategory = category;
    this.scheduleRender();
  }

  /** Invalidates the cached palette — call after theme tokens change. */
  refreshPalette(): void {
    this.cachedPalette = null;
    this.scheduleRender();
  }

  resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const host = this.canvas.parentElement ?? document.documentElement;
    const w = host.clientWidth;
    const h = host.clientHeight;
    this.canvas.width = Math.max(1, Math.floor(w * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(h * this.dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.scheduleRender();
  }

  /** Returns the current layout for hit-testing. Null until snapshot is set. */
  currentLayout(): MosaicLayout | null {
    if (!this.snapshot) return null;
    return solveLayout(this.cssWidth(), this.cssHeight());
  }

  private cssWidth(): number {
    return this.canvas.width / this.dpr;
  }

  private cssHeight(): number {
    return this.canvas.height / this.dpr;
  }

  private scheduleRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  private render(): void {
    if (!this.snapshot) return;
    const ctx = this.ctx;
    const w = this.cssWidth();
    const h = this.cssHeight();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const palette = (this.cachedPalette ??= readPalette());
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, w, h);

    const layout = solveLayout(w, h);
    const detail = detailLevel(w, h);

    for (const hour of this.hours) {
      drawTile(
        ctx,
        layout,
        hour,
        palette,
        this.snapshot.day.day_start_hour,
        detail,
        hour.state === "current" ? this.pulseAlpha : 1,
      );
    }

    const currentHourIndex = Math.floor(this.snapshot.currentMinute / 60);
    if (currentHourIndex >= 0 && currentHourIndex < 24) {
      const minuteInHour = this.snapshot.currentMinute - currentHourIndex * 60;
      // Seconds elapsed within the current minute → a progress fill in its cell.
      // Drawn each frame (the pulse loop keeps render running) so it grows live.
      const now = new Date();
      const progress = (now.getSeconds() + now.getMilliseconds() / 1000) / 60;
      const fillColor = this.currentActivityCategory
        ? palette.bright[this.currentActivityCategory]
        : palette.accent;
      drawCurrentMinuteProgress(ctx, layout, currentHourIndex, minuteInHour, progress, fillColor);
      drawCurrentMinuteMarker(ctx, layout, currentHourIndex, minuteInHour, palette);
      drawCurrentHourBadge(
        ctx,
        layout,
        currentHourIndex,
        this.snapshot.day.day_start_hour,
        palette,
        detail,
      );
    }

    if (this.hoverRun) {
      drawActivityFrame(ctx, layout, this.hoverRun, palette);
    }

    if (this.selection) {
      drawSelection(ctx, layout, this.selection, palette);
    }
  }
}

/**
 * Frames a set of minute cells with a single outline by cancelling every edge
 * shared between two cells in the set — what remains is the outer boundary of
 * their union. Works for the irregular "staircase" shapes a contiguous minute
 * run makes inside the wrapped sub-grid, and naturally yields one frame per
 * hour-tile when a run crosses an hour boundary.
 */
function drawActivityFrame(
  ctx: CanvasRenderingContext2D,
  layout: MosaicLayout,
  minutes: number[],
  palette: Palette,
): void {
  const edges = new Map<string, [number, number, number, number]>();
  const toggle = (ax: number, ay: number, bx: number, by: number): void => {
    // Canonical endpoint order so the same edge from two cells collides.
    const swap = bx < ax || (bx === ax && by < ay);
    const [x1, y1, x2, y2] = swap ? [bx, by, ax, ay] : [ax, ay, bx, by];
    const key = `${x1.toFixed(2)},${y1.toFixed(2)},${x2.toFixed(2)},${y2.toFixed(2)}`;
    if (edges.has(key)) edges.delete(key);
    else edges.set(key, [x1, y1, x2, y2]);
  };

  for (const abs of minutes) {
    const r = minuteRect(layout, Math.floor(abs / 60), abs % 60);
    const x0 = r.x;
    const y0 = r.y;
    const x1 = r.x + r.w;
    const y1 = r.y + r.h;
    toggle(x0, y0, x1, y0); // top
    toggle(x1, y0, x1, y1); // right
    toggle(x0, y1, x1, y1); // bottom
    toggle(x0, y0, x0, y1); // left
  }

  ctx.save();
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of edges.values()) {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
  ctx.restore();
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  layout: MosaicLayout,
  selection: MosaicSelection,
  palette: Palette,
): void {
  const start = Math.max(0, Math.min(59, Math.min(selection.startMinute, selection.endMinute)));
  const end = Math.max(0, Math.min(59, Math.max(selection.startMinute, selection.endMinute)));
  ctx.save();
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 1.5;
  for (let m = start; m <= end; m++) {
    const r = minuteRect(layout, selection.hour, m);
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(1, r.w - 1), Math.max(1, r.h - 1));
  }
  ctx.restore();
}

function buildHourData(snap: MosaicSnapshot): HourData[] {
  const byMinute = new Map<number, MinuteCell>();
  for (const m of snap.day.minutes) byMinute.set(m.minute_of_day, m);
  const currentHourIndex = Math.floor(snap.currentMinute / 60);

  const hours: HourData[] = [];
  for (let h = 0; h < 24; h++) {
    const minutes: (MinuteCell | null)[] = [];
    for (let m = 0; m < 60; m++) {
      minutes.push(byMinute.get(h * 60 + m) ?? null);
    }
    const state =
      h < currentHourIndex ? "past" : h === currentHourIndex ? "current" : "future";
    hours.push({ hourIndex: h, state, minutes });
  }
  return hours;
}
