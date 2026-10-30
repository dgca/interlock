import { setImmediate as yieldTurn } from 'node:timers/promises';
import { Store } from '@interlock/storage';
import {
  InterlockError,
  ResultRejection,
  simulationRequestSchema,
  assertionProblems,
  evaluateAssertions,
  promptIds,
  type CapturedCase,
  type WorkflowDefinition,
  type Workflow,
  type SavedPrompt,
  type TestSuite,
  type Json,
  type Run,
  type WorkRequest,
  type ResultCheck,
} from '@interlock/core';
import { Engine } from './index.js';
import { definitionHash, fingerprint } from './versionIdentity.js';

type Request = typeof simulationRequestSchema._output;
type State =
  'running' | 'passed' | 'failed' | 'unsupported' | 'cancelled' | 'interrupted';
type Receipt = {
  index: number;
  nodeId: string;
  kind: string;
  executionId: string;
  outcome:
    'substituted' | 'failure' | 'accepted' | 'rejected' | 'not_submitted';
  diagnostics?: ResultCheck['diagnostics'];
};
type Trace = {
  executionId: string;
  nodeId: string;
  kind: string;
  status: string;
  port?: string;
  truncated?: boolean;
};
const trace = (run: Run): Trace[] =>
  run.executions.map((e) => ({
    executionId: e.id,
    nodeId: e.nodeId.slice(0, 256),
    kind: e.kind,
    status: e.status,
    ...(e.port ? { port: e.port.slice(0, 256) } : {}),
    ...(e.nodeId.length > 256 || (e.port?.length ?? 0) > 256
      ? { truncated: true }
      : {}),
  }));
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
  private active = new Map<string, { record: Record; engine?: Engine }>();
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
        ].includes(node.kind)
      )
        return [`Node ${node.id}: ${node.kind} is unsupported`];
      if (node.kind === 'agent' && node.unclaimedTimeoutMs !== undefined)
        return [`Node ${node.id}: Agent timeouts are unsupported`];
      return [];
    });
    unsupported.push(...assertionProblems(testCase.assertions, definition));
    const prompts = promptIds(definition)
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
    for (const [index, fixture] of (testCase.fixtures ?? []).entries()) {
      if (
        !definition.nodes.some(
          (n) => n.id === fixture.nodeId && n.kind === fixture.kind,
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
      const active = { record, engine: undefined as Engine | undefined };
      this.active.set(record.id, active);
      // Defer execution so callers can inspect/cancel immediately and other requests remain serviceable.
      void this.execute(active, workflow, version);
    }
    return this.report(record);
  }
  private async execute(
    active: { record: Record; engine?: Engine },
    workflow: Workflow,
    version: NonNullable<ReturnType<Store['getVersion']>>,
  ) {
    const r = active.record;
    let scratch: Store | undefined;
    let runId: string | undefined;
    let cursor = 0;
    let fatal: string | undefined;
    const fixtures = r.capture.case.fixtures ?? [];
    const take = (nodeId: string, kind: string) => {
      if (fatal) throw new InterlockError(fatal);
      const f = fixtures[cursor];
      if (!f || f.nodeId !== nodeId || f.kind !== kind) {
        fatal = `Fixture ${cursor}: expected ${kind} node ${nodeId}; ${f ? `received ${f.kind} node ${f.nodeId}` : 'fixture is missing'}`;
        throw new InterlockError(fatal);
      }
      cursor++;
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
        index: cursor - 1,
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
      scratch.version(version);
      for (const prompt of r.capture.prompts) scratch.put('prompts', prompt);
      const engine = new Engine(scratch, this.cwd, {
        substituteOperation: async (node, execution) => {
          const f = take(node.id, node.kind);
          receipt(
            node.id,
            node.kind,
            execution.id,
            f.error ? 'failure' : 'substituted',
          );
          if (f.error) throw new InterlockError(f.error);
          return f.output!;
        },
      });
      active.engine = engine;
      runId = engine.start(workflow.id, r.capture.case.input, r.version).run.id;
      let claim: WorkRequest | undefined;
      for (let turns = 0; turns < 10000 && r.state === 'running'; turns++) {
        if (fatal) throw new InterlockError(fatal);
        const run = engine.run(runId);
        r.runStatus = run.status;
        r.executions = trace(run);
        if (['completed', 'failed', 'cancelled'].includes(run.status)) {
          r.checks = evaluateAssertions(r.capture.case.assertions, run);
          r.result = run.output;
          if (cursor < fixtures.length)
            throw new InterlockError(
              `${run.error ? run.error.slice(0, 256) + '. ' : ''}${fixtures.length - cursor} unused fixtures starting at index ${cursor}`,
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
          if (work)
            claim = engine.claim(
              work.id,
              {
                workerId: 'simulation',
                freshContext: true,
                tools: work.context.tools,
                skills: work.context.skills,
                session: { executorId: 'simulation', sessionId: 'simulation' },
              },
              3600,
            );
        }
        if (claim) {
          const f = take(claim.nodeId, 'agent');
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
                `Fixture ${cursor - 1}: expected contract rejection but output is valid`,
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
        r.executions = trace(run);
        r.checks = evaluateAssertions(r.capture.case.assertions, run);
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
