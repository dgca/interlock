/** A conservative visual subset. Unknown schema features are never discarded. */
export type Contract = Record<string, unknown>;
export type FieldType =
  | 'any'
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'choice'
  | 'object'
  | 'array'
  | 'null';
export const fieldTypes: Record<FieldType, string> = {
  any: 'Any',
  string: 'Text',
  number: 'Number',
  integer: 'Whole number',
  boolean: 'Boolean',
  choice: 'Choice',
  object: 'Object',
  array: 'List',
  null: 'Null',
};
export function fieldType(schema: Contract): FieldType {
  if (Array.isArray(schema.enum)) return 'choice';
  return typeof schema.type === 'string' &&
    Object.hasOwn(fieldTypes, schema.type)
    ? (schema.type as FieldType)
    : 'any';
}
export function newContract(type: FieldType): Contract {
  if (type === 'any') return {};
  if (type === 'choice') return { type: 'string', enum: ['known', 'unknown'] };
  if (type === 'object') return { type: 'object', properties: {} };
  if (type === 'array') return { type: 'array', items: { type: 'string' } };
  return { type };
}
export function propertiesOf(schema: Contract): Record<string, Contract> {
  return (schema.properties ?? {}) as Record<string, Contract>;
}
export function requiredOf(schema: Contract): string[] {
  return (schema.required ?? []) as string[];
}
export function visualIssues(
  schema: unknown,
  path = 'Value',
  depth = 0,
): string[] {
  if (depth > 12)
    return [`${path}: nesting exceeds the visual editor's 12-level limit.`];
  if (!schema || typeof schema !== 'object' || Array.isArray(schema))
    return [`${path}: this schema needs the advanced editor.`];
  const s = schema as Contract,
    type = fieldType(s);
  const allowed = ['title', 'description', 'type'];
  if (type === 'object')
    allowed.push('properties', 'required', 'additionalProperties');
  if (type === 'array') allowed.push('items', 'minItems', 'maxItems');
  if (type === 'string' || type === 'choice')
    allowed.push('minLength', 'maxLength');
  if (type === 'number' || type === 'integer')
    allowed.push('minimum', 'maximum');
  if (type === 'choice') allowed.push('enum');
  const issues = Object.keys(s)
    .filter((k) => !allowed.includes(k))
    .map((k) => `${path}: “${k}” needs the advanced editor.`);
  if (
    s.type !== undefined &&
    (typeof s.type !== 'string' ||
      !Object.hasOwn(fieldTypes, s.type) ||
      s.type === 'any' ||
      s.type === 'choice')
  )
    issues.push(`${path}: this type needs the advanced editor.`);
  for (const key of ['title', 'description'])
    if (s[key] !== undefined && typeof s[key] !== 'string')
      issues.push(`${path}: ${key} must be text.`);
  for (const key of [
    'minItems',
    'maxItems',
    'minLength',
    'maxLength',
    'minimum',
    'maximum',
  ])
    if (
      s[key] !== undefined &&
      (typeof s[key] !== 'number' || !Number.isFinite(s[key]))
    )
      issues.push(`${path}: ${key} must be a number.`);
  if (
    type === 'choice' &&
    (s.type !== 'string' ||
      !(s.enum as unknown[]).length ||
      (s.enum as unknown[]).some((v) => typeof v !== 'string'))
  )
    issues.push(`${path}: only text choices are visually editable.`);
  if (type === 'object') {
    if (
      s.additionalProperties !== undefined &&
      typeof s.additionalProperties !== 'boolean'
    )
      issues.push(
        `${path}: additional-property schemas need the advanced editor.`,
      );
    if (
      s.properties !== undefined &&
      (!s.properties ||
        typeof s.properties !== 'object' ||
        Array.isArray(s.properties))
    )
      issues.push(`${path}: invalid properties.`);
    else {
      const props = propertiesOf(s);
      if (
        s.required !== undefined &&
        (!Array.isArray(s.required) ||
          s.required.some(
            (key) => typeof key !== 'string' || !Object.hasOwn(props, key),
          ))
      )
        issues.push(`${path}: required keys must refer to declared fields.`);
      for (const [key, value] of Object.entries(props))
        issues.push(...visualIssues(value, `${path}.${key}`, depth + 1));
    }
  }
  if (type === 'array' && s.items !== undefined)
    issues.push(...visualIssues(s.items, `${path} items`, depth + 1));
  return issues;
}
export function renameField(
  schema: Contract,
  oldKey: string,
  key: string,
): Contract {
  const props = propertiesOf(schema);
  if (!key.trim()) throw new Error('A data key cannot be empty.');
  if (key !== oldKey && Object.hasOwn(props, key))
    throw new Error(`The data key "${key}" already exists.`);
  return {
    ...schema,
    properties: Object.fromEntries(
      Object.entries(props).map(([k, v]) => [k === oldKey ? key : k, v]),
    ),
    ...(schema.required
      ? { required: requiredOf(schema).map((k) => (k === oldKey ? key : k)) }
      : {}),
  };
}
export function inferContract(value: unknown): {
  schema: Contract;
  notes: string[];
} {
  const notes = new Set<string>([
    'Fields present in every supplied example are marked required. Review which fields may be absent.',
  ]);
  function infer(values: unknown[], path: string, depth: number): Contract {
    if (depth > 12) throw new Error('Example nesting exceeds 12 levels.');
    if (!values.length) {
      notes.add(
        `${path}: an empty list does not reveal its item type. Choose one before using the contract.`,
      );
      return {};
    }
    const types = [
      ...new Set(
        values.map((v) =>
          v === null
            ? 'null'
            : Array.isArray(v)
              ? 'array'
              : typeof v === 'object'
                ? 'object'
                : typeof v,
        ),
      ),
    ];
    if (types.length > 1) {
      notes.add(
        `${path}: mixed types were preserved as alternatives in the advanced editor.`,
      );
      return {
        anyOf: types.map((t) =>
          infer(
            values.filter(
              (v) =>
                (v === null
                  ? 'null'
                  : Array.isArray(v)
                    ? 'array'
                    : typeof v === 'object'
                      ? 'object'
                      : typeof v) === t,
            ),
            path,
            depth + 1,
          ),
        ),
      };
    }
    const type = types[0];
    if (type === 'object') {
      const objects = values as Record<string, unknown>[],
        keys = [...new Set(objects.flatMap(Object.keys))];
      return {
        type: 'object',
        properties: Object.fromEntries(
          keys.map((key) => [
            key,
            infer(
              objects.filter((v) => Object.hasOwn(v, key)).map((v) => v[key]),
              `${path}.${key}`,
              depth + 1,
            ),
          ]),
        ),
        required: keys.filter((key) =>
          objects.every((v) => Object.hasOwn(v, key)),
        ),
      };
    }
    if (type === 'array')
      return {
        type: 'array',
        items: infer(
          (values as unknown[][]).flat(),
          `${path} items`,
          depth + 1,
        ),
      };
    if (type === 'null')
      notes.add(
        `${path}: null does not reveal a non-null type. Review whether this field should allow another value.`,
      );
    return {
      type:
        type === 'number' && values.every(Number.isInteger) ? 'integer' : type,
    };
  }
  return { schema: infer([value], 'Value', 0), notes: [...notes] };
}
export function contractExample(schema: Contract, depth = 0): unknown {
  if (depth > 12) return null;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  switch (fieldType(schema)) {
    case 'string':
      return 'Example text'
        .padEnd(Math.min(Number(schema.minLength ?? 0), 200), 'x')
        .slice(0, Number(schema.maxLength ?? 200));
    case 'number':
    case 'integer':
      return typeof schema.minimum === 'number'
        ? schema.minimum
        : typeof schema.maximum === 'number'
          ? Math.min(0, schema.maximum)
          : 0;
    case 'boolean':
      return true;
    case 'null':
    case 'any':
      return null;
    case 'array':
      return Array.from(
        {
          length: Math.min(
            3,
            Number(schema.maxItems) === 0
              ? 0
              : Math.max(1, Number(schema.minItems ?? 1)),
          ),
        },
        () => contractExample((schema.items ?? {}) as Contract, depth + 1),
      );
    case 'object':
      return Object.fromEntries(
        Object.entries(propertiesOf(schema)).map(([key, value]) => [
          key,
          contractExample(value, depth + 1),
        ]),
      );
  }
}
