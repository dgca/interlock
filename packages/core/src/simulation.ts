import { z } from 'zod';
import { jsonSchema } from './index.js';

const id = z.string().min(1).max(120);
export const simulationFixtureSchema = z
  .object({
    nodeId: id,
    kind: z.enum(['agent', 'script', 'fetch']),
    output: z.lazy(() => jsonSchema).optional(),
    error: z.string().min(1).max(512).optional(),
    expectRejection: z.boolean().optional(),
  })
  .strict()
  .superRefine((fixture, ctx) => {
    if ((fixture.output === undefined) === (fixture.error === undefined))
      ctx.addIssue({
        code: 'custom',
        message: 'Provide exactly one of output or error',
      });
    if (
      fixture.expectRejection &&
      (fixture.kind !== 'agent' || fixture.output === undefined)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Expected rejection requires an Agent output',
      });
    if (
      fixture.kind === 'fetch' &&
      fixture.output !== undefined &&
      !z
        .object({
          status: z.number().int().min(100).max(599),
          headers: z.record(z.string()),
          body: z.lazy(() => jsonSchema),
        })
        .strict()
        .safeParse(fixture.output).success
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Fetch output requires status (100–599), string headers and JSON body',
      });
  });
export const simulationRequestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('run'),
      suiteId: id,
      suiteRevision: z.number().int().positive(),
      caseId: id,
      version: z.number().int().positive(),
      requestId: id,
    })
    .strict(),
  z
    .object({
      action: z.literal('get'),
      id,
      offset: z.number().int().min(0).max(10000).default(0),
      limit: z.number().int().min(1).max(100).default(20),
    })
    .strict(),
  z
    .object({
      action: z.literal('list'),
      workflowId: id.optional(),
      offset: z.number().int().min(0).max(1000000).default(0),
      limit: z.number().int().min(1).max(100).default(20),
    })
    .strict(),
  z.object({ action: z.literal('capture'), id }).strict(),
  z.object({ action: z.literal('cancel'), id }).strict(),
]);
export const simulationToolSchema = z
  .object({ request: simulationRequestSchema })
  .strict();
export type SimulationFixture = z.infer<typeof simulationFixtureSchema>;
