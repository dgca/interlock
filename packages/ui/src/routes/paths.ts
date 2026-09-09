// Resource URLs use stable IDs, independent of names or future folder membership.
export const paths = {
  workflows: '/workflows',
  workflow: (id: string) => `/workflows/${encodeURIComponent(id)}`,
  runs: (tab: 'active' | 'history' = 'active') =>
    tab === 'history' ? '/runs?tab=history' : '/runs',
  run: (id: string) => `/runs/${encodeURIComponent(id)}`,
};
