/** Fixed value sent through Script and Fetch Failed routes, independent of success contracts. */
export const FAILURE_ROUTE_SCHEMA = {
  type: 'object',
  required: ['input', 'error', 'output'],
  properties: {
    input: { description: 'Resolved input used by the failed operation.' },
    error: {
      type: 'object',
      required: ['nodeId', 'executionId', 'kind', 'category', 'message'],
      properties: {
        nodeId: { type: 'string' },
        executionId: { type: 'string' },
        kind: { type: 'string', enum: ['script', 'fetch'] },
        category: { type: 'string', enum: ['execution', 'http', 'output'] },
        message: { type: 'string' },
      },
      additionalProperties: false,
    },
    output: { description: 'Returned JSON value, or null if unavailable.' },
  },
  additionalProperties: false,
};

export type FailureCategory = 'execution' | 'http' | 'output' | 'child';

/** Waited Workflow failures reference their retained child rather than copying its history. */
export const WORKFLOW_FAILURE_ROUTE_SCHEMA = {
  ...FAILURE_ROUTE_SCHEMA,
  properties: {
    ...FAILURE_ROUTE_SCHEMA.properties,
    error: {
      ...FAILURE_ROUTE_SCHEMA.properties.error,
      required: [...FAILURE_ROUTE_SCHEMA.properties.error.required, 'child'],
      properties: {
        ...FAILURE_ROUTE_SCHEMA.properties.error.properties,
        kind: { type: 'string', enum: ['workflow'] },
        category: { type: 'string', enum: ['child', 'output'] },
        child: {
          type: 'object',
          required: ['runId', 'workflowId', 'version', 'executionId'],
          properties: {
            runId: { type: 'string' },
            workflowId: { type: 'string' },
            version: { type: 'integer', minimum: 1 },
            executionId: { type: ['string', 'null'] },
          },
          additionalProperties: false,
        },
      },
    },
  },
};

export function failureRouteContract(kind: string) {
  return kind === 'workflow'
    ? WORKFLOW_FAILURE_ROUTE_SCHEMA
    : FAILURE_ROUTE_SCHEMA;
}
