import {
  InterlockError,
  evaluationGradeSchema,
  readPath,
  type ComparisonSample,
  type Json,
  type Run,
  type WorkflowComparison,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import {
  evaluationSpecification,
  graderInput,
  trialGap,
} from './evaluationReceipts.js';
import type { Testbench } from './testbench.js';
import { fingerprint } from './versionIdentity.js';

const maxEvidenceBytes = 262144;

function comparison(store: Store, id: string) {
  const c = store.get<WorkflowComparison>('comparisons', id);
  if (!c) throw new InterlockError('Comparison not found');
  return c;
}

/** Why the selected output of a retained trial root cannot be graded, if it cannot. */
function outputGap(target: Run, path: string) {
  if (!Object.hasOwn(target, 'output')) return 'Trial output is unavailable';
  let value: Json;
  try {
    value = readPath(target.output!, path);
  } catch {
    return `Trial output has no path "${path}"; choose another outputPath`;
  }
  return Buffer.byteLength(JSON.stringify(value)) > maxEvidenceBytes
    ? 'Selected output exceeds 256 KiB; use a narrower outputPath'
    : undefined;
}

/**
 * Selects the samples an evaluation run grades and builds each grader input
 * exactly as its receipt later expects. Only roots whose original observation
 * and current run are both completed qualify; complete case/repetition pairs
 * come first. The output carries no side, version or worker identity.
 */
export function planEvaluation(
  store: Store,
  input: { id: string; evaluationRunId: string },
) {
  const c = comparison(store, input.id);
  const { evaluationRun, specification } = evaluationSpecification(
    store,
    c,
    input.evaluationRunId,
  );
  const skipped: { sampleId: string; reason: string }[] = [];
  const eligible: ComparisonSample[] = [];
  for (const sample of c.samples) {
    const reason =
      trialGap(store, c, sample) ??
      outputGap(
        store.get<Run>('runs', sample.runId!)!,
        specification.outputPath,
      );
    if (reason) skipped.push({ sampleId: sample.id, reason });
    else eligible.push(sample);
  }
  const groups = new Map<string, ComparisonSample[]>();
  for (const sample of eligible) {
    const key = JSON.stringify([sample.caseId, sample.repetition]);
    groups.set(key, [...(groups.get(key) ?? []), sample]);
  }
  const pairs = [...groups.values()].filter((g) => g.length > 1);
  const singles = [...groups.values()].filter((g) => g.length === 1);
  const limit = specification.maxSamples;
  const selected: ComparisonSample[] = [];
  for (const pair of pairs)
    if (limit - selected.length >= pair.length) selected.push(...pair);
  for (const [sample] of singles)
    if (selected.length < limit) selected.push(sample);
  for (const sample of pairs.flat())
    if (selected.length < limit && !selected.includes(sample))
      selected.push(sample);
  return {
    ...specification,
    evaluationRunId: evaluationRun.id,
    samples: selected.map((sample) => {
      const target = store.get<Run>('runs', sample.runId!)!;
      const path = specification.outputPath;
      return {
        ...graderInput(specification, evaluationRun.id, c, sample),
        // A fresh reviewer reads the output itself; checks_only keeps its digest.
        evidence:
          specification.mode === 'checks_only'
            ? [
                {
                  field: 'output' as const,
                  path,
                  sha256: fingerprint(readPath(target.output!, path)),
                },
              ]
            : [],
      };
    }),
    skipped: skipped.slice(0, 100),
    remaining:
      eligible.length - selected.length + Math.max(skipped.length - 100, 0),
  };
}

/**
 * Records the grade a Batch item run's completed `review` or `checks` step
 * produced, through the ordinary quality judgment path and its request key.
 */
export function recordEvaluation(
  testbench: Pick<Testbench, 'judge'>,
  store: Store,
  input: {
    id: string;
    evaluationRunId: string;
    reviewerRunId: string;
    sampleId: string;
  },
) {
  const fail = (message: string): never => {
    throw new InterlockError(`Evaluation receipt: ${message}`);
  };
  comparison(store, input.id);
  const execution = store
    .get<Run>('runs', input.reviewerRunId)
    ?.executions.findLast(
      (e) =>
        (e.nodeId === 'review' || e.nodeId === 'checks') &&
        e.status === 'completed',
    );
  if (!execution)
    return fail('the item run has no completed review or checks step');
  const parsed = evaluationGradeSchema.safeParse(
    Object.hasOwn(execution, 'result') ? execution.result : execution.output,
  );
  if (!parsed.success)
    return fail('accepted grader output does not satisfy the grade contract');
  const grade = parsed.data;
  if (
    grade.evaluationRunId !== input.evaluationRunId ||
    grade.sampleId !== input.sampleId
  )
    return fail('the grade belongs to another evaluation run or sample');
  return testbench.judge({
    id: input.id,
    sampleId: input.sampleId,
    reviewer: 'evaluation:' + input.evaluationRunId,
    reviewerKind: 'agent',
    rubric: grade.rubric,
    score: grade.score,
    notes: grade.notes,
    requestId: `${input.evaluationRunId}:${input.sampleId}`,
    evaluation: {
      runId: input.evaluationRunId,
      reviewerRunId: input.reviewerRunId,
      executionId: execution.id,
      evidence: grade.evidence,
    },
  });
}
