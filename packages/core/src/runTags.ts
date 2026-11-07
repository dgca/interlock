import { z } from 'zod';

// Keep own literal __proto__ keys, which Zod records otherwise discard. The
// intersection restores the original entries; validate the restored pair too.
export const runTagsSchema = z
  .record(z.string().min(1).max(64), z.string().max(64))
  .and(z.unknown())
  .superRefine((tags, ctx) => {
    if (Object.keys(tags).length > 16)
      ctx.addIssue({ code: 'custom', message: 'Use at most 16 tags' });
    if (Object.hasOwn(tags, '__proto__')) {
      const value = tags['__proto__'];
      if (typeof value !== 'string' || value.length > 64)
        ctx.addIssue({
          code: 'custom',
          path: ['__proto__'],
          message: 'Tag values must be strings of at most 64 characters',
        });
    }
  })
  .describe(
    'Non-secret exact, case-sensitive tags: max 16 pairs; keys 1..64 chars, values 0..64.',
  );
export type RunTags = z.infer<typeof runTagsSchema>;
