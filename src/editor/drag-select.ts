// Pointer-driven drag-select on the mosaic canvas. Constrains drag to a single hour tile.

import { hitTest, type MosaicLayout } from "../mosaic/layout";

export interface DragRange {
  hour: number;
  startMinute: number;
  endMinute: number;
}

export interface DragHandlers {
  onStart: (range: DragRange, event: PointerEvent) => void;
  onUpdate: (range: DragRange, event: PointerEvent) => void;
  onCommit: (range: DragRange, event: PointerEvent) => void;
  onCancel: () => void;
  /** Returns the current layout, or null if mosaic is not yet rendered. */
  layoutProvider: () => MosaicLayout | null;
  /** Hours strictly greater than this are non-editable (future). */
  maxEditableHour: () => number;
}

export class DragSelect {
  private state: { hour: number; startMinute: number; endMinute: number; pointerId: number } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly handlers: DragHandlers,
  ) {
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerCancel);
  }

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerCancel);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const hit = this.hitFromEvent(e);
    if (!hit) return;
    if (hit.hour > this.handlers.maxEditableHour()) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.state = {
      hour: hit.hour,
      startMinute: hit.minute,
      endMinute: hit.minute,
      pointerId: e.pointerId,
    };
    this.handlers.onStart(this.range(), e);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.state || e.pointerId !== this.state.pointerId) return;
    const hit = this.hitFromEvent(e);
    if (!hit || hit.hour !== this.state.hour) return; // constrain to the same hour
    if (hit.minute === this.state.endMinute) return;
    this.state.endMinute = hit.minute;
    this.handlers.onUpdate(this.range(), e);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.state || e.pointerId !== this.state.pointerId) return;
    const range = this.range();
    this.canvas.releasePointerCapture(e.pointerId);
    this.state = null;
    this.handlers.onCommit(range, e);
  };

  private onPointerCancel = (e: PointerEvent): void => {
    if (!this.state || e.pointerId !== this.state.pointerId) return;
    this.canvas.releasePointerCapture(e.pointerId);
    this.state = null;
    this.handlers.onCancel();
  };

  private hitFromEvent(e: PointerEvent): { hour: number; minute: number } | null {
    const layout = this.handlers.layoutProvider();
    if (!layout) return null;
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    return hitTest(layout, px, py);
  }

  private range(): DragRange {
    const s = this.state!;
    const lo = Math.min(s.startMinute, s.endMinute);
    const hi = Math.max(s.startMinute, s.endMinute);
    return { hour: s.hour, startMinute: lo, endMinute: hi };
  }
}
