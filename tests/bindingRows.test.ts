import { expect, it } from 'vitest';
import { valueBindingsSchema } from '@interlock/core';
import {
  bindingRows,
  bindingsFromRows,
  bindingRowError,
  renameBindingRow,
} from '../packages/ui/src/features/workflows/bindingRows';
it('round trips nested fields without reinterpreting old literal dotted names', () => {
  const fields = valueBindingsSchema.parse(
    JSON.parse(
      '{"literal.name":{"source":"runInput","path":"zero","default":0},"project":{"source":"object","fields":{"repoPath":{"source":"runInput","path":"repoPath"},"flags":{"source":"literal","value":[true,null]}}},"empty":{"source":"object","fields":{}},"__proto__":{"source":"literal","value":"own value"}}',
    ),
  );
  const rows = bindingRows(fields);
  expect(rows.find((r) => r.name === 'literal.name')!.keys).toEqual([
    'literal.name',
  ]);
  expect(rows.find((r) => r.name === 'project.repoPath')!.keys).toEqual([
    'project',
    'repoPath',
  ]);
  expect(bindingsFromRows(rows)).toEqual(fields);
  rows.find((r) => r.name === 'project.repoPath')!.binding = {
    source: 'literal',
    value: 'updated',
  };
  expect(bindingsFromRows(rows)['literal.name']).toEqual(
    fields['literal.name'],
  );
});
it('builds nested objects from a deliberately renamed target and rejects collisions', () => {
  const rows = bindingRows({ old: { source: 'literal', value: 1 } });
  rows[0] = { ...rows[0], name: 'project.id', keys: ['project', 'id'] };
  expect(bindingsFromRows(rows)).toEqual({
    project: {
      source: 'object',
      fields: { id: { source: 'literal', value: 1 } },
    },
  });
  rows.push({
    name: 'project',
    keys: ['project'],
    binding: { source: 'literal', value: 2 },
  });
  expect(bindingRowError(rows[0], rows)).toContain('cannot also contain');
  expect(() => bindingsFromRows(rows)).toThrow();
});

it('preserves literal dots when a target is cleared and retyped unchanged', () => {
  const original = {
    project: {
      source: 'object' as const,
      fields: { 'repo.path': { source: 'literal' as const, value: 1 } },
    },
  };
  const row = bindingRows(original)[0];
  const cleared = renameBindingRow(row, '');
  expect(bindingsFromRows([renameBindingRow(cleared, row.name)])).toEqual(
    original,
  );
});
