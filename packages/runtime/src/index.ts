import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Store } from '@interlock/storage';
import {
  assertContract,
  blankDefinition,
  definitionSchema,
  InterlockError,
  readPath,
  validateDefinition,
  type Json,
  type NodeExecution,
  type Run,
  type Workflow,
  type WorkflowDefinition,
  type WorkflowNode,
  type WorkRequest,
} from '@interlock/core';
import { executeScript } from './scripts.js';

const now = () => new Date().toISOString();
const terminal = (s: string) =>
  ['completed', 'failed', 'cancelled'].includes(s);
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export interface Worker {
  workerId: string;
  freshContext: boolean;
  tools: string[];
  skills: string[];
}

export class Engine {
  private scriptJobs = new Map<string, AbortController>();
  private stopped = false;
  private listeners = new Set<() => void>();
  constructor(
    readonly store: Store,
    private cwd: string,
  ) {
    // A process interruption gives no evidence that a script's side effects completed.
    for (const run of store.runs()) {
      const execution = run.executions.at(-1);
      if (
        run.status === 'running' &&
        execution?.kind === 'script' &&
        execution.status === 'running'
      ) {
        this.fail(
          run,
          execution,
          'Service interrupted during script execution. Inspect side effects before retrying.',
        );
      }
    }
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private event(run: Run, type: string, text: string) {
    this.store.put('events', {
      id: randomUUID(),
      runId: run.id,
      type,
      message: text,
      at: now(),
    });
    queueMicrotask(() => this.listeners.forEach((listener) => listener()));
  }
  private save(run: Run) {
    run.updatedAt = now();
    this.store.put('runs', run);
  }
  workflow(id: string) {
    const w = this.store.get<Workflow>('workflows', id);
    if (!w) throw new InterlockError('Workflow not found');
    return w;
  }
  run(id: string) {
    const run = this.store.get<Run>('runs', id);
    if (!run) throw new InterlockError('Run not found');
    return run;
  }
  create(
    name: string,
    description = '',
    definition = blankDefinition(),
  ): Workflow {
    const time = now();
    const workflow: Workflow = {
      id: randomUUID(),
      name,
      description,
      archived: false,
      draft: definitionSchema.parse(definition),
      draftRevision: 1,
      latestVersion: 0,
      createdAt: time,
      updatedAt: time,
    };
    this.store.put('workflows', workflow);
    return workflow;
  }
  update(
    id: string,
    patch: {
      name?: string;
      description?: string;
      archived?: boolean;
      draft?: WorkflowDefinition;
      draftRevision?: number;
    },
  ) {
    return this.store.transaction(() => {
      const w = this.workflow(id);
      if (patch.draft && patch.draftRevision !== w.draftRevision)
        throw new InterlockError(
          'Draft changed elsewhere. Reload before saving.',
        );
      if (patch.name !== undefined) w.name = patch.name;
      if (patch.description !== undefined) w.description = patch.description;
      if (patch.archived !== undefined) w.archived = patch.archived;
      if (patch.draft) {
        w.draft = definitionSchema.parse(patch.draft);
        w.draftRevision++;
      }
      w.updatedAt = now();
      this.store.put('workflows', w);
      return w;
    });
  }
  clone(id: string) {
    const w = this.workflow(id);
    return this.create(`${w.name} copy`, w.description, w.draft);
  }
  publish(id: string) {
    return this.store.transaction(() => {
      const w = this.workflow(id);
      const definition = validateDefinition(w.draft);
      for (const n of definition.nodes)
        if (n.kind === 'workflow' || n.kind === 'map') {
          if (!this.store.getVersion(n.workflowId, n.version))
            throw new InterlockError(
              `${n.label}: referenced workflow version does not exist`,
            );
        }
      w.latestVersion++;
      w.updatedAt = now();
      this.store.version({
        workflowId: id,
        version: w.latestVersion,
        definition,
        createdAt: now(),
      });
      this.store.put('workflows', w);
      return w;
    });
  }
  private newRun(
    workflowId: string,
    version: number,
    input: Json,
    parentRunId?: string,
  ): Run {
    const w = this.workflow(workflowId);
    const snapshot = this.store.getVersion(workflowId, version);
    if (!snapshot)
      throw new InterlockError('Published workflow version not found');
    assertContract(snapshot.definition.inputSchema, input, 'Workflow input');
    let depth = 0,
      parent = parentRunId;
    while (parent) {
      if (++depth > 10)
        throw new InterlockError('Nested workflow depth exceeded 10');
      parent = this.run(parent).parentRunId;
    }
    const time = now();
    const run: Run = {
      id: randomUUID(),
      workflowId,
      workflowName: w.name,
      version,
      parentRunId,
      status: 'running',
      input,
      cursor: snapshot.definition.nodes.find((n) => n.kind === 'entry')!.id,
      value: input,
      executions: [],
      createdAt: time,
      updatedAt: time,
    };
    this.save(run);
    this.event(run, 'run.started', `Started ${w.name} v${version}`);
    return run;
  }
  start(workflowId: string, input: Json, version?: number) {
    const w = this.workflow(workflowId);
    if (w.archived)
      throw new InterlockError('Restore this workflow before starting it');
    const run = this.store.transaction(() =>
      this.newRun(workflowId, version ?? w.latestVersion, input),
    );
    this.pump();
    return this.inspect(run.id);
  }
  inspect(id: string) {
    const run = this.run(id);
    return {
      run,
      definition: this.store.getVersion(run.workflowId, run.version)!
        .definition,
      work: this.store
        .work()
        .filter((w) => w.runId === id)
        .map(({ token, ...w }) => w),
      events: this.store.events(id),
      children: this.store.runs().filter((r) => r.parentRunId === id),
    };
  }
  private definition(run: Run) {
    return this.store.getVersion(run.workflowId, run.version)!.definition;
  }
  private fail(run: Run, execution: NodeExecution, error: string) {
    for (const id of execution.childRunIds)
      if (!terminal(this.run(id).status)) this.cancelTree(id);
    execution.status = 'failed';
    execution.error = error;
    execution.completedAt = now();
    run.status = 'failed';
    run.error = error;
    this.save(run);
    this.event(run, 'node.failed', `${execution.label}: ${error}`);
  }
  private finish(
    run: Run,
    execution: NodeExecution,
    node: WorkflowNode,
    output: Json,
    port = 'default',
  ) {
    assertContract(node.outputSchema, output, `${node.label} output`);
    if (node.kind === 'exit')
      assertContract(
        this.definition(run).outputSchema,
        output,
        'Workflow output',
      );
    execution.output = output;
    execution.status = 'completed';
    execution.completedAt = now();
    run.value = output;
    if (node.kind === 'exit') {
      run.status = 'completed';
      run.output = output;
      this.event(run, 'run.completed', 'Workflow completed');
    } else {
      run.cursor = this.definition(run).edges.find(
        (e) => e.source === node.id && e.port === port,
      )!.target;
      run.status = 'running';
    }
    this.save(run);
    this.event(run, 'node.completed', execution.label);
  }
  private advance(run: Run): boolean {
    if (terminal(run.status)) return false;
    const definition = this.definition(run),
      node = definition.nodes.find((n) => n.id === run.cursor)!;
    let execution = run.executions.at(-1);
    if (!execution || terminal(execution.status)) {
      execution = {
        id: randomUUID(),
        nodeId: node.id,
        kind: node.kind,
        label: node.label,
        input: run.value,
        status: 'running',
        startedAt: now(),
        childRunIds: [],
        nextItem: 0,
      };
      run.executions.push(execution);
      this.event(run, 'node.started', node.label);
      try {
        if (run.executions.length > definition.maxSteps)
          throw new InterlockError('Workflow step limit exceeded');
        assertContract(
          node.inputSchema,
          execution.input,
          `${node.label} input`,
        );
      } catch (error) {
        this.fail(run, execution, message(error));
        return true;
      }
    }
    try {
      if (node.kind === 'agent') {
        if (execution.status === 'waiting') return false;
        const work: WorkRequest = {
          id: randomUUID(),
          runId: run.id,
          executionId: execution.id,
          nodeId: node.id,
          label: node.label,
          prompt: node.prompt,
          input: execution.input,
          context: node.context,
          outputSchema: node.outputSchema,
          status: 'available',
          attempt: 0,
          maxAttempts: node.maxAttempts,
          createdAt: now(),
        };
        this.store.put('work', work);
        execution.status = 'waiting';
        run.status = 'waiting';
        this.save(run);
        this.event(run, 'work.available', `Awaiting agent: ${node.label}`);
        return true;
      }
      if (node.kind === 'script') {
        this.save(run);
        return false;
      }
      if (node.kind === 'workflow' || node.kind === 'map') {
        const value =
          node.kind === 'map'
            ? readPath(execution.input, node.itemsPath)
            : [execution.input];
        if (!Array.isArray(value))
          throw new InterlockError('Map input must resolve to an array');
        if (value.length > 200)
          throw new InterlockError('Map input exceeds 200 items');
        let children = execution.childRunIds.map((id) => this.run(id));
        if (node.kind === 'workflow' || node.failurePolicy === 'all') {
          const failed = children.find(
            (c) => c.status === 'failed' || c.status === 'cancelled',
          );
          if (failed) {
            for (const child of children)
              if (!terminal(child.status)) this.cancelTree(child.id);
            throw new InterlockError(
              `Child run ${failed.id}: ${failed.error ?? failed.status}`,
            );
          }
        }
        let changed = false;
        const concurrency = node.kind === 'map' ? node.concurrency : 1;
        let active = children.filter((c) => !terminal(c.status)).length;
        while (execution.nextItem < value.length && active < concurrency) {
          const child = this.newRun(
            node.workflowId,
            node.version,
            value[execution.nextItem],
            run.id,
          );
          execution.childRunIds.push(child.id);
          execution.nextItem++;
          active++;
          changed = true;
        }
        children = execution.childRunIds.map((id) => this.run(id));
        if (
          execution.nextItem === value.length &&
          children.every((c) => terminal(c.status))
        ) {
          const output: Json =
            node.kind === 'workflow'
              ? children[0].output!
              : node.failurePolicy === 'collect'
                ? children.map((c) => ({
                    runId: c.id,
                    status: c.status,
                    output: c.output ?? null,
                    error: c.error ?? null,
                  }))
                : children.map((c) => c.output!);
          this.finish(run, execution, node, output);
          return true;
        }
        execution.status = 'waiting';
        run.status = 'waiting';
        this.save(run);
        return changed;
      }
      this.finish(
        run,
        execution,
        node,
        execution.input,
        node.kind === 'condition'
          ? String(
              isDeepStrictEqual(
                readPath(execution.input, node.path),
                node.equals,
              ),
            )
          : 'default',
      );
      return true;
    } catch (error) {
      this.fail(run, execution, message(error));
      return true;
    }
  }
  stop() {
    this.stopped = true;
    for (const controller of this.scriptJobs.values()) controller.abort();
  }
  pump() {
    if (this.stopped) return;
    this.store.transaction(() => {
      for (const work of this.store.work())
        if (
          work.status === 'claimed' &&
          Date.parse(work.leaseUntil!) <= Date.now()
        ) {
          this.releaseFailure(work, 'Worker lease expired');
        }
      let changed = true,
        rounds = 0;
      while (changed && rounds++ < 2000) {
        changed = false;
        for (const run of this.store.runs())
          if (this.advance(run)) changed = true;
      }
    });
    for (const run of this.store.runs()) {
      const execution = run.executions.at(-1);
      if (
        run.status !== 'running' ||
        execution?.kind !== 'script' ||
        execution.status !== 'running' ||
        this.scriptJobs.has(execution.id)
      )
        continue;
      const node = this.definition(run).nodes.find(
        (n) => n.id === execution.nodeId,
      )!;
      if (node.kind !== 'script') continue;
      const controller = new AbortController();
      this.scriptJobs.set(execution.id, controller);
      void executeScript(
        node.command,
        execution.input,
        node.timeoutMs,
        this.cwd,
        controller.signal,
      )
        .then((output) => {
          if (this.stopped) return;
          this.store.transaction(() => {
            const latest = this.run(run.id);
            if (latest.status === 'cancelled') return;
            const current = latest.executions.at(-1)!;
            this.finish(latest, current, node, output);
          });
        })
        .catch((error) => {
          if (this.stopped) return;
          this.store.transaction(() => {
            const latest = this.run(run.id);
            if (latest.status !== 'cancelled')
              this.fail(latest, latest.executions.at(-1)!, message(error));
          });
        })
        .finally(() => {
          this.scriptJobs.delete(execution.id);
          this.pump();
        });
    }
  }
  available(runId?: string) {
    this.pump();
    const within = (id: string): boolean => {
      if (!runId || id === runId) return true;
      const parent = this.run(id).parentRunId;
      return parent ? within(parent) : false;
    };
    return this.store
      .work()
      .filter((w) => w.status === 'available' && within(w.runId));
  }
  claim(workId: string, worker: Worker, leaseSeconds = 300) {
    this.pump();
    return this.store.transaction(() => {
      const work = this.store.get<WorkRequest>('work', workId);
      if (!work || work.status !== 'available')
        throw new InterlockError('Work is not available');
      if (work.context.mode === 'fresh' && !worker.freshContext)
        throw new InterlockError('This assignment requires fresh context');
      const missingTools = work.context.tools.filter(
        (t) => !worker.tools.includes(t),
      );
      const missingSkills = work.context.skills.filter(
        (s) => !worker.skills.includes(s),
      );
      if (missingTools.length || missingSkills.length)
        throw new InterlockError(
          `Missing capabilities: ${[...missingTools, ...missingSkills].join(', ')}`,
        );
      work.status = 'claimed';
      work.attempt++;
      work.workerId = worker.workerId;
      work.token = randomUUID();
      work.leaseUntil = new Date(
        Date.now() + leaseSeconds * 1000,
      ).toISOString();
      this.store.put('work', work);
      this.event(
        this.run(work.runId),
        'work.claimed',
        `${work.label} claimed by ${worker.workerId}`,
      );
      return work;
    });
  }
  private owned(id: string, token: string) {
    const work = this.store.get<WorkRequest>('work', id);
    if (!work || work.token !== token)
      throw new InterlockError('Claim token does not match');
    if (work.status === 'completed') return work;
    if (work.status !== 'claimed' || Date.parse(work.leaseUntil!) <= Date.now())
      throw new InterlockError('Claim expired or no longer active');
    return work;
  }
  renew(id: string, token: string, leaseSeconds = 300) {
    return this.store.transaction(() => {
      const work = this.owned(id, token);
      if (work.status !== 'claimed')
        throw new InterlockError('Work already completed');
      work.leaseUntil = new Date(
        Date.now() + leaseSeconds * 1000,
      ).toISOString();
      this.store.put('work', work);
      return work;
    });
  }
  submit(id: string, token: string, output: Json) {
    const runId = this.store.transaction(() => {
      const work = this.owned(id, token);
      if (work.status === 'completed') {
        if (!isDeepStrictEqual(work.output, output))
          throw new InterlockError('A different result was already accepted');
        return work.runId;
      }
      assertContract(work.outputSchema, output, 'Agent result');
      const run = this.run(work.runId),
        execution = run.executions.find((e) => e.id === work.executionId)!;
      const node = this.definition(run).nodes.find(
        (n) => n.id === work.nodeId,
      )!;
      this.finish(run, execution, node, output);
      work.status = 'completed';
      work.output = output;
      this.store.put('work', work);
      return run.id;
    });
    this.pump();
    return this.inspect(runId);
  }
  private releaseFailure(work: WorkRequest, error: string) {
    work.error = error;
    work.token = undefined;
    work.leaseUntil = undefined;
    const run = this.run(work.runId);
    if (work.attempt >= work.maxAttempts) {
      work.status = 'failed';
      this.fail(
        run,
        run.executions.find((e) => e.id === work.executionId)!,
        error,
      );
    } else {
      work.status = 'available';
      this.event(run, 'work.retry', `${work.label}: ${error}`);
    }
    this.store.put('work', work);
  }
  reportFailure(id: string, token: string, error: string) {
    const runId = this.store.transaction(() => {
      const work = this.owned(id, token);
      if (work.status === 'completed')
        throw new InterlockError('Work already completed');
      this.releaseFailure(work, error);
      return work.runId;
    });
    this.pump();
    return this.inspect(runId);
  }
  private cancelTree(id: string) {
    const run = this.run(id);
    if (terminal(run.status)) return;
    for (const child of this.store.runs().filter((r) => r.parentRunId === id))
      this.cancelTree(child.id);
    run.status = 'cancelled';
    const execution = run.executions.at(-1);
    if (execution) this.scriptJobs.get(execution.id)?.abort();
    if (execution && !terminal(execution.status))
      execution.status = 'cancelled';
    for (const work of this.store
      .work()
      .filter(
        (w) => w.runId === id && ['available', 'claimed'].includes(w.status),
      )) {
      work.status = 'cancelled';
      work.token = undefined;
      this.store.put('work', work);
    }
    this.save(run);
    this.event(run, 'run.cancelled', 'Run cancelled');
  }
  cancel(id: string) {
    this.store.transaction(() => this.cancelTree(id));
    this.pump();
    return this.inspect(id);
  }
  private resumeStep(run: Run) {
    const execution = run.executions.at(-1);
    run.status = 'running';
    run.error = undefined;
    if (!execution) {
      this.save(run);
      return;
    }
    run.value = execution.input;
    if (execution.kind === 'map' || execution.kind === 'workflow') {
      execution.status = 'waiting';
      execution.error = undefined;
      execution.completedAt = undefined;
      for (const id of execution.childRunIds) {
        const child = this.run(id);
        if (child.status === 'failed' || child.status === 'cancelled')
          this.resumeStep(child);
      }
    }
    this.save(run);
    this.event(run, 'run.retried', 'Explicit retry requested');
  }
  retry(id: string) {
    this.store.transaction(() => {
      const run = this.run(id);
      if (run.status !== 'failed')
        throw new InterlockError('Only failed runs can be retried');
      if (run.parentRunId && terminal(this.run(run.parentRunId).status))
        throw new InterlockError('Retry the failed parent run instead');
      this.resumeStep(run);
    });
    this.pump();
    return this.inspect(id);
  }
}
