/** Workflow page sections, selected by the `view` search parameter. */
export type WorkflowSection = 'editor' | 'runs' | 'report' | 'children';
export const workflowSection = (value: string | null): WorkflowSection =>
  value === 'runs' || value === 'report' || value === 'children'
    ? value
    : 'editor';
