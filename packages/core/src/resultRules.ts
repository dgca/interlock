import { z } from 'zod';
import { structuralEqual } from './jsonEquality.js';
import { readPath, type Json } from './index.js';

const segments = (path: string) =>
  !path || path === '$' ? [] : path.replace(/^\$\./, '').split('.');
const dataPath = z
  .string()
  .max(256)
  .refine(
    (path) =>
      segments(path).every(
        (key) => !['__proto__', 'prototype', 'constructor'].includes(key),
      ),
    'Invalid data path',
  );
const fields = { id: z.string().trim().min(1).max(64), outputPath: dataPath };
export const resultRulesSchema = z
  .array(
    z.discriminatedUnion('kind', [
      z.object({ ...fields, kind: z.literal('exists') }).strict(),
      z
        .object({
          ...fields,
          kind: z.literal('equalsInput'),
          inputPath: dataPath,
        })
        .strict(),
    ]),
  )
  .max(32)
  .describe(
    'Optional Agent acceptance checks: exists requires outputPath; equalsInput requires outputPath and inputPath in captured resolved input. Dot paths, blank/$ selects root. Missing values fail; null exists; equality is structural without coercion. Max 32 rules.',
  );
export type ResultRule = z.infer<typeof resultRulesSchema>[number];

/** Reject only paths excluded by the supported, closed contract subset. */
function excludesPath(schema: Record<string, unknown>, path: string): boolean {
  let current: unknown = schema;
  for (const key of segments(path)) {
    if (!current || typeof current !== 'object' || Array.isArray(current))
      return false;
    const s = current as Record<string, any>;
    if (
      [
        '$ref',
        'allOf',
        'anyOf',
        'oneOf',
        'not',
        'if',
        'patternProperties',
      ].some((k) => k in s)
    )
      return false;
    if (s.type === 'object') {
      if (s.properties && Object.hasOwn(s.properties, key))
        current = s.properties[key];
      else if (s.additionalProperties === false) return true;
      else current = s.additionalProperties;
    } else if (s.type === 'array') {
      if (!/^(0|[1-9]\d*)$/.test(key)) return true;
      if (typeof s.maxItems === 'number' && Number(key) >= s.maxItems)
        return true;
      if (Array.isArray(s.items)) {
        const i = Number(key);
        if (i >= s.items.length && s.additionalItems === false) return true;
        current = s.items[i] ?? s.additionalItems;
      } else current = s.items;
    } else if (typeof s.type === 'string') return true;
    else return false;
  }
  return false;
}
export function resultRuleProblems(
  rules: ResultRule[] = [],
  input: Record<string, unknown>,
  output: Record<string, unknown>,
) {
  const seen = new Set<string>();
  return rules.flatMap((rule) => {
    const errors: string[] = [];
    if (seen.has(rule.id)) errors.push('Result rule IDs must be unique');
    seen.add(rule.id);
    if (excludesPath(output, rule.outputPath))
      errors.push(
        `Result rule ${rule.id}: output contract excludes path "${rule.outputPath}"`,
      );
    if (rule.kind === 'equalsInput' && excludesPath(input, rule.inputPath))
      errors.push(
        `Result rule ${rule.id}: input contract excludes path "${rule.inputPath}"`,
      );
    return errors;
  });
}
export function checkResultRules(
  rules: ResultRule[] = [],
  input: Json,
  output: Json,
) {
  return rules.flatMap((rule, index) => {
    let valid = false;
    try {
      const value = readPath(output, rule.outputPath);
      valid =
        rule.kind === 'exists' ||
        structuralEqual(value, readPath(input, rule.inputPath));
    } catch {
      /* Missing paths fail, including when both sides are missing. */
    }
    if (valid) return [];
    const path = segments(rule.outputPath)
      .map((key) => '/' + key.replaceAll('~', '~0').replaceAll('/', '~1'))
      .join('');
    return [
      {
        path: path.slice(0, 256),
        schemaPath: `/resultRules/${index}`,
        rule: rule.kind,
        ruleId: rule.id,
        ...(rule.kind === 'equalsInput' ? { inputPath: rule.inputPath } : {}),
        message:
          rule.kind === 'exists'
            ? 'Add the required output path.'
            : 'Match this output path to the captured input path; both must exist.',
        pathTruncated: path.length > 256,
      },
    ];
  });
}
