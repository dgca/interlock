import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Store } from '@interlock/storage';
import { tidyWorkflow } from '@interlock/core/layout';
import {
  assertContract,
  workHoldRequestSchema,
  HoldDeadlineError,
  type WorkHoldRequest,
  checkAgentResult,
  ResultRejection,
  type ResultCheck,
  DEFAULT_BATCH_MAX_ITEMS,
  STARTED_RUN_SCHEMA,
  isStartedRunSchema,
  isPollWait,
  hasTimeoutRoute,
  hasFailureRoute,
  type FailureCategory,
  blankDefinition,
  definitionSchema,
  InterlockError,
  readPath,
  resolveFetch,
  validateDefinition,
  applyWorkflowEdits,
  diagnoseDraft,
  summarizeDiagnostics,
  draftChanges,
  type DraftDiagnostic,
  validateWorkflowReferences,
  type Json,
  type NodeExecution,
  type Run,
  type RunAncestry,
  type Workflow,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkRequest,
  composePrompt,
  promptIds,
  continuationLimitSchema,
  budgetPolicySchema,
  type BudgetPolicy,
  type ContextHandoffInput,
  type SessionIdentity,
  type ModelSelection,
  modelSelectionSchema,
  draftLayoutSchema,
  type DraftLayout,
} from '@interlock/core';
import { freshContextInstructions } from './agentInstructions.js';
import { executeFetch } from './fetch.js';
import { executeScript } from './scripts.js';
import { Continuation } from './continuation.js';
import { Prompts } from './prompts.js';
import { VersionCleanup } from './versionCleanup.js';
import { Ownership } from './ownership.js';
import { Testbench } from './testbench.js';
import { Simulations } from './simulation.js';
import { Usage } from './usage.js';
import { Budgets } from './budgets.js';
import { WorkHolds } from './workHolds.js';
import { AssignmentSizes } from './assignmentSize.js';
import { ContextContinuityGroups } from './contextContinuity.js';
import { claimTokenHash, leaseCounts, expiredClaimMessage } from './leases.js';

class ExpiredClaimError extends InterlockError {}

const now = () => new Date().toISOString();
const terminal = (s: string) =>
  ['completed', 'failed', 'cancelled'].includes(s);
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export interface Worker {
  modelSelection?: ModelSelection;
  session?: SessionIdentity;
  workerId: string;
  freshContext: boolean;
  tools: string[];
  skills: string[];
}

