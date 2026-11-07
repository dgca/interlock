import { runTagsSchema } from './runTags.js';
import { z } from 'zod';
import type { ExternalTask } from './runStarts.js';
import type { RunWaiting } from './runProjection.js';

export const lifecycleEventKindSchema = z.enum([
  'completed',
  'failed',
  'cancelled',
  'needs_attention',
  'stalled',
]);
export type LifecycleEventKind = z.infer<typeof lifecycleEventKindSchema>;
export const eventScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('library') }).strict(),
  z
    .object({
      type: z.literal('workflow'),
      workflowId: z.string().min(1),
      includeChildren: z.boolean().default(false),
    })
    .strict(),
]);
export const eventWebhookActionSchema = z
  .object({
    type: z.literal('webhook'),
    url: z.string().url(),
    secretId: z.string().min(1).max(200).optional(),
    headers: z.record(z.string().min(1)).optional(),
    timeoutMs: z.number().int().min(500).max(60000).default(5000),
  })
  .strict();
export type EventWebhookAction = z.infer<typeof eventWebhookActionSchema>;
export const eventWorkflowActionSchema = z
  .object({
    type: z.literal('workflow'),
  })
  .strict();
export type EventWorkflowAction = z.infer<typeof eventWorkflowActionSchema>;
export const eventActionSchema = z.discriminatedUnion('type', [
  eventWorkflowActionSchema,
  eventWebhookActionSchema,
]);
export type EventAction = z.infer<typeof eventActionSchema>;
export const eventConfigSchema = z
  .object({
    kind: z.literal('event'),
    name: z.string().trim().min(1).max(120),
    tags: runTagsSchema.optional(),
    events: z.array(lifecycleEventKindSchema).min(1).max(5),
    scope: eventScopeSchema,
    action: eventActionSchema.optional(),
    exitNodeId: z.string().min(1).max(200).optional(),
    waitForQuiescence: z.boolean().default(false),
    maxTriggerDepth: z.number().int().min(1).max(20).default(2),
    pauseAfterConsecutiveFailures: z
      .number()
      .int()
      .min(1)
      .max(10000)
      .nullable()
      .default(null),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.events).size !== value.events.length)
      ctx.addIssue({
        code: 'custom',
        path: ['events'],
        message: 'Select each lifecycle event once',
      });
    if (value.exitNodeId && value.events.some((event) => event !== 'completed'))
      ctx.addIssue({
        code: 'custom',
        path: ['exitNodeId'],
        message: 'Exit node filters require completed events only',
      });
    if (
      value.waitForQuiescence &&
      value.events.some(
        (event) => !['completed', 'failed', 'cancelled'].includes(event),
      )
    )
      ctx.addIssue({
        code: 'custom',
        path: ['waitForQuiescence'],
        message: 'Quiescence requires terminal events only',
      });
  });
export type EventConfig = z.infer<typeof eventConfigSchema>;

/** Lifecycle context only. Workflow data and outputs are never included. */
export interface EventPayload {
  eventId: string;
  type: LifecycleEventKind;
  occurredAt: string;
  runId: string;
  workflowId: string;
  version: number;
  externalTask?: ExternalTask;
  tags?: import('./runTags.js').RunTags;
  stage?: string | null;
  waiting?: RunWaiting | null;
  failingNode?: { id: string; label: string };
  error?: string;
}
export interface EventDelivery {
  id: string;
  eventId: string;
  triggerId: string;
  /** Target workflow identity. */
  workflowId: string;
  sourceRunId: string;
  occurredAt: string;
  createdAt: string;
  outcome:
    | 'pending_quiescence'
    | 'pending_pause'
    | 'started'
    | 'queued'
    | 'suppressed'
    | 'failed'
    | 'delivered';
  reason?: string;
  runId?: string;
  settled?: boolean;
  runStatus?: string;
  version?: number;
  error?: string;
  /** Retained only while dispatch is pending. */
  payload?: EventPayload;
  triggerChain?: string[];
}
