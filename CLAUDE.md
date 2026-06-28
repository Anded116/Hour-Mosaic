# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Hour Mosaic is an **ambient time tracker** built on Tauri 2. Not a "productivity app you open" — an always-on dashboard for a second monitor. The user glances at it 1-2 times an hour. Most of the user experience lives in the colored shape of the day, not in UI chrome.

This framing rules out a lot of code that would normally be reasonable: streak notifications, "productivity score" badges, modal nudges, onboarding flows, gradient-by-age dimming, glassmorphism, parallax. If a change adds any of those, push back. The original design brief is authoritative on aesthetic philosophy — see "Design invariants" below.

See [README.md](README.md) for the user-facing feature list and project layout.

## Commands

```powershell
pnpm tauri dev         # iterate — vite HMR for src/, cargo incremental rebuild for src-tauri/
pnpm tauri build       # NSIS installer + standalone exe in src-tauri/target/release/
pnpm exec tsc --noEmit # frontend type-check without bundling
cargo check            # Rust check (run from src-tauri/)
```

There are no tests yet. `pnpm tauri dev` opens a single live Tauri window — that **is** the test environment. Resize it across aspect ratios (24×1 horizontal bar, 1×24 vertical bar, 150 px postage-stamp, 800×600 spacious) to exercise the layout solver. The vite URL at `http://localhost:1420` is for the internal dev server only — opening it in a browser will look broken because `__TAURI_INTERNALS__` is not injected outside the Tauri webview.

## Architecture

**Day cutover at 04:00.** This is the central time abstraction. `date_key = (local_now - 4h).date()`, `minute_of_day = shifted_now.hour*60 + minute`, range 0..1439. Hours past midnight belong to the previous "user day", so a 02:00 work session lands on yesterday's mosaic. The `day_start_hour` is configurable in [src-tauri/src/config.rs](src-tauri/src/config.rs) and applied symmetrically in [src-tauri/src/tracker.rs](src-tauri/src/tracker.rs) and [src-tauri/src/commands.rs](src-tauri/src/commands.rs#L182-L187) — change both if you touch this.

**Backend pipeline** ([src-tauri/src/tracker.rs](src-tauri/src/tracker.rs) → [classifier.rs](src-tauri/src/classifier.rs) → [aggregator.rs](src-tauri/src/aggregator.rs) → [db.rs](src-tauri/src/db.rs)). A tokio loop polls the active foreground window every 5 s via `active-win-pos-rs` and reads idle time via Windows' `GetLastInputInfo`. Each sample runs through the classifier — user rules first, then [seed.json](src-tauri/src/seed.json) process rules, then domain rules for browsers (title-substring heuristic since there's no cross-platform way to read the active tab URL), else `unclassified`. The aggregator folds samples into one cell per minute by dominant category. When the wall-clock minute rolls, the finalized cell is written to SQLite and the frontend gets a `hm:tick` event.

**Entity identity vs category.** The rules decide a sample's *category* and AFK behavior; the `source_key` (the grouping "entity") is a separate axis. `WindowGrouping` ([config.rs](src-tauri/src/config.rs)) remaps `source_key` to one of three grains — `App` (process only), `Site` (browsers per-domain, the historical default), `Window` (`process::normalize_title`, with leading unread counts / the app's own name stripped so near-identical titles merge). It's a live `Arc<AtomicU8>` on the `TrackerHandle`: `set_settings` stores it, the tracker loop reads it per tick, so a change takes effect without restart. Category logic never depends on grouping. The frontend labels entities from `source_key` (`entityLabel` in [hour-editor.ts](src/editor/hour-editor.ts)), not the raw per-minute title.

**User classification overrides.** The Classification settings pane assigns a category to an observed `source_key`. `reclassify_source` recolors past minutes, persists a `rules` row (`source='user'`), and updates a live `Arc<Mutex<HashMap<source_key, Category>>>` on the `TrackerHandle`. The tracker loads these on start (`db.load_overrides`) and applies them after the seed classifier on every tick, so an override wins over seed rules for future minutes without a restart. Seed defaults live in [seed.json](src-tauri/src/seed.json) (process rules match by exact/suffix on the exe; domain rules are title-substring, browsers only — `BROWSER_PROCESSES` in classifier.rs gates which processes count as browsers). `seed.json` also has `source_rules`: exact source_key → category defaults (e.g. `zen.exe`/`firefox.exe` catch-all browsing → unproductive), seeded into the same override map below user rules — these only hit a browser's non-domain entity, so domain-matched sub-entities (`zen.exe::figma.com`) keep their own category.

