import { z } from 'zod';
import { CronExpressionParser } from 'cron-parser';
import { jsonSchema, type Json } from './index.js';

export const scheduleTimingSchema = z
  .discriminatedUnion('type', [
    z
      .object({
        type: z.literal('interval'),
        intervalMs: z.number().int().min(30_000).max(31_536_000_000),
      })
      .strict(),
    z
      .object({
        type: z.literal('cron'),
        expression: z.string().trim().min(1).max(200),
        timeZone: z.string().trim().min(1).max(100),
      })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    if (value.type !== 'cron') return;
    let validZone = true;
    try {
      if (/^[+-]/.test(value.timeZone))
        throw new Error('Use an IANA time zone, not a fixed offset');
      new Intl.DateTimeFormat('en', { timeZone: value.timeZone });
    } catch (error) {
      validZone = false;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['timeZone'],
        message:
          error instanceof Error ? error.message : 'Invalid IANA time zone',
      });
    }
    try {
      if (
        value.expression.split(/\s+/).length !== 5 ||
        /\bH\b|@/i.test(value.expression)
      )
        throw new Error(
          'Use exactly five cron fields without macros or hashed jitter',
        );
      CronExpressionParser.parse(value.expression, {
        tz: validZone ? value.timeZone : 'UTC',
        currentDate: '2026-01-01T00:00:00Z',
      }).next();
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expression'],
        message:
          error instanceof Error ? error.message : 'Invalid cron expression',
      });
    }
  });
export type ScheduleTiming = z.infer<typeof scheduleTimingSchema>;
export const scheduleBindingsSchema = z
  .object({
    scheduledAt: z.string().optional(),
    firedAt: z.string().optional(),
    triggerId: z.string().optional(),
    previousRunId: z.string().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const paths = Object.values(value).filter(
      (p): p is string => p !== undefined,
    );
    for (const path of paths) {
      if (
        path.length > 300 ||
        !/^[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*)*$/.test(path) ||
        path
          .split('.')
          .some((p) => ['__proto__', 'prototype', 'constructor'].includes(p))
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Binding paths use dot-separated object keys without prototype keys',
        });
    }
    if (
      paths.some((p, i) =>
        paths.some((q, j) => i !== j && (p === q || p.startsWith(q + '.'))),
      )
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Binding paths must not overlap',
      });
  });
export const scheduleConfigSchema = z
  .object({
    kind: z.literal('schedule').default('schedule'),
    name: z.string().trim().min(1).max(120),
    timing: scheduleTimingSchema,
    input: z.lazy(() => jsonSchema).default({}),
    bindings: scheduleBindingsSchema.default({}),
    overlapPolicy: z.enum(['skip', 'queue', 'allow']).default('skip'),
    missedFirePolicy: z.enum(['skip', 'run_once']).default('skip'),
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
    if (
      new TextEncoder().encode(JSON.stringify(value.input)).byteLength > 65536
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Schedule input exceeds 64 KiB',
      });
    if (
      Object.keys(value.bindings).length &&
      (value.input === null ||
        typeof value.input !== 'object' ||
        Array.isArray(value.input))
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Bindings require an object input template',
      });
  });
export type ScheduleConfig = z.infer<typeof scheduleConfigSchema>;
export const scheduleReadSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('list'),
      workflowId: z.string().min(1).optional(),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(20),
    })
    .strict(),
  z
    .object({
      action: z.literal('inspect'),
      id: z.string().min(1),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(20),
    })
    .strict(),
  z
    .object({ action: z.literal('preview'), timing: scheduleTimingSchema })
    .strict(),
  z
    .object({
      action: z.literal('attention'),
      workflowId: z.string().min(1).optional(),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(20),
    })
    .strict(),
]);
export const scheduleMutationSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('create'),
      workflowId: z.string().min(1),
      config: scheduleConfigSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('update'),
      id: z.string().min(1),
      expectedRevision: z.number().int().positive(),
      config: scheduleConfigSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('enable'),
      id: z.string().min(1),
      expectedRevision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      action: z.literal('disable'),
      id: z.string().min(1),
      expectedRevision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      action: z.literal('delete'),
      id: z.string().min(1),
      expectedRevision: z.number().int().positive(),
    })
    .strict(),
]);
export type ScheduleRead = z.input<typeof scheduleReadSchema>;
export type ScheduleMutation = z.input<typeof scheduleMutationSchema>;
export interface WorkflowTrigger extends ScheduleConfig {
  id: string;
  workflowId: string;
  revision: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  anchorAt: string;
  nextFireAt: string;
  lastFireAt?: string;
  previousRunId?: string;
  consecutiveFailures: number;
  autoPaused?: { at: string; reason: string };
  lastLagMs?: number;
  lastCheckedAt?: string;
}
export interface ScheduleFire {
  id: string;
  triggerId: string;
  workflowId: string;
  scheduledAt: string;
  firedAt: string;
  outcome:
    'started' | 'queued' | 'skipped_overlap' | 'skipped_missed' | 'failed';
  runId?: string;
  version?: number;
  admittedAt?: string;
  lagMs?: number;
  error?: string;
  settled?: boolean;
  runStatus?: string;
}
export const SCHEDULE_LAG_THRESHOLD_MS = 60_000;
export function nextScheduleSlot(
  timing: ScheduleTiming,
  after: string,
  anchor = after,
): string {
  if (timing.type === 'interval') {
    const start = Date.parse(anchor),
      current = Date.parse(after);
    return new Date(
      start +
        Math.max(1, Math.floor((current - start) / timing.intervalMs) + 1) *
          timing.intervalMs,
    ).toISOString();
  }
  return CronExpressionParser.parse(timing.expression, {
    tz: timing.timeZone,
    currentDate: after,
  })
    .next()
    .toISOString()!;
}
export function latestScheduleSlot(
  timing: ScheduleTiming,
  at: string,
  anchor: string,
): string {
  if (timing.type === 'interval')
    return new Date(
      Date.parse(anchor) +
        Math.floor((Date.parse(at) - Date.parse(anchor)) / timing.intervalMs) *
          timing.intervalMs,
    ).toISOString();
  return CronExpressionParser.parse(timing.expression, {
    tz: timing.timeZone,
    currentDate: new Date(Date.parse(at) + 1),
  })
    .prev()
    .toISOString()!;
}
export function scheduleInput(
  config: ScheduleConfig,
  metadata: Record<keyof z.infer<typeof scheduleBindingsSchema>, Json>,
): Json {
  const result = structuredClone(config.input);
  for (const [key, path] of Object.entries(config.bindings)) {
    if (!path) continue;
    let target = result as Record<string, Json>;
    const parts = path.split('.');
    for (const part of parts.slice(0, -1)) {
      if (
        !target[part] ||
        typeof target[part] !== 'object' ||
        Array.isArray(target[part])
      )
        target[part] = {};
      target = target[part] as Record<string, Json>;
    }
    target[parts.at(-1)!] = metadata[key as keyof typeof metadata];
  }
  return result;
}

// Flatten discovery to avoid repeating the full config for create and update.
export const scheduleManageInputSchema = z
  .object({
    action: z.enum(['create', 'update', 'enable', 'disable', 'delete']),
    workflowId: z.string().min(1).optional().describe('Required for create.'),
    id: z
      .string()
      .min(1)
      .optional()
      .describe('Required except create; inspect the exact trigger first.'),
    expectedRevision: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Required except create; use current inspection revision.'),
    config: scheduleConfigSchema
      .optional()
      .describe('Required for create/update; replaces the full configuration.'),
  })
  .strict()
  .transform((value) => scheduleMutationSchema.parse(value));
