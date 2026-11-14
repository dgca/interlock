import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual as structuralEqual } from 'node:util';
import {
  applyWorkflowEdits,
  draftChanges,
  InterlockError,
  type DraftDiagnostic,
  type TestSuite,
  type WorkflowDefinition,
  type WorkRequest,
  workflowEditSchema,
} from '@interlock/core';
import {
  defaultProposalSettings,
  proposalCreateSchema,
  proposalDecisionSchema,
  proposalLimits,
  proposalListSchema,
  proposalSettingsSchema,
  type ProposalCaseResult,
  type ProposalConflict,
  type ProposalCreate,
  type ProposalDecision,
  type ProposalSettings,
  type ProposalSimulation,
  type ProposalSource,
  type WorkflowProposal,
} from '@interlock/core/proposals';
import type { Store } from '@interlock/storage';
import type { Engine } from './index.js';
import { fingerprint } from './versionIdentity.js';

const collection = 'workflowProposals';
const settingsCollection = 'workflowProposalSettings';
const now = () => new Date().toISOString();
const errorList = (diagnostics: DraftDiagnostic[]) =>
  diagnostics
    .filter((d) => d.severity === 'error')
    .slice(0, 5)
    .map((d) => `${d.path}: ${d.message}`)
    .join('; ');

type Edit = {
  op: string;
  id?: string;
  node?: { id?: unknown; kind?: unknown };
  edge?: { source?: unknown; target?: unknown };
  set?: Record<string, unknown>;
  unset?: string[];
};

/**
 * Check an agent's edits against the workflow's proposal scope. Limited fields
 * allow only updates of those fields; limited node kinds cover node edits and
 * the endpoints of edge edits.
 */
function scopeProblem(
  settings: ProposalSettings,
  draft: WorkflowDefinition,
  edits: unknown[],
) {
  const kinds = new Map(draft.nodes.map((n) => [n.id, n.kind as string]));
  const edges = new Map(draft.edges.map((e) => [e.id, e]));
  const kindAllowed = (nodeId: unknown) =>
    !settings.nodeKinds ||
    (settings.nodeKinds as string[]).includes(kinds.get(String(nodeId)) ?? '');
  for (const [index, raw] of edits.entries()) {
    const edit = { ...(raw as Edit), op: String((raw as Edit | null)?.op) };
    const where = `Edit ${index} (${edit.op})`;
    if (edit.op === 'update_settings' && !settings.workflowSettings)
      return `${where}: this workflow does not accept agent proposals for workflow settings`;
    if (edit.op === 'add_node')
      kinds.set(String(edit.node?.id), String(edit.node?.kind));
    if (settings.fields) {
      if (!edit.op.startsWith('update_'))
        return `${where}: this workflow only accepts agent proposals that update ${settings.fields.join(', ')}`;
      const touched = [...Object.keys(edit.set ?? {}), ...(edit.unset ?? [])];
      const outside = touched.filter((f) => !settings.fields!.includes(f));
      if (outside.length)
        return `${where}: field ${outside.join(', ')} is outside this workflow's proposal scope`;
    }
    if (
      edit.op.endsWith('_node') &&
      !kindAllowed(edit.op === 'add_node' ? edit.node?.id : edit.id)
    )
      return `${where}: this workflow does not accept agent proposals for ${kinds.get(String(edit.op === 'add_node' ? edit.node?.id : edit.id)) ?? 'unknown'} nodes`;
    if (edit.op.endsWith('_edge')) {
      // Check the route's current endpoints and any it is moved to.
      const edge =
        edit.op === 'add_edge' ? edit.edge : edges.get(String(edit.id));
      const ends = [edge?.source, edge?.target];
      if (edit.op === 'update_edge')
        for (const end of ['source', 'target'] as const)
          if (edit.set && Object.hasOwn(edit.set, end))
            ends.push(edit.set[end]);
      if (ends.some((end) => end !== undefined && !kindAllowed(end)))
        return `${where}: a route endpoint is outside this workflow's proposal node kinds`;
    }
  }
  return undefined;
}

