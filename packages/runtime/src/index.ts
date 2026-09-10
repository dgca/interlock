import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Store } from '@interlock/storage';
import {
  assertContract,
  blankDefinition,
  definitionSchema,
  InterlockError,
  readPath,
  resolveFetch,
  validateDefinition,
  validateWorkflowReferences,
  type Json,
  type NodeExecution,
  type Run,
  type Workflow,
  type WorkflowDefinition,
  type WorkflowNode,
  type WorkRequest,
} from '@interlock/core';
import { freshContextInstructions } from './agentInstructions.js';
import { executeFetch } from './fetch.js';
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
  private localJobs = new Map<string, AbortController>();
  private stopped = false;
  private listeners = new Set<() => void>();
  constructor(
    readonly store: Store,
    private cwd: string,
  ) {
    // A process interruption gives no evidence that local work or remote side effects completed.
    for (const run of store.runs()) {
      const execution = run.executions.at(-1);
      if (
        run.status === 'running' &&
        (execution?.kind === 'script' || execution?.kind === 'fetch') &&
        execution.status === 'running'
      ) {
        this.fail(
          run,
          execution,
          `Service interrupted during ${execution.kind} execution. Inspect side effects before retrying.`,
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
    return { ...w, ownerWorkflowId: w.ownerWorkflowId ?? null };
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
    ownerWorkflowId: string | null = null,
  ): Workflow {
    if (ownerWorkflowId) {
      const owner = this.workflow(ownerWorkflowId);
      if (owner.ownerWorkflowId)
        throw new InterlockError('Children cannot own workflows');
      if (owner.archived)
        throw new InterlockError('Restore the parent before creating a child');
    }
    const time = now();
    const workflow: Workflow = {
      id: randomUUID(),
      ownerWorkflowId,
      name,
      description,
      archived: false,
      draft: definitionSchema.parse(definition),
      draftRevision: 1,
      latestVersion: 0,
      createdAt: time,
      updatedAt: time,
    };
    validateWorkflowReferences(
      workflow.id,
      workflow.draft,
      this.store.workflows(),
    );
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
        validateWorkflowReferences(w.id, w.draft, this.store.workflows());
        w.draftRevision++;
      }
      w.updatedAt = now();
      this.store.put('workflows', w);
      return w;
    });
  }
  createChild(input: {
    ownerWorkflowId: string;
    name: string;
    parentDraftRevision: number;
    parent: {
      name: string;
      description: string;
      definition: WorkflowDefinition;
    };
    nodeId?: string;
  }) {
    return this.store.transaction(() => {
      const parent = this.workflow(input.ownerWorkflowId);
      if (parent.draftRevision !== input.parentDraftRevision)
        throw new InterlockError(
          'Draft changed elsewhere. Reload before creating a child.',
        );
      const child = this.create(input.name, '', blankDefinition(), parent.id);
      const draft = definitionSchema.parse(input.parent.definition);
      if (input.nodeId) {
        const node = draft.nodes.find((n) => n.id === input.nodeId);
        if (!node || node.kind !== 'workflow')
          throw new InterlockError('Workflow node not found');
        node.workflowId = child.id;
        node.version = null;
      }
      validateWorkflowReferences(parent.id, draft, this.store.workflows());
      parent.draft = draft;
      parent.name = input.parent.name;
      parent.description = input.parent.description;
      parent.draftRevision++;
      parent.updatedAt = now();
      this.store.put('workflows', parent);
      return { parent, child };
    });
  }
  useChildVersion(input: {
    id: string;
    childId: string;
    nodeId: string;
    version: number;
    draftRevision: number;
  }) {
    return this.store.transaction(() => {
      const parent = this.workflow(input.id);
      const child = this.workflow(input.childId);
      if (parent.draftRevision !== input.draftRevision)
        throw new InterlockError(
          'Draft changed elsewhere. Reload before selecting a version.',
        );
      if (child.ownerWorkflowId !== parent.id)
        throw new InterlockError('Child does not belong to this workflow');
      if (!this.store.getVersion(child.id, input.version))
        throw new InterlockError('Workflow version not found');
      const node = parent.draft.nodes.find((n) => n.id === input.nodeId);
      if (!node || node.kind !== 'workflow' || node.workflowId !== child.id)
        throw new InterlockError(
          'The parent no longer references this child at that node',
        );
      node.version = input.version;
      parent.draftRevision++;
      parent.updatedAt = now();
      this.store.put('workflows', parent);
      return parent;
    });
  }
  deleteWorkflow(id: string) {
    const result = this.store.transaction(() => {
      this.workflow(id);
      if (this.store.workflows().some((w) => w.ownerWorkflowId === id))
        throw new InterlockError(
          'Delete the children first. Parent deletion with children is not available yet.',
        );
      const references = (definition: WorkflowDefinition) =>
        definition.nodes.some(
          (node) => node.kind === 'workflow' && node.workflowId === id,
        );
      for (const workflow of this.store.workflows()) {
        if (workflow.id === id) continue;
        const versions = this.store
          .list<import('@interlock/core').WorkflowVersion>('versions')
          .filter((version) => version.workflowId === workflow.id);
        if (
          references(workflow.draft) ||
          versions.some((version) => references(version.definition))
        )
          throw new InterlockError(
            `Cannot delete: "${workflow.name}" references this workflow. Delete the referencing workflow first, or archive this one.`,
          );
      }
      const runs = this.store.runs();
      const removed = new Set(
        runs.filter((run) => run.workflowId === id).map((run) => run.id),
      );
      for (const run of runs)
        if (
          removed.has(run.id) &&
          run.parentRunId &&
          !removed.has(run.parentRunId)
        )
          throw new InterlockError(
            'Cannot delete a workflow with runs belonging to another workflow.',
          );
      let changed = true;
      while (changed) {
        changed = false;
        for (const run of runs)
          if (
            run.parentRunId &&
            removed.has(run.parentRunId) &&
            !removed.has(run.id)
          ) {
            removed.add(run.id);
            changed = true;
          }
      }
      if (runs.some((run) => removed.has(run.id) && !terminal(run.status)))
        throw new InterlockError(
          'Cancel or finish active runs before deleting this workflow.',
        );
      for (const work of this.store.work())
        if (removed.has(work.runId)) this.store.remove('work', work.id);
      for (const event of this.store.list<import('@interlock/core').RunEvent>(
        'events',
      ))
        if (removed.has(event.runId)) this.store.remove('events', event.id);
      for (const runId of removed) this.store.remove('runs', runId);
      for (const version of this.store.list<
        import('@interlock/core').WorkflowVersion & { id: string }
      >('versions'))
        if (version.workflowId === id)
          this.store.remove('versions', version.id);
      this.store.remove('workflows', id);
      return { id };
    });
    queueMicrotask(() => this.listeners.forEach((listener) => listener()));
    return result;
  }
  clone(id: string) {
    const w = this.workflow(id);
    if (this.store.workflows().some((child) => child.ownerWorkflowId === id))
      throw new InterlockError(
        'Cloning a workflow with children is not available yet.',
      );
    return this.create(`${w.name} copy`, w.description, w.draft);
  }
  publish(id: string, cascade = false) {
    return this.store.transaction(() => {
      if (!cascade) return this.publishVersion(id);
      const workflows = this.store.workflows();
      const definitions = new Map(
        workflows.map((w) => [
          w.id,
          w.id === id
            ? w.draft
            : this.store.getVersion(w.id, w.latestVersion)?.definition,
        ]),
      );
      this.workflow(id);
      const affected = new Set([id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const w of workflows) {
          if (
            !affected.has(w.id) &&
            definitions
              .get(w.id)
              ?.nodes.some(
                (n) => n.kind === 'workflow' && affected.has(n.workflowId),
              )
          ) {
            affected.add(w.id);
            changed = true;
          }
        }
      }
      const ordered: string[] = [];
      const visiting = new Set<string>();
      const visited = new Set<string>();
      const visit = (workflowId: string) => {
        if (visiting.has(workflowId))
          throw new InterlockError(
            'Cannot cascade publication through a dependency cycle. Publish versions explicitly.',
          );
        if (visited.has(workflowId)) return;
        visiting.add(workflowId);
        for (const node of definitions.get(workflowId)!.nodes)
          if (node.kind === 'workflow' && affected.has(node.workflowId))
            visit(node.workflowId);
        visiting.delete(workflowId);
        visited.add(workflowId);
        ordered.push(workflowId);
      };
      for (const workflowId of affected) visit(workflowId);
      for (const workflowId of ordered) {
        const w = this.workflow(workflowId);
        if (workflowId !== id) {
          if (!isDeepStrictEqual(w.draft, definitions.get(workflowId)))
            throw new InterlockError(
              `Cannot cascade: "${w.name}" has unpublished definition edits. Publish or discard them first.`,
            );
          for (const node of w.draft.nodes)
            if (node.kind === 'workflow' && affected.has(node.workflowId))
              node.version = this.workflow(node.workflowId).latestVersion;
          w.draftRevision++;
          this.store.put('workflows', w);
        }
        this.publishVersion(workflowId);
      }
      return this.workflow(id);
    });
  }
  private publishVersion(id: string) {
    const w = this.workflow(id);
    const definition = validateDefinition(w.draft);
    validateWorkflowReferences(w.id, definition, this.store.workflows());
    for (const n of definition.nodes) {
      if (
        n.kind === 'workflow' &&
        (n.version === null || !this.store.getVersion(n.workflowId, n.version))
      )
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
  }
  private pinnedVersion(node: Extract<WorkflowNode, { kind: 'workflow' }>) {
    if (node.version === null)
      throw new InterlockError(
        'Cannot execute an unpublished workflow reference',
      );
    return node.version;
  }
  private newRun(
    workflowId: string,
    version: number,
    input: Json,
    parentRunId?: string,
    batchNodeId?: string,
  ): Run {
    const w = this.workflow(workflowId);
    const definition = this.definition({ workflowId, version });
    const itemRoute = batchNodeId
      ? definition.edges.find(
          (e) => e.source === batchNodeId && e.port === 'item',
        )
      : undefined;
    if (batchNodeId && !itemRoute)
      throw new InterlockError('Batch item route not found');
    if (!parentRunId)
      assertContract(definition.inputSchema, input, 'Workflow input');
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
      batchNodeId,
      status: 'running',
      input,
      cursor:
        itemRoute?.target ??
        definition.nodes.find((n) => n.kind === 'entry')!.id,
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
    if (
      w.archived ||
      (w.ownerWorkflowId && this.workflow(w.ownerWorkflowId).archived)
    )
      throw new InterlockError('Restore this workflow before starting it');
    const run = this.store.transaction(() =>
      this.newRun(workflowId, version ?? w.latestVersion, input),
    );
    this.pump();
    return this.inspect(run.id);
  }
  inspect(id: string) {
    const run = this.run(id);
    const allRuns = this.store.runs();
    const ids = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const child of allRuns)
        if (
          child.parentRunId &&
          ids.has(child.parentRunId) &&
          !ids.has(child.id)
        ) {
          ids.add(child.id);
          changed = true;
        }
    }
    return {
      run,
      descendants: allRuns.filter(
        (child) => child.id !== id && ids.has(child.id),
      ),
      descendantWork: this.store
        .work()
        .filter((work) => ids.has(work.runId))
        .map((work) => {
          const { token, ...visible } = this.describeWork(work);
          return visible;
        }),
      definition: this.definition(run),
      work: this.store
        .work()
        .filter((w) => w.runId === id)
        .map((work) => {
          const { token, ...visible } = this.describeWork(work);
          return visible;
        }),
      events: this.store.events(id),
      children: this.store.runs().filter((r) => r.parentRunId === id),
    };
  }
  private definition(
    run: Pick<Run, 'workflowId' | 'version'>,
  ): WorkflowDefinition {
    const snapshot = this.store.getVersion(run.workflowId, run.version);
    if (!snapshot)
      throw new InterlockError('Published workflow version not found');
    return snapshot.definition;
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
    const edge = this.definition(run).edges.find(
      (e) => e.source === node.id && e.port === port,
    );
    if (!edge && node.kind !== 'exit')
      throw new InterlockError(
        'Missing outgoing route; connect item paths to End',
      );
    if (edge?.targetHandle === 'end' && edge.target !== run.batchNodeId)
      throw new InterlockError('End must belong to the current Batch group');
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
    if (node.kind === 'exit' || edge?.targetHandle === 'end') {
      run.status = 'completed';
      run.output = output;
      this.event(
        run,
        'run.completed',
        run.batchNodeId ? 'Item result returned' : 'Workflow completed',
      );
    } else {
      run.cursor = edge!.target;
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
        if (node.batchId !== run.batchNodeId)
          throw new InterlockError('Execution cannot cross Batch groups');
        if (run.executions.length > definition.maxSteps)
          throw new InterlockError('Workflow step limit exceeded');
        if (node.kind === 'entry')
          assertContract(definition.inputSchema, run.input, 'Workflow input');
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
      if (node.kind === 'script' || node.kind === 'fetch') {
        if (node.kind === 'fetch' && !execution.request)
          execution.request = resolveFetch(node, execution.input);
        this.save(run);
        return false;
      }
      if (node.kind === 'workflow' || node.kind === 'batch') {
        const value =
          node.kind !== 'workflow'
            ? readPath(execution.input, node.itemsPath)
            : [execution.input];
        if (!Array.isArray(value))
          throw new InterlockError('Batch input must resolve to an array');
        if (value.length > 200)
          throw new InterlockError('Batch input exceeds 200 items');
        let children = execution.childRunIds.map((id) => this.run(id));
        if (node.kind === 'workflow' || node.failurePolicy === 'all') {
          const failed = children.find(
            (c) =>
              (c.status === 'failed' || c.status === 'cancelled') &&
              !execution!.retryChildRunIds?.includes(c.id),
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
        const concurrency = node.kind !== 'workflow' ? node.concurrency : 1;
        let active = children.filter((c) => !terminal(c.status)).length;
        while (execution.retryChildRunIds?.length && active < concurrency) {
          this.resumeStep(this.run(execution.retryChildRunIds.shift()!));
          active++;
          changed = true;
        }
        while (
          execution.nextItem < value.length &&
          active < concurrency &&
          !execution.retryChildRunIds?.length
        ) {
          const child = this.newRun(
            node.kind === 'batch' ? run.workflowId : node.workflowId,
            node.kind === 'batch' ? run.version : this.pinnedVersion(node),
            value[execution.nextItem],
            run.id,
            node.kind === 'batch' ? node.id : undefined,
          );
          if (node.kind === 'batch') {
            child.workflowName = `${node.label} · item ${execution.nextItem + 1}`;
            this.save(child);
          }
          execution.childRunIds.push(child.id);
          execution.nextItem++;
          active++;
          changed = true;
        }
        children = execution.childRunIds.map((id) => this.run(id));
        if (
          !execution.retryChildRunIds?.length &&
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
          this.finish(
            run,
            execution,
            node,
            output,
            node.kind === 'batch' ? 'complete' : 'default',
          );
          return true;
        }
        execution.status = 'waiting';
        run.status = 'waiting';
        this.save(run);
        return changed;
      }
      if (
        node.kind !== 'entry' &&
        node.kind !== 'exit' &&
        node.kind !== 'condition'
      )
        throw new InterlockError('Unsupported node type in published workflow');
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
    for (const controller of this.localJobs.values()) controller.abort();
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
        // Earlier advances can cancel or resume descendants in this same pass.
        for (const { id } of this.store.runs())
          if (this.advance(this.run(id))) changed = true;
      }
    });
    for (const run of this.store.runs()) {
      const execution = run.executions.at(-1);
      if (
        run.status !== 'running' ||
        (execution?.kind !== 'script' && execution?.kind !== 'fetch') ||
        execution.status !== 'running' ||
        this.localJobs.has(execution.id)
      )
        continue;
      const node = this.definition(run).nodes.find(
        (n) => n.id === execution.nodeId,
      )!;
      if (node.kind !== 'script' && node.kind !== 'fetch') continue;
      const controller = new AbortController();
      this.localJobs.set(execution.id, controller);
      const job =
        node.kind === 'fetch'
          ? executeFetch(execution.request!, node.timeoutMs, controller.signal)
          : executeScript(
              node.command,
              execution.input,
              node.timeoutMs,
              this.cwd,
              controller.signal,
              node.language,
            );
      void job
        .then((output) => {
          if (this.stopped) return;
          this.store.transaction(() => {
            const latest = this.run(run.id);
            if (
              latest.status !== 'running' ||
              latest.executions.at(-1)?.id !== execution.id
            )
              return;
            const current = latest.executions.at(-1)!;
            if (node.kind === 'fetch') {
              current.output = output;
              const status = (output as { status: number }).status;
              if (node.failOnHttpError && (status < 200 || status >= 300)) {
                this.fail(latest, current, `Fetch returned HTTP ${status}`);
                return;
              }
            }
            this.finish(latest, current, node, output);
          });
        })
        .catch((error) => {
          if (this.stopped) return;
          this.store.transaction(() => {
            const latest = this.run(run.id);
            if (
              latest.status === 'running' &&
              latest.executions.at(-1)?.id === execution.id
            )
              this.fail(latest, latest.executions.at(-1)!, message(error));
          });
        })
        .finally(() => {
          this.localJobs.delete(execution.id);
          this.pump();
        });
    }
  }
  private describeWork(work: WorkRequest): WorkRequest {
    if (work.context.mode !== 'fresh') return work;
    let root = this.run(work.runId);
    while (root.parentRunId) root = this.run(root.parentRunId);
    return {
      ...work,
      executionInstructions: freshContextInstructions(root.id, work.id),
    };
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
      .filter((w) => w.status === 'available' && within(w.runId))
      .map((work) => this.describeWork(work));
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
      return this.describeWork(work);
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
    if (execution) this.localJobs.get(execution.id)?.abort();
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
    if (execution.kind === 'batch' || execution.kind === 'workflow') {
      execution.status = 'waiting';
      execution.error = undefined;
      execution.completedAt = undefined;
      execution.retryChildRunIds = execution.childRunIds.filter((id) => {
        const child = this.run(id);
        return child.status === 'failed' || child.status === 'cancelled';
      });
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
      if (run.parentRunId) {
        const parent = this.run(run.parentRunId);
        const execution = parent.executions.at(-1);
        if (execution?.kind === 'batch' && execution.childRunIds.includes(id)) {
          execution.retryChildRunIds ??= [];
          if (!execution.retryChildRunIds.includes(id))
            execution.retryChildRunIds.push(id);
          this.save(parent);
          this.event(
            run,
            'run.retry-queued',
            'Explicit retry queued within parent concurrency limit',
          );
          return;
        }
      }
      this.resumeStep(run);
    });
    this.pump();
    return this.inspect(id);
  }
}
