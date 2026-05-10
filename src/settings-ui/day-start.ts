import { ipc } from "../state/ipc";

export async function mountDayStart(container: HTMLElement): Promise<void> {
  container.innerHTML = "";

  const settings = await ipc.getSettings().catch(() => null);
  const current = settings?.day_start_hour ?? 4;

  const label = document.createElement("label");
  label.className = "settings__field";
  label.innerHTML = '<span class="settings__field-label">Day starts at</span>';

  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.max = "23";
  input.value = String(current);
  input.className = "settings__input mono";
  label.appendChild(input);

  const suffix = document.createElement("span");
  suffix.className = "settings__field-suffix mono";
  suffix.textContent = ":00";
  label.appendChild(suffix);

  const note = document.createElement("p");
  note.className = "muted";
  note.textContent =
    "Hours after midnight stay on the previous day until this hour rolls over. Defaults to 04:00.";

  let pending: number | null = null;
  let timer: number | null = null;
  input.addEventListener("input", () => {
    const v = clamp(Number(input.value), 0, 23);
    pending = v;
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      try {
        await ipc.setSettings({ day_start_hour: pending! });
      } catch (err) {
        console.error("set_settings failed", err);
      }
    }, 400);
  });

  container.append(label, note);
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
