import { api } from '../../lib/api';

/** Both local files and pasted JSON use the same server operations and defaults. */
export async function importWorkflowJson(text: string): Promise<string> {
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
    const result = await api.workflows.import.mutate({ bundle: data });
    return result.rootId;
  }
  const workflow = await api.workflows.create.mutate(data);
  return workflow.id;
}
