/** Read-only procedures that accept individual POST requests for large inputs. */
export const largeQueryProcedures: readonly string[] = [
  'workflows.validate',
  'workflows.previewImport',
  'work.preflight',
  'work.size',
  'testbench.preview',
];
