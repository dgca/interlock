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

export async function readModelAlias(id: string, signal?: AbortSignal) {
  const result = await api.modelAliases.read.query(
    { action: 'inspect', id },
    { signal },
  );
  if ('items' in result) throw new Error('Could not read the model alias.');
  return result;
}

/** Inspect without treating a known missing preset as a literal model. */
export async function inspectModelReference(reference: string): Promise<{
  alias?: Awaited<ReturnType<typeof readModelAlias>>;
  missing?: boolean;
}> {
  if (reference.length > 120) return {};
  try {
    return { alias: await readModelAlias(reference) };
  } catch (error) {
    if (error instanceof Error && error.message.endsWith('does not exist.'))
      return {
        missing: error.message.endsWith(
          'is a known requirement but does not exist.',
        ),
      };
    throw error;
  }
}

export async function resolveModelAlias(reference: string) {
  return (await inspectModelReference(reference)).alias ?? null;
}
