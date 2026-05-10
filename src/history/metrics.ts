import type { DaySummary } from "../state/ipc";

export interface AggregatedMetrics {
  avgProductiveMin: number;
  bestDay: DaySummary | null;
  worstDay: DaySummary | null;
  deepWorkStreak: number; // consecutive days with productive >= 240 min ending today
}

const DEEP_WORK_MIN = 240; // 4 hours

export function aggregate(days: DaySummary[]): AggregatedMetrics {
  if (days.length === 0) {
    return { avgProductiveMin: 0, bestDay: null, worstDay: null, deepWorkStreak: 0 };
  }
  const sortedByDate = [...days].sort((a, b) => a.date_key.localeCompare(b.date_key));
  const totalProductive = sortedByDate.reduce((s, d) => s + d.productive_minutes, 0);
  const avgProductiveMin = Math.round(totalProductive / sortedByDate.length);

  const bestDay = sortedByDate.reduce(
    (best, d) => (d.productive_minutes > (best?.productive_minutes ?? -1) ? d : best),
    null as DaySummary | null,
  );
  const worstDay = sortedByDate.reduce(
    (worst, d) => (d.unproductive_minutes > (worst?.unproductive_minutes ?? -1) ? d : worst),
    null as DaySummary | null,
  );

  let streak = 0;
  for (let i = sortedByDate.length - 1; i >= 0; i--) {
    if (sortedByDate[i]!.productive_minutes >= DEEP_WORK_MIN) streak++;
    else break;
  }

  return { avgProductiveMin, bestDay, worstDay, deepWorkStreak: streak };
}
