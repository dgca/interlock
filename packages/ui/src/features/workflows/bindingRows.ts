import type { ValueBinding } from '@interlock/core';
export type BindingRow = {
  name: string;
  keys: string[];
  binding: ValueBinding;
  originalLiteralPath?: { name: string; keys: string[] };
};
export function bindingRows(
  fields: Record<string, ValueBinding> = {},
  prefix: string[] = [],
): BindingRow[] {
  return Object.entries(fields).flatMap(([key, binding]) => {
    const keys = [...prefix, key];
    return binding.source === 'object' && Object.keys(binding.fields).length
      ? bindingRows(binding.fields, keys)
      : [
          {
            name: keys.join('.'),
            keys,
            binding,
            ...(keys.some((key) => key.includes('.'))
              ? { originalLiteralPath: { name: keys.join('.'), keys } }
              : {}),
          },
        ];
  });
}
export function bindingRowError(row: BindingRow, rows: BindingRow[]): string {
  if (row.keys.some((key) => !key))
    return 'Enter a field name. Use dots between nested fields.';
  if (row.keys.length > 11) return 'Use at most 10 nested objects.';
  const conflict = rows.find(
    (other) =>
      other !== row &&
      other.keys
        .slice(0, Math.min(other.keys.length, row.keys.length))
        .every((key, i) => key === row.keys[i]),
  );
  return conflict
    ? JSON.stringify(conflict.keys) === JSON.stringify(row.keys)
      ? 'Each field needs a unique name.'
      : 'A field cannot also contain mapped fields.'
    : '';
}
export function bindingsFromRows(
  rows: BindingRow[],
): Record<string, ValueBinding> {
  type Tree = Map<string, { binding?: ValueBinding; fields: Tree }>;
  const root: Tree = new Map();
  for (const row of rows) {
    if (bindingRowError(row, rows)) throw new Error(bindingRowError(row, rows));
    let tree = root;
    row.keys.forEach((key, index) => {
      if (!tree.has(key)) tree.set(key, { fields: new Map() });
      const current = tree.get(key)!;
      if (index === row.keys.length - 1) current.binding = row.binding;
      tree = current.fields;
    });
  }
  const build = (tree: Tree): Record<string, ValueBinding> =>
    Object.fromEntries(
      [...tree].map(([key, item]) => [
        key,
        item.binding ?? { source: 'object', fields: build(item.fields) },
      ]),
    );
  return build(root);
}

export function renameBindingRow(row: BindingRow, name: string): BindingRow {
  return {
    ...row,
    name,
    keys:
      name === row.originalLiteralPath?.name
        ? row.originalLiteralPath.keys
        : name.split('.'),
  };
}
