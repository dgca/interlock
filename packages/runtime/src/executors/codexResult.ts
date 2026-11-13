import { jsonSchema, type WorkRequest } from '@interlock/core';
import { HarnessResultError, resultEnvelope } from './contracts.js';

// Keep unsupported contracts intact. A JSON string transport avoids inventing
// a different contract (for example, turning optional properties into required ones).
function supports(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema))
    return false;
  const s = schema as Record<string, unknown>;
  if (
    Object.keys(s).some(
      (k) =>
        ![
          'type',
          'properties',
          'required',
          'additionalProperties',
          'items',
          'enum',
          'description',
          'title',
          'anyOf',
          'minLength',
          'maxLength',
          'minimum',
          'maximum',
          'exclusiveMinimum',
          'exclusiveMaximum',
          'multipleOf',
          'minItems',
          'maxItems',
        ].includes(k),
    )
  )
    return false;
  if (Array.isArray(s.anyOf))
    return (
      Object.keys(s).every((k) =>
        ['anyOf', 'description', 'title'].includes(k),
      ) &&
      s.anyOf.length > 0 &&
      s.anyOf.every(supports)
    );
  const types = Array.isArray(s.type) ? s.type : [s.type];
  if (Array.isArray(s.type) && (types.length !== 2 || !types.includes('null')))
    return false;
  if (
    types.some(
      (t) =>
        ![
          'object',
          'array',
          'string',
          'number',
          'integer',
          'boolean',
          'null',
        ].includes(t as string),
    )
  )
    return false;
  if (types.includes('object')) {
    if (
      s.additionalProperties !== false ||
      !s.properties ||
      typeof s.properties !== 'object'
    )
      return false;
    const keys = Object.keys(s.properties);
    if (
      !Array.isArray(s.required) ||
      s.required.length !== keys.length ||
      keys.some((k) => !(s.required as unknown[]).includes(k))
    )
      return false;
    if (!Object.values(s.properties).every(supports)) return false;
  }
  return !types.includes('array') || supports(s.items);
}

function decodeResultString(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    // Recover a complete object or array followed by short prose. Parsing the
    // prefix still rejects truncation, changed delimiters, and extra JSON values.
    const trailingProse =
      /^([\s\S]*[}\]])\s+([A-Za-z][A-Za-z0-9 \t\r\n.,!?'-]{0,255})$/u.exec(
        value.trimEnd(),
      );
    if (
      trailingProse &&
      !/^(true|false|null)(?:\s|$)/u.test(trailingProse[2])
    ) {
      try {
        return JSON.parse(trailingProse[1]);
      } catch {
        // Report the same error for an invalid prefix.
      }
    }
    throw new HarnessResultError('Codex returned invalid encoded result JSON');
  }
}

export function codexResult(work: WorkRequest) {
  const encoded = !supports(work.outputSchema);
  return {
    schema: encoded
      ? {
          type: 'object',
          properties: { result: { type: 'string' } },
          required: ['result'],
          additionalProperties: false,
        }
      : resultEnvelope(work),
    instructions: encoded
      ? 'Return a JSON object with one field, result, containing a JSON-encoded string of your assignment result. Decode that string to obtain the value matching this original JSON Schema:\n' +
        JSON.stringify(work.outputSchema) +
        '\nInterlock validates the decoded value against this complete contract. The host owns claim, renewal and submission; do not claim or submit this assignment yourself.'
      : undefined,
    decode(value: unknown) {
      if (encoded) {
        if (typeof value !== 'string')
          throw new HarnessResultError(
            'Codex must encode the assignment result as a JSON string',
          );
        value = decodeResultString(value);
      }
      return jsonSchema.parse(value);
    },
  };
}
