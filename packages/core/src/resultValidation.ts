import Ajv from 'ajv';
import { z } from 'zod';

const ajv = new Ajv({ allErrors: true, strict: false });
const clip = (value: string, max = 256) =>
  value.length > max ? value.slice(0, max) + '…' : value;
const escape = (value: string) =>
  value.replaceAll('~', '~0').replaceAll('/', '~1');
export const resultDiagnosticSchema = z.object({
  path: z.string().max(257),
  schemaPath: z.string().max(257),
  rule: z.string().max(65),
  message: z.string().max(256),
  pathTruncated: z.boolean(),
});
export type ResultDiagnostic = z.infer<typeof resultDiagnosticSchema>;
export function checkResultContract(
  schema: Record<string, unknown>,
  value: unknown,
) {
  const validate = ajv.compile(schema);
  validate(value);
  const errors = validate.errors ?? [];
  const items: ResultDiagnostic[] = errors.slice(0, 10).map((error) => {
    const property =
      error.keyword === 'required'
        ? error.params.missingProperty
        : error.keyword === 'additionalProperties'
          ? error.params.additionalProperty
          : undefined;
    const path =
      error.instancePath +
      (typeof property === 'string' ? '/' + escape(property) : '');
    const messages: Record<string, string> = {
      required: 'Add this required field.',
      additionalProperties: 'Remove this unexpected field.',
      type: `Use the required type: ${clip(String(error.params.type), 80)}.`,
      enum: 'Use one of the values allowed by the output contract.',
      const: 'Use the constant specified by the output contract.',
      minLength: 'Increase the text length to the contract minimum.',
      maxLength: 'Reduce the text length to the contract maximum.',
      minimum: 'Increase the number to the contract minimum.',
      maximum: 'Reduce the number to the contract maximum.',
      pattern: 'Match the pattern in the output contract.',
      minItems: 'Add items to meet the contract minimum.',
      maxItems: 'Remove items to meet the contract maximum.',
    };
    return {
      path: clip(path),
      schemaPath: clip(error.schemaPath),
      rule: clip(error.keyword, 64),
      message:
        messages[error.keyword] ??
        'Correct this value to satisfy the output contract rule.',
      pathTruncated: path.length > 256 || error.schemaPath.length > 256,
    };
  });
  return {
    items,
    total: errors.length,
    truncated: errors.length > items.length,
  };
}
export const resultCheckSchema = z.object({
  code: z.enum([
    'ready',
    'invalid_result',
    'already_accepted',
    'completed_conflict',
    'not_found',
    'invalid_claim',
    'replaced',
    'expired',
    'cancelled',
    'inactive',
  ]),
  accepted: z.literal(false),
  alreadyAccepted: z.boolean(),
  claimUsable: z.boolean(),
  canSubmit: z.boolean(),
  nextAction: z.enum([
    'submit',
    'correct_result',
    'inspect_work',
    'read_result',
  ]),
  diagnostics: z.object({
    items: z.array(resultDiagnosticSchema).max(10),
    total: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
});
export type ResultCheck = z.infer<typeof resultCheckSchema>;
