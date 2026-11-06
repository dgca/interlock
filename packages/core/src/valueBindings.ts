import {
  InterlockError,
  readPath,
  type Json,
  type ValueBinding,
} from './index.js';

export type PathBinding = Exclude<
  ValueBinding,
  { source: 'literal' | 'object' }
>;
export function bindingLeaves(
  fields: Record<string, ValueBinding>,
  depth = 0,
): PathBinding[] {
  if (depth > 10)
    throw new InterlockError('Bindings support at most 10 nested objects');
  return Object.values(fields).flatMap((b) =>
    b.source === 'object'
      ? bindingLeaves(b.fields, depth + 1)
      : b.source === 'literal'
        ? []
        : [b],
  );
}
export function resolveBindingFields(
  fields: Record<string, ValueBinding>,
  source: (binding: PathBinding) => Json | undefined,
  depth = 0,
): Record<string, Json> {
  if (depth > 10)
    throw new InterlockError('Bindings support at most 10 nested objects');
  return Object.fromEntries(
    Object.entries(fields).map(([key, b]) => {
      if (b.source === 'literal') return [key, b.value];
      if (b.source === 'object')
        return [key, resolveBindingFields(b.fields, source, depth + 1)];
      const value = source(b);
      if (value === undefined) {
        if (b.source !== 'node')
          throw new InterlockError(
            `Binding source "${b.source}" is unavailable`,
          );
        if (b.sourceDefault !== undefined) return [key, b.sourceDefault];
        throw new InterlockError(
          `Node "${b.nodeId}" has no completed output in this run`,
        );
      }
      try {
        return [key, readPath(value, b.path)];
      } catch (error) {
        if (
          error instanceof InterlockError &&
          error.message.startsWith('Input has no path') &&
          Object.hasOwn(b, 'default') &&
          b.default !== undefined
        )
          return [key, b.default!];
        throw error;
      }
    }),
  );
}

/** Includes object containers so diagnostics can point at invalid authoring targets. */
export function bindingEntries(
  fields: Record<string, ValueBinding>,
  prefix = '',
): Array<[string, ValueBinding]> {
  return Object.entries(fields).flatMap(
    ([key, binding]): Array<[string, ValueBinding]> => {
      const field = prefix ? `${prefix}.fields.${key}` : key;
      return [
        [field, binding],
        ...(binding.source === 'object'
          ? bindingEntries(binding.fields, field)
          : []),
      ];
    },
  );
}
export function literalContract(value: Json): Record<string, unknown> {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) return { type: 'array', items: {} };
  if (typeof value !== 'object')
    return {
      type:
        typeof value === 'number' && Number.isInteger(value)
          ? 'integer'
          : typeof value,
    };
  return {
    type: 'object',
    properties: Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, literalContract(v)]),
    ),
    required: Object.keys(value),
    additionalProperties: false,
  };
}
export function bindingContract(
  binding: ValueBinding,
  pathContract: (binding: PathBinding) => Record<string, unknown>,
): Record<string, unknown> {
  if (binding.source === 'literal') return literalContract(binding.value);
  if (binding.source === 'object')
    return bindingsContract(binding.fields, pathContract);
  const selected = pathContract(binding);
  if (!Object.keys(selected).length) return selected;
  const contracts = [selected];
  for (const value of [
    binding.default,
    binding.source === 'node' ? binding.sourceDefault : undefined,
  ]) {
    if (value === undefined) continue;
    const fallback = literalContract(value);
    if (
      !contracts.some(
        (schema) => JSON.stringify(schema) === JSON.stringify(fallback),
      )
    )
      contracts.push(fallback);
  }
  return contracts.length === 1 ? selected : { anyOf: contracts };
}
export function bindingsContract(
  fields: Record<string, ValueBinding>,
  pathContract: (binding: PathBinding) => Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: 'object',
    properties: Object.fromEntries(
      Object.entries(fields).map(([key, b]) => [
        key,
        bindingContract(b, pathContract),
      ]),
    ),
    required: Object.keys(fields),
    additionalProperties: false,
  };
}
