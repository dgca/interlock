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
  'memory',
  'children',
] as const;
export type WorkflowSection = (typeof workflowSections)[number];
export function workflowSection(view: string | null): WorkflowSection {
  return workflowSections.find((section) => section === view) ?? 'editor';
}

/** Attached tabs of a workflow page; only library workflows have children. */
export function sectionTabs(
  workflow: { ownerWorkflowId?: string | null },
  proposals?: number,
  memory?: number,
) {
  return [
    { value: 'editor', label: 'Editor' },
    { value: 'runs', label: 'Runs' },
    { value: 'tests', label: 'Tests' },
    { value: 'report', label: 'Report' },
    { value: 'proposals', label: 'Proposals', count: proposals },
    { value: 'memory', label: 'Memory', count: memory },
    ...(!workflow.ownerWorkflowId
      ? [{ value: 'children', label: 'Child workflows' }]
      : []),
  ];
}

/** Sections whose content the workflow route supplies. */
export const routedSections = [
  'runs',
  'tests',
  'report',
  'proposals',
  'memory',
] as const;
