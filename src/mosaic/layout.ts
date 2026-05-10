// Solves how to lay out 24 hour-tiles inside a canvas of given size,
// and how to lay out 60 minute-cells inside each tile.

export interface TileSubGrid {
  cols: number;
  rows: number;
}

export interface MosaicLayout {
  cols: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  tileSubGrid: TileSubGrid;
  gap: number;
  outerPadding: number;
}

const GRID_CANDIDATES: ReadonlyArray<readonly [number, number]> = [
  [24, 1],
  [12, 2],
  [8, 3],
  [6, 4],
  [4, 6],
  [3, 8],
  [2, 12],
  [1, 24],
];

const SUB_CANDIDATES: ReadonlyArray<readonly [number, number]> = [
  [5, 12],
  [6, 10],
  [10, 6],
  [12, 5],
];

export function solveLayout(canvasWidth: number, canvasHeight: number): MosaicLayout {
  const outerPadding = canvasWidth < 200 || canvasHeight < 200 ? 2 : 6;
  const gap = canvasWidth < 300 || canvasHeight < 300 ? 1 : 2;

  const availW = Math.max(1, canvasWidth - outerPadding * 2);
  const availH = Math.max(1, canvasHeight - outerPadding * 2);
  const targetLog = Math.log(availW / availH);

  let best: readonly [number, number] = GRID_CANDIDATES[0]!;
  let bestScore = Infinity;
  for (const candidate of GRID_CANDIDATES) {
    const score = Math.abs(Math.log(candidate[0] / candidate[1]) - targetLog);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  const [cols, rows] = best;
  const tileWidth = (availW - gap * (cols - 1)) / cols;
  const tileHeight = (availH - gap * (rows - 1)) / rows;

  return {
    cols,
    rows,
    tileWidth,
    tileHeight,
    tileSubGrid: pickTileSubGrid(tileWidth, tileHeight),
    gap,
    outerPadding,
  };
}

function pickTileSubGrid(tw: number, th: number): TileSubGrid {
  const ratio = tw / th;
  if (ratio > 4) return { cols: 60, rows: 1 };
  if (ratio < 0.25) return { cols: 1, rows: 60 };

  const targetLog = Math.log(ratio);
  let best: readonly [number, number] = [10, 6];
  let bestScore = Infinity;
  for (const c of SUB_CANDIDATES) {
    const score = Math.abs(Math.log(c[0] / c[1]) - targetLog);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return { cols: best[0], rows: best[1] };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function tileRect(layout: MosaicLayout, hourIndex: number): Rect {
  const col = hourIndex % layout.cols;
  const row = Math.floor(hourIndex / layout.cols);
  return {
    x: layout.outerPadding + col * (layout.tileWidth + layout.gap),
    y: layout.outerPadding + row * (layout.tileHeight + layout.gap),
    w: layout.tileWidth,
    h: layout.tileHeight,
  };
}

export function minuteRect(layout: MosaicLayout, hourIndex: number, minute: number): Rect {
  const tile = tileRect(layout, hourIndex);
  const sub = layout.tileSubGrid;
  const col = minute % sub.cols;
  const row = Math.floor(minute / sub.cols);
  const cellW = tile.w / sub.cols;
  const cellH = tile.h / sub.rows;
  return {
    x: tile.x + col * cellW,
    y: tile.y + row * cellH,
    w: cellW,
    h: cellH,
  };
}

/** Maps a pointer position (canvas-relative px) to (hour, minute) or null if outside any tile. */
export function hitTest(
  layout: MosaicLayout,
  px: number,
  py: number,
): { hour: number; minute: number } | null {
  for (let h = 0; h < 24; h++) {
    const t = tileRect(layout, h);
    if (px < t.x || py < t.y || px >= t.x + t.w || py >= t.y + t.h) continue;
    const sub = layout.tileSubGrid;
    const localX = px - t.x;
    const localY = py - t.y;
    const col = Math.min(sub.cols - 1, Math.max(0, Math.floor((localX / t.w) * sub.cols)));
    const row = Math.min(sub.rows - 1, Math.max(0, Math.floor((localY / t.h) * sub.rows)));
    const minute = Math.min(59, row * sub.cols + col);
    return { hour: h, minute };
  }
  return null;
}
