import type { EventConfig, ScheduleConfig } from '@interlock/core';
import { api } from '../../lib/api';
import { paths, runOffset } from '../../routes/paths';

export type Inspection = Awaited<ReturnType<typeof api.triggers.inspect.query>>;
export type Automation = Inspection['trigger'];
export type Listing = Awaited<ReturnType<typeof api.triggers.list.query>>;
export type AutomationConfig = ScheduleConfig | EventConfig;
export type Status = 'all' | 'enabled' | 'disabled' | 'attention';
export const statusViews: { value: Status; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'attention', label: 'Needs attention' },
];
export function listQuery(search: URLSearchParams) {
  const value = search.get('status');
  const status: Status =
    value === 'enabled' || value === 'disabled' || value === 'attention'
      ? value
      : 'all';
  return {
    workflowId: search.get('workflow') || undefined,
    search: (search.get('search') ?? '').slice(0, 200),
    status,
    offset: runOffset(search.get('offset')),
  };
}
export function listHref(query: ReturnType<typeof listQuery>) {
  const search = new URLSearchParams();
  if (query.workflowId) search.set('workflow', query.workflowId);
  if (query.status !== 'all') search.set('status', query.status);
  if (query.search) search.set('search', query.search);
  if (query.offset) search.set('offset', String(query.offset));
  return paths.automations + (search.size ? `?${search}` : '');
}
export function returnHref(search: URLSearchParams) {
  return listHref(listQuery(new URLSearchParams(search.get('from') ?? '')));
}
export function itemHref(id: string, search: URLSearchParams, edit = false) {
  const next = new URLSearchParams();
  if (search.get('from')) next.set('from', search.get('from')!);
  return (
    (edit ? paths.automationEdit(id) : paths.automation(id)) +
    (next.size ? `?${next}` : '')
  );
}
export function editable(trigger: Automation) {
  return (
    trigger.kind === 'schedule' ||
    (trigger.kind === 'event' && trigger.action?.type !== 'webhook')
  );
}
export function automationStatus(
  trigger: Pick<Automation, 'enabled' | 'autoPaused'>,
) {
  return !trigger.enabled
    ? 'Disabled'
    : trigger.autoPaused
      ? 'Auto-paused'
      : 'Enabled';
}
export function timingLabel(
  trigger: Pick<ScheduleConfig, 'timing'>,
  includeZone = true,
) {
  const timing = trigger.timing;
  if (timing.type === 'cron')
    return `${cronLabel(timing.expression)}${includeZone ? ` · ${timing.timeZone}` : ''}`;
  for (const [unit, ms] of [
    ['day', 86400000],
    ['hour', 3600000],
    ['minute', 60000],
    ['second', 1000],
  ] as const) {
    if (timing.intervalMs % ms === 0) {
      const count = timing.intervalMs / ms;
      return `Every ${count} ${unit}${count === 1 ? '' : 's'}`;
    }
  }
  return `Every ${timing.intervalMs} ms`;
}
// Recognize common schedules; retain the exact expression for all others.
function cronLabel(expression: string) {
  const [minute, hour, day, month, weekday, extra] = expression
    .trim()
    .split(/\s+/);
  if (
    extra ||
    day !== '*' ||
    month !== '*' ||
    !/^\d+$/.test(minute ?? '') ||
    !/^\d+$/.test(hour ?? '')
  )
    return expression;
  const h = Number(hour),
    m = Number(minute);
  if (h > 23 || m > 59) return expression;
  const when = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const days: Record<string, string> = {
    '*': 'Every day',
    '1-5': 'Weekdays',
    '1,2,3,4,5': 'Weekdays',
    '0': 'Sundays',
    '7': 'Sundays',
    '1': 'Mondays',
    '2': 'Tuesdays',
    '3': 'Wednesdays',
    '4': 'Thursdays',
    '5': 'Fridays',
    '6': 'Saturdays',
  };
  return days[weekday] ? `${days[weekday]} at ${when}` : expression;
}
export const eventLabels: Record<EventConfig['events'][number], string> = {
  completed: 'Completes',
  failed: 'Fails',
  cancelled: 'Is cancelled',
  needs_attention: 'Needs attention',
  stalled: 'Stalls',
};
export function timestamp(value?: string | null, zone?: string) {
  if (!value) return 'Never';
  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  };
  try {
    return new Date(value).toLocaleString(undefined, {
      ...options,
      ...(zone ? { timeZone: zone } : {}),
    });
  } catch {
    return new Date(value).toLocaleString(undefined, options);
  }
}
export function outcomeLabel(outcome: string) {
  const labels: Record<string, string> = {
    skipped_overlap: 'Skipped · overlap',
    skipped_missed: 'Skipped · missed time',
    pending_quiescence: 'Waiting for source work to stop',
    pending_pause: 'Waiting for pause release',
  };
  return (
    labels[outcome] ??
    outcome.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())
  );
}
export function initialConfig(kind: 'schedule' | 'event'): AutomationConfig {
  return kind === 'schedule'
    ? {
        kind,
        name: '',
        timing: { type: 'interval', intervalMs: 300000 },
        input: {},
        bindings: {},
        overlapPolicy: 'skip',
        missedFirePolicy: 'skip',
        pauseAfterConsecutiveFailures: null,
      }
    : {
        kind,
        name: '',
        events: ['failed'],
        scope: { type: 'workflow', workflowId: '', includeChildren: false },
        action: { type: 'workflow' },
        waitForQuiescence: false,
        maxTriggerDepth: 2,
        pauseAfterConsecutiveFailures: null,
      };
}
