// M8: applies a palette JSON to :root CSS variables. Stub usable from M1.

export interface Palette {
  name: string;
  tokens: Record<string, string>;
}

export function applyPalette(palette: Palette): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(palette.tokens)) {
    root.style.setProperty(key, value);
  }
}
