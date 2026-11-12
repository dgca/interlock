import type { Workflow } from '@interlock/core';
export const workflowViews = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
];
export function workflowTabs(workflows: Pick<Workflow, 'archived'>[]) {
  return workflowViews.map((view) => ({
    ...view,
    count: workflows.filter(
      (workflow) => workflow.archived === (view.value === 'archived'),
    ).length,
  }));
}
