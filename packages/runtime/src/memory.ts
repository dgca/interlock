import { randomUUID } from 'node:crypto';
import {
  InterlockError,
  capFences,
  memoryLimits,
  memoryManageSchema,
  memoryOffMessage,
  memoryReadSchema,
  memorySection,
  memorySettingsFor,
  workMemorySchema,
  type MemoryAuthor,
  type MemoryCapture,
  type MemoryHistory,
  type MemoryListing,
  type MemoryReviews,
  type MemoryNote,
  type MemoryNoteRevision,
  type MemorySettings,
  type MemorySnapshot,
  type MemorySource,
  type Run,
  type WorkMemoryRequest,
  type WorkRequest,
  type Workflow,
} from '@interlock/core';
import type { Store } from '@interlock/storage';

const settingsCollection = 'memorySettings';
const notesCollection = 'memoryNotes';
const revisionsCollection = 'memoryNoteRevisions';
/** Notes written by live comparison trials: never read back into real memory. */
const trialCollection = 'memoryTrialNotes';
const comparisonCollection = 'memoryComparisonCaptures';
/** Live notes stored once per workflow memory revision that a run captured. */
const snapshotCollection = 'memorySnapshots';

/** Isolated per comparison sample, so sides and repetitions stay independent. */
type TrialNote = MemoryNote & { comparisonId: string; sampleId: string };
type Snapshot = {
  id: string;
  workflowId: string;
  revision: number;
  notes: MemorySnapshot[];
};
type ComparisonCaptures = {
  id: string;
  captures: Record<string, MemoryCapture | null>;
};
/** What a fixture simulation copies into its scratch store. */
export interface SimulationMemory {
  settings: MemorySettings[];
  notes: MemoryNote[];
}

const iso = (ms: number) => new Date(ms).toISOString();
const sameScope = (note: MemoryNote, nodeId: string | undefined) =>
  note.nodeId === nodeId;
const snapshotId = (workflowId: string, revision: number) =>
  `${workflowId}:${revision}`;
const summary = (note: MemoryNote) => ({
  id: note.id,
  scope: note.nodeId ? 'node' : 'workflow',
  status: note.status,
  revision: note.revision,
  author: note.author,
  updatedAt: note.updatedAt,
  preview: note.content.slice(0, 120),
});

