// Main window entry — wires the mosaic to live backend tracking.
// Falls back to mock data when IPC is unavailable (e.g. running the Vite preview without Tauri).

import { HourEditor } from "./editor/hour-editor";
import { MosaicRenderer } from "./mosaic/mosaic";
import { PulseLoop } from "./mosaic/pulse";
import { detailLevel, showsTicker } from "./mosaic/progressive";
import { createDayStore, currentMinuteOfDay, todayKey } from "./state/day-store";
import { onCurrentActivity, onTick } from "./state/events";
import { ipc } from "./state/ipc";
import { HamburgerMenu } from "./ui/menu";
import { PausedOverlay } from "./ui/paused-overlay";

const canvas = document.getElementById("mosaic") as HTMLCanvasElement | null;
const ticker = document.getElementById("ticker") as HTMLDivElement | null;
const hamburger = document.getElementById("hamburger") as HTMLButtonElement | null;

if (!canvas) throw new Error("#mosaic canvas missing");

const renderer = new MosaicRenderer(canvas);
const store = createDayStore(4);
const pulse = new PulseLoop((alpha) => renderer.setPulseAlpha(alpha));

let dayStartHour = 4;

store.subscribe((snap) => renderer.setSnapshot(snap));
renderer.resize();
pulse.start();

window.addEventListener("resize", () => {
  renderer.resize();
  updateTickerVisibility();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") pulse.start();
  else pulse.stop();
});

function updateTickerVisibility(): void {
  if (!ticker) return;
  const level = detailLevel(document.documentElement.clientWidth, document.documentElement.clientHeight);
  ticker.style.display = showsTicker(level) ? "" : "none";
}
updateTickerVisibility();

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
  });
}

async function refreshState(): Promise<void> {
  try {
    const state = await ipc.getCurrentState();
    paused = state.paused;
    pausedOverlay.setVisible(paused);
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
  setSegment: (key, start, end, category, presetId) =>
    ipc.setSegment(key, start, end, category, presetId),
  clearSegment: (key, start, end) => ipc.clearSegment(key, start, end),
  refreshDay: async () => {
    try {
      const day = await ipc.getDay();
      store.setDay(day);
    } catch (err) {
      console.warn("refreshDay failed", err);
    }
  },
});
void editor; // keep alive

void boot();

async function boot(): Promise<void> {
  try {
    const day = await ipc.getDay();
    dayStartHour = day.day_start_hour;
    store.setDay(day);
    store.setCurrentMinute(currentMinuteOfDay(dayStartHour));
  } catch (err) {
    console.warn("backend get_day failed, falling back to mock", err);
    store.loadMock();
    if (ticker) ticker.textContent = "◉ backend offline · mock day";
    return;
  }

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
    if (!ticker) return;
    if (paused) {
      ticker.textContent = "◉ PAUSED";
      return;
    }
    const proc = evt.process ?? "—";
    const head = evt.title ? evt.title.split(" — ")[0]!.slice(0, 64) : "";
    const idleSec = Math.floor(evt.idle_ms / 1000);
    const idleTag = idleSec > 60 ? ` · idle ${Math.floor(idleSec / 60)}m` : "";
    ticker.textContent = `◉ ${proc} · ${head} · ${evt.category}${idleTag}`;
  });
}
