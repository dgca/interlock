import { z } from 'zod';

export interface BackgroundScript {
  state: 'launching' | 'running' | 'completed' | 'uncertain' | 'reconciled';
  deadline: string;
  supervisorPid?: number;
  supervisorStart?: string;
  progress?: string;
}
const target = { runId: z.string().min(1), executionId: z.string().min(1) };
export const scriptOperationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('inspect'), ...target }),
  z.object({ action: z.literal('stop'), ...target }),
  z.object({
    action: z.literal('reconcile'),
    ...target,
    stopped: z
      .literal(true)
      .describe(
        'Confirm the original supervisor and Script process group have stopped and external effects were inspected.',
      ),
    reason: z.string().trim().min(1).max(1000),
  }),
]);
export type ScriptOperation = z.infer<typeof scriptOperationSchema>;
