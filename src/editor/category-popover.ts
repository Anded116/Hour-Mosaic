// DOM popover anchored at a pointer position with category-select buttons.

import type { Category } from "../types";

interface PopoverChoice {
  label: string;
  category: Category;
  hint?: string;
}

const CHOICES: ReadonlyArray<PopoverChoice> = [
  { label: "Productive", category: "productive" },
  { label: "Unproductive", category: "unproductive" },
  { label: "Break", category: "neutral", hint: "neutral" },
  { label: "Clear lock", category: "void", hint: "remove manual edit" },
];

export interface PopoverResult {
  /** "void" is overloaded as a sentinel for "clear lock"; caller distinguishes. */
  category: Category;
}

export function showCategoryPopover(
  clientX: number,
  clientY: number,
): Promise<PopoverResult | null> {
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.className = "hm-popover";
    root.setAttribute("role", "menu");

    let resolved = false;
    const close = (result: PopoverResult | null): void => {
      if (resolved) return;
      resolved = true;
      window.removeEventListener("pointerdown", outsideHandler, true);
      window.removeEventListener("keydown", keyHandler);
      root.remove();
      resolve(result);
    };

    const outsideHandler = (e: PointerEvent): void => {
      if (!(e.target instanceof Node)) return;
      if (root.contains(e.target)) return;
      close(null);
    };
    const keyHandler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close(null);
    };

    for (const choice of CHOICES) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hm-popover__choice";
      button.dataset["category"] = choice.category;
      button.textContent = choice.label;
      if (choice.hint) {
        const hint = document.createElement("span");
        hint.className = "hm-popover__hint";
        hint.textContent = choice.hint;
        button.appendChild(hint);
      }
      button.addEventListener("click", () => close({ category: choice.category }));
      root.appendChild(button);
    }

    document.body.appendChild(root);

    // Position after mount so we can measure intrinsic size.
    const margin = 6;
    const { offsetWidth: w, offsetHeight: h } = root;
    const docW = document.documentElement.clientWidth;
    const docH = document.documentElement.clientHeight;
    const left = Math.max(margin, Math.min(docW - w - margin, clientX + 4));
    const top = Math.max(margin, Math.min(docH - h - margin, clientY + 4));
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;

    window.addEventListener("pointerdown", outsideHandler, true);
    window.addEventListener("keydown", keyHandler);
  });
}
