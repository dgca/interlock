import { setImmediate as yieldTurn } from 'node:timers/promises';
import { Store } from '@interlock/storage';
import {
  InterlockError,
  ResultRejection,
  simulationRequestSchema,
  assertionProblems,
  evaluateAssertions,
  promptIds,
  isPollWait,
  type CapturedCase,
  type WorkflowDefinition,
  type Workflow,
  type SavedPrompt,
  type TestSuite,
  type Json,
  type Run,
  type WorkRequest,
  type ResultCheck,
  type RouteCoverage,
} from '@interlock/core';
import { Engine } from './index.js';
import { definitionHash, fingerprint } from './versionIdentity.js';
import {
  computeCoverage,
  forSimulation,
  trace,
  type Trace,
} from './simulationGroups.js';

type Request = typeof simulationRequestSchema._output;
type State =
  'running' | 'passed' | 'failed' | 'unsupported' | 'cancelled' | 'interrupted';
type Receipt = {
  index: number;
  nodeId: string;
  kind: string;
  executionId: string;
  outcome:
    | 'substituted'
    | 'failure'
    | 'accepted'
    | 'rejected'
    | 'not_submitted'
    | 'timed_out';
  diagnostics?: ResultCheck['diagnostics'];
};
type Record = {
  id: string;
  requestHash: string;
  mode: 'simulation';
  workflowId: string;
  suiteId: string;
  suiteRevision: number;
  caseId: string;
  version: number;
  definitionHash: string;
  caseHash: string;
  capture: {
    definition: WorkflowDefinition;
    case: CapturedCase;
    prompts: SavedPrompt[];
  };
  state: State;
  substitutions: Receipt[];
  executions: Trace[];
  checks: ReturnType<typeof evaluateAssertions>;
  unsupported: string[];
  runStatus?: Run['status'];
  error?: string;
  result?: Json;
  coverage?: RouteCoverage;
  createdAt: string;
  updatedAt: string;
};
const collection = 'workflowSimulations';
const now = () => new Date().toISOString();
const errorText = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 512);
const summary = (r: Record) => {
  const {
    capture: _capture,
    substitutions,
    executions,
    checks,
    unsupported,
    result: _result,
    requestHash: _hash,
    ...rest
  } = r;
  return {
    ...rest,
    substitutionCount: substitutions.length,
    executionCount: executions.length,
    checkCount: checks.length,
    unsupportedCount: unsupported.length,
  };
};
const page = <T>(items: T[], offset: number, limit: number) => ({
  items: items.slice(offset, offset + limit),
  total: items.length,
  nextOffset: offset + limit < items.length ? offset + limit : null,
  truncated: offset > 0 || offset + limit < items.length,
});

