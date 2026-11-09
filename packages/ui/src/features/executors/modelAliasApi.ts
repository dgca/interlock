import { api } from '../../lib/api';

export async function readModelAliases(
  options: { search?: string; offset?: number; limit?: number } = {},
) {
  const result = await api.modelAliases.read.query({
    action: 'list',
    ...options,
  });
  if (!('items' in result)) throw new Error('Could not read model aliases.');
  return result;
}

export async function readModelAlias(id: string) {
  const result = await api.modelAliases.read.query({ action: 'inspect', id });
  if ('items' in result) throw new Error('Could not read the model alias.');
  return result;
}

/** A model reference can be either a literal model or a saved alias identity. */
export async function resolveModelAlias(reference: string) {
  if (reference.length > 120) return null;
  try {
    return await readModelAlias(reference);
  } catch (error) {
    if (error instanceof Error && error.message.includes('does not exist'))
      return null;
    throw error;
  }
}
