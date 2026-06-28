// Window-grouping granularity picker — controls how foreground windows collapse
// into a single tracked entity (source_key).

import { ipc, type WindowGrouping } from "../state/ipc";

interface GroupingOption {
  value: WindowGrouping;
  label: string;
  hint: string;
}

const OPTIONS: ReadonlyArray<GroupingOption> = [
  {
    value: "app",
    label: "By application",
    hint: "Every window or tab of the same app is one entity — all Telegram chats, all browser tabs collapse together.",
  },
  {
    value: "site",
    label: "By site",
    hint: "Browsers split per domain; every other app groups by itself. The default.",
  },
  {
    value: "window",
    label: "By window",
    hint: "Each distinct window is its own entity. Unread counts and the app's own name are stripped so near-identical titles still merge.",
  },
];

export async function mountGrouping(container: HTMLElement): Promise<void> {
  container.innerHTML = "";

  const settings = await ipc.getSettings().catch(() => null);
  let current: WindowGrouping = settings?.window_grouping ?? "site";

  const heading = document.createElement("h2");
  heading.className = "settings__pane-title";
  heading.textContent = "Window grouping";

  const note = document.createElement("p");
  note.className = "muted";
  note.textContent =
    "How separate windows merge into one tracked entity for classification and display. Applies to new minutes immediately.";

  const list = document.createElement("div");
  list.className = "settings__radio-group";

  const radios: HTMLInputElement[] = [];
  for (const opt of OPTIONS) {
    const row = document.createElement("label");
    row.className = "settings__radio";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "window-grouping";
    input.value = opt.value;
    input.checked = opt.value === current;
    radios.push(input);

    const text = document.createElement("span");
    text.className = "settings__radio-text";
    const title = document.createElement("span");
    title.className = "settings__radio-label";
    title.textContent = opt.label;
    const hint = document.createElement("span");
    hint.className = "settings__radio-hint";
    hint.textContent = opt.hint;
    text.append(title, hint);

    row.append(input, text);
    list.appendChild(row);

    input.addEventListener("change", async () => {
      if (!input.checked) return;
      const next = opt.value;
      const prev = current;
      current = next;
      try {
        await ipc.setSettings({ windowGrouping: next });
      } catch (err) {
        console.error("set_settings(window_grouping) failed", err);
        // Revert the UI selection on failure.
        current = prev;
        for (const r of radios) r.checked = r.value === prev;
      }
    });
  }

  container.append(heading, note, list);
}
