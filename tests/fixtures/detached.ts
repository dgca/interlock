import {
  blankDefinition,
  nodeSchema,
  type WorkflowDefinition,
} from '@interlock/core';

export function workflowCall(
  workflowId: string,
  mode?: 'wait' | 'detached',
  after = false,
): WorkflowDefinition {
  const definition = blankDefinition();
  definition.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'workflow',
    label: 'Start investigation',
    workflowId,
    version: 1,
    ...(mode ? { mode } : {}),
  });
  if (after) {
    definition.nodes.splice(
      2,
      0,
      nodeSchema.parse({
        id: 'after',
        kind: 'agent',
        label: 'Continue supervisor',
        prompt: 'Continue',
        maxAttempts: 1,
      }),
    );
    definition.edges[1].target = 'after';
    definition.edges.push({
      id: 'after-exit',
      source: 'after',
      target: 'exit',
      port: 'default',
    });
  }
  return definition;
}
