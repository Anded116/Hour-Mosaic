// Hamburger menu — opens as a popover anchored to the hamburger button.

import { invoke } from "@tauri-apps/api/core";

import { ipc } from "../state/ipc";

export interface MenuDeps {
  hamburger: HTMLButtonElement;
  isPaused: () => boolean;
  isAlwaysOnTop: () => boolean;
  setAlwaysOnTop: (on: boolean) => void;
  onAfterAction: () => void;
  onError?: (err: unknown, label: string) => void;
}

interface MenuItem {
  label: string;
  shortcut?: string;
  action: () => Promise<void> | void;
}

export class HamburgerMenu {
  private open = false;
  private el: HTMLDivElement | null = null;

  constructor(private readonly deps: MenuDeps) {
    deps.hamburger.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.open) this.close();
      else this.openMenu();
    });
  }

  private openMenu(): void {
    this.open = true;
    const el = document.createElement("div");
    el.className = "hm-menu";
    el.setAttribute("role", "menu");

    const items = this.buildItems();
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hm-menu__item";
      const label = document.createElement("span");
      label.textContent = item.label;
      button.appendChild(label);
      if (item.shortcut) {
        const kbd = document.createElement("span");
        kbd.className = "hm-menu__kbd";
        kbd.textContent = item.shortcut;
        button.appendChild(kbd);
      }
      button.addEventListener("click", async () => {
        this.close();
        try {
          await item.action();
        } catch (err) {
          console.error(`[menu] ${item.label} failed:`, err);
          this.deps.onError?.(err, item.label);
        } finally {
          this.deps.onAfterAction();
        }
      });
      el.appendChild(button);
    }

    document.body.appendChild(el);
    this.el = el;

    const rect = this.deps.hamburger.getBoundingClientRect();
    const margin = 6;
    const desiredLeft = rect.right - el.offsetWidth;
    const docW = document.documentElement.clientWidth;
    el.style.left = `${Math.max(margin, Math.min(docW - el.offsetWidth - margin, desiredLeft))}px`;
    el.style.top = `${rect.bottom + 4}px`;

    setTimeout(() => {
      window.addEventListener("pointerdown", this.outsideHandler, true);
      window.addEventListener("keydown", this.keyHandler);
    }, 0);
  }

  private buildItems(): MenuItem[] {
    const paused = this.deps.isPaused();
    const aot = this.deps.isAlwaysOnTop();
    return [
      {
        label: paused ? "Resume tracking" : "Pause tracking",
        action: async () => {
          if (paused) await ipc.resumeTracking();
          else await ipc.pauseTracking();
        },
      },
      {
        label: "Mark break now",
        shortcut: "Ctrl+Shift+B",
        action: async () => {
          await invoke("mark_break_now");
        },
      },
      {
        label: aot ? "Disable always on top" : "Enable always on top",
        action: async () => {
          await invoke("set_always_on_top", { on: !aot });
          this.deps.setAlwaysOnTop(!aot);
        },
      },
      {
        label: "History",
        action: async () => {
          await invoke("open_history");
        },
      },
      {
        label: "Settings",
        action: async () => {
          await invoke("open_settings");
        },
      },
    ];
  }

  private close = (): void => {
    if (!this.open) return;
    this.open = false;
    this.el?.remove();
    this.el = null;
    window.removeEventListener("pointerdown", this.outsideHandler, true);
    window.removeEventListener("keydown", this.keyHandler);
  };

  private outsideHandler = (e: PointerEvent): void => {
    if (!(e.target instanceof Node)) return this.close();
    if (this.el?.contains(e.target)) return;
    if (this.deps.hamburger === e.target) return;
    this.close();
  };

  private keyHandler = (e: KeyboardEvent): void => {
    if (e.key === "Escape") this.close();
  };
}
