import {
  InterlockError,
  historyPreviewSchema,
  historyDeletionSchema,
  type HistorySelection,
  type HistoryDeletion,
} from '@interlock/core';
import type { Store, HistoryRun } from '@interlock/storage';
import { fingerprint } from './versionIdentity.js';

const terminal = (run: HistoryRun) =>
  ['completed', 'failed', 'cancelled'].includes(run.status);
const spaceGuidance =
  'Removed document bytes are JSON data, not reclaimed file bytes. SQLite reuses deleted space; the file may not shrink. Offline VACUUM can compact it and needs maintenance time and spare disk space. Backups, native harness files and trial files are separate.';

/** Shared directed ancestry and rollover links, independent of terminal status. */
function historyEdges(runs: HistoryRun[], includeDetached = true) {
  const edges = new Map<string, string[]>();
  const add = (parent: string, child: string) => {
    const children = edges.get(parent) ?? [];
    children.push(child);
    edges.set(parent, children);
  };
  for (const run of runs) {
    if (run.parentRunId && (includeDetached || run.parentMode !== 'detached'))
      add(run.parentRunId, run.id);
    if (run.chainNextRunId) add(run.id, run.chainNextRunId);
  }
  return edges;
}

/** Descendants only: selecting a child never selects its parent or siblings. */
export function discoverRunTree(
  runs: HistoryRun[],
  rootRunId: string,
  includeDetached: boolean,
) {
  if (!runs.some((run) => run.id === rootRunId))
    throw new InterlockError('Run not found');
  const edges = historyEdges(runs, includeDetached);
  const selected = new Set<string>();
  const pending = [rootRunId];
  for (let i = 0; i < pending.length; i++) {
    const id = pending[i];
    if (selected.has(id)) continue;
    selected.add(id);
    pending.push(...(edges.get(id) ?? []));
  }
  return runs.filter((run) => selected.has(run.id));
}

/** Whole-tree history removal, separate from workflow and definition deletion. */
export class RunHistory {
  constructor(
    private store: Store,
    private markDeleted: (ids: Set<string>) => void,
    private executionBlockers: (ids: Set<string>) => string[],
    private notify: () => void,
  ) {}

  /** Metadata only, shared by manual cleanup and automatic retention. */
  trees() {
    const runs = this.store.historyRuns();
    const byId = new Map(runs.map((run) => [run.id, run]));
    // Parent and rollover links both join histories whose accounting and retry
    // semantics depend on one another. Detached descendants stay in the tree.
    const parents = new Map(runs.map((run) => [run.id, run.id]));
    const find = (id: string): string => {
      const parent = parents.get(id)!;
      if (parent === id) return id;
      const root = find(parent);
      parents.set(id, root);
      return root;
    };
    for (const [parent, children] of historyEdges(runs))
      for (const child of children)
        if (byId.has(parent) && byId.has(child))
          parents.set(find(child), find(parent));
    // Retain incomplete chain-history protection when an intermediate link is missing.
    for (const run of runs)
      if (run.chainRootRunId && byId.has(run.chainRootRunId))
        parents.set(find(run.id), find(run.chainRootRunId));
    const groups = new Map<string, HistoryRun[]>();
    for (const run of runs) {
      const id = find(run.id);
      const group = groups.get(id) ?? [];
      group.push(run);
      groups.set(id, group);
    }
    const roots = [...groups.values()]
      .map((members) => {
        const root =
          members.find(
            (run) =>
              !run.parentRunId &&
              (!run.chainRootRunId || run.chainRootRunId === run.id),
          ) ?? members[0];
        return {
          root,
          members,
          updatedAt: members.reduce(
            (at, run) => (run.updatedAt > at ? run.updatedAt : at),
            root.updatedAt,
          ),
        };
      })
      .sort(
        (a, b) =>
          b.root.createdAt.localeCompare(a.root.createdAt) ||
          a.root.id.localeCompare(b.root.id),
      );
    return { byId, roots };
  }

