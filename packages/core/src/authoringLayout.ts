import { z } from 'zod';

export const draftLayoutSchema = z
  .literal('tidy')
  .describe(
    'Optional full-workflow Dagre Tidy on this save. Only positions change, with Batch scopes and port ordering. Omit to preserve positions. Updates require current draftRevision even without a replacement draft. Prefer for new graphs or structural edits; no ELK, incremental placement, or preview.',
  );
export type DraftLayout = z.infer<typeof draftLayoutSchema>;
