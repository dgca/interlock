import { z } from 'zod';
import { jsonSchema, type Json } from './index.js';

const path = z
  .string()
  .max(300)
  .refine(
    (value) =>
      !value
        .split('.')
        .some((part) =>
          ['__proto__', 'prototype', 'constructor'].includes(part),
        ),
    'Prototype keys are not allowed',
  );
const header = z
  .string()
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/)
  .max(100)
  .transform((s) => s.toLowerCase());
export const webhookSourceSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('body'), path }).strict(),
  z.object({ source: z.literal('header'), path: header }).strict(),
]);
export const webhookBindingSchema = z.union([
  webhookSourceSchema,
  z
    .object({ source: z.literal('literal'), value: z.lazy(() => jsonSchema) })
    .strict(),
]);
const externalTask = z
  .object({
    system: webhookBindingSchema,
    id: webhookBindingSchema,
    title: webhookBindingSchema.optional(),
    url: webhookBindingSchema.optional(),
  })
  .strict();
const payload = {
  input: z.lazy(() => jsonSchema).default({}),
  bindings: z
    .record(
      path.refine(
        (value) => value.length > 0,
        'Destination paths cannot be empty',
      ),
      webhookBindingSchema,
    )
    .default({}),
};
const actionVariants = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('start'),
      ...payload,
      externalTask: externalTask.optional(),
      onActiveExternalTask: z
        .enum(['allow', 'reuse', 'reject', 'cancel_previous'])
        .default('allow'),
    })
    .strict(),
  z
    .object({
      type: z.literal('input'),
      ...payload,
      externalTask,
      nodeId: z.string().trim().min(1).max(200),
    })
    .strict(),
  z.object({ type: z.literal('cancel'), externalTask }).strict(),
  z.object({ type: z.literal('hold'), externalTask }).strict(),
]);
// Flat discovery avoids repeating bindings and external-task schemas for every action.
export const webhookActionSchema = z
  .object({
    type: z.enum(['start', 'input', 'cancel', 'hold']),
    input: z.lazy(() => jsonSchema).optional(),
    bindings: z
      .record(
        path.refine(
          (value) => value.length > 0,
          'Destination paths cannot be empty',
        ),
        webhookBindingSchema,
      )
      .optional(),
    externalTask: externalTask
      .optional()
      .describe('Required for input, cancel and hold.'),
    nodeId: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe('Required for input; exact waiting node ID.'),
    onActiveExternalTask: z
      .enum(['allow', 'reuse', 'reject', 'cancel_previous'])
      .optional(),
  })
  .strict()
  .transform((value, ctx) => {
    const parsed = actionVariants.safeParse(value);
    if (parsed.success) return parsed.data;
    for (const issue of parsed.error.issues) ctx.addIssue(issue);
    return z.NEVER;
  });