export class Simulations {
  private active = new Map<
    string,
    {
      record: Record;
      engine?: Engine;
      childWorkflows?: Workflow[];
      childVersions?: NonNullable<ReturnType<Store['getVersion']>>[];
    }
  >();
  private stopped = false;
  constructor(
    private store: Store,
    private cwd: string,
  ) {
    for (const record of store.list<Record>(collection)) {
      if (record.state !== 'running') continue;
      record.state = 'interrupted';
      record.error =
        'Service interrupted. Start a new simulation with a new requestId.';
      this.save(record);
    }
  }
  private save(record: Record) {
    record.updatedAt = now();
    this.store.put(collection, record);
  }
  private get(id: string) {
    const record = this.store.get<Record>(collection, id);
    if (!record) throw new InterlockError('Simulation not found');
    return record;
  }
  private report(record: Record, offset = 0, limit = 20) {
    return {
      ...summary(record),
      substitutions: page(record.substitutions, offset, limit),
      executions: page(record.executions, offset, limit),
      checks: page(record.checks, offset, limit),
      unsupported: page(record.unsupported, offset, limit),
    };
  }
  request(input: typeof simulationRequestSchema._input) {
    const q = simulationRequestSchema.parse(input);
    if (this.stopped)
      throw new InterlockError('Simulation service has stopped');
    switch (q.action) {
      case 'run':
        return this.start(q);
      case 'get':
        return this.report(this.get(q.id), q.offset, q.limit);
      case 'list':
        return page(
          this.store
            .list<Record>(collection)
            .filter((r) => !q.workflowId || r.workflowId === q.workflowId)
            .reverse()
            .map(summary),
          q.offset,
          q.limit,
        );
      case 'capture': {
        const r = this.get(q.id);
        return { ...summary(r), capture: r.capture, result: r.result };
      }
      case 'cancel': {
        const r = this.active.get(q.id)?.record ?? this.get(q.id);
        if (r.state === 'running') {
          r.state = 'cancelled';
          this.active.get(q.id)?.engine?.stop();
          this.save(r);
        }
        return this.report(r);
      }
    }
  }
  private start(q: Extract<Request, { action: 'run' }>) {
    const requestHash = fingerprint(q);
    const previous = this.store.get<Record>(collection, q.requestId);
    if (previous) {
      if (previous.requestHash !== requestHash)
        throw new InterlockError(
          'Simulation requestId was already used with different arguments',
        );
      return this.report(previous);
    }
    if (this.active.size >= 4)
      throw new InterlockError('At most four simulations may be active');
    const suite = this.store.get<TestSuite>('testSuites', q.suiteId);
    if (!suite || suite.revision !== q.suiteRevision)
      throw new InterlockError('Test suite is missing or its revision changed');
    const testCase = suite.cases.find((c) => c.id === q.caseId);
    if (!testCase) throw new InterlockError('Test case not found');
    const workflow = this.store.get<Workflow>('workflows', suite.workflowId);
    const version = this.store.getVersion(suite.workflowId, q.version);
    if (!workflow || !version)
      throw new InterlockError('Published workflow version not found');
    const definition = version.definition;
    const unsupported = definition.nodes.flatMap((node) => {
      if (node.kind === 'exit' && node.continueAsNew)
        return [
          `Node ${node.id}: continue as new is unsupported in simulation`,
        ];
      if (
        ![
          'entry',
          'exit',
          'agent',
          'script',
          'fetch',
          'condition',
          'switch',
          'workflow',
          'wait',
          'input',
          'batch',
          'parallel',
        ].includes(node.kind)
      )
        return [`Node ${node.id}: ${node.kind} is unsupported`];
      return [];
    });
    unsupported.push(...assertionProblems(testCase.assertions, definition));
    const childWorkflows: Workflow[] = [];
    const childVersions: NonNullable<ReturnType<Store['getVersion']>>[] = [];
    const queue = [...definition.nodes];
    const visitedWorkflows = new Set<string>();
    while (queue.length) {
      const node = queue.shift()!;
      if (node.kind === 'workflow') {
        const cw = this.store.get<Workflow>('workflows', node.workflowId);
        if (cw && !visitedWorkflows.has(cw.id)) {
          visitedWorkflows.add(cw.id);
          childWorkflows.push(cw);
          const cv = this.store.getVersion(node.workflowId, node.version ?? 1);
          if (cv) {
            childVersions.push(cv);
            queue.push(...cv.definition.nodes);
          }
        }
      }
    }
    const allPrompts = [...promptIds(definition)];
    for (const cv of childVersions) {
      allPrompts.push(...promptIds(cv.definition));
    }
    const prompts = [...new Set(allPrompts)]
      .map((id) => {
        const p = this.store.get<SavedPrompt>('prompts', id);
        if (!p) unsupported.push(`Saved prompt ${id} is missing`);
        return p;
      })
      .filter((p): p is SavedPrompt => !!p);
    if (
      prompts.length > 64 ||
      Buffer.byteLength(JSON.stringify(prompts)) > 1048576
    )
      unsupported.push('Saved prompt capture exceeds 64 prompts or 1 MiB');
    const allNodes = [...definition.nodes];
    for (const cv of childVersions) {
      allNodes.push(...cv.definition.nodes);
    }
    for (const [index, fixture] of (testCase.fixtures ?? []).entries()) {
      if (
        !allNodes.some(
          (n) =>
            n.id === fixture.nodeId &&
            (n.kind === fixture.kind ||
              (n.kind === 'wait' &&
                isPollWait(n) &&
                fixture.kind === n.timing.check.kind) ||
              (n.kind === 'wait' && fixture.kind === 'wait')),
        )
      )
        unsupported.push(
          `Fixture ${index}: node or kind does not match the pinned definition`,
        );
    }
    const record: Record = {
      id: q.requestId,
      requestHash,
      mode: 'simulation',
      workflowId: workflow.id,
      suiteId: suite.id,
      suiteRevision: suite.revision,
      caseId: testCase.id,
      version: q.version,
      definitionHash: definitionHash(definition),
      caseHash: fingerprint(testCase),
      capture: {
        definition,
        case: testCase,
        prompts: unsupported.length ? [] : prompts,
      },
      state: unsupported.length ? 'unsupported' : 'running',
      substitutions: [],
      executions: [],
      checks: evaluateAssertions(testCase.assertions),
      unsupported: unsupported.map((s) => s.slice(0, 512)),
      createdAt: now(),
      updatedAt: now(),
    };
    this.save(record);
    if (!unsupported.length) {
      const active = {
        record,
        engine: undefined as Engine | undefined,
        childWorkflows,
        childVersions,
      };
      this.active.set(record.id, active);
      // Defer execution so callers can inspect/cancel immediately and other requests remain serviceable.
      void this.execute(active, workflow, version);
    }
    return this.report(record);
  }
  private async execute(
    active: {
      record: Record;
      engine?: Engine;
      childWorkflows?: Workflow[];
      childVersions?: NonNullable<ReturnType<Store['getVersion']>>[];
    },
    workflow: Workflow,
    version: NonNullable<ReturnType<Store['getVersion']>>,
  ) {
    const r = active.record;
    let scratch: Store | undefined;
    let runId: string | undefined;
    const used = new Set<number>();
    let last = -1;
    let grouped: (runId?: string) => boolean = () => false;
    let fatal: string | undefined;
    let read: (id: string) => Run = () => {
      throw new InterlockError('Simulation engine is not running');
    };
    const fixtures = r.capture.case.fixtures ?? [];
    const first = () => {
      let i = 0;
      while (used.has(i)) i++;
      return i;
    };
    // Outside groups a step takes the next fixture in list order. Inside a
    // Batch item or Parallel branch it takes the next unused one for its node.
    const pick = (nodeId: string, runId?: string) => {
      const start = first();
      if (grouped(runId))
        for (let i = start; i < fixtures.length; i++)
          if (!used.has(i) && fixtures[i].nodeId === nodeId) return i;
      return start;
    };
    const take = (nodeId: string, kind: string, runId?: string) => {
      if (fatal) throw new InterlockError(fatal);
      const i = pick(nodeId, runId);
      const f = fixtures[i];
      const matchKind =
        f &&
        (f.kind === kind ||
          (kind === 'wait' &&
            (f.kind === 'wait' || f.kind === 'script' || f.kind === 'fetch')) ||
          ((kind === 'script' || kind === 'fetch') && f.kind === 'wait'));
      if (!f || f.nodeId !== nodeId || !matchKind) {
        fatal = `Fixture ${i}: expected ${kind} node ${nodeId}; ${f ? `received ${f.kind} node ${f.nodeId}` : 'fixture is missing'}`;
        throw new InterlockError(fatal);
      }
      used.add(i);
      last = i;
      return f;
    };
    const receipt = (
      nodeId: string,
      kind: string,
      executionId: string,
      outcome: Receipt['outcome'],
      diagnostics?: Receipt['diagnostics'],
    ) => {
      r.substitutions.push({
        index: last,
        nodeId,
        kind,
        executionId,
        outcome,
        ...(diagnostics ? { diagnostics } : {}),
      });
      this.save(r);
    };
    try {
      await yieldTurn();
      if (r.state !== 'running') return;
      scratch = new Store(':memory:');
      scratch.put('workflows', {
        ...workflow,
        ownerWorkflowId: undefined,
        archived: false,
      });
      const substituted = new Set(
        fixtures.filter((f) => f.kind === 'workflow').map((f) => f.nodeId),
      );
      scratch.version(forSimulation(version, substituted));
      for (const cw of active.childWorkflows ?? []) {
        scratch.put('workflows', {
          ...cw,
          ownerWorkflowId: undefined,
          archived: false,
        });
      }
      for (const cv of active.childVersions ?? []) {
        scratch.version(forSimulation(cv, substituted));
      }
      for (const prompt of r.capture.prompts) scratch.put('prompts', prompt);
      // Detached calls with a workflow fixture take it for their run reference.
      const detached = new Set(
        [version, ...(active.childVersions ?? [])].flatMap((v) =>
          v.definition.nodes
            .filter((n) => n.kind === 'workflow' && n.mode === 'detached')
            .filter((n) => substituted.has(n.id))
            .map((n) => `${v.workflowId}:${n.id}`),
        ),
      );
      const owner = (executionId: string) =>
        scratch!
          .activeRuns()
          .find((ar) => ar.executions.some((x) => x.id === executionId))?.id;
      let virtualTime = Date.now();
      const clock = {
        now: () => virtualTime,
      };
      const engine = new Engine(scratch, this.cwd, {
        clock,
        substituteWorkflow: (node, execution) => {
          const ownerId = owner(execution.id);
          const call = ownerId && engine.run(ownerId);
          const isDetached =
            !!call && detached.has(`${call.workflowId}:${node.id}`);
          const nextFixture = fixtures[pick(node.id, ownerId)];
          if (
            isDetached ||
            (nextFixture &&
              nextFixture.nodeId === node.id &&
              nextFixture.kind === 'workflow')
          ) {
            let f: (typeof fixtures)[number];
            try {
              f = take(node.id, 'workflow', ownerId);
              if (isDetached && f.error)
                throw new InterlockError(
                  (fatal = `Fixture ${last}: a detached Workflow call cannot fail; supply the started run reference as output`),
                );
            } catch (error) {
              return Promise.reject(new InterlockError(errorText(error)));
            }
            receipt(
              node.id,
              'workflow',
              execution.id,
              f.error ? 'failure' : 'substituted',
            );
            if (f.error) return Promise.reject(new InterlockError(f.error));
            return Promise.resolve(f.output!);
          }
          return undefined;
        },
        substituteOperation: async (node, execution) => {
          const targetId = execution.nodeId;
          const f = take(targetId, node.kind, owner(execution.id));
          receipt(
            targetId,
            f.kind,
            execution.id,
            f.error ? 'failure' : 'substituted',
          );
          if (f.error) throw new InterlockError(f.error);
          return f.output!;
        },
      });
      active.engine = engine;
      grouped = (id) => {
        for (let run = id && engine.run(id); run;) {
          if (run.batchNodeId || run.parallelBranch) return true;
          run = run.parentRunId && engine.run(run.parentRunId);
        }
        return false;
      };
      read = (id) => engine.run(id);
      runId = engine.start(workflow.id, r.capture.case.input, r.version).run.id;
      let claim: WorkRequest | undefined;
      for (let turns = 0; turns < 10000 && r.state === 'running'; turns++) {
        if (fatal) throw new InterlockError(fatal);
        const run = engine.run(runId);
        r.runStatus = run.status;
        r.executions = trace(run, read);
        if (['completed', 'failed', 'cancelled'].includes(run.status)) {
          r.checks = evaluateAssertions(r.capture.case.assertions, run);
          r.result = run.output;
          r.coverage = computeCoverage(r.capture.definition, run, read);
          if (used.size < fixtures.length)
            throw new InterlockError(
              `${run.error ? run.error.slice(0, 256) + '. ' : ''}${fixtures.length - used.size} unused fixtures starting at index ${first()}`,
            );
          r.state =
            run.status === 'completed' &&
            r.checks.every((c) => c.status === 'pass')
              ? 'passed'
              : 'failed';
          r.error = run.error?.slice(0, 512);
          break;
        }
        if (!claim) {
          const work = engine.available(runId)[0];
          if (work) {
            const index = pick(work.nodeId, work.runId);
            const nextFixture = fixtures[index];
            if (
              nextFixture &&
              nextFixture.nodeId === work.nodeId &&
              nextFixture.kind === 'agent' &&
              nextFixture.timedOut
            ) {
              used.add(index);
              last = index;
              receipt(work.nodeId, 'agent', work.executionId, 'timed_out');
              if (work.availableUntil) {
                virtualTime = Math.max(
                  virtualTime,
                  Date.parse(work.availableUntil) + 1,
                );
              }
              engine.pump();
            } else {
              claim = engine.claim(
                work.id,
                {
                  workerId: 'simulation',
                  freshContext: true,
                  tools: work.context.tools,
                  skills: work.context.skills,
                  session: {
                    executorId: 'simulation',
                    sessionId: 'simulation',
                  },
                },
                3600,
              );
            }
          }
        }
        if (claim) {
          const f = take(claim.nodeId, 'agent', claim.runId);
          if (f.error) {
            receipt(claim.nodeId, 'agent', claim.executionId, 'failure');
            engine.reportFailure(claim.id, claim.token!, f.error);
            claim = undefined;
          } else {
            const check = engine.preflightResult(
              claim.id,
              claim.token!,
              f.output!,
            );
            if (f.expectRejection && check.canSubmit) {
              receipt(
                claim.nodeId,
                'agent',
                claim.executionId,
                'not_submitted',
              );
              throw new InterlockError(
                `Fixture ${last}: expected contract rejection but output is valid`,
              );
            }
            try {
              // Submission may synchronously dispatch a subsequent operation. Record this fixture first.
              receipt(
                claim.nodeId,
                'agent',
                claim.executionId,
                check.canSubmit ? 'accepted' : 'rejected',
                check.canSubmit ? undefined : check.diagnostics,
              );
              engine.submit(claim.id, claim.token!, f.output!);
              claim = undefined;
            } catch (e) {
              if (!(
                f.expectRejection &&
                e instanceof ResultRejection &&
                e.resultCheck.code === 'invalid_result'
              ))
                throw e;
            }
          }
        }
        // A waiting Human input takes the next fixture as the person's answer.
        const asked = claim
          ? undefined
          : scratch
              .activeRuns()
              .map((ar) => ({ ar, step: ar.executions.at(-1) }))
              .find(
                ({ ar, step }) =>
                  ar.status === 'waiting' &&
                  step?.kind === 'input' &&
                  step.status === 'waiting',
              );
        if (asked?.step && engine.available(runId).length === 0) {
          const f = take(asked.step.nodeId, 'input', asked.ar.id);
          receipt(asked.step.nodeId, 'input', asked.step.id, 'substituted');
          engine.externalInputs.answer(
            {
              action: 'answer',
              target: {
                kind: 'human',
                runId: asked.ar.id,
                executionId: asked.step.id,
              },
              value: f.output!,
              expectedRevision: 0,
              submissionId: `simulation-${last + 1}`,
            },
            'mcp',
          );
          await yieldTurn();
          continue;
        }
        if (!claim && engine.available(runId).length === 0) {
          const activeRuns = scratch.activeRuns();
          const deadlines: number[] = [];
          for (const ar of activeRuns) {
            for (const exec of ar.executions) {
              if (exec.status === 'waiting') {
                if (exec.resumeAt) deadlines.push(Date.parse(exec.resumeAt));
                if (exec.nextCheckAt)
                  deadlines.push(Date.parse(exec.nextCheckAt));
                if (exec.timeoutAt) deadlines.push(Date.parse(exec.timeoutAt));
              }
            }
          }
          for (const w of scratch.work('available')) {
            if (w.availableUntil) deadlines.push(Date.parse(w.availableUntil));
          }
          const pending = deadlines.filter((d) => d >= virtualTime);
          if (pending.length > 0) {
            const nextTime = Math.min(...pending);
            virtualTime = Math.max(virtualTime, nextTime);
            engine.pump();
          }
        }
        await yieldTurn();
      }
      if (r.state === 'running')
        throw new InterlockError('Simulation exceeded 10000 driver turns');
    } catch (error) {
      if (r.state === 'running') {
        r.state = 'failed';
        r.error = errorText(error);
      }
    } finally {
      if (runId && active.engine && !this.stopped) {
        const run = active.engine.run(runId);
        r.runStatus = run.status;
        r.executions = trace(run, read);
        r.checks = evaluateAssertions(r.capture.case.assertions, run);
        r.coverage = computeCoverage(r.capture.definition, run, read);
      }
      active.engine?.stop();
      scratch?.close();
      this.active.delete(r.id);
      if (!this.stopped) this.save(r);
    }
  }
  stop() {
    this.stopped = true;
    for (const { record, engine } of this.active.values()) {
      if (record.state === 'running') {
        record.state = 'interrupted';
        record.error =
          'Service stopped. Start a new simulation with a new requestId.';
        this.save(record);
      }
      engine?.stop();
    }
  }
  assertDeletable(workflowId: string) {
    if (
      [...this.active.values()].some((a) => a.record.workflowId === workflowId)
    )
      throw new InterlockError(
        'Wait for active simulation cleanup before deleting this workflow',
      );
  }
  deleteWorkflow(workflowId: string) {
    for (const r of this.store.list<Record>(collection))
      if (r.workflowId === workflowId) this.store.remove(collection, r.id);
  }
}
