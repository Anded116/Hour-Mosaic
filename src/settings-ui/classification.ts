// Classification table — every observed source_key with an inline category
// select, plus multi-select for assigning a category to several sources at once.

import { ipc, type DiscoveredApp } from "../state/ipc";
import { CATEGORIES, type Category } from "../types";

const BULK_CATEGORIES: ReadonlyArray<Category> = ["productive", "unproductive", "neutral"];

export class ClassificationTable {
  private readonly container: HTMLElement;
  private filter = "";
  private sources: DiscoveredApp[] = [];
  private currentBySource = new Map<string, Category>();
  private selected = new Set<string>();

  private tbody: HTMLTableSectionElement | null = null;
  private bulkBar: HTMLDivElement | null = null;
  private bulkCount: HTMLSpanElement | null = null;
  private selectAll: HTMLInputElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  async load(): Promise<void> {
    try {
      const [all, unclassified] = await Promise.all([
        ipc.listSources(200),
        ipc.listUnclassified(50),
      ]);
      this.sources = all;
      this.currentBySource.clear();
      for (const s of all) this.currentBySource.set(s.source_key, s.current_category);
      this.selected.clear();
      this.buildChrome(unclassified.length);
      this.renderRows();
    } catch (err) {
      console.error("classification load failed", err);
      this.container.innerHTML = '<p class="muted">Failed to load classification list.</p>';
    }
  }

  private filtered(): DiscoveredApp[] {
    return this.filter
      ? this.sources.filter((s) => s.source_key.toLowerCase().includes(this.filter))
      : this.sources;
  }

  /** Builds the static shell once; row updates go through renderRows(). */
  private buildChrome(unclassifiedCount: number): void {
    this.container.innerHTML = "";

    if (unclassifiedCount > 0) {
      const banner = document.createElement("div");
      banner.className = "settings__banner";
      banner.textContent = `${unclassifiedCount} app${unclassifiedCount === 1 ? "" : "s"} waiting for classification`;
      this.container.appendChild(banner);
    }

    const filterRow = document.createElement("div");
    filterRow.className = "settings__filter";
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "Filter by process / domain…";
    input.value = this.filter;
    input.addEventListener("input", () => {
      this.filter = input.value.toLowerCase();
      this.renderRows();
    });
    filterRow.appendChild(input);
    this.container.appendChild(filterRow);

    // Bulk action bar — visible only when at least one row is selected.
    const bar = document.createElement("div");
    bar.className = "settings__bulk";
    const count = document.createElement("span");
    count.className = "settings__bulk-count";
    const sel = document.createElement("select");
    for (const cat of BULK_CATEGORIES) {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      sel.appendChild(opt);
    }
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "settings__button";
    apply.textContent = "Apply to selected";
    apply.addEventListener("click", () => void this.applyBulk(sel.value as Category));
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "settings__button";
    clear.textContent = "Clear";
    clear.addEventListener("click", () => {
      this.selected.clear();
      this.renderRows();
    });
    bar.append(count, sel, apply, clear);
    this.container.appendChild(bar);
    this.bulkBar = bar;
    this.bulkCount = count;

    const table = document.createElement("table");
    table.className = "settings__table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");

    const thCheck = document.createElement("th");
    const selectAll = document.createElement("input");
    selectAll.type = "checkbox";
    selectAll.title = "Select all";
    selectAll.addEventListener("change", () => {
      const keys = this.filtered().map((s) => s.source_key);
      if (selectAll.checked) for (const k of keys) this.selected.add(k);
      else for (const k of keys) this.selected.delete(k);
      this.renderRows();
    });
    thCheck.appendChild(selectAll);
    this.selectAll = selectAll;

    for (const [th, label] of [
      [thCheck, ""],
      [document.createElement("th"), "Source"],
      [document.createElement("th"), "Minutes"],
      [document.createElement("th"), "Category"],
    ] as [HTMLTableCellElement, string][]) {
      if (label) th.textContent = label;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    table.appendChild(tbody);
    this.tbody = tbody;
    this.container.appendChild(table);

    this.updateBulkBar();
  }

  private renderRows(): void {
    const tbody = this.tbody;
    if (!tbody) return;
    tbody.innerHTML = "";

    const items = this.filtered();
    if (items.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML =
        '<td colspan="4" class="muted">No sources yet — the tracker will populate this as it observes activity.</td>';
      tbody.appendChild(tr);
    } else {
      for (const src of items) {
        const tr = document.createElement("tr");

        const tdCheck = document.createElement("td");
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = this.selected.has(src.source_key);
        check.addEventListener("change", () => {
          if (check.checked) this.selected.add(src.source_key);
          else this.selected.delete(src.source_key);
          this.updateBulkBar();
          this.updateSelectAll();
        });
        tdCheck.appendChild(check);

        const tdSrc = document.createElement("td");
        tdSrc.className = "mono";
        tdSrc.textContent = src.source_key;

        const tdMin = document.createElement("td");
        tdMin.className = "mono right";
        tdMin.textContent = `${src.minutes_seen}m`;

        const tdSel = document.createElement("td");
        const select = document.createElement("select");
        // `idle` is a tracker-derived AFK state, not a manual classification.
        for (const cat of CATEGORIES.filter((c) => c !== "idle")) {
          const opt = document.createElement("option");
          opt.value = cat;
          opt.textContent = cat;
          select.appendChild(opt);
        }
        select.value = this.currentBySource.get(src.source_key) ?? "unclassified";
        select.addEventListener("change", async () => {
          const cat = select.value as Category;
          try {
            await ipc.reclassifySource(src.source_key, cat);
            this.currentBySource.set(src.source_key, cat);
          } catch (err) {
            console.error("reclassify failed", err);
            select.value = this.currentBySource.get(src.source_key) ?? "unclassified";
          }
        });
        tdSel.appendChild(select);

        tr.append(tdCheck, tdSrc, tdMin, tdSel);
        tbody.appendChild(tr);
      }
    }

    this.updateBulkBar();
    this.updateSelectAll();
  }

  private updateBulkBar(): void {
    if (!this.bulkBar || !this.bulkCount) return;
    const n = this.selected.size;
    this.bulkBar.style.display = n > 0 ? "" : "none";
    this.bulkCount.textContent = `${n} selected`;
  }

  /** Reflects whether all / some / none of the filtered rows are selected. */
  private updateSelectAll(): void {
    if (!this.selectAll) return;
    const keys = this.filtered().map((s) => s.source_key);
    const selectedCount = keys.filter((k) => this.selected.has(k)).length;
    this.selectAll.checked = keys.length > 0 && selectedCount === keys.length;
    this.selectAll.indeterminate = selectedCount > 0 && selectedCount < keys.length;
  }

  private async applyBulk(category: Category): Promise<void> {
    const keys = [...this.selected];
    if (keys.length === 0) return;
    try {
      await Promise.all(keys.map((k) => ipc.reclassifySource(k, category)));
      for (const k of keys) this.currentBySource.set(k, category);
      this.selected.clear();
      this.renderRows();
    } catch (err) {
      console.error("bulk reclassify failed", err);
    }
  }
}
