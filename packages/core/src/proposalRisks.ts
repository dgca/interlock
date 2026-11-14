import { structuralEqual } from './jsonEquality.js';
import { nodeVariableReferences } from './variables.js';
import type { WorkflowDefinition } from './index.js';

/** One change that lets the workflow do more than before. */
export type WideningChange = {
  subject: string;
  field: string;
  reason: string;
  before: unknown;
  after: unknown;
};

const workflowFields: Record<string, string> = {
  agentPermissions: 'Agent permission mode',
  permissionPolicy: 'Permission policy',
  workspace: 'Workspace',
  executor: 'Executor',
  cwd: 'Working directory',
};
const nodeFields: Record<string, Record<string, string>> = {
  script: {
    command: 'Script command',
    language: 'Script language',
    environment: 'Script environment',
    environmentMode: 'Script environment mode',
    environmentPassthrough: 'Passed-through environment',
    cwd: 'Working directory',
    executionMode: 'Execution mode',
  },
  fetch: {
    url: 'Fetch URL',
    method: 'Fetch method',
    headers: 'Fetch headers',
    query: 'Fetch query',
    blockPrivateNetwork: 'Private network access',
  },
  wait: { timing: 'Polling check' },
  agent: { executor: 'Executor', cwd: 'Working directory' },
  workflow: { workflowId: 'Called workflow' },
};
const limits = [
  'maxSteps',
  'maxActiveRuns',
  'maxAttempts',
  'maxLeaseExpiries',
  'leaseSeconds',
  'maxExecutionMs',
  'timeoutMs',
  'unclaimedTimeoutMs',
];
const increased = (before: unknown, after: unknown) =>
  typeof after === 'number' && (typeof before !== 'number' || after > before);
const field = (value: unknown, key: string) =>
  (value as Record<string, unknown> | undefined)?.[key];

/**
 * Changes a reviewer must see before approving: permissions, workspace,
 * code and requests a step runs, Secret and Config references, tool routes,
 * and raised limits. The list is shown expanded above the ordinary diff.
 */
export function wideningChanges(
  before: WorkflowDefinition,
  after: WorkflowDefinition,
): WideningChange[] {
  const changes: WideningChange[] = [];
  const push = (
    subject: string,
    key: string,
    reason: string,
    from: unknown,
    to: unknown,
  ) => changes.push({ subject, field: key, reason, before: from, after: to });
  for (const [key, reason] of Object.entries(workflowFields))
    if (!structuralEqual(field(before, key), field(after, key)))
      push('Workflow', key, reason, field(before, key), field(after, key));
  for (const key of limits)
    if (increased(field(before, key), field(after, key)))
      push(
        'Workflow',
        key,
        'Raised limit',
        field(before, key),
        field(after, key),
      );
  const old = new Map(before.nodes.map((n) => [n.id, n]));
  for (const node of after.nodes) {
    const previous = old.get(node.id);
    const subject = `${node.label} (${node.id})`;
    for (const [key, reason] of Object.entries(nodeFields[node.kind] ?? {}))
      if (!structuralEqual(field(previous, key), field(node, key)))
        push(subject, key, reason, field(previous, key), field(node, key));
    for (const key of limits)
      if (previous && increased(field(previous, key), field(node, key)))
        push(
          subject,
          key,
          'Raised limit',
          field(previous, key),
          field(node, key),
        );
    const used = new Set(previous ? nodeVariableReferences(previous) : []);
    const added = nodeVariableReferences(node).filter((ref) => !used.has(ref));
    if (added.length)
      push(
        subject,
        'variables',
        'New Secret or Config references',
        [...used],
        [...used, ...added],
      );
  }
  const edges = new Map(before.edges.map((e) => [e.id, e]));
  for (const edge of after.edges)
    if (edge.kind === 'tool' && !structuralEqual(edges.get(edge.id), edge))
      push(`Route ${edge.id}`, 'tool', 'Agent tool', edges.get(edge.id), edge);
  return changes;
}
