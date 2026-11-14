import type { RunMode } from '../features/runs/runListConfig';
import type { RunTab } from '../features/runs/runAttention';
import { runTagsSchema, type RequestTarget } from '@interlock/core';
function runListSearch(
  tab: RunTab,
  offset: number,
  tags?: Record<string, string>,
  mode?: RunMode,
) {
  const query = new URLSearchParams();
  if (mode === 'overview' || mode === 'stages') query.set('mode', mode);
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

export function automationDraftKey(search: URLSearchParams) {
  return JSON.stringify([search.get('type'), search.get('workflow') || null]);
}

// Only return to in-app run, request, or Board views. Parse before navigation
// because the destination can be supplied by a copied or edited URL.
export function runReturnLocation(value: string | null | undefined) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//')
  )
    return;
  try {
    const origin = 'https://interlock.invalid';
    const url = new URL(value, origin);
    if (url.origin !== origin) return;
    const { pathname, search, searchParams, hash } = url;
    const path = pathname + search + hash;
    if (pathname === '/runs') return { path, label: 'Back to runs' };
    if (pathname === '/runs/request') return { path, label: 'Back to request' };
    if (/^\/runs\/[^/]+$/.test(pathname)) return { path, label: 'Back to run' };
    if (
      !['/boards/new', '/boards/types'].includes(pathname) &&
      /^\/boards\/[^/]+$/.test(pathname)
    )
      return {
        path,
        label: searchParams.has('request')
          ? 'Back to request'
          : 'Back to board',
      };
    if (
      /^\/workflows\/[^/]+$/.test(pathname) &&
      searchParams.get('view') === 'runs'
    )
      return { path, label: 'Back to runs' };
  } catch {
    return;
  }
}

// Resource URLs use stable IDs, independent of names or future folder membership.
export const paths = {
  boards: '/boards',
  boardNew: '/boards/new',
  board: (id: string) => `/boards/${encodeURIComponent(id)}`,
  boardSettings: (id: string) => `/boards/${encodeURIComponent(id)}/settings`,
  boardTypes: '/boards/types',
  boardTypeNew: '/boards/types/new',
  boardType: (id: string) => `/boards/types/${encodeURIComponent(id)}`,
  request: (target: RequestTarget, returnTo?: string) => {
    const query = new URLSearchParams({ request: JSON.stringify(target) });
    if (returnTo) query.set('returnTo', returnTo);
    return `/runs/request?${query}`;
  },
  automations: '/automations',
  automationNew: '/automations/new',
  automation: (id: string) => `/automations/${encodeURIComponent(id)}`,
  automationEdit: (id: string) => `/automations/${encodeURIComponent(id)}/edit`,
  report: '/report',
  workflowReport: (id: string) => `/workflows/${encodeURIComponent(id)}/report`,
  diagnostics: '/settings/diagnostics',
  harnesses: '/settings/ai',
  integrationNew: '/settings/ai/integrations/-/new',
  integration: (id: string) =>
    `/settings/ai/integrations/${encodeURIComponent(id)}`,
  prompts: '/prompts',
  promptNew: '/prompts/-/new',
  variables: '/variables',
  variable: (id: string) => `/variables/${encodeURIComponent(id)}`,
  prompt: (id: string) => `/prompts/${encodeURIComponent(id)}`,
  workflows: '/workflows',
  workflowSchedule: (id: string, triggerId?: string) =>
    triggerId
      ? `/automations/${encodeURIComponent(triggerId)}?from=${encodeURIComponent(new URLSearchParams({ workflow: id }).toString())}`
      : `/automations?workflow=${encodeURIComponent(id)}`,
  workflow: (id: string) => `/workflows/${encodeURIComponent(id)}`,
  runs: (
    tab: RunTab = 'active',
    offset = 0,
    tags?: Record<string, string>,
    mode?: RunMode,
  ) => {
    const query = runListSearch(tab, offset, tags, mode);
    return `/runs${query.size ? `?${query}` : ''}`;
  },
  workflowRuns: (
    id: string,
    tab: RunTab = 'active',
    offset = 0,
    tags?: Record<string, string>,
    mode?: RunMode,
  ) => {
    const query = runListSearch(tab, offset, tags, mode);
    return `/workflows/${encodeURIComponent(id)}?view=runs${query.size ? `&${query}` : ''}`;
  },
  run: (
    id: string,
    {
      workflowId,
      tab,
      executionId,
      offset = 0,
      tags,
      mode,
      returnTo,
    }: {
      workflowId?: string;
      tab?: RunTab;
      executionId?: string;
      offset?: number;
      tags?: Record<string, string>;
      mode?: RunMode;
      returnTo?: string;
    } = {},
  ) => {
    const query = new URLSearchParams();
    if (mode) query.set('mode', mode);
    if (workflowId) query.set('workflow', workflowId);
    if (workflowId || tab) query.set('tab', tab ?? 'active');
    if (executionId) query.set('execution', executionId);
    if (returnTo) query.set('returnTo', returnTo);
    if (offset > 0) query.set('offset', String(offset));
    if (tags && Object.keys(tags).length)
      query.set('tags', JSON.stringify(tags));
    return `/runs/${encodeURIComponent(id)}${query.size ? `?${query}` : ''}`;
  },
};
