import { definitionSchema, type Json } from '@interlock/core';
import type { Engine } from '@interlock/runtime';

export function seed(engine: Engine) {
  // Seed exactly once per database. The marker distinguishes "fresh
  // install" from "the user deleted every workflow", which is permanent.
  if (engine.store.get('meta', 'seed')) return;
  const mark = () =>
    engine.store.put('meta', {
      id: 'seed',
      seededAt: new Date().toISOString(),
    });
  // Stores created before the marker existed are already seeded.
  if (engine.store.workflows().length) return mark();
  const scout = engine.create(
    'Size up a Pokémon',
    'Look a Pokémon up on PokéAPI, compute its stat sheet, then branch: small and adorable ones get an agent-written mascot pitch, the rest keep their raw stats.',
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
          label: 'Pokémon name',
          position: { x: 40, y: 200 },
        },
        {
          id: 'lookup',
          kind: 'fetch',
          label: 'Ask PokéAPI',
          position: { x: 300, y: 200 },
          url: 'https://pokeapi.co/api/v2/pokemon/{{input.name}}',
          method: 'GET',
        },
        {
          id: 'stats',
          kind: 'script',
          label: 'Pull the fun stats',
          language: 'javascript',
          position: { x: 580, y: 200 },
          command: `const body = input.body;
if (!body || typeof body.name !== 'string')
  throw new Error('PokéAPI did not recognize that name');
const stats = {};
for (const stat of body.stats ?? []) stats[stat.stat.name] = stat.base_stat;
return {
  name: body.name,
  types: (body.types ?? []).map((entry) => entry.type.name),
  heightM: (body.height ?? 0) / 10,
  weightKg: (body.weight ?? 0) / 10,
  smallAndAdorable: (body.height ?? 999) <= 6,
  stats,
};`,
        },
        {
          id: 'cute-check',
          kind: 'condition',
          label: 'Small and adorable?',
          position: { x: 860, y: 200 },
          path: 'smallAndAdorable',
          equals: true,
        },
        {
          id: 'mascot-pitch',
          kind: 'agent',
          label: 'Write the mascot pitch',
          position: { x: 1140, y: 90 },
          prompt:
            'Write a delightfully overcommitted mascot pitch for the Pokémon in the input, a scouting sheet with name, types, height, weight, and base stats. One short paragraph that leans into how small and adorable it is while citing one real stat as evidence. Do not invent abilities or moves. Return an object with name, pitch, and reasoning.',
          context: {
            mode: 'current',
            instructions:
              'Stay playful but keep every factual claim grounded in the input scouting sheet.',
          },
          outputSchema: {
            type: 'object',
            required: ['name', 'pitch', 'reasoning'],
            properties: {
              name: { type: 'string' },
              pitch: { type: 'string' },
              reasoning: { type: 'string' },
            },
          },
        },
        {
          id: 'exit-pitch',
          kind: 'exit',
          label: 'Mascot pitch',
          position: { x: 1460, y: 90 },
        },
        {
          id: 'exit-stats',
          kind: 'exit',
          label: 'Stat sheet',
          position: { x: 1140, y: 310 },
        },
      ],
      edges: [
        { id: 'e1', source: 'entry', target: 'lookup' },
        { id: 'e2', source: 'lookup', target: 'stats' },
        { id: 'e3', source: 'stats', target: 'cute-check' },
        {
          id: 'e4',
          source: 'cute-check',
          port: 'true',
          target: 'mascot-pitch',
        },
        { id: 'e5', source: 'mascot-pitch', target: 'exit-pitch' },
        { id: 'e6', source: 'cute-check', port: 'false', target: 'exit-stats' },
      ],
    }),
  );
  engine.publish(scout.id);
  const roster = engine.create(
    'Build a team roster',
    'Scout a list of candidate Pokémon in parallel with the Size up a Pokémon workflow, then turn the scouting sheets into a picked team.',
    definitionSchema.parse({
      inputSchema: {
        type: 'object',
        required: ['candidates'],
        properties: {
          candidates: {
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
          label: 'Candidate list',
          position: { x: 30, y: 180 },
        },
        {
          id: 'scouting',
          kind: 'batch',
          label: 'Size up each candidate',
          itemsPath: 'candidates',
          concurrency: 5,
          failurePolicy: 'collect',
          position: { x: 330, y: 180 },
        },
        {
          id: 'scout-workflow',
          batchId: 'scouting',
          kind: 'workflow',
          label: 'Size up a Pokémon',
          workflowId: scout.id,
          version: 1,
          position: { x: 130, y: 160 },
        },
        {
          id: 'selection',
          kind: 'agent',
          label: 'Pick the final six',
          position: { x: 990, y: 180 },
          prompt:
            'You are staffing a team roster. The input holds one record per candidate with a run status and either a scouting sheet, a mascot pitch, or an error. Pick up to six candidates, give each a one-line team role grounded in its types and stats, and call out any candidates whose scouting failed. Return {"title": string, "markdown": string} with the roster as a markdown document.',
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
          label: 'Team roster',
          position: { x: 1300, y: 180 },
        },
      ],
      edges: [
        { id: 'e1', source: 'entry', target: 'scouting' },
        {
          id: 'item',
          source: 'scouting',
          port: 'item',
          target: 'scout-workflow',
        },
        {
          id: 'item-end',
          source: 'scout-workflow',
          port: 'default',
          target: 'scouting',
          targetHandle: 'end',
        },
        { id: 'e2', source: 'scouting', port: 'complete', target: 'selection' },
        { id: 'e3', source: 'selection', target: 'exit' },
      ],
    }),
  );
  engine.publish(roster.id);
  mark();
}
export const exampleInput: Json = {
  candidates: [{ name: 'pikachu' }, { name: 'gengar' }, { name: 'togepi' }],
};
