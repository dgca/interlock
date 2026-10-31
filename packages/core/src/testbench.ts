import { z } from 'zod';
import { simulationFixtureSchema } from './simulation.js';
import {
  jsonSchema,
  readPath,
  type Json,
  type Run,
  type WorkflowDefinition,
} from './index.js';
import { structuralEqual } from './jsonEquality.js';
import type { PromptSnapshot } from './prompts.js';
import type { UsageAttempt, UsageMetric } from './usage.js';
import { modelTierSchema } from './modelTiers.js';
import {
  trialSetupSchema,
  trialReadSchema,
  trialCleanupSchema,
  type TrialSetup,
  type TrialEnvironment,
} from './trialEnvironments.js';
import {
  evaluationReferenceSchema,
  type EvaluationReceipt,
} from './evaluation.js';

const id = z.string().min(1).max(120);
const name = z.string().trim().min(1).max(120);
const valueCheck = z
  .object({
    kind: z.literal('output'),
    path: z.string().max(500).default(''),
    nodeId: id.optional(),
    visit: z.number().int().min(1).max(1000).default(1),
    operator: z.enum(['exists', 'equals', 'gte', 'lte']),
    expected: z.lazy(() => jsonSchema).optional(),
  })
  .strict();
const routeCheck = z
  .object({
    kind: z.literal('route'),
    nodeId: id,
    visit: z.number().int().min(1).max(1000),
    port: id,
  })
  .strict();
export const testAssertionSchema = z
  .discriminatedUnion('kind', [valueCheck, routeCheck])
  .superRefine((a, ctx) => {
    if (a.kind !== 'output') return;
    if (a.operator !== 'exists' && a.expected === undefined)
      ctx.addIssue({
        code: 'custom',
        message: 'A comparison value is required',
      });
    if (['gte', 'lte'].includes(a.operator) && typeof a.expected !== 'number')
      ctx.addIssue({
        code: 'custom',
        message: 'Numeric checks require a numeric expected value',
      });
    if (a.operator === 'exists' && a.expected !== undefined)
      ctx.addIssue({
        code: 'custom',
        message: 'Existence checks do not take an expected value',
      });
    if (!a.nodeId && a.visit !== 1)
      ctx.addIssue({ code: 'custom', message: 'A visit requires a nodeId' });
  });
export const testCaseSchema = z
  .object({
    id,
    name,
    input: z.lazy(() => jsonSchema).optional(),
    sourceRunId: id.optional(),
    fixtures: z.array(simulationFixtureSchema).max(1000).optional(),
    assertions: z.array(testAssertionSchema).max(50).default([]),
    qualityGuidance: z.string().max(4000).default(''),
  })
  .strict()
  .superRefine((c, ctx) => {
    if ((c.input === undefined) === (c.sourceRunId === undefined))
      ctx.addIssue({
        code: 'custom',
        message: 'Provide exactly one of input or sourceRunId',
      });
    if (
      c.input !== undefined &&
      new TextEncoder().encode(JSON.stringify(c.input)).length > 65536
    )
      ctx.addIssue({ code: 'custom', message: 'Case input exceeds 64 KiB' });
  });
export const suiteContentSchema = z
  .object({
    name,
    description: z.string().max(4000).default(''),
    cases: z.array(testCaseSchema).min(1).max(25),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (new Set(s.cases.map((c) => c.id)).size !== s.cases.length)
      ctx.addIssue({ code: 'custom', message: 'Case IDs must be unique' });
    if (new TextEncoder().encode(JSON.stringify(s)).length > 1048576)
      ctx.addIssue({ code: 'custom', message: 'Suite exceeds 1 MiB' });
  });
export const createSuiteSchema = z
  .object({ workflowId: id, content: suiteContentSchema })
  .strict();
export const updateSuiteSchema = z
  .object({
    id,
    revision: z.number().int().positive(),
    content: suiteContentSchema,
  })
  .strict();
