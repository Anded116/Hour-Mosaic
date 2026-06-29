// Settings window entry — tabbed UI: classification, grouping, day-start, hotkeys, privacy.

import { invoke } from "@tauri-apps/api/core";

import { ClassificationTable } from "./settings-ui/classification";
import { mountDayStart } from "./settings-ui/day-start";
import { mountGrouping } from "./settings-ui/grouping";
import { mountPrivacy } from "./settings-ui/privacy";

async function checkPermissions() {
  try {
    const [screen, acc] = await invoke<[boolean, boolean]>("check_mac_permissions");
    const banner = document.getElementById("permissions-banner");
    const btnContainer = document.getElementById("permissions-buttons");
    if (banner && btnContainer) {
      if (!screen || !acc) {
        banner.style.display = "flex";
        btnContainer.innerHTML = "";
        
        if (!screen) {
          const btnScreen = document.createElement("button");
          btnScreen.className = "btn btn--small";
          btnScreen.textContent = "Screen Recording";
          btnScreen.addEventListener("click", () => invoke("open_mac_screen_recording_settings").catch(console.error));
          btnContainer.appendChild(btnScreen);
        }
        
        if (!acc) {
          const btnAcc = document.createElement("button");
          btnAcc.className = "btn btn--small";
          btnAcc.textContent = "Accessibility";
          btnAcc.addEventListener("click", () => invoke("open_mac_accessibility_settings").catch(console.error));
          btnContainer.appendChild(btnAcc);
        }
        
        const missing = [];
        if (!screen) missing.push("Screen Recording");
        if (!acc) missing.push("Accessibility");
        banner.querySelector("span")!.textContent = `⚠️ macOS Permissions Missing: ${missing.join(", ")}`;
      } else {
        banner.style.display = "none";
      }
    }
  } catch (err) {
    console.error("Failed to check permissions", err);
  }
}
void checkPermissions();

type PaneId = "classification" | "grouping" | "day-start" | "hotkeys" | "privacy";

const nav = document.getElementById("settings-nav");
const panes: Record<PaneId, HTMLElement | null> = {
  classification: document.getElementById("pane-classification"),
  grouping: document.getElementById("pane-grouping"),
  "day-start": document.getElementById("pane-day-start"),
  hotkeys: document.getElementById("pane-hotkeys"),
  privacy: document.getElementById("pane-privacy"),
};

if (!nav) throw new Error("settings shell missing");

const classification = panes.classification ? new ClassificationTable(panes.classification) : null;
void classification?.load();
if (panes.grouping) void mountGrouping(panes.grouping);
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
