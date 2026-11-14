import type { ElapsedDistributionMetric } from '@interlock/core';

export type TimeBasis = 'wall' | 'activeMs' | 'pausedMs';

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}

/** Coarse waiting time, for example "3 h" or "2 d". */
export function formatWait(sinceIso: string, nowMs: number): string {
  const ms = Math.max(0, nowMs - Date.parse(sinceIso));
  if (ms < 60_000) return 'under 1 min';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h`;
  return `${Math.floor(ms / 86_400_000)} d`;
}

export function formatCost(
  micros: number | null | undefined,
  currency: string | undefined,
): string {
  if (currency === 'mixed') return 'Mixed currencies';
  if (micros === null || micros === undefined) return '—';
  return `${(micros / 1_000_000).toFixed(4)} ${currency ?? ''}`.trim();
}

export function basisMetric(
  value: ElapsedDistributionMetric | undefined,
  basis: TimeBasis,
) {
  return basis === 'wall' ? value : value?.[basis];
}

/** Completed runs as a share of runs that finished as completed or failed. */
export function successRate(outcomes: {
  completedRuns: number;
  failedRuns: number;
}): number | null {
  const finished = outcomes.completedRuns + outcomes.failedRuns;
  return finished ? (outcomes.completedRuns / finished) * 100 : null;
}

export type Change = {
  /** Visible text, with an arrow so direction never depends on color. */
  text: string;
  /** Full sentence for assistive technology and tooltips. */
  description: string;
};

/**
 * Describes a change from the previous period. `unit: 'points'` compares
 * percentages by difference; otherwise the change is relative.
 */
export function describeChange(
  current: number | null | undefined,
  previous: number | null | undefined,
  format: (value: number) => string,
  unit: 'relative' | 'points' = 'relative',
): Change | null {
  if (current === null || current === undefined) return null;
  if (previous === null || previous === undefined)
    return {
      text: 'No previous data',
      description: 'No data in the previous period',
    };
  const from = `from ${format(previous)}`;
  if (current === previous)
    return { text: '→ No change', description: `Unchanged ${from}` };
  const arrow = current > previous ? '↑' : '↓';
  const direction = current > previous ? 'Up' : 'Down';
  if (unit === 'points') {
    const points = Math.abs(current - previous).toFixed(1);
    return {
      text: `${arrow} ${points} pts`,
      description: `${direction} ${points} percentage points ${from}`,
    };
  }
  if (previous === 0)
    return { text: `${arrow} ${from}`, description: `${direction} ${from}` };
  const percent = Math.round((Math.abs(current - previous) / previous) * 100);
  return {
    text: `${arrow} ${percent}%`,
    description: `${direction} ${percent}% ${from}`,
  };
}

export const periodLabels = {
  '24h': 'previous 24 hours',
  '7d': 'previous 7 days',
  '30d': 'previous 30 days',
} as const;

export function bucketLabel(startIso: string, endIso: string, spanMs: number) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (spanMs <= 2 * 86_400_000) {
    const time = (date: Date) =>
      date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      });
    return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time(start)}–${time(end)}`;
  }
  const day = (date: Date) =>
    date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const last = new Date(end.getTime() - 1);
  return day(start) === day(last) ? day(start) : `${day(start)}–${day(last)}`;
}
