// Top-level Canvas orchestrator for the day mosaic.

import type { DayData, MinuteCell } from "../types";
import { minuteRect, solveLayout, type MosaicLayout } from "./layout";
import { detailLevel } from "./progressive";
import {
  type HourData,
  drawCurrentHourBadge,
  drawCurrentMinuteMarker,
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

  /** Invalidates the cached palette — call after theme tokens change. */
  refreshPalette(): void {
    this.cachedPalette = null;
    this.scheduleRender();
  }

  resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const { clientWidth, clientHeight } = document.documentElement;
    this.canvas.width = Math.max(1, Math.floor(clientWidth * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(clientHeight * this.dpr));
    this.canvas.style.width = `${clientWidth}px`;
    this.canvas.style.height = `${clientHeight}px`;
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
      drawCurrentMinuteMarker(
        ctx,
        layout,
        currentHourIndex,
        this.snapshot.currentMinute - currentHourIndex * 60,
        palette,
      );
      drawCurrentHourBadge(
        ctx,
        layout,
        currentHourIndex,
        this.snapshot.day.day_start_hour,
        palette,
        detail,
      );
    }

    if (this.selection) {
      drawSelection(ctx, layout, this.selection, palette);
    }
  }
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