export const webhookConfigSchema = z
  .object({
    kind: z.literal('webhook'),
    name: z.string().trim().min(1).max(120),
    authentication: z
      .object({
        secretId: z.string().min(1).max(200),
        header,
        algorithm: z.enum(['sha256', 'sha512']).default('sha256'),
        prefix: z.string().max(100).default('sha256='),
        parts: z
          .array(
            z.union([
              z.object({ source: z.literal('body') }).strict(),
              z.object({ source: z.literal('header'), path: header }).strict(),
            ]),
          )
          .min(1)
          .max(10),
        separator: z.string().max(10).default('.'),
      })
      .strict(),
    deliveryId: webhookSourceSchema,
    timestamp: webhookSourceSchema,
    timestampFormat: z.enum(['iso', 'unix_seconds', 'unix_ms']).default('iso'),
    timestampWindowMs: z
      .number()
      .int()
      .min(1000)
      .max(86_400_000)
      .default(300_000),
    filters: z
      .array(
        z
          .object({
            ...{ value: webhookSourceSchema },
            equals: z.lazy(() => jsonSchema),
          })
          .strict(),
      )
      .max(32)
      .default([]),
    action: webhookActionSchema,
    maxBodyBytes: z.number().int().min(1).max(1_048_576).default(65_536),
    rateLimit: z
      .object({
        maxRequests: z.number().int().min(1).max(10000).default(60),
        windowMs: z.number().int().min(1000).max(3_600_000).default(60_000),
      })
      .strict()
      .default({ maxRequests: 60, windowMs: 60_000 }),
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
    const headers = new Set(
      value.authentication.parts
        .filter((p) => p.source === 'header')
        .map((p) => p.path),
    );
    if (
      value.authentication.parts.filter((p) => p.source === 'body').length !== 1
    )
      ctx.addIssue({
        code: 'custom',
        path: ['authentication', 'parts'],
        message: 'Sign the raw body exactly once',
      });
    const parts = value.authentication.parts;
    const headerParts = parts.filter((p) => p.source === 'header');
    if (
      parts.at(-1)?.source !== 'body' ||
      headers.size !== headerParts.length ||
      headers.has(value.authentication.header) ||
      (headerParts.length && !value.authentication.separator.length)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['authentication', 'parts'],
        message:
          'Use unique non-signature headers, a nonempty separator, then the raw body last',
      });
    const check = (
      binding: z.infer<typeof webhookBindingSchema>,
      at: (string | number)[],
    ) => {
      if (binding.source === 'header' && !headers.has(binding.path))
        ctx.addIssue({
          code: 'custom',
          path: at,
          message: 'Header sources must be included in signed material',
        });
    };
    check(value.deliveryId, ['deliveryId']);
    check(value.timestamp, ['timestamp']);
    value.filters.forEach((f, i) => check(f.value, ['filters', i, 'value']));
    if ('externalTask' in value.action && value.action.externalTask)
      for (const [key, binding] of Object.entries(value.action.externalTask))
        check(binding, ['action', 'externalTask', key]);
    if ('bindings' in value.action) {
      const paths = Object.keys(value.action.bindings);
      if (
        paths.length > 64 ||
        paths.some((p, i) =>
          paths.some((q, j) => i !== j && (p === q || p.startsWith(q + '.'))),
        )
      )
        ctx.addIssue({
          code: 'custom',
          path: ['action', 'bindings'],
          message: 'Use at most 64 non-overlapping binding paths',
        });
      if (
        paths.length &&
        (!value.action.input ||
          typeof value.action.input !== 'object' ||
          Array.isArray(value.action.input))
      )
        ctx.addIssue({
          code: 'custom',
          path: ['action', 'input'],
          message: 'Bindings require an object input template',
        });
      for (const [key, binding] of Object.entries(value.action.bindings))
        check(binding, ['action', 'bindings', key]);
    }
    if (new TextEncoder().encode(JSON.stringify(value)).length > 65_536)
      ctx.addIssue({
        code: 'custom',
        message: 'Webhook configuration exceeds 64 KiB',
      });
  });
export type WebhookConfig = z.infer<typeof webhookConfigSchema>;
export type WebhookBinding = z.infer<typeof webhookBindingSchema>;
export interface WebhookDelivery {
  id: string;
  triggerId: string;
  receivedAt: string;
  outcome:
    | 'started'
    | 'queued'
    | 'submitted'
    | 'cancelled'
    | 'held'
    | 'ignored'
    | 'rejected'
    | 'duplicate';
  status: number;
  code: string;
  runId?: string;
  affectedRuns?: number;
  eventAt?: string;
}
export type WebhookReceipt = {
  id: string;
  triggerId: string;
  materialHash: string;
  delivery: WebhookDelivery;
};
export function webhookPath(value: Json, path: string): Json | undefined {
  let result: unknown = value;
  for (const part of path ? path.split('.') : []) {
    if (
      result === null ||
      typeof result !== 'object' ||
      !Object.hasOwn(result, part)
    )
      return undefined;
    result = (result as Record<string, unknown>)[part];
  }
  return result as Json | undefined;
}