export class Engine {
  readonly continuation: Continuation;
  readonly prompts: Prompts;
  readonly versions: VersionCleanup;
  readonly ownership: Ownership;
  readonly testbench: Testbench;
  readonly simulations: Simulations;
  readonly usage: Usage;
  readonly budgets: Budgets;
  readonly assignmentSizes: AssignmentSizes;
  readonly holds: WorkHolds;
  readonly contextGroups: ContextContinuityGroups;
  private localJobs = new Map<string, AbortController>();
  private stopped = false;
  private listeners = new Set<() => void>();
  constructor(
    readonly store: Store,
    private cwd: string,
    private options: {
      substituteOperation?: (
        node: Extract<WorkflowNode, { kind: 'script' | 'fetch' }>,
        execution: NodeExecution,
      ) => Promise<Json>;
    } = {},
  ) {
    this.simulations = new Simulations(store, cwd);
    this.continuation = new Continuation(store);
    this.holds = new WorkHolds(
      store,
      (work, outcome) => this.usage.ended(work, outcome),
      (work) => {
        const node = this.definition(this.run(work.runId)).nodes.find(
          (n) => n.id === work.nodeId,
        );
        return node?.kind === 'agent' ? node.unclaimedTimeoutMs : undefined;
      },
      (runId, type, message) => this.event(this.run(runId), type, message),
    );
    this.prompts = new Prompts(store);
    this.assignmentSizes = new AssignmentSizes(store, this.prompts, (work) =>
      this.describeWork(work),
    );
    this.versions = new VersionCleanup(store);
    this.ownership = new Ownership(store);
    this.usage = new Usage(store, (runId) => {
      this.budgets.refresh();
      this.event(
        this.run(runId),
        'work.usage_reported',
        'Executor usage updated',
      );
    });
    this.budgets = new Budgets(store, this.usage, (runId, blocked) =>
      this.event(
        this.run(runId),
        'run.budget_updated',
        blocked
          ? 'Agent claims blocked by budget'
          : 'Budget updated; claim eligibility rechecked',
      ),
    );
    this.contextGroups = new ContextContinuityGroups(store, (runId) =>
      this.event(
        this.run(runId),
        'context.updated',
        'Context continuity binding updated',
      ),
    );
    this.testbench = new Testbench(store, {
      create: (workflowId, version, input, comparison) =>
        this.newRun(
          workflowId,
          version,
          input,
          undefined,
          undefined,
          comparison,
        ),
      cancel: (id) => this.cancelTree(id),
    });
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
  describeWorkflow(workflow: Workflow) {
    const latest = this.store.getVersion(workflow.id, workflow.latestVersion);
    return {
      ...workflow,
      draftMatchesLatest: latest
        ? isDeepStrictEqual(workflow.draft, latest.definition)
        : null,
    };
  }
  authoringSummary(workflow: Workflow) {
    const { id, draftRevision, latestVersion, draftMatchesLatest, archived } =
      this.describeWorkflow(workflow);
    return {
      ok: true as const,
      id,
      draftRevision,
      latestVersion,
      draftMatchesLatest,
      archived,
    };
  }
  run(id: string) {
    const run = this.store.get<Run>('runs', id);
    if (!run) throw new InterlockError('Run not found');
    return run;
  }
  private arrangeDraft(definition: WorkflowDefinition, layout?: DraftLayout) {
    const parsed = definitionSchema.parse(definition);
    if (layout === undefined) return parsed;
    draftLayoutSchema.parse(layout);
    return definitionSchema.parse(tidyWorkflow(parsed));
  }
  create(
    name: string,
    description = '',
    definition = blankDefinition(),
    ownerWorkflowId: string | null = null,
    layout?: DraftLayout,
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
      draft: this.arrangeDraft(definition, layout),
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
      layout?: DraftLayout;
    },
  ) {
    return this.store.transaction(() => {
      const w = this.workflow(id);
      if (
        (patch.draft || patch.layout !== undefined) &&
        patch.draftRevision !== w.draftRevision
      )
        throw new InterlockError(
          'Draft changed elsewhere. Reload before saving.',
        );
      if (patch.name !== undefined) w.name = patch.name;
      if (patch.description !== undefined) w.description = patch.description;
      if (patch.archived !== undefined) w.archived = patch.archived;
      if (patch.draft || patch.layout !== undefined) {
        w.draft = this.arrangeDraft(patch.draft ?? w.draft, patch.layout);
        validateWorkflowReferences(w.id, w.draft, this.store.workflows());
        w.draftRevision++;
      }
      w.updatedAt = now();
      this.store.put('workflows', w);
      return w;
    });
  }
  validateDraft(id: string, candidate?: unknown) {
    const w = this.workflow(id);
    const result = diagnoseDraft(candidate === undefined ? w.draft : candidate);
    this.addReferenceDiagnostics(w.id, result.definition, result.diagnostics);
    return {
      draftRevision: w.draftRevision,
      saveable: !result.diagnostics.some(
        (d) => d.category === 'save' && d.severity === 'error',
      ),
      publishable: !result.diagnostics.some(
        (d) => d.category !== 'contract' && d.severity === 'error',
      ),
      diagnostics: result.diagnostics,
    };
  }
  private addReferenceDiagnostics(
    id: string,
    definition: WorkflowDefinition | undefined,
    diagnostics: DraftDiagnostic[],
  ) {
    if (definition) {
      const workflows = this.store.workflows();
      for (const [i, node] of definition.nodes.entries()) {
        if (node.kind === 'agent') {
          for (const [j, promptId] of (node.promptIds ?? []).entries())
            if (!this.store.get('prompts', promptId))
              diagnostics.push({
                severity: 'error',
                category: 'publication',
                code: 'missing_prompt',
                nodeId: node.id,
                path: `nodes.${i}.promptIds.${j}`,
                message: `Saved prompt ${promptId} does not exist.`,
              });
        }
        if (node.kind !== 'workflow') continue;
        try {
          validateWorkflowReferences(
            id,
            { ...definition, nodes: [node] },
            workflows,
          );
        } catch (error) {
          diagnostics.push({
            severity: 'error',
            category: 'save',
            code: 'workflow_ownership',
            nodeId: node.id,
            path: `nodes.${i}.workflowId`,
            message: (error as Error).message,
          });
        }
        if (
          node.version !== null &&
          !this.store.getVersion(node.workflowId, node.version)
        )
          diagnostics.push({
            severity: 'error',
            category: 'publication',
            code: 'missing_workflow_version',
            nodeId: node.id,
            path: `nodes.${i}.version`,
            message: 'Referenced workflow version does not exist.',
          });
      }
    }
  }
  editDraft(
    id: string,
    draftRevision: number,
    edits: unknown,
    diagnosticsMode: 'all' | 'summary' = 'all',
    layout?: DraftLayout,
  ) {
    return this.store.transaction(() => {
      const w = this.workflow(id);
      const before =
        diagnosticsMode === 'summary' ? this.validateDraft(id).diagnostics : [];
      const project = (diagnostics: DraftDiagnostic[]) =>
        diagnosticsMode === 'summary'
          ? summarizeDiagnostics(before, diagnostics)
          : { diagnostics };
      const unchanged = draftChanges(w.draft, w.draft);
      const failure = (diagnostics: DraftDiagnostic[]) => ({
        applied: false,
        draftRevision: w.draftRevision,
        changes: unchanged,
        ...project(diagnostics),
      });
      if (draftRevision !== w.draftRevision)
        return failure([
          {
            severity: 'error',
            category: 'save',
            code: 'stale_revision',
            path: 'draftRevision',
            message: 'Draft changed elsewhere. Reload before editing.',
          },
        ]);
      const result = applyWorkflowEdits(w.draft, edits);
      if (!result.definition) return failure(result.diagnostics);
      this.addReferenceDiagnostics(id, result.definition, result.diagnostics);
      const validation = result;
      if (
        validation.diagnostics.some(
          (d) => d.category === 'save' && d.severity === 'error',
        )
      ) {
        // The latest node edit touching a rejected reference identifies its operation.
        for (const diagnostic of validation.diagnostics) {
          if (
            diagnostic.category !== 'save' ||
            !diagnostic.nodeId ||
            !Array.isArray(edits)
          )
            continue;
          for (let i = edits.length - 1; i >= 0; i--) {
            const edit = edits[i] as {
              op: string;
              id?: string;
              node?: { id?: string };
            };
            if (
              (edit.op === 'update_node' && edit.id === diagnostic.nodeId) ||
              (edit.op === 'add_node' && edit.node?.id === diagnostic.nodeId)
            ) {
              diagnostic.operationIndex = i;
              break;
            }
          }
        }
        return failure(validation.diagnostics);
      }
      result.definition = this.arrangeDraft(result.definition, layout);
      const changes = draftChanges(w.draft, result.definition);
      const changed =
        changes.settings.length > 0 ||
        Object.values(changes.nodes).some((ids) => ids.length > 0) ||
        Object.values(changes.edges).some((ids) => ids.length > 0);
      if (changed) {
        w.draft = result.definition;
        w.draftRevision++;
        w.updatedAt = now();
        this.store.put('workflows', w);
      }
      return {
        applied: true,
        draftRevision: w.draftRevision,
        changes,
        ...project(validation.diagnostics),
      };
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
      this.testbench.assertDeletable(id);
      this.simulations.assertDeletable(id);
      if (this.store.workflows().some((w) => w.ownerWorkflowId === id))
        throw new InterlockError(
          'Delete the children first. Parent deletion with children is not available yet.',
        );
      const references = (definition: WorkflowDefinition) =>
        definition.nodes.some(
          (node) => node.kind === 'workflow' && node.workflowId === id,
        );
      const versions =
        this.store.list<import('@interlock/core').WorkflowVersion>('versions');
      const blockers: string[] = [];
      let hasPublishedReferences = false;
      for (const workflow of this.store.workflows()) {
        if (workflow.id === id) continue;
        const referencedVersions = versions
          .filter(
            (version) =>
              version.workflowId === workflow.id &&
              references(version.definition),
          )
          .map((version) => version.version)
          .sort((a, b) => a - b);
        const locations: string[] = [];
        if (references(workflow.draft)) locations.push('draft');
        if (referencedVersions.length) {
          hasPublishedReferences = true;
          locations.push(
            `published versions ${referencedVersions.map((version) => `v${version}${version === workflow.latestVersion ? ' (latest)' : ''}`).join(', ')}`,
          );
        }
        if (!locations.length) continue;
        const latest =
          workflow.latestVersion > 0 &&
          !referencedVersions.includes(workflow.latestVersion)
            ? `; latest v${workflow.latestVersion} does not reference it`
            : '';
        blockers.push(
          `"${workflow.name}" (${workflow.id}): ${locations.join('; ')}${latest}`,
        );
      }
      if (blockers.length)
        throw new InterlockError(
          `Cannot delete: referenced by ${blockers.join('; ')}. ${
            hasPublishedReferences
              ? 'Published references are immutable. Preview explicit old-version cleanup to remove obsolete callers after reviewing history loss. Remove current draft references first, or archive this workflow to preserve its versions and history.'
              : 'Remove these draft references first, or archive this workflow to preserve its history.'
          }`,
        );
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
      this.usage.removeRuns(removed);
      this.holds.removeRuns(removed);
      this.budgets.removeRuns(removed);
      this.contextGroups.removeRuns(removed);
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
      for (const version of this.store.list<
        import('@interlock/core').DeletedWorkflowVersion & { id: string }
      >('deletedVersions'))
        if (version.workflowId === id)
          this.store.remove('deletedVersions', version.id);
      this.testbench.deleteWorkflow(id);
      this.simulations.deleteWorkflow(id);
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
    this.prompts.capture(definition);
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
    comparison?: import('@interlock/core').ComparisonRunContext,
  ): Run {
    const w = this.workflow(workflowId);
    // Preserve existing dispatch-time failures for invalid nested pins; cleanup
    // dependencies are rejected before startup so deleted history is not replayed.
    this.versions.assertRunnable({ workflowId, version }, true);
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
    comparison ??= parentRunId ? this.run(parentRunId).comparison : undefined;
    const capturedPrompts = comparison
      ? this.testbench.promptsFor(comparison)
      : undefined;
    const time = now();
    const run: Run = {
      ...(comparison ? { comparison } : {}),
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
      promptSnapshots:
        batchNodeId && parentRunId
          ? this.run(parentRunId).promptSnapshots
          : capturedPrompts
            ? promptIds(definition).map((id) => {
                const prompt = capturedPrompts.find((p) => p.id === id);
                if (!prompt)
                  throw new InterlockError(
                    `Comparison prompt capture ${id} is missing`,
                  );
                return prompt;
              })
            : this.prompts.capture(definition),
    };
    this.save(run);
    this.event(run, 'run.started', `Started ${w.name} v${version}`);
    return run;
  }
  start(
    workflowId: string,
    input: Json,
    version?: number,
    budget?: BudgetPolicy,
  ) {
    return this.inspect(this.startRun(workflowId, input, version, budget));
  }
  startSummary(
    workflowId: string,
    input: Json,
    version?: number,
    limit = 20,
    budget?: BudgetPolicy,
  ) {
    const bounded = continuationLimitSchema.parse(limit);
    const id = this.startRun(workflowId, input, version, budget);
    return this.continuation.summary(id, bounded);
  }
  private startRun(
    workflowId: string,
    input: Json,
    version?: number,
    budget?: BudgetPolicy,
  ) {
    const w = this.workflow(workflowId);
    if (
      w.archived ||
      (w.ownerWorkflowId && this.workflow(w.ownerWorkflowId).archived)
    )
      throw new InterlockError('Restore this workflow before starting it');
    const policy =
      budget === undefined ? undefined : budgetPolicySchema.parse(budget);
    const run = this.store.transaction(() => {
      const run = this.newRun(workflowId, version ?? w.latestVersion, input);
      if (policy)
        this.budgets.set({
          runId: run.id,
          expectedRevision: 0,
          budget: policy,
        });
      return run;
    });
    this.pump();
    return run.id;
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
      counterpartRunId: this.testbench.counterpart(run),
      descendants: allRuns.filter(
        (child) => child.id !== id && ids.has(child.id),
      ),
      descendantWork: this.store
        .work()
        .filter((work) => ids.has(work.runId))
        .map((work) => {
          const { token, ...visible } = this.describeWork(work);
          return {
            ...visible,
            ...(work.holdRevision
              ? { holdHistory: this.holds.history(work.id) }
              : {}),
          };
        }),
      definition:
        this.store.getVersion(run.workflowId, run.version)?.definition ?? null,
      definitionAvailable: Boolean(
        this.store.getVersion(run.workflowId, run.version),
      ),
      work: this.store
        .work()
        .filter((w) => w.runId === id)
        .map((work) => {
          const { token, ...visible } = this.describeWork(work);
          return {
            ...visible,
            ...(work.holdRevision
              ? { holdHistory: this.holds.history(work.id) }
              : {}),
          };
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
      if (
        this.run(id).parentMode !== 'detached' &&
        !terminal(this.run(id).status)
      )
        this.cancelTree(id);
    execution.status = 'failed';
    execution.error = error;
    execution.completedAt = now();
    run.status = 'failed';
    run.error = error;
    this.save(run);
    this.event(run, 'node.failed', `${execution.label}: ${error}`);
  }
  private failOperation(
    run: Run,
    execution: NodeExecution,
    node: WorkflowNode,
    error: string,
    category: FailureCategory,
  ) {
    if (!hasFailureRoute(node)) return this.fail(run, execution, error);
    const edge = this.definition(run).edges.find(
      (e) => e.source === node.id && e.port === 'failed',
    );
    if (
      !edge ||
      (edge.targetHandle === 'end' && edge.target !== run.batchNodeId)
    )
      return this.fail(run, execution, `${error}; invalid Failed route`);
    const value: Json = {
      input: execution.input,
      error: {
        nodeId: node.id,
        executionId: execution.id,
        kind: node.kind,
        category,
        message: error,
      },
      output: execution.output ?? null,
    };
    execution.status = 'failed';
    execution.error = error;
    execution.port = 'failed';
    execution.completedAt = now();
    run.value = value;
    if (edge.targetHandle === 'end') {
      run.status = 'completed';
      run.output = value;
      this.event(run, 'run.completed', 'Item result returned');
    } else {
      run.cursor = edge.target;
      run.status = 'running';
    }
    this.save(run);
    this.event(run, 'node.failed', `${execution.label}: ${error}`);
    this.event(
      run,
      'node.failure_routed',
      `${execution.label}: followed Failed`,
    );
  }
  private finish(
    run: Run,
    execution: NodeExecution,
    node: WorkflowNode,
    output: Json,
    port: WorkflowEdge['port'] = 'default',
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
    // A timeout returns the original input, not a result.
    if (!(port === 'timeout' && hasTimeoutRoute(node)))
      assertContract(
        node.kind === 'workflow' && node.mode === 'detached'
          ? STARTED_RUN_SCHEMA
          : node.outputSchema,
        output,
        `${node.label} output`,
      );
    if (node.kind === 'exit')
      assertContract(
        this.definition(run).outputSchema,
        output,
        'Workflow output',
      );
    execution.output = output;
    execution.port = port;
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
        if (node.inputBindings) {
          execution.originalInput = run.value;
          let workflowRun = run;
          while (workflowRun.batchNodeId && workflowRun.parentRunId)
            workflowRun = this.run(workflowRun.parentRunId);
          let root = workflowRun;
          while (root.parentRunId) root = this.run(root.parentRunId);
          const sources = {
            input: run.value,
            runInput: workflowRun.input,
            rootInput: root.input,
            itemInput: run.input,
          };
          execution.input = Object.fromEntries(
            Object.entries(node.inputBindings).map(([key, binding]) => {
              if (binding.source === 'itemInput' && !run.batchNodeId)
                throw new InterlockError(
                  'itemInput is only available inside a Batch item run',
                );
              if (binding.source === 'node') {
                const previous = run.executions.findLast(
                  (candidate) =>
                    candidate.nodeId === binding.nodeId &&
                    candidate.status === 'completed',
                );
                if (!previous || previous.output === undefined)
                  throw new InterlockError(
                    `Node "${binding.nodeId}" has no completed output in this run`,
                  );
                return [key, readPath(previous.output, binding.path)];
              }
              return [key, readPath(sources[binding.source], binding.path)];
            }),
          );
        }
        if (node.batchId !== run.batchNodeId)
          throw new InterlockError('Execution cannot cross Batch groups');
        if (run.executions.length > definition.maxSteps)
          throw new InterlockError(
            `Workflow step limit exceeded (${definition.maxSteps} steps); could not start ${node.label}`,
          );
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
        if (execution.status === 'waiting') {
          if (node.unclaimedTimeoutMs === undefined) return false;
          const work = this.store
            .work()
            .find(
              (w) =>
                w.executionId === execution!.id && w.status === 'available',
            );
          if (
            work?.budgetBlocked ||
            !work?.availableUntil ||
            Date.parse(work.availableUntil) > Date.now()
          )
            return false;
          work.status = 'timed_out';
          this.store.put('work', work);
          this.event(
            run,
            'work.timed_out',
            `${node.label}: unclaimed deadline reached`,
          );
          this.finish(run, execution, node, execution.input, 'timeout');
          return true;
        }
        const savedPrompts = (node.promptIds ?? []).map((id) => {
          const snapshot = run.promptSnapshots?.find((p) => p.id === id);
          if (!snapshot)
            throw new InterlockError(`Missing captured prompt ${id}`);
          return snapshot;
        });
        const work: WorkRequest = {
          id: randomUUID(),
          runId: run.id,
          executionId: execution.id,
          nodeId: node.id,
          label: node.label,
          prompt: composePrompt(node.prompt, savedPrompts),
          ...(savedPrompts.length ? { savedPrompts } : {}),
          input: execution.input,
          context: node.context,
          ...(node.context.continuityGroup
            ? {
                continuity: this.contextGroups.describe(
                  run.id,
                  node.context.continuityGroup,
                ),
              }
            : {}),
          outputSchema: node.outputSchema,
          ...(node.resultRules ? { resultRules: node.resultRules } : {}),
          status: 'available',
          attempt: 0,
          maxAttempts: node.maxAttempts,
          ...(node.maxLeaseExpiries === undefined
            ? {}
            : {
                maxLeaseExpiries: node.maxLeaseExpiries,
                failureCount: 0,
                leaseExpiryCount: 0,
              }),
          leaseSeconds: node.leaseSeconds,
          availableUntil:
            node.unclaimedTimeoutMs === undefined
              ? undefined
              : new Date(Date.now() + node.unclaimedTimeoutMs).toISOString(),
          createdAt: now(),
        };
        this.store.put('work', work);
        this.budgets.refresh();
        execution.status = 'waiting';
        run.status = 'waiting';
        this.save(run);
        this.event(run, 'work.available', `Awaiting agent: ${node.label}`);
        return true;
      }
      if (isPollWait(node)) {
        if (!execution.nextCheckAt) {
          const started = Date.now();
          execution.nextCheckAt = new Date(started).toISOString();
          execution.resumeAt = execution.nextCheckAt;
          if (node.timing.timeoutMs !== undefined)
            execution.timeoutAt = new Date(
              started + node.timing.timeoutMs,
            ).toISOString();
          execution.status = 'waiting';
          run.status = 'waiting';
          this.save(run);
          this.event(
            run,
            'node.waiting',
            `${node.label}: checking every ${Math.round(node.timing.everyMs / 1000)}s${execution.timeoutAt ? ` until ${execution.timeoutAt}` : ''}`,
          );
        }
        if (this.finishPollTimeout(run, execution, node)) return true;
        return false;
      }
      if (node.kind === 'wait') {
        if (!execution.resumeAt) {
          if (node.timing.kind === 'duration') {
            execution.resumeAt = new Date(
              Date.now() + node.timing.ms,
            ).toISOString();
          } else {
            const value = readPath(execution.input, node.timing.path);
            if (
              typeof value !== 'string' ||
              !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
                value,
              ) ||
              !Number.isFinite(Date.parse(value)) ||
              new Date(value.slice(0, 10) + 'T00:00:00Z')
                .toISOString()
                .slice(0, 10) !== value.slice(0, 10)
            )
              throw new InterlockError(
                'Wait requires an ISO timestamp with a timezone, such as 2026-09-10T12:00:00Z',
              );
            execution.resumeAt = new Date(value).toISOString();
          }
          execution.status = 'waiting';
          run.status = 'waiting';
          this.save(run);
          this.event(
            run,
            'node.waiting',
            `${node.label}: waiting until ${execution.resumeAt}`,
          );
        }
        if (Date.parse(execution.resumeAt) > Date.now()) return false;
        this.finish(run, execution, node, execution.input);
        return true;
      }
      if (node.kind === 'script' || node.kind === 'fetch') {
        if (node.kind === 'fetch' && !execution.request)
          execution.request = resolveFetch(node, execution.input);
        this.save(run);
        return false;
      }
      if (node.kind === 'workflow' && node.mode === 'detached') {
        if (!isStartedRunSchema(node.outputSchema))
          throw new InterlockError(
            `${node.label}: Start and continue requires the fixed Started run output contract`,
          );
        const version = this.pinnedVersion(node);
        const target = this.definition({
          workflowId: node.workflowId,
          version,
        });
        assertContract(
          target.inputSchema,
          execution.input,
          `${node.label}: workflow input`,
        );
        // A savepoint protects child creation if finishing the dispatch fails.
        // Mutate a copy so the failure path never retains rolled-back child IDs.
        this.store.transaction(() => {
          const dispatched = structuredClone(run);
          const step = dispatched.executions.at(-1)!;
          const child = step.childRunIds.length
            ? this.run(step.childRunIds[0])
            : this.newRun(node.workflowId, version, step.input, run.id);
          child.parentMode = 'detached';
          child.parentExecutionId = step.id;
          this.save(child);
          step.childRunIds = [child.id];
          this.finish(dispatched, step, node, {
            runId: child.id,
            workflowId: child.workflowId,
            version: child.version,
          });
        });
        return true;
      }
      if (node.kind === 'workflow' || node.kind === 'batch') {
        const value =
          node.kind !== 'workflow'
            ? readPath(execution.input, node.itemsPath)
            : [execution.input];
        if (!Array.isArray(value))
          throw new InterlockError('Batch input must resolve to an array');
        if (
          node.kind === 'batch' &&
          value.length > (node.maxItems ?? DEFAULT_BATCH_MAX_ITEMS)
        )
          throw new InterlockError(
            `Batch input has ${value.length} items; limit is ${node.maxItems ?? DEFAULT_BATCH_MAX_ITEMS} items (maxItems). Raise Maximum items or split the input.`,
          );
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
              `Child run ${failed.id}: ${failed.error ?? failed.status}${node.kind === 'batch' ? `; ${children.filter((c) => c.status === 'completed').length} of ${value.length} Batch items completed` : ''}`,
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
      if (node.kind === 'switch') {
        const value = readPath(execution.input, node.path);
        const port =
          node.cases.find((entry) => isDeepStrictEqual(value, entry.equals))
            ?.port ?? node.default;
        if (port === undefined)
          throw new InterlockError(
            `${node.label}: no case matched ${JSON.stringify(value)} ${node.path ? `at input field "${node.path}"` : 'for the whole input'}`,
          );
        this.finish(run, execution, node, execution.input, port);
        return true;
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
          ? isDeepStrictEqual(readPath(execution.input, node.path), node.equals)
            ? 'true'
            : 'false'
          : 'default',
      );
      return true;
    } catch (error) {
      this.fail(run, execution, message(error));
      return true;
    }
  }
  stop() {
    this.simulations.stop();
    this.continuation.stop();
    this.stopped = true;
    for (const controller of this.localJobs.values()) controller.abort();
  }
  pump() {
    if (this.stopped) return;
    this.store.transaction(() => {
      this.budgets.refresh();
      for (const work of this.store.work())
        if (
          work.status === 'claimed' &&
          Date.parse(work.leaseUntil!) <= Date.now()
        ) {
          work.expiredClaims = [
            ...(work.expiredClaims ?? []),
            {
              tokenHash: claimTokenHash(work.token!),
              expiredAt: work.leaseUntil!,
              attempt: work.attempt,
            },
          ];
          this.releaseFailure(work, 'Worker lease expired', 'expiry');
        }
      let changed = true,
        rounds = 0;
      while (changed && rounds++ < 2000) {
        this.budgets.refresh();
        changed = this.testbench.advance();
        // Earlier advances can cancel or resume descendants in this same pass.
        for (const { id } of this.store.runs())
          if (this.advance(this.run(id))) changed = true;
      }
    });
    for (const run of this.store.runs()) {
      const execution = run.executions.at(-1);
      if (!execution || this.localJobs.has(execution.id)) continue;
      if (execution.kind === 'wait') {
        if (run.status === 'waiting' && execution.status === 'waiting')
          this.runPollCheck(run, execution);
        continue;
      }
      if (
        run.status !== 'running' ||
        (execution.kind !== 'script' && execution.kind !== 'fetch') ||
        execution.status !== 'running'
      )
        continue;
      const node = this.definition(run).nodes.find(
        (n) => n.id === execution.nodeId,
      )!;
      if (node.kind !== 'script' && node.kind !== 'fetch') continue;
      const controller = new AbortController();
      this.localJobs.set(execution.id, controller);
      const job = this.options.substituteOperation
        ? this.options.substituteOperation(node, execution)
        : node.kind === 'fetch'
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
        .then(
          (output) => ({ ok: true as const, output }),
          (error) => ({ ok: false as const, error: message(error) }),
        )
        .then((result) => {
          if (this.stopped) return;
          this.store.transaction(() => {
            const latest = this.run(run.id);
            if (
              latest.status !== 'running' ||
              latest.executions.at(-1)?.id !== execution.id
            )
              return;
            const current = latest.executions.at(-1)!;
            if (!result.ok) {
              this.failOperation(
                latest,
                current,
                node,
                result.error,
                'execution',
              );
              return;
            }
            const output = result.output;
            if (node.kind === 'fetch') {
              current.output = output;
              const status = (output as { status: number }).status;
              if (node.failOnHttpError && (status < 200 || status >= 300)) {
                this.failOperation(
                  latest,
                  current,
                  node,
                  `Fetch returned HTTP ${status}`,
                  'http',
                );
                return;
              }
            }
            try {
              // Retain returned data even if its success contract rejects it.
              if (hasFailureRoute(node)) current.output = output;
              assertContract(node.outputSchema, output, `${node.label} output`);
            } catch (error) {
              this.failOperation(
                latest,
                current,
                node,
                message(error),
                'output',
              );
              return;
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
  private finishPollTimeout(
    run: Run,
    execution: NodeExecution,
    node: WorkflowNode,
  ): boolean {
    if (!execution.timeoutAt || Date.parse(execution.timeoutAt) > Date.now())
      return false;
    this.localJobs.get(execution.id)?.abort();
    this.event(
      run,
      'node.timed_out',
      `${node.label}: no passing check before ${execution.timeoutAt}`,
    );
    this.finish(run, execution, node, execution.input, 'timeout');
    return true;
  }
  /**
   * Run a polling Wait's check when it is due. The check is a server-side job
   * like a Script or Fetch step, but the execution stays `waiting`: a passing
   * result finishes the step, anything else schedules the next check. A check
   * interrupted by a restart simply runs again.
   */
  private runPollCheck(run: Run, execution: NodeExecution) {
    const node = this.definition(run).nodes.find(
      (n) => n.id === execution.nodeId,
    );
    if (!node || !isPollWait(node)) return;
    if (
      !execution.nextCheckAt ||
      Date.parse(execution.nextCheckAt) > Date.now() ||
      (execution.timeoutAt && Date.parse(execution.timeoutAt) <= Date.now())
    )
      return;
    const { timing } = node;
    const controller = new AbortController();
    this.localJobs.set(execution.id, controller);
    const job: Promise<Json> = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return timing.check.kind === 'fetch'
        ? executeFetch(
            resolveFetch(timing.check, execution.input),
            timing.check.timeoutMs,
            controller.signal,
          ).then((output) => {
            const status = (output as { status: number }).status;
            if (
              timing.check.kind === 'fetch' &&
              timing.check.failOnHttpError &&
              (status < 200 || status >= 300)
            )
              throw new InterlockError(`Fetch returned HTTP ${status}`);
            return output;
          })
        : executeScript(
            timing.check.command,
            execution.input,
            timing.check.timeoutMs,
            this.cwd,
            controller.signal,
            timing.check.language,
          );
    });
    const settle = (result: { output?: Json; error?: string }) => {
      if (this.stopped) return;
      this.store.transaction(() => {
        const latest = this.run(run.id);
        const current = latest.executions.at(-1);
        if (
          latest.status !== 'waiting' ||
          current?.id !== execution.id ||
          current.status !== 'waiting'
        )
          return;
        if (this.finishPollTimeout(latest, current, node)) return;
        const checked = now();
        current.check = {
          count: (current.check?.count ?? 0) + 1,
          at: checked,
          ...result,
        };
        if (result.error === undefined) {
          let value: Json;
          try {
            value = readPath(result.output!, timing.path);
          } catch (error) {
            this.fail(
              latest,
              current,
              `${node.label}: check output ${message(error).replace(/^Input /, '')}`,
            );
            return;
          }
          if (isDeepStrictEqual(value, timing.equals)) {
            const input = current.input;
            const output =
              input !== null &&
              typeof input === 'object' &&
              !Array.isArray(input) &&
              result.output !== null &&
              typeof result.output === 'object' &&
              !Array.isArray(result.output)
                ? { ...input, ...(result.output as Record<string, Json>) }
                : result.output!;
            try {
              this.finish(latest, current, node, output);
            } catch (error) {
              this.fail(latest, current, message(error));
            }
            return;
          }
        }
        current.nextCheckAt = new Date(
          Date.parse(checked) + timing.everyMs,
        ).toISOString();
        current.resumeAt = current.nextCheckAt;
        this.save(latest);
      });
    };
    void job
      .then(
        (output) => settle({ output }),
        (error) => settle({ error: message(error) }),
      )
      .finally(() => {
        this.localJobs.delete(execution.id);
        this.pump();
      });
  }
  private describeWork(work: WorkRequest): WorkRequest {
    const {
      expiredClaims: _receipts,
      holdReceipt: _holdReceipt,
      ...visible
    } = work;
    work = visible;
    if (work.context.mode !== 'fresh') return work;
    return {
      ...work,
      executionInstructions: freshContextInstructions(
        this.lifecycleRunId(work.runId),
        work.id,
      ),
    };
  }
  private lifecycleRunId(id: string) {
    let run = this.run(id);
    while (run.parentRunId && run.parentMode !== 'detached')
      run = this.run(run.parentRunId);
    return run.id;
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
      .filter(
        (w) => w.status === 'available' && !w.budgetBlocked && within(w.runId),
      )
      .map((work) => this.describeWork(work));
  }
  workSummaries(runId?: string) {
    const ancestry = new Map<string, RunAncestry>();
    return this.available(runId).map((work) => ({
      id: work.id,
      runId: work.runId,
      ...this.store.runAncestry(work.runId, ancestry),
      nodeId: work.nodeId,
      label: work.label,
      status: work.status,
      context: work.context,
      ...(work.continuity ? { continuity: work.continuity } : {}),
      attempt: work.attempt,
      maxAttempts: work.maxAttempts,
      maxLeaseExpiries: work.maxLeaseExpiries,
      failureCount: work.failureCount,
      leaseExpiryCount: work.leaseExpiryCount,
      ...(work.holdRevision ? { holdRevision: work.holdRevision } : {}),
      ...(work.heldClaimCount ? { heldClaimCount: work.heldClaimCount } : {}),
      leaseSeconds: work.leaseSeconds,
      availableUntil: work.availableUntil,
    }));
  }
  manageWorkHold(input: WorkHoldRequest) {
    const q = workHoldRequestSchema.parse(input);
    if (q.action === 'history')
      return this.holds.history(q.workId, q.offset, q.limit);
    this.pump();
    try {
      return this.store.transaction(() => {
        const result = this.holds.change(q);
        this.budgets.refresh();
        return result;
      });
    } catch (error) {
      if (error instanceof HoldDeadlineError) {
        this.pump();
        throw new InterlockError(error.message);
      }
      throw error;
    }
  }
  handoffContext(input: ContextHandoffInput) {
    this.pump();
    return this.contextGroups.handoff(input);
  }
  claim(workId: string, worker: Worker, leaseSeconds?: number) {
    const modelSelection =
      worker.modelSelection === undefined
        ? undefined
        : modelSelectionSchema.parse(worker.modelSelection);
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
      this.budgets.assertClaim(work.runId);
      work.status = 'claimed';
      work.availableUntil = undefined;
      work.attempt++;
      work.workerId = worker.workerId;
      work.modelSelection = modelSelection;
      this.contextGroups.claimed(work, worker.session);
      work.token = randomUUID();
      work.claimLeaseSeconds = leaseSeconds ?? work.leaseSeconds ?? 300;
      work.leaseUntil = new Date(
        Date.now() + work.claimLeaseSeconds * 1000,
      ).toISOString();
      this.store.put('work', work);
      this.event(
        this.run(work.runId),
        'work.claimed',
        `${work.label} claimed by ${worker.workerId}`,
      );
      this.usage.claimed(work);
      this.budgets.refresh();
      return this.describeWork(work);
    });
  }
  private owned(id: string, token: string) {
    const work = this.store.get<WorkRequest>('work', id);
    if (!work || work.token !== token)
      throw new InterlockError(
        (work &&
          expiredClaimMessage(work, token, this.run(work.runId).status)) ||
          'Claim token does not match',
      );
    if (work.status === 'completed') return work;
    if (work.status !== 'claimed')
      throw new InterlockError('Claim no longer active');
    if (Date.parse(work.leaseUntil!) <= Date.now())
      throw new ExpiredClaimError('Claim expired');
    return work;
  }
  private withClaim<T>(
    id: string,
    token: string,
    action: (work: WorkRequest) => T,
  ): T {
    this.pump();
    try {
      return this.store.transaction(() => action(this.owned(id, token)));
    } catch (error) {
      // The deadline can cross between the initial pump and the ownership check.
      // Process that expiry after rollback so its receipt and budget survive rejection.
      if (error instanceof ExpiredClaimError) {
        this.pump();
        const work = this.store.get<WorkRequest>('work', id)!;
        throw new InterlockError(
          expiredClaimMessage(work, token, this.run(work.runId).status) ??
            error.message,
        );
      }
      throw error;
    }
  }
  renew(id: string, token: string, leaseSeconds?: number) {
    return this.withClaim(id, token, (work) => {
      if (work.status !== 'claimed')
        throw new InterlockError('Work already completed');
      work.leaseUntil = new Date(
        Date.now() + (leaseSeconds ?? work.claimLeaseSeconds ?? 300) * 1000,
      ).toISOString();
      this.store.put('work', work);
      return this.describeWork(work);
    });
  }
  /** Read-only: do not pump, renew, or process expired claims. */
  preflightResult(id: string, token: string, output: Json): ResultCheck {
    const work = this.store.get<WorkRequest>('work', id);
    const report = (
      code: ResultCheck['code'],
      claimUsable = false,
    ): ResultCheck => ({
      code,
      accepted: false,
      alreadyAccepted: code === 'already_accepted',
      claimUsable,
      canSubmit: code === 'ready' || code === 'already_accepted',
      nextAction:
        code === 'ready'
          ? 'submit'
          : code === 'invalid_result'
            ? 'correct_result'
            : code === 'already_accepted' || code === 'completed_conflict'
              ? 'read_result'
              : 'inspect_work',
      diagnostics: { items: [], total: 0, truncated: false },
    });
    if (!work) return report('not_found');
    if (work.status === 'cancelled') return report('cancelled');
    if (work.status === 'held') return report('held');
    if (work.token !== token) {
      const expired = work.expiredClaims?.some(
        (receipt) => receipt.tokenHash === claimTokenHash(token),
      );
      return report(
        expired
          ? work.status === 'claimed'
            ? 'replaced'
            : 'expired'
          : 'invalid_claim',
      );
    }
    if (work.status === 'completed')
      return report(
        isDeepStrictEqual(work.output, output)
          ? 'already_accepted'
          : 'completed_conflict',
      );
    if (work.status !== 'claimed') return report('inactive');
    if (Date.parse(work.leaseUntil!) <= Date.now()) return report('expired');
    const diagnostics = checkAgentResult(
      work.outputSchema,
      work.resultRules,
      work.input,
      output,
    );
    return {
      ...report(diagnostics.total ? 'invalid_result' : 'ready', true),
      diagnostics,
    };
  }
  submit(id: string, token: string, output: Json) {
    return this.inspect(this.submitWork(id, token, output));
  }
  submitSummary(id: string, token: string, output: Json, limit = 20) {
    const bounded = continuationLimitSchema.parse(limit);
    const workRunId = this.submitWork(id, token, output);
    return {
      ...this.continuation.summary(this.lifecycleRunId(workRunId), bounded),
      workId: id,
      workRunId,
    };
  }
  private resultRejection(id: string, token: string, check: ResultCheck) {
    const work = this.store.get<WorkRequest>('work', id);
    return new ResultRejection(
      check,
      (work && expiredClaimMessage(work, token, this.run(work.runId).status)) ||
        '',
    );
  }
  private submitWork(id: string, token: string, output: Json) {
    this.pump();
    let runId: string;
    try {
      runId = this.store.transaction(() => {
        const check = this.preflightResult(id, token, output);
        if (!check.canSubmit) throw this.resultRejection(id, token, check);
        const work = this.store.get<WorkRequest>('work', id)!;
        if (work.status === 'completed') return work.runId;
        const run = this.run(work.runId),
          execution = run.executions.find((e) => e.id === work.executionId)!;
        const node = this.definition(run).nodes.find(
          (n) => n.id === work.nodeId,
        )!;
        this.finish(run, execution, node, output);
        this.usage.ended(work, 'completed');
        work.status = 'completed';
        work.output = output;
        this.store.put('work', work);
        return run.id;
      });
    } catch (error) {
      if (
        error instanceof ResultRejection &&
        error.resultCheck.code === 'expired'
      ) {
        // The lease can cross its deadline after the initial pump. Recover outside rollback.
        this.pump();
        throw this.resultRejection(
          id,
          token,
          this.preflightResult(id, token, output),
        );
      }
      throw error;
    }
    this.pump();
    return runId;
  }
  private releaseFailure(
    work: WorkRequest,
    error: string,
    reason: 'failure' | 'expiry' = 'failure',
  ) {
    this.usage.ended(work, reason === 'expiry' ? 'expired' : 'failed');
    if (work.maxLeaseExpiries !== undefined) {
      if (reason === 'expiry')
        work.leaseExpiryCount = (work.leaseExpiryCount ?? 0) + 1;
      else work.failureCount = (work.failureCount ?? 0) + 1;
    }
    const exhausted =
      work.maxLeaseExpiries === undefined
        ? work.attempt - (work.heldClaimCount ?? 0) >= work.maxAttempts
        : (work.failureCount ?? 0) >= work.maxAttempts ||
          (work.leaseExpiryCount ?? 0) >= work.maxLeaseExpiries;
    if (reason === 'expiry') {
      this.event(
        this.run(work.runId),
        'work.lease_expired',
        `${work.label} (${work.id}): claim expired at ${work.leaseUntil} on ${leaseCounts(work)}. ` +
          (exhausted
            ? 'No attempts remain under the configured budget; inspect the run before explicitly retrying the failed step. '
            : 'Another attempt is available; inspect the run and reclaim available work. ') +
          'Renew before expiry or choose a longer claim lease.',
      );
      if (exhausted && work.maxLeaseExpiries !== undefined)
        error = 'Lease expiry budget exhausted';
    }
    work.error = error;
    work.token = undefined;
    work.leaseUntil = undefined;
    const run = this.run(work.runId);
    if (exhausted) {
      work.status = 'failed';
      this.fail(
        run,
        run.executions.find((e) => e.id === work.executionId)!,
        error,
      );
    } else {
      work.status = 'available';
      const node = this.definition(run).nodes.find((n) => n.id === work.nodeId);
      work.availableUntil =
        node?.kind === 'agent' && node.unclaimedTimeoutMs !== undefined
          ? new Date(Date.now() + node.unclaimedTimeoutMs).toISOString()
          : undefined;
      this.event(run, 'work.retry', `${work.label}: ${error}`);
    }
    this.store.put('work', work);
  }
  reportFailure(id: string, token: string, error: string) {
    const runId = this.withClaim(id, token, (work) => {
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
    for (const child of this.store
      .runs()
      .filter((r) => r.parentRunId === id && r.parentMode !== 'detached'))
      this.cancelTree(child.id);
    run.status = 'cancelled';
    const execution = run.executions.at(-1);
    if (execution) this.localJobs.get(execution.id)?.abort();
    if (execution && !terminal(execution.status))
      execution.status = 'cancelled';
    for (const work of this.store
      .work()
      .filter(
        (w) =>
          w.runId === id && ['available', 'claimed', 'held'].includes(w.status),
      )) {
      this.usage.ended(work, 'cancelled');
      this.holds.close(work, now(), 'run cancellation', 'cancelled');
      work.status = 'cancelled';
      work.endedAt = now();
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
    run.value = Object.hasOwn(execution, 'originalInput')
      ? execution.originalInput!
      : execution.input;
    // Only dispatched child runs have progress to retain. Initialization
    // failures must resolve bindings and validate input again on retry.
    if (
      (execution.kind === 'batch' || execution.kind === 'workflow') &&
      execution.childRunIds.length > 0
    ) {
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
      this.versions.assertRunnable(run);
      if (run.parentRunId && run.parentMode !== 'detached')
        this.versions.assertRunnable(this.run(run.parentRunId));
      if (
        run.parentRunId &&
        run.parentMode !== 'detached' &&
        terminal(this.run(run.parentRunId).status)
      )
        throw new InterlockError('Retry the failed parent run instead');
      this.testbench.assertRetryCapacity(run);
      if (run.parentRunId && run.parentMode !== 'detached') {
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
