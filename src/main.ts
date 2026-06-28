// Main window entry — wires the mosaic to live backend tracking.
// Falls back to mock data when IPC is unavailable (e.g. running the Vite preview without Tauri).

import { getCurrentWindow } from "@tauri-apps/api/window";

import { HourEditor } from "./editor/hour-editor";
import { MosaicRenderer } from "./mosaic/mosaic";
import { PulseLoop } from "./mosaic/pulse";
import { createDayStore, currentMinuteOfDay, todayKey } from "./state/day-store";
import { onCurrentActivity, onDayChanged, onTick } from "./state/events";
import { ipc } from "./state/ipc";
import { HamburgerMenu } from "./ui/menu";
import { PausedOverlay } from "./ui/paused-overlay";
import type { Category } from "./types";

const canvas = document.getElementById("mosaic") as HTMLCanvasElement | null;
const ticker = document.getElementById("ticker") as HTMLSpanElement | null;
const statusBar = document.getElementById("status-bar") as HTMLElement | null;
const copyStatusBtn = document.getElementById("copy-status") as HTMLButtonElement | null;
const hamburger = document.getElementById("hamburger") as HTMLButtonElement | null;
const winMinBtn = document.getElementById("win-min") as HTMLButtonElement | null;
const winMaxBtn = document.getElementById("win-max") as HTMLButtonElement | null;
const winCloseBtn = document.getElementById("win-close") as HTMLButtonElement | null;

if (!canvas) throw new Error("#mosaic canvas missing");

const renderer = new MosaicRenderer(canvas);
const store = createDayStore(4);
// The pulse loop runs ~30fps while visible; piggyback the minute-rollover check
// on it so the current-minute pointer and the optimistic fill stay frame-synced
// with the progress bar (no black gap when a minute completes).
const pulse = new PulseLoop((alpha) => {
  renderer.setPulseAlpha(alpha);
  tickMinute();
});

let dayStartHour = 4;
let lastTickerText = "◉ loading…";
/** Full text of the most recent error, kept for the copy button after the ticker reverts. */
let lastErrorText = "";
/** Latest live activity (from hm:current-activity) — colors the in-progress minute
 * and optimistically fills a minute the instant it rolls over, before its tick lands. */
let liveCategory: Category | null = null;
let liveSource: string | null = null;
let liveTitle: string | null = null;

/** Advance the current-minute pointer to wall-clock time; when it rolls, color the
 * just-completed minute with the live activity so it never flashes void. */
function tickMinute(): void {
  const m = currentMinuteOfDay(dayStartHour);
  const cur = store.get().currentMinute;
  if (m === cur) return;
  if (!paused && liveCategory !== null && cur === (m - 1 + 1440) % 1440) {
    store.applyTick(cur, liveCategory, liveSource, liveTitle);
  }
  store.setCurrentMinute(m);
}

store.subscribe((snap) => renderer.setSnapshot(snap));
renderer.resize();
pulse.start();

window.addEventListener("resize", () => {
  renderer.resize();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") pulse.start();
  else pulse.stop();
});

function setTicker(text: string): void {
  lastTickerText = text;
  if (ticker) ticker.textContent = text;
}

function setCopyVisible(visible: boolean): void {
  copyStatusBtn?.classList.toggle("status-copy--visible", visible);
}

function flashError(err: unknown, label: string): void {
  const msg = err instanceof Error ? err.message : String(err);
  lastErrorText = `${label}: ${msg}`;
  setTicker(`✕ ${label}: ${msg}`);
  setCopyVisible(true);
  if (statusBar) {
    statusBar.classList.add("status-bar--error");
    window.setTimeout(() => {
      statusBar.classList.remove("status-bar--error");
      if (ticker) ticker.textContent = lastTickerText;
      setCopyVisible(false);
    }, 4000);
  }
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // WebView fallback when the async clipboard API is unavailable.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } finally {
      ta.remove();
    }
  }
}

copyStatusBtn?.addEventListener("click", () => {
  const text = lastErrorText || ticker?.textContent || "";
  if (!text) return;
  void copyText(text).then(() => {
    copyStatusBtn.textContent = "✓";
    window.setTimeout(() => {
      copyStatusBtn.textContent = "⧉";
    }, 1200);
  });
});

// Window controls (decorations are off, so these are custom).
winMinBtn?.addEventListener("click", () => {
  getCurrentWindow().minimize().catch((err) => console.error("minimize failed", err));
});
winMaxBtn?.addEventListener("click", () => {
  getCurrentWindow().toggleMaximize().catch((err) => console.error("toggleMaximize failed", err));
});
winCloseBtn?.addEventListener("click", () => {
  ipc.quitApp().catch((err) => console.error("quit failed", err));
});

// Backup for when the pulse loop is paused (window hidden): still roll minutes.
window.setInterval(tickMinute, 1_000);

