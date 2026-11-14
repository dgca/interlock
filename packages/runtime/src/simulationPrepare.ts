import {
  assertionProblems,
  isPollWait,
  promptIds,
  type CapturedCase,
  type SavedPrompt,
  type Workflow,
  type WorkflowDefinition,
} from '@interlock/core';
import type { Store } from '@interlock/storage';

/** Check a definition and case for simulation and collect what the scratch engine needs. */
export function prepareSimulation(
  store: Store,
  definition: WorkflowDefinition,
  testCase: CapturedCase,
) {
  const unsupported = definition.nodes.flatMap((node) => {
    if (node.kind === 'exit' && node.continueAsNew)
      return [`Node ${node.id}: continue as new is unsupported in simulation`];
    if (
      ![
        'entry',
        'exit',
        'agent',
        'script',
        'fetch',
        'condition',
        'switch',
        'workflow',
        'wait',
        'input',
        'batch',
        'parallel',
      ].includes(node.kind)
    )
      return [`Node ${node.id}: ${node.kind} is unsupported`];
    return [];
  });
  unsupported.push(...assertionProblems(testCase.assertions, definition));
  const childWorkflows: Workflow[] = [];
  const childVersions: NonNullable<ReturnType<Store['getVersion']>>[] = [];
  const queue = [...definition.nodes];
  const visitedWorkflows = new Set<string>();
  while (queue.length) {
    const node = queue.shift()!;
    if (node.kind === 'workflow') {
      const cw = store.get<Workflow>('workflows', node.workflowId);
      if (cw && !visitedWorkflows.has(cw.id)) {
        visitedWorkflows.add(cw.id);
        childWorkflows.push(cw);
        const cv = store.getVersion(node.workflowId, node.version ?? 1);
        if (cv) {
          childVersions.push(cv);
          queue.push(...cv.definition.nodes);
        }
      }
    }
  }
  const allPrompts = [...promptIds(definition)];
  for (const cv of childVersions) {
    allPrompts.push(...promptIds(cv.definition));
  }
  const prompts = [...new Set(allPrompts)]
    .map((id) => {
      const p = store.get<SavedPrompt>('prompts', id);
      if (!p) unsupported.push(`Saved prompt ${id} is missing`);
      return p;
    })
    .filter((p): p is SavedPrompt => !!p);
  if (
    prompts.length > 64 ||
    Buffer.byteLength(JSON.stringify(prompts)) > 1048576
  )
    unsupported.push('Saved prompt capture exceeds 64 prompts or 1 MiB');
  const allNodes = [...definition.nodes];
  for (const cv of childVersions) {
    allNodes.push(...cv.definition.nodes);
  }
  for (const [index, fixture] of (testCase.fixtures ?? []).entries()) {
    if (
      !allNodes.some(
        (n) =>
          n.id === fixture.nodeId &&
          (n.kind === fixture.kind ||
            (n.kind === 'wait' &&
              isPollWait(n) &&
              fixture.kind === n.timing.check.kind) ||
            (n.kind === 'wait' && fixture.kind === 'wait')),
      )
    )
      unsupported.push(
        `Fixture ${index}: node or kind does not match the pinned definition`,
      );
  }
  return { unsupported, childWorkflows, childVersions, prompts };
}
