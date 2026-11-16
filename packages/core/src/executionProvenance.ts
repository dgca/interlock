import { z } from 'zod';
import { modelUsageSchema, type ModelUsage } from './usage.js';
export interface ExecutionProvenance {
  profileId: string | null;
  harness: string | null;
  sessionId: string | null;
  requestedModel: string | null;
  actualModel: string | null;
  provider: string | null;
  effort: string | null;
  attempt: number;
  visitCount: number;
  startedAt: string | null;
  endedAt: string | null;
  usage: ModelUsage[] | null;
}
export const executionProvenanceSchema = z.object({
  profileId: z.string().nullable(),
  harness: z.string().nullable(),
  sessionId: z.string().nullable(),
  requestedModel: z.string().nullable(),
  actualModel: z.string().nullable(),
  provider: z.string().nullable(),
  effort: z.string().nullable(),
  attempt: z.number().int().positive(),
  visitCount: z.number().int().positive(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  usage: z.array(modelUsageSchema).nullable(),
});
export const EXECUTION_PROVENANCE_CONTRACT = {
  type: 'object',
  properties: {
    profileId: { type: ['string', 'null'] },
    harness: { type: ['string', 'null'] },
    sessionId: { type: ['string', 'null'] },
    requestedModel: { type: ['string', 'null'] },
    actualModel: { type: ['string', 'null'] },
    provider: { type: ['string', 'null'] },
    effort: { type: ['string', 'null'] },
    attempt: { type: 'integer' },
    visitCount: { type: 'integer' },
    startedAt: { type: ['string', 'null'] },
    endedAt: { type: ['string', 'null'] },
    usage: { type: ['array', 'null'] },
  },
  required: ['attempt', 'visitCount'],
};
