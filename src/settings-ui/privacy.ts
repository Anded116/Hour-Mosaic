import { ipc } from "../state/ipc";

export function mountPrivacy(container: HTMLElement): void {
  container.innerHTML = "";

  const note = document.createElement("p");
  note.className = "muted";
  note.textContent =
    "All data stays on this machine. Use these buttons to export a JSON dump or wipe everything.";
  container.appendChild(note);

  const row = document.createElement("div");
  row.className = "settings__row";

  const exportBtn = document.createElement("button");
  exportBtn.className = "settings__button";
  exportBtn.type = "button";
  exportBtn.textContent = "Export JSON";
  exportBtn.addEventListener("click", async () => {
    try {
      const day = await ipc.getDay();
      const blob = new Blob([JSON.stringify(day, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `hour-mosaic-${day.date_key}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("export failed", err);
    }
  });

  const wipeBtn = document.createElement("button");
  wipeBtn.className = "settings__button settings__button--danger";
  wipeBtn.type = "button";
  wipeBtn.textContent = "Wipe all data";
  wipeBtn.addEventListener("click", async () => {
    const ok = window.confirm("This deletes every minute, sample, and user rule. Proceed?");
    if (!ok) return;
    try {
      await ipc.wipeData();
      window.alert("Data wiped.");
    } catch (err) {
      console.error("wipe failed", err);
    }
  });

  row.append(exportBtn, wipeBtn);
  container.appendChild(row);
}
