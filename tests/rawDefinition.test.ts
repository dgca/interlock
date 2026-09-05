import { expect, it } from 'vitest';
import { blankDefinition } from '@interlock/core';
import { parseRawDefinition } from '../packages/ui/src/features/workflows/rawDefinition';

it('round-trips a workflow definition without losing script code', () => {
  const definition = blankDefinition();
  const node = definition.nodes[1];
  definition.nodes[1] = {
    id: node.id,
    label: 'Script',
    position: node.position,
    inputSchema: {},
    outputSchema: {},
    kind: 'script',
    language: 'javascript',
    command: 'const value = await Promise.resolve(input);\nreturn value;',
    timeoutMs: 30000,
  };
  expect(parseRawDefinition(JSON.stringify(definition))).toEqual({
    definition,
  });
});

it('blocks malformed JSON and identifies missing node fields', () => {
  expect(parseRawDefinition('{').error).toBeTruthy();
  const definition = blankDefinition();
  const input = JSON.parse(JSON.stringify(definition));
  delete input.nodes[1].prompt;
  expect(parseRawDefinition(JSON.stringify(input)).error).toContain(
    'nodes.1.prompt',
  );
});

it('allows saving an unfinished graph but reports why publishing is blocked', () => {
  const definition = blankDefinition();
  definition.edges = [];
  const result = parseRawDefinition(JSON.stringify(definition));
  expect(result.definition).toEqual(definition);
  expect(result.error).toBeUndefined();
  expect(result.publishError).toContain('outgoing routes');
});

it('reports dangling connections and duplicate IDs before publishing', () => {
  const definition = blankDefinition();
  definition.edges[0].target = 'missing';
  expect(parseRawDefinition(JSON.stringify(definition)).publishError).toContain(
    'missing node',
  );
  definition.nodes[1].id = definition.nodes[0].id;
  expect(parseRawDefinition(JSON.stringify(definition)).publishError).toContain(
    'unique',
  );
});

it('rejects workflow metadata outside the editable definition', () => {
  expect(
    parseRawDefinition(
      JSON.stringify({ ...blankDefinition(), latestVersion: 3 }),
    ).error,
  ).toContain('latestVersion');
});

it('reports unknown nested fields instead of silently dropping raw edits', () => {
  const definition = JSON.parse(JSON.stringify(blankDefinition()));
  definition.nodes[1].maxAttempt = 4;
  expect(parseRawDefinition(JSON.stringify(definition)).error).toContain(
    'nodes.1.maxAttempt: Unknown field',
  );
});
