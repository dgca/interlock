import { z } from 'zod';

export const draftLayoutSchema = z
  .enum(['tidy', 'preserve'])
  .describe(
    'Presentation layout: tidy runs full-workflow Dagre with Batch scopes and port ordering; preserve keeps saved positions for existing nodes and seeds new nodes from the supplied draft. Updates require current draftRevision, even without a replacement draft. Layout-only changes do not advance it or publish. Omit to accept supplied positions. No server ELK or preview.',
  );
export type DraftLayout = z.infer<typeof draftLayoutSchema>;
