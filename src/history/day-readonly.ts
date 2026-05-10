// Read-only mosaic rendering for a single past day. Used in the History drill-down.

import { MosaicRenderer } from "../mosaic/mosaic";
import type { DayData } from "../types";

export class DayReadonlyView {
  private readonly renderer: MosaicRenderer;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new MosaicRenderer(canvas);
  }

  resize(): void {
    this.renderer.resize();
  }

  show(day: DayData): void {
    // For past days the "current minute" effectively sits at end-of-day so every hour renders as past.
    const currentMinute = 1440;
    this.renderer.setSnapshot({ day, currentMinute });
    this.resize();
  }
}
