import { definitionSchema, type Json } from '@interlock/core';
import type { Engine } from '@interlock/runtime';

export function seed(engine: Engine) {
  if (engine.store.workflows().length) return;
  const research = engine.create(
    'Research a protocol',
    'A focused agent assignment with an evidence contract.',
    definitionSchema.parse({
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
      },
      nodes: [
        {
          id: 'entry',
          kind: 'entry',
          label: 'Protocol',
          position: { x: 40, y: 160 },
        },
        {
          id: 'research',
          kind: 'agent',
          label: 'Research protocol',
          position: { x: 350, y: 160 },
          prompt:
            'Research the protocol in the input for opportunities to grow DeFi usage on Base. Include sources and distinguish verified facts from unknowns. Do not invent engagement status. Return an object with protocol, findings, sources, and unknowns. This workflow ships with example inputs, not live rankings.',
          context: {
            mode: 'current',
            instructions:
              'Keep the research scoped to the supplied protocol. Cite sources for factual claims.',
          },
          outputSchema: {
            type: 'object',
            required: ['protocol', 'findings', 'sources', 'unknowns'],
            properties: {
              protocol: { type: 'string' },
              findings: { type: 'string' },
              sources: { type: 'array', items: { type: 'string' } },
              unknowns: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        {
          id: 'exit',
          kind: 'exit',
          label: 'Evidence & findings',
          position: { x: 660, y: 160 },
        },
      ],
      edges: [
        { id: 'e1', source: 'entry', target: 'research' },
        { id: 'e2', source: 'research', target: 'exit' },
      ],
    }),
  );
  engine.publish(research.id);
  const weekly = engine.create(
    'DeFi opportunity brief',
    'Research a protocol list in parallel, then turn the evidence into a Base opportunity brief.',
    definitionSchema.parse({
      inputSchema: {
        type: 'object',
        required: ['protocols'],
        properties: {
          protocols: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name'],
              properties: { name: { type: 'string' } },
            },
          },
        },
      },
      nodes: [
        {
          id: 'entry',
          kind: 'entry',
          label: 'Protocol list',
          position: { x: 30, y: 180 },
        },
        {
          id: 'research',
          kind: 'list',
          label: 'Research each protocol',
          itemsPath: 'protocols',
          concurrency: 5,
          failurePolicy: 'collect',
          position: { x: 330, y: 180 },
        },
        {
          id: 'protocol-workflow',
          listId: 'research',
          kind: 'workflow',
          label: 'Research a protocol',
          workflowId: research.id,
          version: 1,
          position: { x: 130, y: 160 },
        },
        {
          id: 'synthesis',
          kind: 'agent',
          label: 'Compare opportunities',
          position: { x: 990, y: 180 },
          prompt:
            'Compare the collected protocol research for opportunities to increase DeFi usage on Base. Report research failures and unknowns. Return {"title": string, "markdown": string} with a prioritized recommendation document and supporting sources.',
          outputSchema: {
            type: 'object',
            required: ['title', 'markdown'],
            properties: {
              title: { type: 'string' },
              markdown: { type: 'string' },
            },
          },
        },
        {
          id: 'exit',
          kind: 'exit',
          label: 'Opportunity brief',
          position: { x: 1300, y: 180 },
        },
      ],
      edges: [
        { id: 'e1', source: 'entry', target: 'research' },
        {
          id: 'item',
          source: 'research',
          port: 'item',
          target: 'protocol-workflow',
        },
        {
          id: 'item-end',
          source: 'protocol-workflow',
          port: 'default',
          target: 'research',
          targetHandle: 'end',
        },
        { id: 'e2', source: 'research', port: 'complete', target: 'synthesis' },
        { id: 'e3', source: 'synthesis', target: 'exit' },
      ],
    }),
  );
  engine.publish(weekly.id);
}
export const exampleInput: Json = {
  protocols: [{ name: 'Aave' }, { name: 'Uniswap' }, { name: 'Morpho' }],
};