export const comparisonExecutorSchema = z
  .object({
    profile: z.string().trim().min(1).max(200).optional(),
    tier: modelTierSchema.optional(),
    provider: z.string().trim().min(1).max(200).optional(),
    model: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((v) => v !== undefined),
    'Declare at least one executor preference',
  );
export const comparisonSideSchema = z
  .object({
    promptRevisions: z
      .array(z.object({ id, revision: z.number().int().positive() }).strict())
      .max(64)
      .optional()
      .describe(
        'Complete prompt selection for this side, including child workflows. Omit for current revisions.',
      ),
    executor: comparisonExecutorSchema
      .optional()
      .describe(
        'Requested configuration metadata only; does not dispatch or enforce a model/profile.',
      ),
    environment: z
      .object({
        identity: z.string().trim().min(1).max(200),
        receipt: z.string().trim().min(1).max(512).optional(),
      })
      .strict()
      .optional()
      .describe(
        'Non-secret external environment identity/receipt. Does not prepare or verify isolation.',
      ),
  })
  .strict();
export type ComparisonSideSelection = z.infer<typeof comparisonSideSchema>;
export interface ComparisonConfiguration {
  id: string;
  promptSource: 'current' | 'revisions';
  prompts: { id: string; revision: number }[];
  pins: ComparisonPin[];
  executor?: ComparisonSideSelection['executor'];
  environment?: ComparisonSideSelection['environment'];
}
export const comparisonPreviewSchema = z
  .object({
    suiteId: id,
    suiteRevision: z.number().int().positive(),
    baselineVersion: z.number().int().positive(),
    candidateVersion: z.number().int().positive(),
    repetitions: z.number().int().min(1).max(10).default(1),
    concurrency: z.number().int().min(1).max(10).default(2),
    trialSetup: trialSetupSchema.optional(),
    configurations: z
      .object({
        baseline: comparisonSideSchema.optional(),
        candidate: comparisonSideSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const comparisonStartSchema = comparisonPreviewSchema.extend({
  confirmation: z.string().regex(/^[a-f0-9]{64}$/),
  requestId: id.describe(
    'Caller-generated unique ID. Reuse identical arguments after a lost response; conflicting reuse is rejected.',
  ),
});
export const testbenchListSchema = z
  .object({
    workflowId: id.optional(),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict();
export const comparisonReportSchema = z
  .object({
    id,
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(25).default(10),
    checkOffset: z.number().int().min(0).default(0),
    checkLimit: z.number().int().min(1).max(10).default(5),
    judgmentOffset: z.number().int().min(0).default(0),
    judgmentLimit: z.number().int().min(1).max(25).default(10),
    caseOffset: z.number().int().min(0).default(0),
    caseLimit: z.number().int().min(1).max(25).default(5),
    metricsDetail: z.enum(['summary', 'full']).default('summary'),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional()
      .describe(
        'Select cost details for one currency; omission returns at most ten currencies without conversion.',
      ),
  })
  .strict();
export const comparisonCaseSchema = z.object({ id, caseId: id }).strict();
export const comparisonCancelSchema = z
  .object({ id, cancelDetached: z.boolean().default(false) })
  .strict();
export const qualityJudgmentSchema = z
  .object({
    id,
    sampleId: id,
    reviewer: name,
    reviewerKind: z.enum(['human', 'agent']),
    rubric: z.string().trim().min(1).max(4000),
    score: z.number().min(0).max(5),
    notes: z.string().max(4000).default(''),
    requestId: id
      .optional()
      .describe(
        'Optional comparison-scoped idempotency key. Identical retries return the original judgment; conflicting reuse rejects. Omit to append independent legacy judgments.',
      ),
    evaluation: evaluationReferenceSchema
      .optional()
      .describe(
        'Optional captured evaluation provenance: runId owns fixed comparisonId/rubric/mode/outputPath/maxSamples input; reviewerRunId is its descendant, executionId the completed fresh Agent or checks-only Script grade. Evidence field/path/sha256 comes from get_run_result includeHash:true on the trial root. Requires requestId runId:sampleId; only retained originally completed trials are supported. Returns captured spec/version, verdict, findings and grader metadata.',
      ),
  })
  .strict();
// MCP groups related operations while retaining each shared server contract.
export const testSuiteReadSchema = z
  .object({
    request: z.discriminatedUnion('action', [
      testbenchListSchema.extend({ action: z.literal('list') }),
      z.object({ action: z.literal('get'), id }).strict(),
    ]),
  })
  .strict();
export const testSuiteSaveSchema = z
  .object({
    request: z.discriminatedUnion('action', [
      createSuiteSchema.extend({ action: z.literal('create') }),
      updateSuiteSchema.extend({ action: z.literal('update') }),
    ]),
  })
  .strict();
export const comparisonReadSchema = z
  .object({
    request: z.discriminatedUnion('action', [
      testbenchListSchema.extend({ action: z.literal('list') }),
      comparisonReportSchema.extend({ action: z.literal('report') }),
      comparisonCaseSchema.extend({ action: z.literal('case') }),
      trialReadSchema.extend({ action: z.literal('trial') }),
    ]),
  })
  .strict();
export const comparisonUpdateSchema = z
  .object({
    request: z.discriminatedUnion('action', [
      comparisonCancelSchema.extend({ action: z.literal('cancel') }),
      qualityJudgmentSchema.extend({ action: z.literal('record_quality') }),
      trialCleanupSchema.extend({ action: z.literal('cleanup_trial') }),
    ]),
  })
  .strict();
export type TestAssertion = z.infer<typeof testAssertionSchema>;
export type SuiteContent = z.infer<typeof suiteContentSchema>;
export type CapturedCase = Omit<
  z.infer<typeof testCaseSchema>,
  'input' | 'sourceRunId'
> & {
  input: Json;
  source?: { runId: string; workflowId: string; version: number };
};
export interface TestSuite {
  id: string;
  workflowId: string;
  name: string;
  description: string;
  revision: number;
  cases: CapturedCase[];
  createdAt: string;
  updatedAt: string;
}
export interface ComparisonRunContext {
  comparisonId: string;
  suiteId: string;
  suiteName: string;
  suiteRevision: number;
  sampleId: string;
  caseId: string;
  caseName: string;
  side: 'baseline' | 'candidate';
  repetition: number;
}
export interface CheckResult {
  index: number;
  kind: TestAssertion['kind'];
  status: 'pass' | 'fail' | 'unknown';
  reason: string;
}
export interface ComparisonSample {
  trial?: TrialEnvironment;
  id: string;
  caseId: string;
  caseName: string;
  side: 'baseline' | 'candidate';
  repetition: number;
  version: number;
  runId?: string;
  /** Internal frozen membership; reports expose aggregates, never this inventory. */
  measurement?: ComparisonMeasurement;
  observation?: {
    at: string;
    status: Run['status'] | 'unavailable' | 'not_started';
    error?: string;
    checks: CheckResult[];
    descendantErrors: {
      runId: string;
      status: Run['status'];
      error?: string;
    }[];
  };
}
export interface ComparisonMeasurement {
  runIds: string[];
  detachedRuns: number;
  attempts: Pick<
    UsageAttempt,
    'id' | 'workId' | 'runId' | 'attempt' | 'outcome'
  >[];
  timing: {
    rootElapsedMs: number | null;
    treeElapsedMs: number | null;
    claimIntervalMs: UsageMetric;
    unclaimedAssignmentMs: UsageMetric;
    declaredHoldMs: UsageMetric;
  };
}
export interface ComparisonPin {
  workflowId: string;
  version: number;
  definitionHash: string;
}
export interface QualityJudgment {
  id: string;
  sampleId: string;
  reviewer: string;
  reviewerKind: 'human' | 'agent';
  rubric: string;
  score: number;
  notes: string;
  createdAt: string;
  requestId?: string;
  /** Internal idempotency fingerprint, omitted from public receipts. */
  requestHash?: string;
  evaluation?: EvaluationReceipt;
}
export interface WorkflowComparison {
  trialSetup?: TrialSetup;
  id: string;
  requestId: string;
  requestHash: string;
  workflowId: string;
  suite: TestSuite;
  baselineVersion: number;
  candidateVersion: number;
  repetitions: number;
  concurrency: number;
  pins: ComparisonPin[];
  prompts: PromptSnapshot[];
  /** Absent on legacy comparisons, whose prompt pool is shared by both sides. */
  configurations?: Record<'baseline' | 'candidate', ComparisonConfiguration>;
  samples: ComparisonSample[];
  judgments: QualityJudgment[];
  status: 'running' | 'completed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}
export function assertionProblems(
  assertions: TestAssertion[],
  definition: WorkflowDefinition,
) {
  return assertions.flatMap((a, index) => {
    if (!a.nodeId) return [];
    const node = definition.nodes.find((n) => n.id === a.nodeId);
    if (!node) return [`Assertion ${index}: node ${a.nodeId} does not exist`];
    if (node.batchId)
      return [
        `Assertion ${index}: Batch-member checkpoints are unsupported; select a root-scope node`,
      ];
    if (
      a.kind === 'route' &&
      !definition.edges.some(
        (e) => e.source === a.nodeId && (e.port ?? 'default') === a.port,
      )
    )
      return [
        `Assertion ${index}: node ${a.nodeId} has no declared port ${a.port}`,
      ];
    return [];
  });
}
export function evaluateAssertions(
  assertions: TestAssertion[],
  run?: Run,
): CheckResult[] {
  return assertions.map((a, index) => {
    const result = (
      status: CheckResult['status'],
      reason: string,
    ): CheckResult => ({
      index,
      kind: a.kind,
      status,
      reason: reason.slice(0, 512),
    });
    if (!run) return result('unknown', 'Run history is unavailable');
    const execution = a.nodeId
      ? run.executions.filter((e) => e.nodeId === a.nodeId)[a.visit - 1]
      : undefined;
    if (a.nodeId && !execution)
      return result(
        'unknown',
        `Node ${a.nodeId} visit ${a.visit} did not execute`,
      );
    const routedFailure =
      execution?.status === 'failed' &&
      (execution.kind === 'script' || execution.kind === 'fetch') &&
      execution.port === 'failed';
    if (
      execution &&
      execution.status !== 'completed' &&
      !(a.kind === 'route' && routedFailure)
    )
      return result('unknown', `Node visit is ${execution.status}`);
    if (a.kind === 'route') {
      if (!execution?.port)
        return result('unknown', 'No recorded route is available');
      return result(
        execution.port === a.port ? 'pass' : 'fail',
        execution.port === a.port
          ? 'Expected route taken'
          : 'Recorded route differs from expected port',
      );
    }
    const source = execution ?? run;
    if (!Object.hasOwn(source, 'output'))
      return result('unknown', 'No output is available');
    let actual: Json;
    try {
      actual = readPath(source.output!, a.path);
    } catch {
      return result('fail', `Output path ${a.path || '(root)'} is missing`);
    }
    if (a.operator === 'exists') return result('pass', 'Output path exists');
    const match =
      a.operator === 'equals'
        ? structuralEqual(actual, a.expected)
        : typeof actual === 'number' &&
          (a.operator === 'gte'
            ? actual >= (a.expected as number)
            : actual <= (a.expected as number));
    return result(
      match ? 'pass' : 'fail',
      match
        ? 'Output satisfies check'
        : `Output does not satisfy ${a.operator}`,
    );
  });
}
