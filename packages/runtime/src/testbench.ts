import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
type Input<T extends { _input: unknown }> = T['_input'];
type Output<T extends { _output: unknown }> = T['_output'];
import {
  InterlockError,
  assertContract,
  promptIds,
  snapshotPrompt,
  assertionProblems,
  evaluateAssertions,
  createSuiteSchema,
  updateSuiteSchema,
  suiteContentSchema,
  comparisonPreviewSchema,
  comparisonStartSchema,
  testbenchListSchema,
  comparisonReportSchema,
  comparisonCaseSchema,
  comparisonCancelSchema,
  qualityJudgmentSchema,
  type TestSuite,
  type CapturedCase,
  type WorkflowComparison,
  type ComparisonPin,
  type ComparisonRunContext,
  type ComparisonSample,
  type Run,
  type Workflow,
  type SavedPrompt,
  type Json,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import { definitionHash, fingerprint } from './versionIdentity.js';
const active = (run: Run) =>
  run.status === 'running' || run.status === 'waiting';
const now = () => new Date().toISOString();
const key = (pin: ComparisonPin) => `${pin.workflowId}:${pin.version}`;
const textError = (e: unknown) => (e instanceof Error ? e.message : String(e));
const trimError = (e?: string) => e?.slice(0, 512);
export class Testbench {
  constructor(
    private store: Store,
    private hooks: {
      create: (
        workflowId: string,
        version: number,
        input: Json,
        context: ComparisonRunContext,
      ) => Run;
      cancel: (id: string) => void;
    },
  ) {}
  private workflow(id: string) {
    const w = this.store.get<Workflow>('workflows', id);
    if (!w) throw new InterlockError(`Workflow ${id} not found`);
    return w;
  }
  getSuite(id: string) {
    const s = this.store.get<TestSuite>('testSuites', id);
    if (!s) throw new InterlockError('Test suite not found');
    return s;
  }
  private get(id: string) {
    const c = this.store.get<WorkflowComparison>('comparisons', id);
    if (!c) throw new InterlockError('Comparison not found');
    return c;
  }
  getCase(input: Input<typeof comparisonCaseSchema>) {
    const q = comparisonCaseSchema.parse(input),
      c = this.get(q.id);
    const testCase = c.suite.cases.find((t) => t.id === q.caseId);
    if (!testCase) throw new InterlockError('Comparison case not found');
    return {
      comparisonId: c.id,
      suiteId: c.suite.id,
      suiteRevision: c.suite.revision,
      case: testCase,
    };
  }
  assertRetryCapacity(run: Run) {
    if (!run.comparison) return;
    const comparison = this.get(run.comparison.comparisonId);
    const sample = comparison.samples.find(
      (s) => s.id === run.comparison!.sampleId,
    );
    if (!sample?.runId)
      throw new InterlockError('Comparison sample is unavailable');
    const runs = this.store.runs();
    // Retrying within an already active tree consumes no additional tree slot.
    if (this.tree(sample.runId, runs).some(active)) return;
    const busy = (c: WorkflowComparison) =>
      c.samples.filter((s) => s.runId && this.tree(s.runId, runs).some(active))
        .length;
    if (
      comparison.status !== 'running' &&
      busy(comparison) === 0 &&
      this.store
        .list<WorkflowComparison>('comparisons')
        .filter(
          (c) =>
            c.status === 'running' ||
            c.samples.some(
              (s) => s.runId && this.tree(s.runId, runs).some(active),
            ),
        ).length >= 4
    )
      throw new InterlockError(
        'Four comparisons are already active; retry after one finishes or is cancelled',
      );
    if (busy(comparison) >= comparison.concurrency)
      throw new InterlockError(
        'Comparison concurrency is full. Retry after an execution tree finishes',
      );
    if (
      this.store
        .list<WorkflowComparison>('comparisons')
        .reduce((n, c) => n + busy(c), 0) >= 10
    )
      throw new InterlockError(
        'Global comparison concurrency is full. Retry after an execution tree finishes',
      );
  }
  listSuites(input: Input<typeof testbenchListSchema>) {
    const q = testbenchListSchema.parse(input);
    const all = this.store
      .list<TestSuite>('testSuites')
      .filter((s) => !q.workflowId || s.workflowId === q.workflowId)
      .reverse();
    return {
      total: all.length,
      items: all
        .slice(0, q.limit)
        .map(({ cases, ...s }) => ({ ...s, caseCount: cases.length })),
    };
  }
  private captureCases(
    workflowId: string,
    content: Output<typeof suiteContentSchema>,
  ) {
    const cases: CapturedCase[] = content.cases.map((c) => {
      if (c.sourceRunId) {
        const run = this.store.get<Run>('runs', c.sourceRunId);
        if (!run || run.workflowId !== workflowId)
          throw new InterlockError(
            `Source run ${c.sourceRunId} is missing or belongs to another workflow`,
          );
        const { sourceRunId: _sourceRunId, ...captured } = c;
        return {
          ...captured,
          input: run.input,
          source: { runId: run.id, workflowId, version: run.version },
        };
      }
      return { ...c, input: c.input! };
    });
    for (const c of cases)
      if (Buffer.byteLength(JSON.stringify(c.input)) > 65536)
        throw new InterlockError('Case input exceeds 64 KiB');
    if (Buffer.byteLength(JSON.stringify({ ...content, cases })) > 1048576)
      throw new InterlockError('Suite exceeds 1 MiB');
    return cases;
  }
  createSuite(input: Input<typeof createSuiteSchema>) {
    const q = createSuiteSchema.parse(input);
    return this.store.transaction(() => {
      this.workflow(q.workflowId);
      const time = now();
      const s: TestSuite = {
        id: randomUUID(),
        workflowId: q.workflowId,
        name: q.content.name,
        description: q.content.description,
        revision: 1,
        cases: this.captureCases(q.workflowId, q.content),
        createdAt: time,
        updatedAt: time,
      };
      this.store.put('testSuites', s);
      return s;
    });
  }
  updateSuite(input: Input<typeof updateSuiteSchema>) {
    const q = updateSuiteSchema.parse(input);
    return this.store.transaction(() => {
      const old = this.getSuite(q.id);
      if (old.revision !== q.revision)
        throw new InterlockError(
          'Suite changed. Read its current revision before saving',
        );
      const content = {
        name: q.content.name,
        description: q.content.description,
        cases: this.captureCases(old.workflowId, q.content),
      };
      if (
        isDeepStrictEqual(content, {
          name: old.name,
          description: old.description,
          cases: old.cases,
        })
      )
        return old;
      const s = {
        ...old,
        ...content,
        revision: old.revision + 1,
        updatedAt: now(),
      };
      this.store.put('testSuites', s);
      return s;
    });
  }
  private capture(q: Output<typeof comparisonPreviewSchema>) {
    const suite = this.getSuite(q.suiteId);
    if (suite.revision !== q.suiteRevision)
      throw new InterlockError(
        'Suite revision changed. Read the suite and preview again',
      );
    const workflow = this.workflow(suite.workflowId);
    const owner = workflow.ownerWorkflowId
      ? this.workflow(workflow.ownerWorkflowId)
      : undefined;
    const blockers: string[] = [];
    if (workflow.archived || owner?.archived)
      blockers.push('Restore the workflow and its owner before comparing');
    if (suite.cases.length * q.repetitions * 2 > 100)
      blockers.push(
        'Comparison exceeds 100 root runs; reduce cases or repetitions',
      );
    const pins = new Map<string, ComparisonPin>();
    const prompts = new Map<string, ReturnType<typeof snapshotPrompt>>();
    const visit = (workflowId: string, version: number) => {
      const id = `${workflowId}:${version}`;
      if (pins.has(id)) return;
      if (pins.size >= 64)
        throw new InterlockError(
          'Comparison exceeds 64 pinned workflow versions',
        );
      const snapshot = this.store.getVersion(workflowId, version);
      if (!snapshot)
        throw new InterlockError(`Published dependency ${id} is unavailable`);
      pins.set(id, {
        workflowId,
        version,
        definitionHash: definitionHash(snapshot.definition),
      });
      for (const promptId of promptIds(snapshot.definition)) {
        const prompt = this.store.get<SavedPrompt>('prompts', promptId);
        if (!prompt)
          throw new InterlockError(`Saved prompt ${promptId} is missing`);
        prompts.set(promptId, snapshotPrompt(prompt));
      }
      for (const node of snapshot.definition.nodes)
        if (node.kind === 'workflow') {
          if (node.version === null)
            throw new InterlockError(`Unresolved Workflow pin ${node.id}`);
          visit(node.workflowId, node.version);
        }
    };
    for (const version of [q.baselineVersion, q.candidateVersion]) {
      visit(workflow.id, version);
      const definition = this.store.getVersion(
        workflow.id,
        version,
      )!.definition;
      for (const c of suite.cases) {
        try {
          assertContract(
            definition.inputSchema,
            c.input,
            `Case ${c.id} v${version}`,
          );
        } catch (e) {
          blockers.push(textError(e).slice(0, 512));
        }
        blockers.push(
          ...assertionProblems(c.assertions, definition).map(
            (p) => `${c.id} v${version}: ${p}`,
          ),
        );
      }
    }
    if (
      prompts.size > 64 ||
      Buffer.byteLength(JSON.stringify([...prompts.values()])) > 1048576
    )
      throw new InterlockError(
        'Comparison prompt capture exceeds 64 prompts or 1 MiB',
      );
    return {
      suite,
      pins: [...pins.values()].sort((a, b) => key(a).localeCompare(key(b))),
      prompts: [...prompts.values()].sort((a, b) => a.id.localeCompare(b.id)),
      blockers,
    };
  }
  preview(input: Input<typeof comparisonPreviewSchema>) {
    const q = comparisonPreviewSchema.parse(input),
      c = this.capture(q);
    const impact = {
      ...q,
      workflowId: c.suite.workflowId,
      suiteName: c.suite.name,
      cases: c.suite.cases.map(
        ({ id, name, input, assertions, source, qualityGuidance }) => ({
          id,
          name,
          inputHash: fingerprint(input),
          assertionsHash: fingerprint(assertions),
          source,
          qualityGuidance,
        }),
      ),
      rootRunCount: c.suite.cases.length * q.repetitions * 2,
      pins: c.pins,
      prompts: c.prompts.map(({ id, name, revision, content }) => ({
        id,
        name,
        revision,
        contentHash: fingerprint(content),
      })),
      blockers: c.blockers.slice(0, 50),
      blockerCount: c.blockers.length,
      execution:
        'Real Agent, Script and Fetch execution. Connected executors are required for Agent work. Nested Workflow and Batch runs add work beyond the exact root count. Detached descendants count toward completion and concurrency.',
    };
    return {
      ...impact,
      canStart: c.blockers.length === 0,
      confirmation: fingerprint(impact),
    };
  }
  start(input: Input<typeof comparisonStartSchema>) {
    const q = comparisonStartSchema.parse(input);
    return this.store.transaction(() => {
      const requestHash = fingerprint(q),
        old = this.store
          .list<WorkflowComparison>('comparisons')
          .find((c) => c.requestId === q.requestId);
      if (old) {
        if (old.requestHash !== requestHash)
          throw new InterlockError(
            'Comparison requestId was already used with different arguments',
          );
        return this.summary(old);
      }
      const { requestId, confirmation, ...selection } = q;
      const preview = this.preview(selection);
      if (confirmation !== preview.confirmation)
        throw new InterlockError(
          'Comparison preview changed. Preview again before starting',
        );
      if (!preview.canStart)
        throw new InterlockError(preview.blockers.join('; '));
      const allRuns = this.store.runs();
      if (
        this.store
          .list<WorkflowComparison>('comparisons')
          .filter(
            (c) =>
              c.status === 'running' ||
              c.samples.some(
                (s) => s.runId && this.tree(s.runId, allRuns).some(active),
              ),
          ).length >= 4
      )
        throw new InterlockError(
          'Four comparisons are already active; finish or cancel one first',
        );
      const captured = this.capture(selection),
        samples: ComparisonSample[] = [];
      for (const c of captured.suite.cases)
        for (let repetition = 1; repetition <= q.repetitions; repetition++)
          for (const side of ['baseline', 'candidate'] as const)
            samples.push({
              id: randomUUID(),
              caseId: c.id,
              caseName: c.name,
              side,
              repetition,
              version:
                side === 'baseline' ? q.baselineVersion : q.candidateVersion,
            });
      const time = now();
      const comparison: WorkflowComparison = {
        id: randomUUID(),
        requestId: q.requestId,
        requestHash,
        workflowId: captured.suite.workflowId,
        suite: captured.suite,
        baselineVersion: q.baselineVersion,
        candidateVersion: q.candidateVersion,
        repetitions: q.repetitions,
        concurrency: q.concurrency,
        pins: captured.pins,
        prompts: captured.prompts,
        samples,
        judgments: [],
        status: 'running',
        createdAt: time,
        updatedAt: time,
      };
      this.store.put('comparisons', comparison);
      return this.summary(comparison);
    });
  }
  promptsFor(context: ComparisonRunContext) {
    return this.get(context.comparisonId).prompts;
  }
  context(c: WorkflowComparison, s: ComparisonSample): ComparisonRunContext {
    return {
      comparisonId: c.id,
      suiteId: c.suite.id,
      suiteName: c.suite.name,
      suiteRevision: c.suite.revision,
      sampleId: s.id,
      caseId: s.caseId,
      caseName: s.caseName,
      side: s.side,
      repetition: s.repetition,
    };
  }
  private tree(rootId: string, runs: Run[]) {
    const ids = new Set([rootId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of runs)
        if (r.parentRunId && ids.has(r.parentRunId) && !ids.has(r.id)) {
          ids.add(r.id);
          changed = true;
        }
    }
    return runs.filter((r) => ids.has(r.id));
  }
  advance() {
    let changed = false;
    const comparisons = this.store.list<WorkflowComparison>('comparisons');
    let runs = this.store.runs();
    let globalBusy = comparisons.reduce(
      (n, c) =>
        n +
        c.samples.filter(
          (s) => s.runId && this.tree(s.runId, runs).some(active),
        ).length,
      0,
    );
    for (const c of comparisons) {
      if (c.status === 'completed') continue;
      let updated = false;
      let busy = c.samples.filter(
        (s) => s.runId && this.tree(s.runId, runs).some(active),
      ).length;
      for (const sample of c.samples) {
        if (sample.observation) continue;
        if (sample.runId) {
          const tree = this.tree(sample.runId, runs);
          if (tree.some(active)) continue;
          const run = runs.find((r) => r.id === sample.runId);
          const testCase = c.suite.cases.find((t) => t.id === sample.caseId)!;
          sample.observation = {
            at: now(),
            status: run?.status ?? 'unavailable',
            error: trimError(run?.error),
            checks: evaluateAssertions(testCase.assertions, run),
            descendantErrors: tree
              .filter(
                (r) =>
                  r.id !== sample.runId &&
                  (r.status === 'failed' || r.status === 'cancelled'),
              )
              .map((r) => ({
                runId: r.id,
                status: r.status,
                error: trimError(r.error),
              })),
          };
          updated = true;
          continue;
        }
        if (c.status !== 'running' || busy >= c.concurrency || globalBusy >= 10)
          continue;
        const testCase = c.suite.cases.find((t) => t.id === sample.caseId)!;
        // The parent pump owns the transaction; it starts external work only after commit.
        // Persisting comparison and run identity together makes retries/restart idempotent.
        const run = this.hooks.create(
          c.workflowId,
          sample.version,
          testCase.input,
          this.context(c, sample),
        );
        sample.runId = run.id;
        updated = true;
        busy++;
        globalBusy++;
        runs.push(run);
      }
      if (
        c.status === 'running' &&
        c.samples.every((s) => Boolean(s.observation)) &&
        !c.samples.some((s) => s.runId && this.tree(s.runId, runs).some(active))
      ) {
        c.status = 'completed';
        updated = true;
      }
      if (updated) {
        c.updatedAt = now();
        this.store.put('comparisons', c);
        changed = true;
      }
    }
    return changed;
  }
  progress(id: string) {
    return this.summary(this.get(id));
  }
  private summary(c: WorkflowComparison) {
    const runs = this.store.runs();
    const activeDetached = c.samples
      .flatMap((s) => (s.runId ? this.tree(s.runId, runs) : []))
      .filter((r) => r.parentMode === 'detached' && active(r));
    return {
      id: c.id,
      requestId: c.requestId,
      workflowId: c.workflowId,
      suiteId: c.suite.id,
      suiteName: c.suite.name,
      suiteRevision: c.suite.revision,
      baselineVersion: c.baselineVersion,
      candidateVersion: c.candidateVersion,
      repetitions: c.repetitions,
      concurrency: c.concurrency,
      status: c.status,
      total: c.samples.length,
      observed: c.samples.filter((s) => s.observation).length,
      queued: c.samples.filter((s) => !s.runId && !s.observation).length,
      activeTrees: c.samples.filter(
        (s) => s.runId && this.tree(s.runId, runs).some(active),
      ).length,
      activeDetachedCount: activeDetached.length,
      activeDetachedRunIds: activeDetached.slice(0, 25).map((r) => r.id),
      judgmentCount: c.judgments.length,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }
  list(input: Input<typeof testbenchListSchema>) {
    const q = testbenchListSchema.parse(input);
    const all = this.store
      .list<WorkflowComparison>('comparisons')
      .filter((c) => !q.workflowId || c.workflowId === q.workflowId)
      .reverse();
    return {
      total: all.length,
      items: all.slice(0, q.limit).map((c) => this.summary(c)),
    };
  }
  report(input: Input<typeof comparisonReportSchema>) {
    const q = comparisonReportSchema.parse(input),
      c = this.get(q.id),
      runs = this.store.runs();
    const samples = c.samples.slice(q.offset, q.offset + q.limit).map((s) => {
      const { observation, ...identity } = s;
      const checks = observation?.checks ?? [];
      return {
        ...identity,
        currentStatus: s.runId
          ? (runs.find((r) => r.id === s.runId)?.status ?? 'unavailable')
          : 'queued',
        runUrl: s.runId ? `/runs/${encodeURIComponent(s.runId)}` : null,
        historyAvailable: s.runId ? runs.some((r) => r.id === s.runId) : null,
        observation: observation
          ? {
              ...observation,
              checks: checks
                .slice(q.checkOffset, q.checkOffset + q.checkLimit)
                .map((check) => {
                  const assertion = c.suite.cases.find(
                    (t) => t.id === s.caseId,
                  )!.assertions[check.index];
                  const expectedOmitted =
                    assertion.kind === 'output' &&
                    assertion.expected !== undefined &&
                    Buffer.byteLength(JSON.stringify(assertion.expected)) >
                      1024;
                  const summary = { ...assertion };
                  if (summary.kind === 'output' && expectedOmitted)
                    delete summary.expected;
                  return {
                    ...check,
                    assertion: summary,
                    expectedOmitted,
                    assertionRef: {
                      comparisonId: c.id,
                      caseId: s.caseId,
                      index: check.index,
                    },
                  };
                }),
              checkTotal: checks.length,
              checkOffset: q.checkOffset,
              checkCounts: {
                pass: checks.filter((x) => x.status === 'pass').length,
                fail: checks.filter((x) => x.status === 'fail').length,
                unknown: checks.filter((x) => x.status === 'unknown').length,
              },
              descendantErrorTotal: observation.descendantErrors.length,
              descendantErrors: observation.descendantErrors.slice(0, 10),
            }
          : null,
        counterpartRunId:
          c.samples.find(
            (t) =>
              t.caseId === s.caseId &&
              t.repetition === s.repetition &&
              t.side !== s.side,
          )?.runId ?? null,
      };
    });
    const allChecks = c.samples.flatMap((s) => s.observation?.checks ?? []);
    const result = {
      ...this.summary(c),
      offset: q.offset,
      samples,
      checkCounts: {
        pass: allChecks.filter((x) => x.status === 'pass').length,
        fail: allChecks.filter((x) => x.status === 'fail').length,
        unknown: allChecks.filter((x) => x.status === 'unknown').length,
      },
      executionErrors: c.samples.filter(
        (s) => s.observation?.status === 'failed',
      ).length,
      pins: c.pins,
      prompts: c.prompts.map(({ id, name, revision }) => ({
        id,
        name,
        revision,
      })),
      judgments: c.judgments.slice(
        q.judgmentOffset,
        q.judgmentOffset + q.judgmentLimit,
      ),
      judgmentOffset: q.judgmentOffset,
      nextOffset: q.offset + samples.length,
      nextJudgmentOffset:
        q.judgmentOffset +
        Math.min(
          q.judgmentLimit,
          Math.max(0, c.judgments.length - q.judgmentOffset),
        ),
      truncated: false,
    };
    // Large notes and many failures can exceed a record-count bound. Keep a
    // byte bound as well, preserving exact totals and offsets for the next page.
    while (Buffer.byteLength(JSON.stringify(result)) > 262144) {
      result.truncated = true;
      if (result.judgments.length) result.judgments.pop();
      else if (result.samples.length > 1) result.samples.pop();
      else
        throw new InterlockError('Comparison report metadata exceeds 256 KiB');
    }
    result.nextOffset = q.offset + result.samples.length;
    result.nextJudgmentOffset = q.judgmentOffset + result.judgments.length;
    return result;
  }
  cancel(input: Input<typeof comparisonCancelSchema>) {
    const q = comparisonCancelSchema.parse(input);
    return this.store.transaction(() => {
      const c = this.get(q.id);
      const runs = this.store.runs();
      for (const s of c.samples) {
        if (s.runId) {
          const root = runs.find((r) => r.id === s.runId);
          if (root && active(root)) this.hooks.cancel(root.id);
          if (q.cancelDetached)
            for (const r of this.tree(s.runId, runs).filter(
              (r) => r.parentMode === 'detached' && active(r),
            ))
              this.hooks.cancel(r.id);
        } else if (!s.observation)
          s.observation = {
            at: now(),
            status: 'not_started',
            checks: [],
            descendantErrors: [],
          };
      }
      if (c.status === 'running') {
        c.status = 'cancelled';
        c.updatedAt = now();
        this.store.put('comparisons', c);
      }
      return this.summary(c);
    });
  }
  judge(input: Input<typeof qualityJudgmentSchema>) {
    const q = qualityJudgmentSchema.parse(input);
    return this.store.transaction(() => {
      const c = this.get(q.id);
      const sample = c.samples.find((s) => s.id === q.sampleId);
      if (!sample?.observation || sample.observation.status === 'not_started')
        throw new InterlockError(
          'Observe an executed sample before recording quality',
        );
      if (c.judgments.length >= 1000)
        throw new InterlockError(
          'Comparison already has 1000 quality judgments',
        );
      const { id, ...data } = q;
      const judgment = { ...data, id: randomUUID(), createdAt: now() };
      c.judgments.push(judgment);
      c.updatedAt = now();
      this.store.put('comparisons', c);
      return judgment;
    });
  }
  counterpart(run: Run) {
    if (!run.comparison) return undefined;
    const c = this.store.get<WorkflowComparison>(
      'comparisons',
      run.comparison.comparisonId,
    );
    const sample = c?.samples.find(
      (s) =>
        s.caseId === run.comparison!.caseId &&
        s.repetition === run.comparison!.repetition &&
        s.side !== run.comparison!.side,
    );
    return sample?.runId && this.store.get<Run>('runs', sample.runId)
      ? sample.runId
      : undefined;
  }
  assertDeletable(workflowId: string) {
    if (
      this.store
        .list<WorkflowComparison>('comparisons')
        .some(
          (c) =>
            c.status === 'running' &&
            c.pins.some((p) => p.workflowId === workflowId),
        )
    )
      throw new InterlockError(
        'Active comparison still needs this workflow. Finish or cancel the comparison first',
      );
  }
  deleteWorkflow(workflowId: string) {
    for (const c of this.store.list<WorkflowComparison>('comparisons'))
      if (c.workflowId === workflowId) this.store.remove('comparisons', c.id);
    for (const s of this.store.list<TestSuite>('testSuites'))
      if (s.workflowId === workflowId) this.store.remove('testSuites', s.id);
  }
}
