// Main window entry — wires the mosaic to live backend tracking.
// Falls back to mock data when IPC is unavailable (e.g. running the Vite preview without Tauri).

import { HourEditor } from "./editor/hour-editor";
import { MosaicRenderer } from "./mosaic/mosaic";
import { PulseLoop } from "./mosaic/pulse";
import { detailLevel, showsTicker } from "./mosaic/progressive";
import { createDayStore, currentMinuteOfDay, todayKey } from "./state/day-store";
import { onCurrentActivity, onDayChanged, onTick } from "./state/events";
import { ipc } from "./state/ipc";
import { HamburgerMenu } from "./ui/menu";
import { PausedOverlay } from "./ui/paused-overlay";

const canvas = document.getElementById("mosaic") as HTMLCanvasElement | null;
const ticker = document.getElementById("ticker") as HTMLSpanElement | null;
const statusBar = document.getElementById("status-bar") as HTMLElement | null;
const copyStatusBtn = document.getElementById("copy-status") as HTMLButtonElement | null;
const hamburger = document.getElementById("hamburger") as HTMLButtonElement | null;

if (!canvas) throw new Error("#mosaic canvas missing");

const renderer = new MosaicRenderer(canvas);
const store = createDayStore(4);
const pulse = new PulseLoop((alpha) => renderer.setPulseAlpha(alpha));

let dayStartHour = 4;
let lastTickerText = "◉ loading…";
/** Full text of the most recent error, kept for the copy button after the ticker reverts. */
let lastErrorText = "";

store.subscribe((snap) => renderer.setSnapshot(snap));
renderer.resize();
pulse.start();

window.addEventListener("resize", () => {
  renderer.resize();
  updateStatusVisibility();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") pulse.start();
  else pulse.stop();
});

function updateStatusVisibility(): void {
  if (!statusBar) return;
  const level = detailLevel(document.documentElement.clientWidth, document.documentElement.clientHeight);
  statusBar.classList.toggle("status-bar--hidden", !showsTicker(level));
  // Trigger a renderer resize because hiding the status bar changes mosaic-host height.
  renderer.resize();
}
updateStatusVisibility();

function setTicker(text: string): void {
  lastTickerText = text;
  if (ticker) ticker.textContent = text;
}

function flashError(err: unknown, label: string): void {
  const msg = err instanceof Error ? err.message : String(err);
  lastErrorText = `${label}: ${msg}`;
  setTicker(`✕ ${label}: ${msg}`);
  if (statusBar) {
    statusBar.classList.add("status-bar--error");
    window.setTimeout(() => {
      statusBar.classList.remove("status-bar--error");
      if (ticker) ticker.textContent = lastTickerText;
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

window.setInterval(() => {
  store.setCurrentMinute(currentMinuteOfDay(dayStartHour));
}, 30_000);

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
    if (paused) {
      setTicker("◉ PAUSED");
      return;
    }
    const proc = evt.process ?? "—";
    const head = evt.title ? evt.title.split(" — ")[0]!.slice(0, 64) : "";
    const idleSec = Math.floor(evt.idle_ms / 1000);
    const thrSec = Math.round(evt.afk_threshold_ms / 1000);
    if (evt.idle_break) {
      // Idle crossed the threshold — this minute is a break, not the app.
      setTicker(`💤 Away (idle ${idleSec}s / thr ${thrSec}s) · was ${proc}`);
    } else {
      // idle/threshold shown inline for now to make AFK behavior observable.
      setTicker(`◉ ${proc} · ${head} · ${evt.category} · idle ${idleSec}s/${thrSec}s`);
    }
  });
}
