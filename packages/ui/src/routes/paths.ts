import type { RunTab } from '../features/runs/runAttention';
import { runTagsSchema } from '@interlock/core';
function runListSearch(
  tab: RunTab,
  offset: number,
  tags?: Record<string, string>,
) {
  const query = new URLSearchParams();
  if (tab !== 'active') query.set('tab', tab);
  if (offset > 0) query.set('offset', String(offset));
  if (tags && Object.keys(tags).length) query.set('tags', JSON.stringify(tags));
  return query;
}

export function runTagFilter(value: string | null) {
  if (!value) return undefined;
  try {
    const parsed = runTagsSchema.safeParse(JSON.parse(value));
    return parsed.success && Object.keys(parsed.data).length
      ? parsed.data
      : undefined;
  } catch {
    return undefined;
  }
}

export function runOffset(value: string | null) {
  const offset = Number(value);
  return Number.isSafeInteger(offset) && offset > 0 ? offset : 0;
}

// Resource URLs use stable IDs, independent of names or future folder membership.
export const paths = {
  automations: '/automations',
  automationNew: '/automations/new',
  automation: (id: string) => `/automations/${encodeURIComponent(id)}`,
  automationEdit: (id: string) => `/automations/${encodeURIComponent(id)}/edit`,
  report: '/report',
  workflowReport: (id: string) => `/workflows/${encodeURIComponent(id)}/report`,
  diagnostics: '/settings/diagnostics',
  harnesses: '/settings/ai',
  prompts: '/prompts',
  variables: '/variables',
  variable: (id: string) => `/variables/${encodeURIComponent(id)}`,
  prompt: (id: string) => `/prompts/${encodeURIComponent(id)}`,
  workflows: '/workflows',
  workflowSchedule: (id: string, triggerId?: string) =>
    triggerId
      ? `/automations/${encodeURIComponent(triggerId)}?from=${encodeURIComponent(new URLSearchParams({ workflow: id }).toString())}`
      : `/automations?workflow=${encodeURIComponent(id)}`,
  workflow: (id: string) => `/workflows/${encodeURIComponent(id)}`,
  runs: (tab: RunTab = 'active', offset = 0, tags?: Record<string, string>) => {
    const query = runListSearch(tab, offset, tags);
    return `/runs${query.size ? `?${query}` : ''}`;
  },
  workflowRuns: (
    id: string,
    tab: RunTab = 'active',
    offset = 0,
    tags?: Record<string, string>,
  ) => {
    const query = runListSearch(tab, offset, tags);
    return `/workflows/${encodeURIComponent(id)}?view=runs${query.size ? `&${query}` : ''}`;
  },
  run: (
    id: string,
    workflowId?: string,
    tab: RunTab = 'active',
    executionId?: string,
    offset = 0,
    tags?: Record<string, string>,
  ) => {
    const query = new URLSearchParams();
    if (workflowId) query.set('workflow', workflowId);
    if (workflowId || tab !== 'active') query.set('tab', tab);
    if (executionId) query.set('execution', executionId);
    if (offset > 0) query.set('offset', String(offset));
    if (tags && Object.keys(tags).length)
      query.set('tags', JSON.stringify(tags));
    return `/runs/${encodeURIComponent(id)}${query.size ? `?${query}` : ''}`;
  },
};