  private plan(input: HistorySelection) {
    const query = historyPreviewSchema.parse(input);
    if (
      query.rootRunIds &&
      new Set(query.rootRunIds).size !== query.rootRunIds.length
    )
      throw new InterlockError('Select each history root only once');
    const { byId, roots } = this.trees();
    if (
      query.rootRunIds?.some((id) => !roots.some((item) => item.root.id === id))
    )
      throw new InterlockError(
        'History root not found. Select a retained tree root or the first chain member; child runs cannot be removed separately.',
      );
    const matching = roots.filter(
      ({ root, updatedAt }) =>
        (!query.workflowId || query.workflowId === root.workflowId) &&
        (!query.before || Date.parse(updatedAt) < Date.parse(query.before)) &&
        (!query.rootRunIds || query.rootRunIds.includes(root.id)),
    );
    const page = matching.slice(query.offset, query.offset + query.limit);
    const scopes = new Map<string, Set<string>>();
    const items = page.map(({ root, members, updatedAt }) => {
      const ids = new Set(members.map((run) => run.id));
      scopes.set(root.id, ids);
      const blockers: string[] = [];
      if (members.some((run) => !terminal(run)))
        blockers.push(
          'Active runs or descendants retain this tree and its budget accounting.',
        );
      if (
        root.parentRunId ||
        (root.chainRootRunId && root.chainRootRunId !== root.id) ||
        members.some(
          (run) =>
            (run.parentRunId && !byId.has(run.parentRunId)) ||
            (run.chainRootRunId && !byId.has(run.chainRootRunId)) ||
            (run.chainNextRunId && !byId.has(run.chainNextRunId)),
        )
      )
        blockers.push(
          'Incomplete ancestry or chain history must be recovered before cleanup.',
        );
      const refs = this.store.historyReferences(ids);
      if (members.some((run) => run.comparisonId) || refs.comparisons)
        blockers.push(
          'Retained comparison or evaluation evidence depends on this history.',
        );
      if (refs.resources)
        blockers.push(
          'Resource reservations must be reconciled before cleanup.',
        );
      if (refs.claimed)
        blockers.push(
          'Claimed assignments must finish or be cancelled before cleanup.',
        );
      blockers.push(...this.executionBlockers(ids));
      const inventory = this.store.historyInventory(ids);
      return {
        rootRunId: root.id,
        workflowId: root.workflowId,
        workflowName: root.workflowName,
        status: root.status,
        createdAt: root.createdAt,
        updatedAt,
        runCount: members.filter((run) => !run.toolCall).length,
        collections: inventory.collections,
        documentBytes: inventory.documentBytes,
        canDelete: blockers.length === 0,
        blockers,
        confirmation: blockers.length
          ? null
          : fingerprint({ rootRunId: root.id, digest: inventory.digest }),
      };
    });
    const preview = {
      items,
      total: matching.length,
      offset: query.offset,
      nextOffset:
        query.offset + items.length < matching.length
          ? query.offset + items.length
          : null,
      storage: this.store.storageSpace(),
      spaceGuidance,
    };
    return { preview, scopes };
  }

  preview(input: HistorySelection = {}) {
    return this.store.transaction(() => this.plan(input).preview);
  }

  delete(input: HistoryDeletion) {
    const query = historyDeletionSchema.parse(input);
    const result = this.store.transaction(() => {
      const { preview, scopes } = this.plan({
        rootRunIds: query.roots.map((root) => root.runId),
        limit: 100,
      });
      for (const requested of query.roots) {
        const reviewed = preview.items.find(
          (item) => item.rootRunId === requested.runId,
        )!;
        if (
          !reviewed.canDelete ||
          reviewed.confirmation !== requested.confirmation
        )
          throw new InterlockError(
            'History or protections changed. Nothing deleted; preview again and review the current selection.',
          );
      }
      const selected = new Set(
        query.roots.flatMap((root) => [...scopes.get(root.runId)!]),
      );
      const collections: Record<string, number> = {};
      for (const item of preview.items)
        for (const [collection, count] of Object.entries(item.collections))
          collections[collection] = (collections[collection] ?? 0) + count;
      const retainedStartReceipts = this.store.forRuns(
        'runStarts',
        selected,
      ).length;
      this.markDeleted(selected);
      this.store.deleteHistoryDocuments(selected);
      return {
        deletedRoots: query.roots.length,
        deletedRuns: selected.size,
        deletedDocuments: collections,
        removedDocumentBytes: preview.items.reduce(
          (bytes, item) => bytes + item.documentBytes,
          0,
        ),
        retainedStartReceipts,
        storageBefore: preview.storage,
        storage: this.store.storageSpace(),
        spaceGuidance,
      };
    });
    this.notify();
    return result;
  }
}
