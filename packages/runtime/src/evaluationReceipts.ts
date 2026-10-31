import {
  InterlockError,
  evaluationInputSchema,
  evaluationGradeSchema,
  readPath,
  type EvaluationReference,
  type EvaluationReceipt,
  type WorkflowComparison,
  type ComparisonSample,
  type Run,
  type WorkRequest,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import { fingerprint } from './versionIdentity.js';

export function validateEvaluationReceipt(
  store: Store,
  c: WorkflowComparison,
  sample: ComparisonSample,
  input: {
    requestId?: string;
    rubric: string;
    score: number;
    notes: string;
    evaluation: EvaluationReference;
  },
): EvaluationReceipt {
  const fail = (message: string): never => {
    throw new InterlockError(`Evaluation receipt: ${message}`);
  };
  const reference = input.evaluation;
  const evaluationRun = store.get<Run>('runs', reference.runId);
  if (!evaluationRun || evaluationRun.comparison)
    return fail('use a retained evaluation run outside the compared trials');
  const parsed = evaluationInputSchema.safeParse(evaluationRun.input);
  if (!parsed.success)
    return fail(
      'evaluation run input must capture comparisonId, rubric and supported evaluation settings',
    );
  const specification = parsed.data;
  if (
    specification.comparisonId !== c.id ||
    specification.rubric !== input.rubric
  )
    return fail('comparison or rubric differs from captured evaluation input');
  if (input.requestId !== `${reference.runId}:${sample.id}`)
    return fail('requestId must be evaluation run ID + colon + sample ID');
  if (
    c.judgments.filter((j) => j.evaluation?.runId === reference.runId).length >=
    specification.maxSamples
  )
    return fail('captured sample limit reached');
  const reviewer = store.get<Run>('runs', reference.reviewerRunId);
  if (!reviewer) return fail('reviewer run is unavailable');
  let owner: Run | undefined = reviewer;
  for (
    let depth = 0;
    owner && owner.id !== evaluationRun.id && depth < 11;
    depth++
  )
    owner = owner.parentRunId
      ? store.get<Run>('runs', owner.parentRunId)
      : undefined;
  if (owner?.id !== evaluationRun.id)
    return fail('reviewer must belong to the evaluation run');
  const execution = reviewer.executions.find(
    (e) => e.id === reference.executionId,
  );
  if (!execution || execution.status !== 'completed')
    return fail('grader execution must be completed');
  const gradeResult = evaluationGradeSchema.safeParse(execution.output);
  if (!gradeResult.success)
    return fail('accepted grader output does not satisfy the grade contract');
  const grade = gradeResult.data;
  const target = sample.runId
    ? store.get<Run>('runs', sample.runId)
    : undefined;
  if (
    sample.observation?.status !== 'completed' ||
    !target ||
    target.status !== 'completed' ||
    target.workflowId !== c.workflowId ||
    target.version !== sample.version
  )
    return fail(
      'first-version evaluation requires a retained completed trial root',
    );
  const expectedInput = {
    ...specification,
    evaluationRunId: evaluationRun.id,
    sampleId: sample.id,
    runId: target.id,
    caseId: sample.caseId,
    guidance:
      c.suite.cases.find((s) => s.id === sample.caseId)?.qualityGuidance ?? '',
    checks: sample.observation?.checks ?? [],
  };
  const graderInput = execution.input;
  if (
    !graderInput ||
    typeof graderInput !== 'object' ||
    Array.isArray(graderInput) ||
    Object.entries(expectedInput).some(
      ([key, value]) =>
        !Object.hasOwn(graderInput, key) ||
        fingerprint(graderInput[key]) !== fingerprint(value),
    )
  )
    return fail(
      'grader input must match captured settings, sample reference, case guidance and frozen checks',
    );
  if (
    grade.evaluationRunId !== evaluationRun.id ||
    grade.sampleId !== sample.id ||
    grade.rubric !== specification.rubric ||
    grade.mode !== specification.mode ||
    grade.outputPath !== specification.outputPath ||
    grade.score !== input.score ||
    grade.notes !== input.notes ||
    fingerprint(grade.evidence) !== fingerprint(reference.evidence)
  )
    return fail(
      'write differs from captured specification or accepted grader output',
    );
  let grader: EvaluationReceipt['grader'];
  if (specification.mode === 'review') {
    const work = store
      .forRuns<WorkRequest>('work', new Set([reviewer.id]))
      .find((w) => w.executionId === execution.id && w.status === 'completed');
    if (execution.kind !== 'agent' || !work || work.context.mode !== 'fresh')
      return fail('review requires a completed fresh-context Agent assignment');
    grader = {
      kind: 'agent',
      workflowId: reviewer.workflowId,
      version: reviewer.version,
      workId: work.id,
      attempt: work.attempt,
      ...(work.workerId ? { workerId: work.workerId } : {}),
      ...(work.modelSelection ? { modelSelection: work.modelSelection } : {}),
    };
  } else {
    if (execution.kind !== 'script')
      return fail('checks_only requires a completed Script grader');
    const checks = sample.observation?.checks ?? [];
    const verdict = checks.some((c) => c.status === 'fail')
      ? 'fail'
      : !checks.length || checks.some((c) => c.status === 'unknown')
        ? 'unknown'
        : 'pass';
    if (
      grade.verdict !== verdict ||
      grade.score !== (verdict === 'pass' ? 5 : 0)
    )
      return fail('checks_only grade must match the original frozen checks');
    grader = {
      kind: 'script',
      workflowId: reviewer.workflowId,
      version: reviewer.version,
    };
    const findings = checks.slice(0, 10).map((c) => ({
      criterion: 'check:' + c.index,
      status: c.status,
      notes: c.reason,
      references: ['check:' + c.index],
    }));
    if (
      grade.notes !==
        'Frozen structural checks only; semantic quality was not reviewed.' ||
      fingerprint(grade.findings) !== fingerprint(findings)
    )
      return fail(
        'checks_only findings must preserve the frozen check results',
      );
  }
  if (grade.verdict === 'unknown' && grade.score !== 0)
    return fail('unknown verdict uses score 0 as an unassessed placeholder');
  if (specification.mode === 'review' && !grade.findings.length)
    return fail('review must record criterion-level findings');
  if (
    grade.verdict === 'pass' &&
    grade.findings.some((f) => f.status !== 'pass')
  )
    return fail('failed or unknown findings cannot produce a pass');
  if (
    grade.verdict === 'pass' &&
    (sample.observation?.checks ?? []).some((c) => c.status !== 'pass')
  )
    return fail('failed or unknown required checks cannot produce a pass');
  if (
    !reference.evidence.some(
      (e) => e.field === 'output' && e.path === specification.outputPath,
    )
  )
    return fail('evidence must include the captured output selection');
  for (const evidence of reference.evidence) {
    if (!Object.hasOwn(target, evidence.field))
      return fail('selected artifact is unavailable');
    const value = readPath(target[evidence.field]!, evidence.path);
    if (Buffer.byteLength(JSON.stringify(value)) > 262144)
      return fail(
        'selected evidence exceeds 256 KiB; use a narrower outputPath',
      );
    if (fingerprint(value) !== evidence.sha256)
      return fail(
        'artifact changed or evidence digest differs from the selected result',
      );
  }
  return {
    ...reference,
    comparisonSampleCount: c.samples.length,
    source: {
      runId: target.id,
      version: sample.version,
      observedAt: sample.observation!.at,
    },
    specificationHash: fingerprint({
      specification,
      workflowId: evaluationRun.workflowId,
      version: evaluationRun.version,
      prompts: evaluationRun.promptSnapshots ?? [],
      grader: {
        workflowId: reviewer.workflowId,
        version: reviewer.version,
        prompts: reviewer.promptSnapshots ?? [],
        modelSelection: grader.modelSelection,
      },
      suite: c.suite,
    }),
    workflowId: evaluationRun.workflowId,
    version: evaluationRun.version,
    mode: specification.mode,
    verdict: grade.verdict,
    findings: grade.findings,
    grader,
  };
}

export function publicJudgment<T extends { requestHash?: string }>(
  judgment: T,
): Omit<T, 'requestHash'> {
  const { requestHash: _hash, ...result } = judgment;
  return result;
}