let paused = false;
let alwaysOnTop = true;
const pausedOverlay = new PausedOverlay();

if (hamburger) {
  new HamburgerMenu({
    hamburger,
    isPaused: () => paused,
    isAlwaysOnTop: () => alwaysOnTop,
    setAlwaysOnTop: (on) => {
      alwaysOnTop = on;
    },
    onAfterAction: () => {
      void refreshState();
    },
    onError: flashError,
  });
}

async function refreshState(): Promise<void> {
  try {
    const state = await ipc.getCurrentState();
    paused = state.paused;
    pausedOverlay.setVisible(paused);
    alwaysOnTop = state.always_on_top;
  } catch (err) {
    console.warn("getCurrentState failed", err);
  }
}

const editor = new HourEditor({
  canvas,
  renderer,
  dayStartHour: () => dayStartHour,
  dateKey: () => store.get().day.date_key || todayKey(dayStartHour),
  maxEditableHour: () => Math.floor(store.get().currentMinute / 60),
  getMinutes: () => store.get().day.minutes,
  setSegment: (key, start, end, category, presetId) =>
    ipc.setSegment(key, start, end, category, presetId),
  clearSegment: (key, start, end) => ipc.clearSegment(key, start, end),
  reclassifySource: async (sourceKey, category) => {
    await ipc.reclassifySource(sourceKey, category);
  },
  refreshDay: async () => {
    try {
      const day = await ipc.getDay();
      store.setDay(day);
    } catch (err) {
      console.warn("refreshDay failed", err);
    }
  },
  onError: flashError,
});
void editor; // keep alive

void boot();

const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

/**
 * The main window's webview loads and runs `boot()` concurrently with the Rust
 * `setup()` hook, which only registers managed state via `app.manage()` after
 * opening the DB and starting the tracker. On a cold/slow disk that work can
 * finish *after* the first `get_day`, which then fails with "state not managed".
 * Retry briefly before giving up to mock so a lost startup race self-heals
 * instead of stranding the UI on stale mock data.
 */
async function fetchDayWithRetry(): Promise<Awaited<ReturnType<typeof ipc.getDay>> | null> {
  const attempts = 8;
  for (let i = 0; i < attempts; i++) {
    try {
      return await ipc.getDay();
    } catch (err) {
      if (i === attempts - 1) {
        console.warn("backend get_day failed after retries, falling back to mock", err);
        lastErrorText = `backend offline: ${err instanceof Error ? err.message : String(err)}`;
        setTicker(`✕ backend offline: ${err}`);
        setCopyVisible(true); // persistent error — keep the copy button up
        return null;
      }
      await sleep(200);
    }
  }
  return null;
}

async function boot(): Promise<void> {
  // Registered first so an early backfill's hm:day-changed isn't missed.
  await onDayChanged(async () => {
    try {
      store.setDay(await ipc.getDay());
    } catch (err) {
      console.warn("day refresh after change failed", err);
    }
  });

  const day = await fetchDayWithRetry();
  if (!day) {
    store.loadMock();
    return;
  }
  dayStartHour = day.day_start_hour;
  store.setDay(day);
  store.setCurrentMinute(currentMinuteOfDay(dayStartHour));

  await refreshState();
  try {
    const state = await ipc.getCurrentState();
    store.setCurrentMinute(state.current_minute);
  } catch (err) {
    console.warn("get_current_state failed", err);
  }

  await onTick(({ minute_of_day, category, source_key, source_title }) => {
    store.applyTick(minute_of_day, category, source_key, source_title);
    store.setCurrentMinute(currentMinuteOfDay(dayStartHour));
  });

  await onCurrentActivity((evt) => {
    if (evt.paused !== paused) {
      paused = evt.paused;
      pausedOverlay.setVisible(paused);
    }
    // Remember the live activity so the in-progress minute's fill is its color
    // and a rolled-over minute can be colored instantly (see tickMinute).
    liveCategory = evt.category;
    liveSource = evt.source_key;
    liveTitle = evt.title;
    renderer.setCurrentActivityCategory(evt.category);
    if (paused) {
      setTicker("◉ PAUSED");
      return;
    }
    const proc = evt.process ?? "—";
    const head = evt.title ? evt.title.split(" — ")[0]!.slice(0, 64) : "";
    const idleSec = Math.floor(evt.idle_ms / 1000);
    const idleStr = idleSec >= 60 ? `${Math.floor(idleSec / 60)}m` : `${idleSec}s`;
    if (evt.idle_break) {
      setTicker(`💤 Away (idle ${idleStr}) · was ${proc}`);
    } else {
      const idleTag = idleSec >= 10 ? ` · idle ${idleStr}` : "";
      setTicker(`◉ ${proc} · ${head} · ${evt.category}${idleTag}`);
    }
  });
}