**Startup backfill.** Seed/override changes don't retroactively recolor stored minutes, so on start the tracker spawns `backfill_unclassified` ([tracker.rs](src-tauri/src/tracker.rs)): it re-runs the classifier (+overrides) over every still-`unclassified`, unlocked minute (reconstructing the process from `source_key`'s pre-`::` part and the stored title) and recolors those that now match. Idempotent — only touches `unclassified`, `locked=0` rows. This is why a newly-seeded app stops showing as "waiting for classification" after a restart instead of only from new minutes onward.

**AFK is its own category and entity.** When idle exceeds the threshold and the foreground app's AFK behavior is `Default`, the tracker stores those minutes as the dedicated `Category::Idle` (own color `--c-idle`, distinct from `neutral`) under `source_key = "idle"`, not the foreground app — so a 7-min Claude run that goes idle at minute 5 splits into a 5-min Claude entity + a 2-min "Away" idle entity (separate hover frames, distinct color). `Idle` is separate from `Neutral` on purpose: `neutral` is deliberate downtime (messaging apps, a manual "break"); `idle` is away-from-keyboard. `StaysActive` apps (calls) and `BecomesUnproductive` apps (media) keep their own source/category. `entityLabel("idle")` → "Away", `categoryLabel("idle")` → "Idle". `idle` is excluded from the manual classification dropdown (it's tracker-derived, not a user label).

**Out-of-band refresh.** Reclassify and backfill change stored minutes behind the main window's back, so they `emit_day_changed` (`hm:day-changed`); the main window re-fetches `get_day` on it. The listener is registered first thing in `boot()` so an early-firing backfill isn't missed. Grouping changes only affect future minutes, so they don't emit.

**Lock semantics.** Manual edits via the hour editor write minutes with `locked=1`. The auto-tracker's `upsert_minute` includes `WHERE locked = 0` so it never overwrites a manually-set minute. The "Clear edit" popover button releases the lock by setting `locked=0`, letting the tracker reclaim those minutes. This is **the** semantic invariant — every write path to `minutes` must respect it.

**AFK behavior** (idle past a configurable threshold — `afk_threshold_ms`, default 5 min, live `Arc<AtomicU32>` on the `TrackerHandle`, editable in Settings → Timing; [tracker.rs:apply_afk](src-tauri/src/tracker.rs)). Default → `idle` (its own category, see "AFK is its own category") (the user picked this; do not change to `void`). Process-level overrides in seed.json: `stays_active` for video-call apps (Meet/Zoom/Discord — keep current category), `becomes_unproductive` for passive consumption (mpv/VLC — count idle as distraction).

**Frontend pipeline** ([src/main.ts](src/main.ts) wires it). [day-store.ts](src/state/day-store.ts) is the single source of truth for the rendered day — `setDay()` from `get_day` on boot, then incremental `applyTick()` calls from `hm:tick` events. The [MosaicRenderer](src/mosaic/mosaic.ts) subscribes to the store, calls [solveLayout](src/mosaic/layout.ts) on every resize, and paints to a single canvas. The pulse loop ([pulse.ts](src/mosaic/pulse.ts)) only animates alpha on the current hour — past hours are drawn once per data change.

**Layout solver** ([src/mosaic/layout.ts](src/mosaic/layout.ts)). Picks one of `[24×1, 12×2, 8×3, 6×4, 4×6, 3×8, 2×12, 1×24]` by minimizing `|log(cols/rows) - log(canvas_aspect)|`. Inside a tile, 60 minutes lay out as 60×1 / 10×6 / 6×10 / 1×60 depending on tile shape. `hitTest()` is the inverse — every editor click goes through it.