/** Scoped, revisioned notes per workflow and Agent node. Off unless enabled. */
export class WorkflowMemory {
  constructor(
    private store: Store,
    private engine: { nowMs(): number; workflow(id: string): Workflow },
  ) {}
  private now() {
    return this.engine.nowMs();
  }
  private workflow(id: string) {
    return this.engine.workflow(id);
  }
  settings(workflowId: string) {
    return memorySettingsFor(
      workflowId,
      this.store.get<MemorySettings>(settingsCollection, workflowId),
    );
  }
  notes(workflowId: string) {
    return this.store.forWork<MemoryNote>(
      notesCollection,
      workflowId,
      'workflowId',
    );
  }
  list(workflowId: string): MemoryListing {
    this.workflow(workflowId);
    return {
      settings: this.settings(workflowId),
      notes: this.notes(workflowId),
    };
  }
  history(noteId: string, offset = 0, limit = 20): MemoryHistory {
    return this.revisions(this.note(noteId), offset, limit);
  }
  read(input: unknown) {
    const q = memoryReadSchema.parse(input);
    if (q.action === 'reviews') return this.reviews(q.workflowId);
    return q.action === 'list'
      ? this.list(q.workflowId)
      : this.history(q.noteId, q.offset, q.limit);
  }
  /** Pending note counts per workflow, without note content. */
  reviews(workflowId?: string): MemoryReviews {
    const counts = new Map<string, number>();
    for (const note of workflowId
      ? this.notes(workflowId)
      : this.store.list<MemoryNote>(notesCollection))
      if (note.status === 'pending')
        counts.set(note.workflowId, (counts.get(note.workflowId) ?? 0) + 1);
    const items = [...counts].flatMap(([id, count]) => {
      const workflow = this.store.get<Workflow>('workflows', id);
      return workflow ? [{ workflowId: id, name: workflow.name, count }] : [];
    });
    return { items, total: items.reduce((sum, item) => sum + item.count, 0) };
  }
  manage(input: unknown) {
    const q = memoryManageSchema.parse(input);
    return this.store.transaction(() => {
      if (q.action === 'configure') {
        this.workflow(q.workflowId);
        const { workflowId, ...changes } = q;
        const next: MemorySettings = {
          ...this.settings(workflowId),
          ...Object.fromEntries(
            Object.entries(changes).filter(
              ([key, value]) => key !== 'action' && value !== undefined,
            ),
          ),
          updatedAt: iso(this.now()),
        };
        this.store.put(settingsCollection, next);
        return next;
      }
      if (q.action === 'add') {
        const workflow = this.workflow(q.workflowId);
        if (
          q.nodeId !== undefined &&
          !workflow.draft.nodes.some(
            (node) => node.id === q.nodeId && node.kind === 'agent',
          )
        )
          throw new InterlockError(
            `Node ${q.nodeId} is not an Agent step in the workflow draft`,
          );
        return this.create(q.workflowId, q.nodeId, q.content, 'person', 'live');
      }
      const note = this.note(q.noteId);
      if (q.revision !== note.revision)
        throw new InterlockError(
          'Note changed elsewhere. Reload before saving. Your edits have not been saved.',
        );
      if (q.action === 'reject' || q.action === 'delete') {
        if (q.action === 'reject' && note.status !== 'pending')
          throw new InterlockError(
            'Only notes waiting for review can be rejected',
          );
        this.remove(note);
        if (note.status === 'live') this.bump(note.workflowId);
        return { id: note.id, removed: true };
      }
      if (q.action === 'approve') {
        if (note.status !== 'pending')
          throw new InterlockError('Note is not waiting for review');
        const content = capFences(q.content ?? note.content);
        this.assertRoom(note.workflowId, note.nodeId, content, note.id);
        const time = iso(this.now());
        const approved: MemoryNote = {
          ...note,
          status: 'live',
          approvedAt: time,
          updatedAt: time,
        };
        if (content !== note.content) this.revise(approved, content, 'person');
        else this.store.put(notesCollection, approved);
        this.bump(note.workflowId);
        return approved;
      }
      if (note.status !== 'live')
        throw new InterlockError(
          'Approve or reject a note that is waiting for review before changing it',
        );
      let content = q.action === 'edit' ? capFences(q.content) : note.content;
      if (q.action === 'revert') {
        const target = this.store.get<MemoryNoteRevision>(
          revisionsCollection,
          `${note.id}:${q.to}`,
        );
        if (!target || q.to === note.revision)
          throw new InterlockError(
            `Note revision ${q.to} does not exist or is current`,
          );
        content = target.content;
      }
      if (content === note.content) return note;
      this.assertRoom(note.workflowId, note.nodeId, content, note.id);
      const next = this.revise(
        note,
        content,
        'person',
        q.action === 'revert' ? q.to : undefined,
      );
      this.bump(note.workflowId);
      return next;
    });
  }
  /** Agent read and write during a claim, limited to its node and workflow. */
  work(input: WorkMemoryRequest) {
    const q = workMemorySchema.parse(input);
    return this.store.transaction(() => {
      const work = this.store.get<WorkRequest>('work', q.workId);
      if (!work || work.token !== q.token)
        throw new InterlockError('Claim token does not match');
      if (
        work.status !== 'claimed' ||
        Date.parse(work.leaseUntil ?? '') <= this.now()
      )
        throw new InterlockError('Claim no longer active');
      const run = this.store.get<Run>('runs', work.runId)!;
      const settings = this.settings(run.workflowId);
      if (!settings.enabled) throw new InterlockError(memoryOffMessage);
      const trial = run.comparison;
      const own = (note: MemoryNote) =>
        note.status === 'live' || note.source?.runId === run.id;
      const inScope = (note: MemoryNote) =>
        !note.nodeId || note.nodeId === work.nodeId;
      const all = [
        ...this.notes(run.workflowId),
        ...(trial ? this.trialNotes(trial.comparisonId, trial.sampleId) : []),
      ].filter(inScope);
      // Another run's pending note is unreviewed: agents see only a count.
      const visible = all.filter(own);
      if (q.action === 'read') {
        if (q.noteId === undefined) {
          const items = visible.sort((a, b) =>
            b.updatedAt.localeCompare(a.updatedAt),
          );
          return {
            revision: settings.revision,
            capturedRevision: run.memoryCapture?.revision ?? null,
            items: items.slice(0, 50).map(summary),
            total: items.length,
            pendingFromOtherRuns: all.length - visible.length,
          };
        }
        const note = visible.find((n) => n.id === q.noteId);
        if (!note)
          throw new InterlockError(
            `Note ${q.noteId} is not in this assignment's memory`,
          );
        return this.revisions(note, 0, 10);
      }
      const nodeId = q.scope === 'node' ? work.nodeId : undefined;
      const content = capFences(q.content);
      const duplicate = all.find(
        (note) => sameScope(note, nodeId) && note.content === content,
      );
      if (duplicate)
        return own(duplicate)
          ? { ...summary(duplicate), duplicate: true }
          : {
              status: 'pending',
              duplicate: true,
              message: 'An identical note is already waiting for review.',
            };
      const status = settings.agentWrites === 'live' ? 'live' : 'pending';
      const source = { runId: run.id, executionId: work.executionId };
      if (status === 'pending') {
        const pending = (
          trial
            ? this.trialNotes(trial.comparisonId, trial.sampleId)
            : this.notes(run.workflowId)
        ).filter((note) => note.status === 'pending');
        if (pending.length >= memoryLimits.pendingPerWorkflow)
          throw new InterlockError(
            `${pending.length} notes are already waiting for review in this workflow. Continue without saving; a person must review them first.`,
          );
        if (
          pending.filter((note) => note.source?.runId === run.id).length >=
          memoryLimits.pendingPerRun
        )
          throw new InterlockError(
            `This run already has ${memoryLimits.pendingPerRun} notes waiting for review. Continue without saving more.`,
          );
      }
      if (trial) {
        const time = iso(this.now());
        const note: TrialNote = {
          id: randomUUID(),
          workflowId: run.workflowId,
          ...(nodeId ? { nodeId } : {}),
          status,
          revision: 1,
          content,
          author: 'agent',
          source,
          comparisonId: trial.comparisonId,
          sampleId: trial.sampleId,
          createdAt: time,
          updatedAt: time,
        };
        this.store.put(trialCollection, note);
        return {
          ...summary(note),
          isolated: true,
          message:
            'Saved to memory isolated to this comparison sample. Real workflow memory is unchanged.',
        };
      }
      const note = this.create(
        run.workflowId,
        nodeId,
        content,
        'agent',
        status,
        source,
      );
      return {
        ...summary(note),
        message:
          status === 'pending'
            ? 'Saved for review. Later runs include it after a person approves it.'
            : 'Saved. Later runs include it; this run keeps the memory it started with.',
      };
    });
  }
  /**
   * Memory for a starting run: a reference to the workflow memory revision.
   * Continuations, Batch items and Parallel branches inherit the reference;
   * comparisons share one per workflow; other runs capture when memory is on.
   */
  capture(
    workflowId: string,
    inherit?: Run,
    comparison?: Run['comparison'],
  ): Pick<Run, 'memoryCapture'> {
    const capture = inherit
      ? inherit.memoryCapture
      : comparison
        ? this.comparisonCapture(comparison.comparisonId, workflowId)
        : this.snapshot(workflowId);
    return capture ? { memoryCapture: capture } : {};
  }
  /** The memory section for an Agent assignment, resolved from the run's reference. */
  section(run: Run, nodeId: string, settings: { executor?: string }) {
    const capture = run.memoryCapture;
    if (!capture) return undefined;
    return memorySection({
      notes: this.snapshotNotes(capture.workflowId, capture.revision),
      revision: capture.revision,
      budget: capture.budget,
      nodeId,
      // Managed sessions have no claim token for work_memory yet.
      canWrite: !settings.executor,
    });
  }
  private snapshotNotes(workflowId: string, revision: number) {
    const stored = this.store.get<Snapshot>(
      snapshotCollection,
      snapshotId(workflowId, revision),
    );
    if (!stored)
      throw new InterlockError(
        `Memory revision ${revision} for workflow ${workflowId} is missing`,
      );
    return stored.notes;
  }
  private snapshot(workflowId: string): MemoryCapture | undefined {
    const settings = this.settings(workflowId);
    if (!settings.enabled) return undefined;
    const id = snapshotId(workflowId, settings.revision);
    const existing = this.store.get<Snapshot>(snapshotCollection, id);
    const stored =
      existing ?? liveSnapshot(this.store, workflowId, settings.revision);
    if (!existing) this.store.put(snapshotCollection, stored);
    return {
      workflowId,
      revision: settings.revision,
      budget: settings.promptBudget,
      noteCount: stored.notes.length,
    };
  }
  private comparisonCapture(comparisonId: string, workflowId: string) {
    const doc = this.store.get<ComparisonCaptures>(
      comparisonCollection,
      comparisonId,
    ) ?? { id: comparisonId, captures: {} };
    if (doc.captures[workflowId]) return doc.captures[workflowId];
    const capture = this.snapshot(workflowId);
    if (!capture) return undefined;
    doc.captures[workflowId] = capture;
    this.store.put(comparisonCollection, doc);
    return capture;
  }
  private trialNotes(comparisonId: string, sampleId: string) {
    return this.store
      .forWork<TrialNote>(trialCollection, comparisonId, 'comparisonId')
      .filter((note) => note.sampleId === sampleId);
  }
  private note(id: string) {
    const note = this.store.get<MemoryNote>(notesCollection, id);
    if (!note) throw new InterlockError(`Memory note ${id} does not exist`);
    return note;
  }
  private revisions(note: MemoryNote, offset: number, limit: number) {
    const all = this.store
      .forWork<MemoryNoteRevision>(revisionsCollection, note.id, 'noteId')
      .sort((a, b) => b.revision - a.revision);
    const items = all.slice(offset, offset + limit);
    return {
      note,
      items,
      total: all.length,
      nextOffset:
        offset + items.length < all.length ? offset + items.length : null,
    };
  }
  private assertRoom(
    workflowId: string,
    nodeId: string | undefined,
    content: string,
    replacing?: string,
  ) {
    const live = this.notes(workflowId).filter(
      (note) =>
        note.status === 'live' &&
        sameScope(note, nodeId) &&
        note.id !== replacing,
    );
    const scope = nodeId ? `Step ${nodeId}` : 'The workflow';
    if (live.length >= memoryLimits.scopeNotes)
      throw new InterlockError(
        `${scope} already has ${memoryLimits.scopeNotes} notes. Delete or merge notes first.`,
      );
    const used = live.reduce((sum, note) => sum + note.content.length, 0);
    if (used + content.length > memoryLimits.scopeCharacters)
      throw new InterlockError(
        `${scope} memory would exceed ${memoryLimits.scopeCharacters} characters (${used} used). Shorten or delete notes first.`,
      );
  }
  private create(
    workflowId: string,
    nodeId: string | undefined,
    content: string,
    author: MemoryAuthor,
    status: MemoryNote['status'],
    source?: MemorySource,
  ) {
    if (status === 'live') this.assertRoom(workflowId, nodeId, content);
    const time = iso(this.now());
    const note: MemoryNote = {
      id: randomUUID(),
      workflowId,
      ...(nodeId ? { nodeId } : {}),
      status,
      revision: 0,
      content,
      author,
      ...(source ? { source } : {}),
      createdAt: time,
      updatedAt: time,
    };
    const created = this.revise(note, content, author, undefined, source);
    if (status === 'live') this.bump(workflowId);
    return created;
  }
  private revise(
    note: MemoryNote,
    content: string,
    author: MemoryAuthor,
    revertedFrom?: number,
    source?: MemorySource,
  ) {
    content = capFences(content);
    const time = iso(this.now());
    const next: MemoryNote = {
      ...note,
      revision: note.revision + 1,
      content,
      author,
      updatedAt: time,
    };
    const revision: MemoryNoteRevision = {
      id: `${note.id}:${next.revision}`,
      noteId: note.id,
      workflowId: note.workflowId,
      revision: next.revision,
      content,
      author,
      ...(source ? { source } : {}),
      ...(revertedFrom === undefined ? {} : { revertedFrom }),
      createdAt: time,
    };
    this.store.put(revisionsCollection, revision);
    this.store.put(notesCollection, next);
    return next;
  }
  private remove(note: MemoryNote) {
    for (const revision of this.store.forWork<MemoryNoteRevision>(
      revisionsCollection,
      note.id,
      'noteId',
    ))
      this.store.remove(revisionsCollection, revision.id);
    this.store.remove(notesCollection, note.id);
  }
  /** Each change to live notes advances the workflow's memory revision. */
  private bump(workflowId: string) {
    const settings = this.settings(workflowId);
    this.store.put(settingsCollection, {
      ...settings,
      revision: settings.revision + 1,
    });
  }
}

