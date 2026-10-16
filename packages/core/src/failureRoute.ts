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

export type FailureCategory = 'execution' | 'http' | 'output';
