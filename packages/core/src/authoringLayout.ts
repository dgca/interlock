import { z } from 'zod';

export const draftLayoutSchema = z
  .enum(['tidy', 'preserve'])
  .describe(
    'tidy arranges groups and ports with Dagre. preserve keeps saved positions and uses supplied positions for new nodes. Omit to accept supplied positions. Updates require draftRevision; layout alone preserves it and never publishes.',
  );
export type DraftLayout = z.infer<typeof draftLayoutSchema>;
