# Hour Mosaic

Ambient time tracker. Your day rendered as a mosaic of 24 hourly tiles on a dark
background — emerald when you're productive, crimson when you're not. Built on
Tauri (Rust + system webview) with a tiny vanilla-TS frontend.

## Features

- **Ambient mosaic** of 24 hour tiles, each minute colored by activity category
  (productive / unproductive / neutral / unclassified / void).
- **Adaptive layout** from 150 × 150 px to fullscreen — grid reshapes between
  6×4, 12×2, 24×1 and the inverse, depending on the window's aspect ratio.
- **Live current-hour pulse** with a thin minute progress marker; past hours
  stay uniformly muted (no "older = darker" gradient).
- **Foreground-window tracker** with built-in classification of common apps
  and domains; AFK > 5 min → neutral, with per-app overrides for video calls
  (stays active) and media players (counts as unproductive).
- **Drag-n-drop edits** on past minutes; manual segments are locked so the
  auto-tracker never overwrites them.
- **Global hotkey** `Ctrl+Shift+B` instantly marks the current minute as a
  break.
- **History window** with a 30-day GitHub-style heatmap, drill-down into any
  past day, and aggregated metrics (avg productive/day, best/worst day,
  deep-work streak).
- **Settings window** with retroactive reclassification, day-start hour,
  hotkey reference, and a privacy panel for JSON export + wipe.

## Project layout

```
src/                  # frontend (vanilla TS + Canvas)
  mosaic/             # layout solver, Canvas renderer, pulse, progressive disclosure
  editor/             # drag-n-drop hour editor + category popover
  history/            # 30-day heatmap, drill-down, metrics
  settings-ui/        # classification, day-start, privacy
  state/              # IPC wrappers, event listeners, day store
  theme/              # CSS variable tokens + default palette
  ui/                 # hamburger menu, paused overlay
src-tauri/            # Tauri 2 + Rust backend
  src/
    tracker.rs        # tokio loop polling foreground window + idle
    classifier.rs     # rule engine over builtin DB + user rules
    aggregator.rs     # sample -> minute (dominant category)
    db.rs             # rusqlite repository
    seed.json         # builtin process / domain classification DB
    events.rs         # hm:tick, hm:current-activity emitters
    commands.rs       # IPC surface
index.html            # main window
history.html          # history window
settings.html         # settings window
```

## Develop

```powershell
pnpm install
pnpm tauri dev
```

The first build takes a few minutes while Cargo compiles Tauri and dependent
crates. Subsequent runs reuse the cached target directory.

Type-check the frontend on demand:

```powershell
pnpm exec tsc --noEmit
```

Rust check without bundling:

```powershell
cd src-tauri
cargo check
```

## Build a production binary

```powershell
pnpm tauri build
```

Produces an NSIS installer under `src-tauri/target/release/bundle/nsis/`. On
first run the app stores its SQLite database at
`%APPDATA%\com.clawbuster.hour-mosaic\hour-mosaic.db`.

## Platforms

Windows-first. Cross-platform crates (`active-win-pos-rs`, `device_query`) work
on macOS/Linux, but the build is currently only verified on Windows.

## Tracking philosophy

- The current hour is bright and pulses; everything else is muted but keeps
  per-minute detail. You can't change the past, but you can shape the next
  minute.
- No notifications, no "productivity score" badges, no streak celebrations.
  The colors are the data.
- All data stays on your machine. There is no telemetry and no cloud sync.
