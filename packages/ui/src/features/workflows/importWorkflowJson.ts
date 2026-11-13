import { api } from '../../lib/api';
import type { BoardImportSetup, VariableImportBindings } from '@interlock/core';
import { assertLegacyVariableFree } from '@interlock/core/importDocument';

/** Both local files and pasted JSON use the same server operations and defaults. */
export async function importWorkflowJson(
  text: string,
  variableBindings?: VariableImportBindings,
  boardSetup?: BoardImportSetup,
): Promise<string> {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Enter valid JSON before importing.');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Expected a workflow object or a portable bundle.');
  }
  if (data.format === 'interlock-workflows') {
    const result = await api.workflows.import.mutate({
      bundle: data,
      ...(boardSetup ? { boardSetup } : {}),
      ...(variableBindings && Object.keys(variableBindings).length
        ? { variableBindings }
        : {}),
    });
    return result.rootId;
  }
  if (boardSetup)
    throw new Error('Board setup requires a portable workflow bundle.');
  assertLegacyVariableFree(data);
  const workflow = await api.workflows.create.mutate({
    ...data,
    imported: true,
  });
  return workflow.id;
}
