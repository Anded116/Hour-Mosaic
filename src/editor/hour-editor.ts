// Coordinates drag-selection on the mosaic, the time tooltip, and the category popover.

import type { MosaicRenderer, MosaicSelection } from "../mosaic/mosaic";
import { showCategoryPopover } from "./category-popover";
import { DragSelect, type DragRange } from "./drag-select";

export interface EditorDeps {
  canvas: HTMLCanvasElement;
  renderer: MosaicRenderer;
  /** Returns the current day_start_hour. */
  dayStartHour: () => number;
  /** Returns the current date_key. */
  dateKey: () => string;
  /** Returns the inclusive upper bound of editable hours (e.g. floor(currentMinute/60)). */
  maxEditableHour: () => number;
  /** Persists a manual segment to the backend. */
  setSegment: (
    dateKey: string,
    startMinute: number,
    endMinute: number,
    category: "productive" | "unproductive" | "neutral",
    presetId: number | null,
  ) => Promise<void>;
  /** Clears the lock on a segment. */
  clearSegment: (dateKey: string, startMinute: number, endMinute: number) => Promise<void>;
  /** Re-fetches the day and pushes it into the store. */
  refreshDay: () => Promise<void>;
}

export class HourEditor {
  private readonly tooltip: HTMLDivElement;
  private readonly drag: DragSelect;

  constructor(private readonly deps: EditorDeps) {
    this.tooltip = document.createElement("div");
    this.tooltip.className = "hm-drag-tooltip";
    this.tooltip.style.display = "none";
    document.body.appendChild(this.tooltip);

    this.drag = new DragSelect(deps.canvas, {
      layoutProvider: () => deps.renderer.currentLayout(),
      maxEditableHour: () => deps.maxEditableHour(),
      onStart: (range, e) => {
        deps.renderer.setSelection(toSelection(range));
        this.updateTooltip(range, e);
      },
      onUpdate: (range, e) => {
        deps.renderer.setSelection(toSelection(range));
        this.updateTooltip(range, e);
      },
      onCommit: (range, e) => {
        this.hideTooltip();
        void this.commit(range, e.clientX, e.clientY);
      },
      onCancel: () => {
        this.hideTooltip();
        deps.renderer.setSelection(null);
      },
    });
  }

  dispose(): void {
    this.drag.dispose();
    this.tooltip.remove();
  }

  private async commit(range: DragRange, clientX: number, clientY: number): Promise<void> {
    const choice = await showCategoryPopover(clientX, clientY);
    this.deps.renderer.setSelection(null);
    if (!choice) return;
    const dateKey = this.deps.dateKey();
    const startAbs = range.hour * 60 + range.startMinute;
    const endAbs = range.hour * 60 + range.endMinute;
    try {
      if (choice.category === "void") {
        // Sentinel: clear lock on the selected range.
        await this.deps.clearSegment(dateKey, startAbs, endAbs);
      } else {
        await this.deps.setSegment(
          dateKey,
          startAbs,
          endAbs,
          choice.category as "productive" | "unproductive" | "neutral",
          null,
        );
      }
      await this.deps.refreshDay();
    } catch (err) {
      console.error("set_segment failed", err);
    }
  }

  private updateTooltip(range: DragRange, event: PointerEvent): void {
    const dayStart = this.deps.dayStartHour();
    const startAbs = range.hour * 60 + range.startMinute;
    const endAbs = range.hour * 60 + range.endMinute;
    const length = endAbs - startAbs + 1;
    this.tooltip.textContent = `${wallClock(startAbs, dayStart)} → ${wallClock(endAbs + 1, dayStart)} · ${length} мин`;
    this.tooltip.style.display = "";
    const margin = 8;
    const docW = document.documentElement.clientWidth;
    const left = Math.max(margin, Math.min(docW - this.tooltip.offsetWidth - margin, event.clientX + 12));
    const top = Math.max(margin, event.clientY + 12);
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
  }

  private hideTooltip(): void {
    this.tooltip.style.display = "none";
  }
}

function toSelection(range: DragRange): MosaicSelection {
  return {
    hour: range.hour,
    startMinute: range.startMinute,
    endMinute: range.endMinute,
  };
}

function wallClock(minuteOfDay: number, dayStartHour: number): string {
  const wallMin = (dayStartHour * 60 + minuteOfDay) % 1440;
  const hh = Math.floor(wallMin / 60);
  const mm = wallMin % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
