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

/** Workflow page sections, selected by the `view` URL parameter. */
const workflowSections = [
  'editor',
  'runs',
  'tests',
  'report',
  'proposals',
  'children',
] as const;
export type WorkflowSection = (typeof workflowSections)[number];
export function workflowSection(view: string | null): WorkflowSection {
  return workflowSections.find((section) => section === view) ?? 'editor';
}
