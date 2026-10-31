import { z } from 'zod';

const id = z.string().min(1).max(120);
export const evaluationInputSchema = z
  .object({
    comparisonId: id,
    rubric: z.string().trim().min(1).max(4000),
    mode: z.enum(['review', 'checks_only']).default('review'),
    outputPath: z.string().max(500).default(''),
    maxSamples: z.number().int().min(1).max(100).default(10),
  })
  .strict();
export const evaluationEvidenceSchema = z
  .object({
    field: z.enum(['input', 'output']),
    path: z.string().max(500),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const evaluationReferenceSchema = z
  .object({
    runId: id,
    reviewerRunId: id,
    executionId: id,
    evidence: z.array(evaluationEvidenceSchema).min(1).max(4),
  })
  .strict();
export const evaluationGradeSchema = z
  .object({
    evaluationRunId: id,
    sampleId: id,
    rubric: z.string().trim().min(1).max(4000),
    mode: z.enum(['review', 'checks_only']),
    outputPath: z.string().max(500),
    verdict: z.enum(['pass', 'fail', 'unknown']),
    score: z.number().min(0).max(5),
    notes: z.string().max(4000),
    evidence: z.array(evaluationEvidenceSchema).min(1).max(4),
    findings: z
      .array(
        z
          .object({
            criterion: z.string().min(1).max(200),
            status: z.enum(['pass', 'fail', 'unknown']),
            notes: z.string().max(512),
            references: z.array(z.string().min(1).max(512)).max(4),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();
export type EvaluationReference = z.infer<typeof evaluationReferenceSchema>;
export function qualityRubricKey(judgment: {
  rubric: string;
  evaluation?: { specificationHash: string };
}) {
  return judgment.evaluation
    ? `evaluation:${judgment.evaluation.specificationHash}`
    : `legacy:${judgment.rubric}`;
}
export interface EvaluationReceipt extends EvaluationReference {
  comparisonSampleCount: number;
  source: { runId: string; version: number; observedAt: string };
  specificationHash: string;
  workflowId: string;
  version: number;
  mode: 'review' | 'checks_only';
  verdict: 'pass' | 'fail' | 'unknown';
  findings: z.infer<typeof evaluationGradeSchema>['findings'];
  grader: {
    kind: 'agent' | 'script';
    workflowId: string;
    version: number;
    workId?: string;
    attempt?: number;
    workerId?: string;
    modelSelection?: import('./modelTiers.js').ModelSelection;
  };
}
