import type { RunTab } from '../features/runs/runAttention';
// Resource URLs use stable IDs, independent of names or future folder membership.
export const paths = {
  harnesses: '/settings/harnesses',
  prompts: '/prompts',
  variables: '/variables',
  variable: (id: string) => `/variables/${encodeURIComponent(id)}`,
  prompt: (id: string) => `/prompts/${encodeURIComponent(id)}`,
  workflows: '/workflows',
  workflow: (id: string) => `/workflows/${encodeURIComponent(id)}`,
  runs: (tab: RunTab = 'active') =>
    tab !== 'active' ? `/runs?tab=${tab}` : '/runs',
  workflowRuns: (id: string, tab: RunTab = 'active') =>
    `/workflows/${encodeURIComponent(id)}?view=runs${tab !== 'active' ? `&tab=${tab}` : ''}`,
  run: (
    id: string,
    workflowId?: string,
    tab: RunTab = 'active',
    executionId?: string,
  ) => {
    const query = new URLSearchParams();
    if (workflowId) query.set('workflow', workflowId);
    if (workflowId || tab !== 'active') query.set('tab', tab);
    if (executionId) query.set('execution', executionId);
    return `/runs/${encodeURIComponent(id)}${query.size ? `?${query}` : ''}`;
  },
};
