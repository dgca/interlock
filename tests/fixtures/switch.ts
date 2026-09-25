import { definitionSchema } from '@interlock/core';

export function switchDefinition(withFallback = true) {
  return definitionSchema.parse({
    nodes: [
      { id: 'entry', kind: 'entry', label: 'Input' },
      {
        id: 'route',
        kind: 'switch',
        label: 'Which specialist?',
        path: 'next.workflow',
        cases: [
          { port: 'investigate', equals: 'investigate' },
          { port: 'ticket', equals: 'ticket' },
          { port: 'assets', equals: 'assets-intake' },
        ],
        ...(withFallback ? { default: 'none' } : {}),
      },
      { id: 'exit', kind: 'exit', label: 'Output' },
    ],
    edges: [
      { id: 'in', source: 'entry', target: 'route' },
      ...[
        'investigate',
        'ticket',
        'assets',
        ...(withFallback ? ['none'] : []),
      ].map((port) => ({
        id: port,
        source: 'route',
        port,
        target: 'exit',
      })),
    ],
  });
}
