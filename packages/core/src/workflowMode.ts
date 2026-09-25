export const STARTED_RUN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    runId: { type: 'string' },
    workflowId: { type: 'string' },
    version: { type: 'integer', minimum: 1 },
  },
  required: ['runId', 'workflowId', 'version'],
  additionalProperties: false,
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

/** Empty means use the intrinsic contract. Explicit overrides must match it. */
export function isStartedRunSchema(schema: Record<string, unknown>) {
  return (
    Object.keys(schema).length === 0 ||
    JSON.stringify(canonical(schema)) ===
      JSON.stringify(canonical(STARTED_RUN_SCHEMA))
  );
}
