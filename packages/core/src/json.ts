import { z } from 'zod';

export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonSchema),
    z.record(jsonSchema),
  ]),
);
// Authoring validators need the original keys for draft and contract diagnostics.
// A Zod record checks "__proto__" values but drops the key from its parsed copy.
export const authoringJsonSchema = z.custom<Json>(
  (value) => jsonSchema.safeParse(value).success,
  'Expected a JSON value',
);
