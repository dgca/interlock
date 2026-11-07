import type { RunTab } from '../features/runs/runAttention';
function runListSearch(tab: RunTab, offset: number) {
  const query = new URLSearchParams();
  if (tab !== 'active') query.set('tab', tab);
  if (offset > 0) query.set('offset', String(offset));
  return query;
}

export function runOffset(value: string | null) {
  const offset = Number(value);
  return Number.isSafeInteger(offset) && offset > 0 ? offset : 0;
}

// Resource URLs use stable IDs, independent of names or future folder membership.
export const paths = {
  harnesses: '/settings/harnesses',
  prompts: '/prompts',
  variables: '/variables',
  variable: (id: string) => `/variables/${encodeURIComponent(id)}`,
  prompt: (id: string) => `/prompts/${encodeURIComponent(id)}`,
  workflows: '/workflows',
  workflowSchedule: (id: string, triggerId?: string) =>
    `/workflows/${encodeURIComponent(id)}?view=schedules${triggerId ? `&schedule=${encodeURIComponent(triggerId)}` : ''}`,
  workflow: (id: string) => `/workflows/${encodeURIComponent(id)}`,
  runs: (tab: RunTab = 'active', offset = 0) => {
    const query = runListSearch(tab, offset);
    return `/runs${query.size ? `?${query}` : ''}`;
  },
  workflowRuns: (id: string, tab: RunTab = 'active', offset = 0) => {
    const query = runListSearch(tab, offset);
    return `/workflows/${encodeURIComponent(id)}?view=runs${query.size ? `&${query}` : ''}`;
  },
  run: (
    id: string,
    workflowId?: string,
    tab: RunTab = 'active',
    executionId?: string,
    offset = 0,
  ) => {
    const query = new URLSearchParams();
    if (workflowId) query.set('workflow', workflowId);
    if (workflowId || tab !== 'active') query.set('tab', tab);
    if (executionId) query.set('execution', executionId);
    if (offset > 0) query.set('offset', String(offset));
    return `/runs/${encodeURIComponent(id)}${query.size ? `?${query}` : ''}`;
  },
};
