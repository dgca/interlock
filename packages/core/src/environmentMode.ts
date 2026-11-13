import { z } from 'zod';

// Field guidance lives in the docs: these schemas repeat across MCP authoring
// tools, so they carry no descriptions and keep bounds out of JSON Schema.
/** Omission keeps the full server environment, as before modes existed. */
export const environmentModeSchema = z.enum(['inherit', 'minimal']);
export type EnvironmentMode = z.infer<typeof environmentModeSchema>;
/** Server variable names also passed in minimal mode. */
export const environmentPassthroughSchema = z
  .array(z.string())
  .refine(
    (names) => names.length <= 64 && names.every((name) => name.length <= 120),
    'Pass through at most 64 names of up to 120 characters.',
  );
