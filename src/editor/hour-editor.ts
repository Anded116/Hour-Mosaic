// Coordinates drag-selection on the mosaic, the time tooltip, and the category popover.

import { hitTest } from "../mosaic/layout";
import type { MosaicRenderer, MosaicSelection } from "../mosaic/mosaic";
import type { Category, MinuteCell } from "../types";
import { SOURCE_CHOICES, showCategoryPopover } from "./category-popover";
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
  /** Returns the rendered day's minute cells (for the hover activity readout). */
  getMinutes: () => ReadonlyArray<MinuteCell>;
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
  /** Reclassifies a whole source (app/site) — recolors its past + future minutes. */
  reclassifySource: (sourceKey: string, category: Category) => Promise<void>;
  /** Re-fetches the day and pushes it into the store. */
  refreshDay: () => Promise<void>;
  /** Optional surface for displaying invoke errors in the UI. */
  onError?: (err: unknown, label: string) => void;
}

export class HourEditor {
  private readonly tooltip: HTMLDivElement;
  private readonly drag: DragSelect;
  /** True while the category popover is open — suppresses hover and new drags. */
  private popoverOpen = false;
  /** True between drag start and commit/cancel — suppresses hover. */
  private dragging = false;
  /** `lo-hi` of the currently framed activity run, to avoid redundant repaints. */
  private hoverKey: string | null = null;

  constructor(private readonly deps: EditorDeps) {
    this.tooltip = document.createElement("div");
    this.tooltip.className = "hm-drag-tooltip";
    this.tooltip.style.display = "none";
    document.body.appendChild(this.tooltip);

    this.drag = new DragSelect(deps.canvas, {
      layoutProvider: () => deps.renderer.currentLayout(),
      maxEditableHour: () => deps.maxEditableHour(),
      canStart: () => !this.popoverOpen,
      onStart: (range, e) => {
        this.dragging = true;
        this.clearHoverFrame();
        deps.renderer.setSelection(toSelection(range));
        this.updateTooltip(range, e);
      },
      onUpdate: (range, e) => {
        deps.renderer.setSelection(toSelection(range));
        this.updateTooltip(range, e);
      },
      onCommit: (range, e) => {
        this.dragging = false;
        this.hideTooltip();
        void this.commit(range, e.clientX, e.clientY);
      },
      onCancel: () => {
        this.dragging = false;
        this.hideTooltip();
        deps.renderer.setSelection(null);
      },
    });

    deps.canvas.addEventListener("pointermove", this.onHoverMove);
    deps.canvas.addEventListener("pointerleave", this.onHoverLeave);
  }

  dispose(): void {
    this.drag.dispose();
    this.deps.canvas.removeEventListener("pointermove", this.onHoverMove);
    this.deps.canvas.removeEventListener("pointerleave", this.onHoverLeave);
    this.tooltip.remove();
  }