function liveSnapshot(
  store: Store,
  workflowId: string,
  revision: number,
): Snapshot {
  return {
    id: snapshotId(workflowId, revision),
    workflowId,
    revision,
    notes: store
      .forWork<MemoryNote>(notesCollection, workflowId, 'workflowId')
      .filter((note) => note.status === 'live')
      .map(({ id, nodeId, revision, content, updatedAt }) => ({
        id,
        ...(nodeId ? { nodeId } : {}),
        revision,
        content,
        updatedAt,
      })),
  };
}

/** The memory section a new run of the workflow would give this Agent step. */
export function memoryPreview(
  store: Store,
  workflowId: string,
  nodeId: string,
) {
  const settings = store.get<MemorySettings>(settingsCollection, workflowId);
  if (!settings?.enabled) return undefined;
  return memorySection({
    notes: liveSnapshot(store, workflowId, settings.revision).notes,
    revision: settings.revision,
    budget: settings.promptBudget,
    nodeId,
    canWrite: true,
  });
}

/** Live memory a fixture simulation reads, for the workflows it can run. */
export function simulationMemory(
  store: Store,
  workflowIds: string[],
): SimulationMemory | undefined {
  const settings = workflowIds.flatMap((id) => {
    const stored = store.get<MemorySettings>(settingsCollection, id);
    return stored?.enabled ? [stored] : [];
  });
  if (!settings.length) return undefined;
  return {
    settings,
    notes: settings.flatMap(({ id }) =>
      store
        .forWork<MemoryNote>(notesCollection, id, 'workflowId')
        .filter((note) => note.status === 'live'),
    ),
  };
}

/** Seeds a scratch store so simulated runs capture, and write to, a copy. */
export function seedSimulationMemory(
  scratch: Store,
  memory?: SimulationMemory,
) {
  for (const settings of memory?.settings ?? [])
    scratch.put(settingsCollection, settings);
  for (const note of memory?.notes ?? []) scratch.put(notesCollection, note);
}

export function deleteWorkflowMemory(store: Store, workflowId: string) {
  store.remove(settingsCollection, workflowId);
  for (const collection of [
    notesCollection,
    revisionsCollection,
    trialCollection,
    snapshotCollection,
  ])
    for (const doc of store.forWork<{ id: string }>(
      collection,
      workflowId,
      'workflowId',
    ))
      store.remove(collection, doc.id);
  for (const doc of store.list<ComparisonCaptures>(comparisonCollection))
    if (!store.get('comparisons', doc.id))
      store.remove(comparisonCollection, doc.id);
}
