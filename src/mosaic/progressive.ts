// Progressive detail disclosure based on canvas size.

export type DetailLevel = "postage" | "tiny" | "normal" | "spacious";

export function detailLevel(width: number, height: number): DetailLevel {
  const min = Math.min(width, height);
  if (min < 150) return "postage";
  if (min < 300) return "tiny";
  if (min < 600) return "normal";
  return "spacious";
}

export function showsAllHourLabels(level: DetailLevel): boolean {
  return level === "normal" || level === "spacious";
}

export function showsCurrentHourLabel(level: DetailLevel): boolean {
  return level !== "postage";
}

export function showsMinuteDividers(level: DetailLevel): boolean {
  return level === "spacious";
}

export function showsTicker(level: DetailLevel): boolean {
  return level !== "postage";
}