**Three windows are pre-declared in [tauri.conf.json](src-tauri/tauri.conf.json) as `visible:false`** (history and settings); commands [open_history](src-tauri/src/commands.rs#L186-L189) / [open_settings](src-tauri/src/commands.rs#L191-L194) just `show()` + `set_focus()`. Do not switch back to `WebviewWindowBuilder::new(...)` for these — in dev mode the dynamically-created builder routes through the asset protocol against a stale `dist/` instead of the live vite server, and you get a black unresponsive webview.

**Editor interaction model** ([src/editor/](src/editor/)). Two distinct gestures on the mosaic: *hover* inspects, *drag* edits. Hovering a minute frames the whole contiguous activity run (grouped by `source_key`, or by category for source-less manual edits) via an edge-cancellation outline in [mosaic.ts](src/mosaic/mosaic.ts) `drawActivityFrame`, and shows a tooltip of app/span/length/category — the per-minute `source_title` already rides along in `MinuteCell`, this only surfaces it. A drag selects a range and on release opens the category popover. **Invariant: while the popover is open, `DragSelect.canStart` returns false** so a click on the mosaic dismisses the popover instead of immediately opening a new one. Hover is suppressed while dragging or while the popover is open.

**Renderer sizes itself against `canvas.parentElement`, not the document.** The window is `flex: column` with a 22 px status bar at the bottom (see [index.html](index.html) + [main.css](src/main.css)). The mosaic-host is `flex: 1` so it gets the remaining height. If you add chrome (toolbar, banner), keep canvas inside its own flex child or the renderer will paint under it.

## Design invariants

These are load-bearing rules from the original design brief — easy to accidentally violate. Push back if a change breaks any of them.

- **Past hours are uniformly muted.** Do not introduce a "the older, the darker" gradient. Morning hours are not less important than evening hours; the brief explicitly forbids this.
- **Only the current hour pulses, and softly** (opacity 0.85 ↔ 1.0, ~3.5 s period, sine eased). Not opacity 0.4 ↔ 1.0, not 1 s period. The current hour is the only animated thing on screen.
- **Per-minute coloring inside the tile.** A tile is not a single average color — the brief calls out that fragmented hours should "look fragmented" and deep-work hours should "look like a monolithic bar". Do not aggregate at tile level.
- **Untracked minutes use `void` (`#0a0a0c`) — slightly darker than the bg.** This creates the visual of "holes in the day". Don't render them as transparent or as the bg color.
- **Future hours are outline-only, not filled.** They have no data, so they have no fill.
- **`unclassified` is amber and visible.** It's an invitation to classify, not a hidden state.
- **AFK > threshold → `idle`, not `void`.** Idle ≠ off — it stays tracked. `idle` is its own category, distinct from `neutral` (deliberate downtime). Don't fold them back together or into `void`.
- **Read-only-ish main UI.** A single hamburger button is the only visible control on the main window. Everything else lives in popovers (hour editor) or separate windows (history, settings).

The brief is also explicit about what NOT to add: streaks, productivity scores, AI summaries, notifications, social features, monetization hints, onboarding/welcome screens, empty-state illustrations. If asked for any of these, surface the brief constraint before implementing.

## Gotchas

- **`tauri::async_runtime::spawn`, never `tokio::spawn`.** Tauri 2 doesn't guarantee a tokio runtime in the `setup()` closure or in plugin callbacks; raw `tokio::spawn` panics silently in release (where `windows_subsystem = "windows"` hides the panic and the app dies on startup). The tauri-bundled runtime is the only safe one.
- **`pnpm tauri build` runs `pnpm build` first.** Release loads frontend from the bundled `dist/`. In dev, vite serves source. Do not assume one matches the other — the dynamic-window asset-protocol bug was caused by a stale `dist/` lingering from an earlier build.
- **IPC arg naming.** Frontend sends `camelCase` (`startMinute`), Rust receives `snake_case` (`start_minute`). Tauri auto-maps. If you rename a field, change both sides.
- **Devtools.** Enabled in release via `tauri = { features = ["devtools"] }`. F12 inside a Tauri window opens the WebView2 inspector — same as Chromium. Console is only visible there, not in the terminal (`windows_subsystem = "windows"` detaches stdout). If you need stderr-style diagnostics in release, write to a file under `app_data_dir()`, not stdout.
- **Status-bar visibility tracks progressive disclosure.** At canvas <150 px on either side, the status bar hides — `updateStatusVisibility()` in [main.ts](src/main.ts) must call `renderer.resize()` afterwards because hiding the bar changes the canvas host's height.
- **Orphan vite processes on Windows.** If `pnpm tauri dev` is killed roughly, node/vite may hold port 1420. `Get-NetTCPConnection -LocalPort 1420 | Select-Object OwningProcess` finds the PID; `Stop-Process -Id <pid> -Force` releases it.

## Plan file

The full milestone plan for the build-out lives at `C:\Users\Anded\.claude\plans\hour-federated-otter.md` (outside the repo). It tracks the 9-milestone roadmap; current status is in the TodoWrite list each session. Refer to it for the original architectural decisions and decisions/trade-offs that were settled at planning time.