  private async commit(range: DragRange, clientX: number, clientY: number): Promise<void> {
    this.popoverOpen = true;
    this.clearHoverFrame();
    try {
      const startAbs = range.hour * 60 + range.startMinute;
      const endAbs = range.hour * 60 + range.endMinute;

      // A single-minute click (no drag) classifies the whole app/source under it.
      // A drag across minutes is a manual per-minute edit.
      if (range.startMinute === range.endMinute) {
        const run = findActivityRun(this.deps.getMinutes(), startAbs);
        const sourceKey = run?.cell.source_key ?? null;
        if (run && sourceKey && sourceKey !== "idle") {
          const choice = await showCategoryPopover(clientX, clientY, {
            variant: "source",
            header: entityLabel(sourceKey) ?? sourceKey,
            subtitle: `Whole app · now ${categoryLabel(run.cell.category)}`,
            choices: SOURCE_CHOICES,
          });
          this.deps.renderer.setSelection(null);
          if (!choice) return;
          await this.deps.reclassifySource(sourceKey, choice.category);
          // The backend emits hm:day-changed, which refreshes the mosaic.
          return;
        }
        // No classifiable source (void/idle/untracked) — fall through to manual edit.
      }

      const dayStart = this.deps.dayStartHour();
      const len = endAbs - startAbs + 1;
      const choice = await showCategoryPopover(clientX, clientY, {
        variant: "manual",
        header: `Edit ${len} min`,
        subtitle: `${wallClock(startAbs, dayStart)}–${wallClock(endAbs + 1, dayStart)} · this selection only`,
      });
      this.deps.renderer.setSelection(null);
      if (!choice) return;
      const dateKey = this.deps.dateKey();
      if (choice.category === "void") {
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
      console.error("commit failed", err);
      this.deps.onError?.(err, "classify");
    } finally {
      this.popoverOpen = false;
    }
  }

  // --- hover: frame the activity run under the cursor and show what it was ---

  private onHoverMove = (e: PointerEvent): void => {
    if (this.dragging || this.popoverOpen) return;
    const layout = this.deps.renderer.currentLayout();
    if (!layout) return this.clearHover();
    const rect = this.deps.canvas.getBoundingClientRect();
    const hit = hitTest(layout, e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) return this.clearHover();

    const run = findActivityRun(this.deps.getMinutes(), hit.hour * 60 + hit.minute);
    if (!run) return this.clearHover();

    const key = `${run.lo}-${run.hi}`;
    if (key !== this.hoverKey) {
      this.hoverKey = key;
      const minutes: number[] = [];
      for (let m = run.lo; m <= run.hi; m++) minutes.push(m);
      this.deps.renderer.setHoverRun(minutes);
    }
    this.showActivityTooltip(run, e);
  };

  private onHoverLeave = (): void => {
    if (this.dragging || this.popoverOpen) return;
    this.clearHover();
  };

  /** Drops the frame and the tooltip. */
  private clearHover(): void {
    this.clearHoverFrame();
    this.hideTooltip();
  }

  /** Drops only the frame overlay, leaving the tooltip alone (used at drag start). */
  private clearHoverFrame(): void {
    if (this.hoverKey !== null) {
      this.hoverKey = null;
      this.deps.renderer.setHoverRun(null);
    }
  }

  private showActivityTooltip(run: ActivityRun, event: PointerEvent): void {
    const dayStart = this.deps.dayStartHour();
    const length = run.hi - run.lo + 1;
    const title = entityLabel(run.cell.source_key) ?? categoryLabel(run.cell.category);
    const sub = `${wallClock(run.lo, dayStart)}–${wallClock(run.hi + 1, dayStart)} · ${length} мин · ${categoryLabel(run.cell.category)}`;

    const titleEl = document.createElement("div");
    titleEl.className = "hm-tip-title";
    titleEl.textContent = title;
    const subEl = document.createElement("div");
    subEl.className = "hm-tip-sub";
    subEl.textContent = sub;
    this.tooltip.replaceChildren(titleEl, subEl);

    this.tooltip.style.display = "";
    const margin = 8;
    const docW = document.documentElement.clientWidth;
    const left = Math.max(margin, Math.min(docW - this.tooltip.offsetWidth - margin, event.clientX + 12));
    const top = Math.max(margin, event.clientY + 12);
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
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

interface ActivityRun {
  lo: number;
  hi: number;
  cell: MinuteCell;
}

/** A run groups by source (the tracked app/site); manual edits with no source group by category. */
function runKey(cell: MinuteCell): string {
  return cell.source_key ?? `cat:${cell.category}`;
}

/** Maximal contiguous range of minutes around `abs` that share the same activity. */
function findActivityRun(minutes: ReadonlyArray<MinuteCell>, abs: number): ActivityRun | null {
  const byMinute = new Map<number, MinuteCell>();
  for (const c of minutes) byMinute.set(c.minute_of_day, c);
  const cell = byMinute.get(abs);
  if (!cell) return null;

  const key = runKey(cell);
  let lo = abs;
  let hi = abs;
  while (lo > 0) {
    const prev = byMinute.get(lo - 1);
    if (!prev || runKey(prev) !== key) break;
    lo--;
  }
  while (hi < 1439) {
    const next = byMinute.get(hi + 1);
    if (!next || runKey(next) !== key) break;
    hi++;
  }
  return { lo, hi, cell };
}

/**
 * Human-readable name for an entity's `source_key`. The key is "process",
 * "process::domain", or "process::title", depending on the grouping mode — show
 * the most specific stable part so e.g. "Telegram.exe" reads as "Telegram" and
 * "chrome.exe::youtube.com" reads as "youtube.com".
 */
function entityLabel(sourceKey: string | null): string | null {
  if (!sourceKey) return null;
  if (sourceKey === "idle") return "Away"; // AFK break — a break is its own entity
  const sep = sourceKey.indexOf("::");
  if (sep !== -1) {
    const rest = sourceKey.slice(sep + 2);
    return rest.startsWith("title:") ? rest.slice("title:".length) : rest;
  }
  return prettifyProcess(sourceKey);
}

function prettifyProcess(process: string): string {
  const stem = process.replace(/\.exe$/i, "");
  // Capitalize a bare lowercase process name ("telegram" -> "Telegram").
  return stem.length > 0 && stem === stem.toLowerCase()
    ? stem.charAt(0).toUpperCase() + stem.slice(1)
    : stem;
}

function categoryLabel(c: Category): string {
  switch (c) {
    case "productive":
      return "Productive";
    case "unproductive":
      return "Unproductive";
    case "neutral":
      return "Neutral";
    case "idle":
      return "Idle";
    case "unclassified":
      return "Unclassified";
    case "void":
      return "Untracked";
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
