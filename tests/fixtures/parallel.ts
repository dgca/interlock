import { definitionSchema } from '@interlock/core';

export function parallelDefinition({
  keys = ['spec', 'code'],
  concurrency = 2,
  maxSteps = 100,
}: { keys?: string[]; concurrency?: number; maxSteps?: number } = {}) {
  const branches = keys.map((key, index) => ({ id: `r${index}`, key }));
  return definitionSchema.parse({
    maxSteps,
    nodes: [
      { id: 'entry', kind: 'entry', label: 'Input' },
      {
        id: 'parallel',
        kind: 'parallel',
        label: 'Reviews',
        branches,
        concurrency,
      },
      ...branches.map(({ id, key }, index) => ({
        id,
        kind: 'agent',
        label: key,
        prompt: 'Review the input.',
        maxAttempts: 1,
        model: index === 0 ? 'gpt-5' : 'claude-sonnet-4-6',
        parallelId: 'parallel',
        parallelBranchId: id,
      })),
      { id: 'exit', kind: 'exit', label: 'Output' },
    ],
    edges: [
      { id: 'in', source: 'entry', target: 'parallel' },
      ...branches.flatMap(({ id }) => [
        {
          id: `start-${id}`,
          source: 'parallel',
          port: `branch:${id}`,
          target: id,
        },
        {
          id: `join-${id}`,
          source: id,
          target: 'parallel',
          targetHandle: 'join',
        },
      ]),
      { id: 'out', source: 'parallel', port: 'complete', target: 'exit' },
    ],
  });
}
