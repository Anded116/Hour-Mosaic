// Diagonal-hatch overlay shown when tracking is paused.

export class PausedOverlay {
  private el: HTMLDivElement | null = null;

  show(): void {
    if (this.el) return;
    const el = document.createElement("div");
    el.className = "hm-paused-overlay";
    el.innerHTML = '<span class="hm-paused-overlay__badge">PAUSED</span>';
    document.body.appendChild(el);
    this.el = el;
  }

  hide(): void {
    this.el?.remove();
    this.el = null;
  }

  setVisible(paused: boolean): void {
    if (paused) this.show();
    else this.hide();
  }
}
