import { z } from 'zod';

/** Omission keeps the full server environment, as before modes existed. */
export const environmentModeSchema = z
  .enum(['inherit', 'minimal'])
  .describe(
    'Omitted/inherit: full server environment. minimal: only PATH, HOME, LANG, LANGUAGE, LC_*, INTERLOCK_*, configured values and environmentPassthrough.',
  );
export type EnvironmentMode = z.infer<typeof environmentModeSchema>;
export const environmentPassthroughSchema = z
  .array(z.string().max(120))
  .max(64)
  .describe('Server variable names added in minimal mode.');
