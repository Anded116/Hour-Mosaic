// Settings window entry — tabbed UI: classification, day-start, hotkeys, privacy.

import { ClassificationTable } from "./settings-ui/classification";
import { mountDayStart } from "./settings-ui/day-start";
import { mountPrivacy } from "./settings-ui/privacy";

type PaneId = "classification" | "day-start" | "hotkeys" | "privacy";

const nav = document.getElementById("settings-nav");
const panes: Record<PaneId, HTMLElement | null> = {
  classification: document.getElementById("pane-classification"),
  "day-start": document.getElementById("pane-day-start"),
  hotkeys: document.getElementById("pane-hotkeys"),
  privacy: document.getElementById("pane-privacy"),
};

if (!nav) throw new Error("settings shell missing");

const classification = panes.classification ? new ClassificationTable(panes.classification) : null;
void classification?.load();
if (panes["day-start"]) void mountDayStart(panes["day-start"]);
if (panes.privacy) mountPrivacy(panes.privacy);

nav.addEventListener("click", (e) => {
  if (!(e.target instanceof HTMLButtonElement)) return;
  const pane = e.target.dataset["pane"] as PaneId | undefined;
  if (!pane) return;
  for (const btn of nav.querySelectorAll<HTMLButtonElement>("button")) {
    btn.classList.toggle("settings__nav-btn--active", btn === e.target);
  }
  for (const [key, el] of Object.entries(panes)) {
    if (!el) continue;
    el.classList.toggle("settings__pane--active", key === pane);
  }
});
