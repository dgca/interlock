import { z } from 'zod';

export const transcriptLimits = {
  entryBytes: 32 * 1024,
  executionEntries: 2000,
  executionBytes: 10 * 1024 * 1024,
  totalBytes: 256 * 1024 * 1024,
  ageMs: 14 * 86_400_000,
  pageBytes: 256 * 1024,
  messageCount: 100,
  walBytes: 16 * 1024 * 1024,
} as const;

export type TranscriptKind =
  'user' | 'assistant' | 'tool_call' | 'tool_result' | 'operator' | 'status';
export interface TranscriptEvent {
  kind: TranscriptKind;
  text: string;
  key?: string;
  tool?: string;
  callId?: string;
}
export interface TranscriptEntry extends TranscriptEvent {
  sequence: number;
  at: string;
  truncated?: boolean;
  originalBytes?: number;
}
export interface MessageReceipt {
  requestId: string;
  executionId: string;
  status: 'pending' | 'accepted' | 'failed' | 'unknown';
  source: 'ui' | 'cli' | 'mcp';
  operator: string;
  at: string;
  updatedAt: string;
  reason?: string;
}
export const transcriptQueryBaseSchema = z
  .object({
    executionId: z.string().min(1).max(200),
    before: z.number().int().positive().optional(),
    after: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export const transcriptQuerySchema = transcriptQueryBaseSchema.refine(
  (q) => q.before === undefined || q.after === undefined,
  'Choose before or after, not both',
);
export const executorMessageSchema = z
  .object({
    executionId: z.string().min(1).max(200),
    requestId: z.string().min(1).max(100),
    message: z
      .string()
      .min(1)
      .max(4000)
      .refine((s) => s.trim().length > 0, 'Message is empty'),
    source: z.enum(['ui', 'cli', 'mcp']).default('mcp'),
    operator: z.string().min(1).max(80).default('local-user'),
  })
  .strict();
export const messageReceiptQuerySchema = z
  .object({
    executionId: z.string().min(1).max(200),
    requestId: z.string().min(1).max(100),
  })
  .strict();
export type TranscriptQuery = z.infer<typeof transcriptQuerySchema>;
export type ExecutorMessage = z.infer<typeof executorMessageSchema>;
export interface TranscriptPage {
  items: TranscriptEntry[];
  retainedBytes: number;
  retainedEntries: number;
  /** Lower bound: journal-pressure omissions share one durable marker. */
  omitted: number;
  gap: boolean;
  reason?: string;
  older: number | null;
  newer: number | null;
  limits: typeof transcriptLimits;
  capability: 'conversation' | 'partial' | 'unavailable';
  messageAvailable: boolean;
  messageReason?: string;
}
