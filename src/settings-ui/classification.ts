// Classification table — every observed source_key with an inline category select.

import { ipc, type DiscoveredApp } from "../state/ipc";
import { CATEGORIES, type Category } from "../types";

export class ClassificationTable {
  private container: HTMLElement;
  private filter = "";
  private sources: DiscoveredApp[] = [];
  private currentBySource = new Map<string, Category>();

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
      const unclassifiedKeys = new Set(unclassified.map((u) => u.source_key));
      for (const s of all) {
        this.currentBySource.set(s.source_key, unclassifiedKeys.has(s.source_key) ? "unclassified" : "unclassified");
      }
      this.render(unclassified.length);
    } catch (err) {
      console.error("classification load failed", err);
      this.container.innerHTML = '<p class="muted">Failed to load classification list.</p>';
    }
  }

  setFilter(text: string): void {
    this.filter = text.toLowerCase();
    this.render(undefined);
  }

  private render(unclassifiedCount: number | undefined): void {
    this.container.innerHTML = "";

    if (unclassifiedCount !== undefined && unclassifiedCount > 0) {
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
    input.addEventListener("input", () => this.setFilter(input.value));
    filterRow.appendChild(input);
    this.container.appendChild(filterRow);

    const table = document.createElement("table");
    table.className = "settings__table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Source</th>
          <th>Minutes</th>
          <th>Category</th>
        </tr>
      </thead>
    `;
    const tbody = document.createElement("tbody");
    table.appendChild(tbody);

    const items = this.filter
      ? this.sources.filter((s) => s.source_key.toLowerCase().includes(this.filter))
      : this.sources;

    if (items.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML = '<td colspan="3" class="muted">No sources yet — the tracker will populate this as it observes activity.</td>';
      tbody.appendChild(tr);
    } else {
      for (const src of items) {
        const tr = document.createElement("tr");
        const tdSrc = document.createElement("td");
        tdSrc.className = "mono";
        tdSrc.textContent = src.source_key;
        const tdMin = document.createElement("td");
        tdMin.className = "mono right";
        tdMin.textContent = `${src.minutes_seen}m`;
        const tdSel = document.createElement("td");
        const select = document.createElement("select");
        for (const cat of CATEGORIES) {
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
        tr.append(tdSrc, tdMin, tdSel);
        tbody.appendChild(tr);
      }
    }

    this.container.appendChild(table);
  }
}