/** Proposed workflow edits that wait for a person; approval edits the draft. */
class WorkflowProposals {
  private simulating = new Set<string>();
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private engine: Engine) {}
  private get store() {
    return this.engine.store;
  }

  settings(workflowId: string): ProposalSettings & { workflowId: string } {
    this.engine.workflow(workflowId);
    const saved = this.store.get<ProposalSettings>(
      settingsCollection,
      workflowId,
    );
    return {
      ...proposalSettingsSchema.strip().parse(saved ?? defaultProposalSettings),
      workflowId,
    };
  }
  saveSettings(workflowId: string, input: unknown) {
    this.engine.workflow(workflowId);
    const settings = proposalSettingsSchema.parse(input);
    this.store.put(settingsCollection, { ...settings, id: workflowId });
    return this.settings(workflowId);
  }

  private get(id: string) {
    const proposal = this.store.get<WorkflowProposal>(collection, id);
    if (!proposal) throw new InterlockError('Proposal not found');
    return proposal;
  }
  private open(filters: Record<string, string>) {
    return this.store.where<WorkflowProposal>(
      collection,
      { ...filters, status: 'open' },
      0,
      1,
    );
  }

  /** Validate and store a proposal. Agents need the workflow's opt-in. */
  create(input: ProposalCreate, author: 'agent' | 'person') {
    const q = proposalCreateSchema.parse(input);
    return this.store.transaction(() => {
      let work: WorkRequest | undefined;
      if (q.workId) {
        work = this.store.get<WorkRequest>('work', q.workId);
        if (!work || work.status !== 'claimed' || work.token !== q.token)
          throw new InterlockError(
            'Claim is not active or the token does not match',
          );
      } else if (q.token) throw new InterlockError('token requires workId');
      const runWorkflowId = work && this.engine.run(work.runId).workflowId;
      const workflowId = q.workflowId ?? runWorkflowId;
      if (!workflowId)
        throw new InterlockError('workflowId is required without a claim');
      const workflow = this.engine.workflow(workflowId);
      const settings = this.settings(workflowId);
      const draft = this.engine.describeWorkflow(workflow).draft;
      if (author === 'agent') {
        if (!settings.agents)
          throw new InterlockError(
            'This workflow does not accept agent proposals. A person can turn them on in its Proposals tab.',
          );
        if (
          runWorkflowId &&
          runWorkflowId !== workflowId &&
          !settings.otherWorkflows
        )
          throw new InterlockError(
            "A claim can only propose changes to its own run's workflow",
          );
        if (!work && !settings.otherWorkflows)
          throw new InterlockError(
            'Propose during a claim on a run of this workflow (pass workId and token). A person can allow proposals without a claim in proposal settings.',
          );
        const problem = scopeProblem(settings, draft, q.edits);
        if (problem) throw new InterlockError(problem);
      }
      const applied = applyWorkflowEdits(draft, q.edits);
      const diagnostics = applied.definition
        ? this.engine.validateDraft(workflowId, applied.definition).diagnostics
        : applied.diagnostics;
      if (
        diagnostics.some((d) => d.category === 'save' && d.severity === 'error')
      )
        throw new InterlockError(
          `Edits do not apply to draft revision ${workflow.draftRevision}: ${errorList(diagnostics)}`,
        );
      // Equivalent edits, such as an omitted or empty unset, merge.
      const print = fingerprint(
        q.edits.map((edit) => {
          const parsed = workflowEditSchema.safeParse(edit);
          return parsed.success ? parsed.data : edit;
        }),
      );
      const origin = author === 'person' ? 'person' : work ? 'claim' : 'client';
      const duplicate = this.open({ workflowId, fingerprint: print }).items[0];
      if (duplicate) return { ...duplicate, deduplicated: true };
      if (author === 'agent') {
        if (this.open({ workflowId }).total >= proposalLimits.openPerWorkflow)
          throw new InterlockError(
            `This workflow already has ${proposalLimits.openPerWorkflow} open proposals. A person must review them before agents propose more.`,
          );
        if (
          work &&
          this.open({ runId: work.runId }).total >= proposalLimits.openPerRun
        )
          throw new InterlockError(
            `This run already has ${proposalLimits.openPerRun} open proposals`,
          );
        if (
          !work &&
          this.open({ workflowId, origin }).total >=
            proposalLimits.openWithoutClaim
        )
          throw new InterlockError(
            `This workflow already has ${proposalLimits.openWithoutClaim} open agent proposals made without a claim`,
          );
      }
      const sources: ProposalSource[] = [];
      for (const source of [
        ...(work ? [{ runId: work.runId, executionId: work.executionId }] : []),
        ...(q.sources ?? []),
      ]) {
        if (!this.store.currentRun(source.runId))
          throw new InterlockError(`Source run not found: ${source.runId}`);
        if (
          !sources.some(
            (s) =>
              structuralEqual(s, source) ||
              (s.runId === source.runId && !source.executionId),
          )
        )
          sources.push(source);
      }
      const time = now();
      const proposal: WorkflowProposal = {
        id: randomUUID(),
        workflowId,
        title: q.title,
        rationale: q.rationale,
        edits: q.edits,
        baseDraftRevision: workflow.draftRevision,
        author:
          author === 'agent'
            ? {
                kind: 'agent',
                ...(work?.workerId ? { workerId: work.workerId } : {}),
                ...(work ? { workId: work.id } : {}),
              }
            : { kind: 'person' },
        ...(work ? { runId: work.runId, executionId: work.executionId } : {}),
        sources: sources.slice(0, proposalLimits.sources),
        origin,
        status: 'open',
        fingerprint: print,
        createdAt: time,
        updatedAt: time,
      };
      this.store.put(collection, proposal);
      if (work) this.store.touchRun(work.runId);
      queueMicrotask(() => void this.simulate(proposal.id));
      return proposal;
    });
  }

  list(input: unknown) {
    const q = proposalListSchema.parse(input);
    const filters: Record<string, string> = {
      ...(q.workflowId ? { workflowId: q.workflowId } : {}),
      ...(q.runId ? { runId: q.runId } : {}),
      ...(q.status !== 'all' ? { status: q.status } : {}),
    };
    const page = this.store.where<WorkflowProposal>(
      collection,
      filters,
      q.offset,
      q.limit,
    );
    const revisions = new Map<string, number | undefined>();
    const revision = (id: string) => {
      if (!revisions.has(id))
        revisions.set(
          id,
          this.store.get<{ draftRevision: number }>('workflows', id)
            ?.draftRevision,
        );
      return revisions.get(id);
    };
    return {
      items: page.items.map(({ edits, rationale, simulation, ...p }) => ({
        ...p,
        fingerprint: undefined,
        rationale: rationale.slice(0, 200),
        editCount: edits.length,
        stale:
          p.status === 'open' && revision(p.workflowId) !== p.baseDraftRevision,
        simulation: simulation && {
          state: simulation.state,
          ...(simulation.state === 'completed'
            ? {
                failing: simulation.cases.filter((c) => c.after !== 'passed')
                  .length,
                total: simulation.cases.length,
              }
            : {}),
        },
      })),
      total: page.total,
      nextOffset: q.offset + q.limit < page.total ? q.offset + q.limit : null,
    };
  }

  /** One proposal with its conflict state and the draft it would produce. */
  view(id: string) {
    const proposal = this.get(id);
    if (
      proposal.status === 'open' &&
      (!proposal.simulation ||
        (proposal.simulation.state === 'running' && !this.simulating.has(id)))
    )
      queueMicrotask(() => void this.simulate(id));
    if (proposal.status !== 'open')
      return {
        ...proposal,
        conflict: { state: 'current' } as ProposalConflict,
      };
    const workflow = this.engine.workflow(proposal.workflowId);
    const draft = this.engine.describeWorkflow(workflow).draft;
    const applied = applyWorkflowEdits(draft, proposal.edits);
    const diagnostics = applied.definition
      ? this.engine.validateDraft(workflow.id, applied.definition).diagnostics
      : applied.diagnostics;
    const fails = diagnostics.some(
      (d) => d.category === 'save' && d.severity === 'error',
    );
    const conflict: ProposalConflict = fails
      ? {
          state: 'conflicting',
          draftRevision: workflow.draftRevision,
          diagnostics,
        }
      : workflow.draftRevision === proposal.baseDraftRevision
        ? { state: 'current' }
        : { state: 'reapplicable', draftRevision: workflow.draftRevision };
    return {
      ...proposal,
      conflict,
      draftRevision: workflow.draftRevision,
      ...(applied.definition && !fails
        ? {
            draft,
            proposed: applied.definition,
            changes: draftChanges(draft, applied.definition),
          }
        : {}),
    };
  }

  /** Approve, reject or re-apply. Only people decide; approval never publishes. */
  decide(input: ProposalDecision) {
    const q = proposalDecisionSchema.parse(input);
    return this.store.transaction(() => {
      const proposal = this.get(q.id);
      if (proposal.status !== 'open')
        throw new InterlockError(`Proposal is already ${proposal.status}`);
      const workflow = this.engine.workflow(proposal.workflowId);
      const time = now();
      if (q.action === 'reject') {
        Object.assign(proposal, {
          status: 'rejected',
          decision: { at: time, reason: q.reason },
          updatedAt: time,
        });
        this.save(proposal);
        this.prune(workflow.id, 'rejected');
        return { proposal };
      }
      if (q.action === 'reapply') {
        if (workflow.draftRevision === proposal.baseDraftRevision)
          return { proposal };
        const view = this.view(proposal.id);
        if (view.conflict.state === 'conflicting')
          throw new InterlockError(
            `The proposal no longer applies to the current draft. Ask for a new proposal. ${errorList(view.conflict.diagnostics)}`,
          );
        // The draft changed; an agent's edits must still fit the current scope.
        const problem =
          proposal.author.kind === 'agent' &&
          scopeProblem(
            this.settings(workflow.id),
            this.engine.describeWorkflow(workflow).draft,
            proposal.edits,
          );
        if (problem)
          throw new InterlockError(
            `The proposal is now outside this workflow's agent proposal scope. ${problem}`,
          );
        proposal.baseDraftRevision = workflow.draftRevision;
        delete proposal.simulation;
        proposal.updatedAt = time;
        this.save(proposal);
        queueMicrotask(() => void this.simulate(proposal.id));
        return { proposal };
      }
      if (workflow.draftRevision !== proposal.baseDraftRevision)
        throw new InterlockError(
          'The draft changed since this proposal was made. Re-apply it to the current draft or ask for a new proposal.',
        );
      const edits = q.edits ?? proposal.edits;
      // A proposal's new Script content counts as agent-written content.
      const previous = this.engine.scriptApprovals.definitions(workflow.id);
      const result = this.engine.editDraft(
        workflow.id,
        proposal.baseDraftRevision,
        edits,
      );
      if (!result.applied) return { proposal, result };
      this.engine.scriptApprovals.recordAgentEdit(workflow.id, previous);
      const edited = !structuralEqual(edits, proposal.edits);
      Object.assign(proposal, {
        status: 'approved',
        decision: {
          at: time,
          draftRevision: result.draftRevision,
          ...(edited ? { edited: true, edits } : {}),
        },
        updatedAt: time,
      });
      this.save(proposal);
      this.prune(workflow.id, 'approved');
      return { proposal, result };
    });
  }

  private save(proposal: WorkflowProposal) {
    this.store.put(collection, proposal);
    if (proposal.runId && this.store.currentRun(proposal.runId))
      this.store.touchRun(proposal.runId);
  }

  /** Keep the newest decided proposals of one kind per workflow. */
  private prune(workflowId: string, status: 'approved' | 'rejected') {
    for (const p of this.store.where<WorkflowProposal>(
      collection,
      { workflowId, status },
      proposalLimits.retainedDecided,
      100,
    ).items)
      this.store.remove(collection, p.id);
  }

  /**
   * Store a simulation result unless the proposal was decided or re-applied
   * since it started; returns false when the result belongs to an old base.
   */
  private record(id: string, base: number, simulation: ProposalSimulation) {
    const current = this.store.get<WorkflowProposal>(collection, id);
    if (!current || current.status !== 'open') return true;
    if (current.baseDraftRevision !== base) return false;
    this.store.put(collection, { ...current, simulation });
    return true;
  }

  private async slot() {
    if (this.active < proposalLimits.activeSimulations) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }
  private release() {
    const next = this.waiting.shift();
    if (next) next();
    else this.active--;
  }

  /**
   * Run every saved case against the current draft and against the draft
   * with the proposal applied. Nothing is stored except the summary.
   */
  async simulate(id: string) {
    if (this.simulating.has(id)) return;
    this.simulating.add(id);
    const finishedAt = now;
    let current = true;
    let slotted = false;
    try {
      const proposal = this.get(id);
      if (proposal.status !== 'open') return;
      const base = proposal.baseDraftRevision;
      const workflow = this.engine.workflow(proposal.workflowId);
      const draftRevision = workflow.draftRevision;
      const unavailable = (reason: string) =>
        void (current = this.record(id, base, {
          state: 'unavailable',
          draftRevision,
          reason,
          finishedAt: finishedAt(),
        }));
      const suites = this.store
        .list<TestSuite>('testSuites')
        .filter((suite) => suite.workflowId === workflow.id);
      const cases = suites.flatMap((suite) =>
        suite.cases.map((c) => ({ suite, c })),
      );
      if (!cases.length)
        return unavailable(
          suites.length
            ? 'The saved test suites have no cases.'
            : 'This workflow has no saved test suite.',
        );
      const before = this.engine.describeWorkflow(workflow).draft;
      const applied = applyWorkflowEdits(before, proposal.edits);
      if (!applied.definition)
        return unavailable('The proposal does not apply to the current draft.');
      await this.slot();
      slotted = true;
      current = this.record(id, base, {
        state: 'running',
        draftRevision,
        startedAt: now(),
      });
      if (!current) return;
      const covered = { before: new Set<string>(), after: new Set<string>() };
      const results: ProposalCaseResult[] = [];
      const selected = cases.slice(0, proposalLimits.simulatedCases);
      for (const { suite, c } of selected) {
        const run = async (
          definition: WorkflowDefinition,
          side: 'before' | 'after',
        ) => {
          const record = await this.engine.simulations.simulateDefinition(
            workflow,
            definition,
            suite,
            c,
          );
          const untested = new Set(
            record.coverage?.untested.map((e) => e.edgeId),
          );
          if (record.coverage)
            for (const edge of definition.edges)
              if (!untested.has(edge.id)) covered[side].add(edge.id);
          return record;
        };
        const b = await run(before, 'before');
        const a = await run(applied.definition, 'after');
        const error = a.error ?? a.unsupported[0];
        results.push({
          suiteId: suite.id,
          suiteName: suite.name,
          caseId: c.id,
          caseName: c.name,
          before: b.state,
          after: a.state,
          ...(error ? { error: error.slice(0, 512) } : {}),
        });
      }
      if (
        results.every(
          (r) => r.before === 'unsupported' && r.after === 'unsupported',
        )
      )
        return unavailable(
          `The saved cases cannot be simulated: ${results[0].error ?? 'unsupported'}`,
        );
      current = this.record(id, base, {
        state: 'completed',
        draftRevision,
        cases: results,
        omittedCases: cases.length - selected.length,
        coverage: {
          before: {
            coveredEdges: covered.before.size,
            totalEdges: before.edges.length,
          },
          after: {
            coveredEdges: covered.after.size,
            totalEdges: applied.definition.edges.length,
          },
        },
        finishedAt: now(),
      });
    } catch {
      // A closed store or deleted workflow leaves the proposal to simulate when next opened.
    } finally {
      if (slotted) this.release();
      this.simulating.delete(id);
      // A re-apply during this run discarded its result; simulate the new base.
      if (!current) queueMicrotask(() => void this.simulate(id));
    }
  }
}

/** Remove a deleted workflow's proposals and proposal settings. */
export function deleteWorkflowProposals(store: Store, workflowId: string) {
  for (;;) {
    const page = store.where<WorkflowProposal>(
      collection,
      { workflowId },
      0,
      100,
    );
    if (!page.items.length) break;
    for (const p of page.items) store.remove(collection, p.id);
  }
  store.remove(settingsCollection, workflowId);
}

const instances = new WeakMap<Engine, WorkflowProposals>();
/** One proposal service per engine, shared by the server's callers. */
export function workflowProposals(engine: Engine) {
  let proposals = instances.get(engine);
  if (!proposals)
    instances.set(engine, (proposals = new WorkflowProposals(engine)));
  return proposals;
}
