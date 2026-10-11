import { createHash } from 'node:crypto';
import { definitionSchema, type WorkflowDefinition } from '@interlock/core';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export const fingerprint = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex');

// Match import's parsed semantics, including defaults and key ordering.
export const definitionHash = (definition: WorkflowDefinition) =>
  fingerprint(definitionSchema.parse(definition));
