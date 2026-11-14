import { definitionSchema, type WorkflowDefinition } from './index.js';

export function blankDefinition(): WorkflowDefinition {
  return definitionSchema.parse({
    nodes: [
      {
        id: 'entry',
        kind: 'entry',
        label: 'Workflow input',
        position: { x: 60, y: 160 },
      },
      {
        id: 'agent',
        kind: 'agent',
        label: 'Agent assignment',
        prompt: 'Process the input and return your result as JSON.',
        position: { x: 370, y: 160 },
      },
      {
        id: 'exit',
        kind: 'exit',
        label: 'Return result',
        position: { x: 680, y: 160 },
      },
    ],
    edges: [
      { id: 'e1', source: 'entry', target: 'agent' },
      { id: 'e2', source: 'agent', target: 'exit' },
    ],
  });
}
