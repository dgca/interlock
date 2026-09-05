import {
  definitionSchema,
  validateDefinition,
  type WorkflowDefinition,
} from '@interlock/core';

type RawDefinition =
  | { definition: WorkflowDefinition; error?: never; publishError?: string }
  | { definition?: never; error: string; publishError?: never };

// Zod strips unknown fields by default. In a raw editor, report them instead
// of silently dropping something the user typed when saving or formatting.
function unknownFields(input: unknown, parsed: unknown, path = ''): string[] {
  if (
    !input ||
    typeof input !== 'object' ||
    !parsed ||
    typeof parsed !== 'object'
  )
    return [];
  return Object.entries(input).flatMap(([key, value]) => {
    const field = path ? `${path}.${key}` : key;
    return Object.hasOwn(parsed, key)
      ? unknownFields(value, (parsed as Record<string, unknown>)[key], field)
      : [`${field}: Unknown field`];
  });
}

export function parseRawDefinition(text: string): RawDefinition {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (error) {
    return { error: (error as Error).message };
  }
  const parsed = definitionSchema.strict().safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues
        .map(
          (issue) =>
            `${issue.path.join('.') || 'definition'}: ${issue.message}`,
        )
        .join('\n'),
    };
  }
  const unknown = unknownFields(input, parsed.data);
  if (unknown.length) return { error: unknown.join('\n') };
  try {
    validateDefinition(parsed.data);
    return { definition: parsed.data };
  } catch (error) {
    return { definition: parsed.data, publishError: (error as Error).message };
  }
}
