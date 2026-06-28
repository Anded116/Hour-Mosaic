import { ipc } from "../state/ipc";

export async function mountDayStart(container: HTMLElement): Promise<void> {
  container.innerHTML = "";

  const settings = await ipc.getSettings().catch(() => null);
  const dayCurrent = settings?.day_start_hour ?? 4;
  const afkCurrentSec = Math.round((settings?.afk_threshold_ms ?? 300_000) / 1000);

  // Day start hour
  const dayLabel = document.createElement("label");
  dayLabel.className = "settings__field";
  dayLabel.innerHTML = '<span class="settings__field-label">Day starts at</span>';
  const dayInput = document.createElement("input");
  dayInput.type = "number";
  dayInput.min = "0";
  dayInput.max = "23";
  dayInput.value = String(dayCurrent);
  dayInput.className = "settings__input mono";
  dayLabel.appendChild(dayInput);
  const daySuffix = document.createElement("span");
  daySuffix.className = "settings__field-suffix mono";
  daySuffix.textContent = ":00";
  dayLabel.appendChild(daySuffix);

  // Idle → break threshold (seconds)
  const afkLabel = document.createElement("label");
  afkLabel.className = "settings__field";
  afkLabel.innerHTML = '<span class="settings__field-label">Idle counts as break after</span>';
  const afkInput = document.createElement("input");
  afkInput.type = "number";
  afkInput.min = "5";
  afkInput.step = "5";
  afkInput.value = String(afkCurrentSec);
  afkInput.className = "settings__input mono";
  afkLabel.appendChild(afkInput);
  const afkSuffix = document.createElement("span");
  afkSuffix.className = "settings__field-suffix mono";
  afkSuffix.textContent = "sec";
  afkLabel.appendChild(afkSuffix);

  const note = document.createElement("p");
  note.className = "muted";
  note.textContent =
    "Day-start: hours after midnight stay on the previous day until this hour. " +
    "Idle threshold: after this much input idle, the minute becomes a break (its own entity). Lower it to test quickly.";

  // Apply + saved confirmation
  const row = document.createElement("div");
  row.className = "settings__row";
  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "settings__button";
  apply.textContent = "Apply";
  const status = document.createElement("span");
  status.className = "muted";
  status.style.alignSelf = "center";
  row.append(apply, status);

  const renderSaved = (daySec: number, afkSec: number): void => {
    status.textContent = `Saved · day ${String(daySec).padStart(2, "0")}:00 · idle ${afkSec}s`;
  };
  renderSaved(dayCurrent, afkCurrentSec);

  apply.addEventListener("click", async () => {
    const dayVal = clamp(Number(dayInput.value), 0, 23);
    const afkSec = clamp(Number(afkInput.value), 5, 3600);
    dayInput.value = String(dayVal);
    afkInput.value = String(afkSec);
    apply.disabled = true;
    status.textContent = "Saving…";
    try {
      await ipc.setSettings({ dayStartHour: dayVal, afkThresholdMs: afkSec * 1000 });
      // Read back the persisted values so the confirmation reflects reality.
      const saved = await ipc.getSettings();
      renderSaved(saved.day_start_hour, Math.round(saved.afk_threshold_ms / 1000));
    } catch (err) {
      console.error("set_settings failed", err);
      status.textContent = `Failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      apply.disabled = false;
    }
  });

  container.append(dayLabel, afkLabel, note, row);
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
