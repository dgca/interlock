// Resource URLs use stable IDs, independent of names or future folder membership.
export const paths = {
  workflows: '/workflows',
  workflow: (id: string) => `/workflows/${encodeURIComponent(id)}`,
  runs: (tab: 'active' | 'history' = 'active') =>
    tab === 'history' ? '/runs?tab=history' : '/runs',
  workflowRuns: (id: string, tab: 'active' | 'history' = 'active') =>
    `/workflows/${encodeURIComponent(id)}?view=runs${tab === 'history' ? '&tab=history' : ''}`,
  run: (
    id: string,
    workflowId?: string,
    tab: 'active' | 'history' = 'active',
  ) =>
    `/runs/${encodeURIComponent(id)}${workflowId ? `?workflow=${encodeURIComponent(workflowId)}&tab=${tab}` : ''}`,
};
