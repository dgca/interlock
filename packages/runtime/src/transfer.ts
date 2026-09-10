import { isDeepStrictEqual } from 'node:util';
import type { Store } from '@interlock/storage';
import {
  InterlockError,
  validateDefinition,
  validateWorkflowReferences,
  type Workflow,
} from '@interlock/core';
import {
  workflowBundleSchema,
  type WorkflowBundle,
} from '../../core/src/transfer.js';

export function exportWorkflows(
  store: Store,
  rootId: string,
  draft?: Pick<Workflow, 'name' | 'description' | 'draft'>,
): WorkflowBundle {
  const workflows = new Map(store.workflows().map((w) => [w.id, w]));
  if (draft && workflows.has(rootId))
    workflows.set(rootId, { ...workflows.get(rootId)!, ...draft });
  const included = new Set<string>();
  const records: WorkflowBundle['workflows'] = [];
  const include = (id: string) => {
    if (included.has(id)) return;
    const w = workflows.get(id);
    if (!w)
      throw new InterlockError(`Cannot export: workflow ${id} does not exist`);
    included.add(id);
    const versions = Array.from({ length: w.latestVersion }, (_, i) => {
      const version = store.getVersion(id, i + 1);
      if (!version) throw new InterlockError(`Missing version ${id}:${i + 1}`);
      return { version: version.version, definition: version.definition };
    });
    records.push({
      id,
      name: w.name,
      description: w.description,
      ownerWorkflowId: w.ownerWorkflowId ?? null,
      draft: w.draft,
      draftRevision: w.draftRevision,
      versions,
    });
    if (w.ownerWorkflowId) include(w.ownerWorkflowId);
    for (const child of workflows.values())
      if (child.ownerWorkflowId === id) include(child.id);
    for (const definition of [w.draft, ...versions.map((v) => v.definition)])
      for (const node of definition.nodes)
        if (node.kind === 'workflow') include(node.workflowId);
  };
  include(rootId);
  return {
    format: 'interlock-workflows',
    formatVersion: 1,
    rootId,
    workflows: records,
  };
}

export function importWorkflows(
  store: Store,
  data: WorkflowBundle,
  options: { force?: boolean; draftRevisions?: Record<string, number> } = {},
) {
  const bundle = workflowBundleSchema.parse(data);
  return store.transaction(() => {
    const ids = new Set(bundle.workflows.map((w) => w.id));
    if (ids.size !== bundle.workflows.length || !ids.has(bundle.rootId))
      throw new InterlockError(
        'Bundle must contain unique workflow IDs and its root',
      );
    const now = new Date().toISOString();
    const changed: string[] = [];
    for (const entry of bundle.workflows) {
      const existing = store.get<Workflow>('workflows', entry.id);
      if (
        existing &&
        (existing.ownerWorkflowId ?? null) !== entry.ownerWorkflowId
      )
        throw new InterlockError(`Ownership conflict for ${entry.id}`);
      const sameDraft =
        existing &&
        isDeepStrictEqual(existing.draft, entry.draft) &&
        existing.name === entry.name &&
        existing.description === entry.description;
      if (
        existing &&
        !sameDraft &&
        !options.force &&
        options.draftRevisions?.[entry.id] !== existing.draftRevision
      )
        throw new InterlockError(
          `Draft conflict for ${entry.id}. Supply its current draftRevisions entry or use force to replace the draft.`,
        );
      for (let i = 0; i < entry.versions.length; i++) {
        const version = entry.versions[i];
        if (version.version !== i + 1)
          throw new InterlockError(
            `Versions for ${entry.id} must be consecutive, starting at 1`,
          );
        const published = store.getVersion(entry.id, version.version);
        if (
          published &&
          !isDeepStrictEqual(published.definition, version.definition)
        )
          throw new InterlockError(
            `Published version conflict for ${entry.id}:${version.version}. Published versions cannot be overwritten, even with force.`,
          );
        if (!published)
          store.version({ workflowId: entry.id, ...version, createdAt: now });
      }
      const latestVersion = Math.max(
        existing?.latestVersion ?? 0,
        entry.versions.length,
      );
      if (!sameDraft || latestVersion !== existing?.latestVersion)
        changed.push(entry.id);
      const workflow: Workflow = {
        id: entry.id,
        ownerWorkflowId: entry.ownerWorkflowId,
        name: entry.name,
        description: entry.description,
        archived: existing?.archived ?? false,
        draft: entry.draft,
        draftRevision: existing
          ? existing.draftRevision + (sameDraft ? 0 : 1)
          : 1,
        latestVersion,
        createdAt: existing?.createdAt ?? now,
        updatedAt:
          !sameDraft || latestVersion !== existing?.latestVersion
            ? now
            : existing.updatedAt,
      };
      store.put('workflows', workflow);
    }
    const all = store.workflows();
    for (const entry of bundle.workflows) {
      if (entry.ownerWorkflowId) {
        const owner = all.find((w) => w.id === entry.ownerWorkflowId);
        if (!owner || owner.ownerWorkflowId || owner.id === entry.id)
          throw new InterlockError(`Invalid owner for ${entry.id}`);
      }
      validateWorkflowReferences(entry.id, entry.draft, all);
      for (const version of entry.versions) {
        validateDefinition(version.definition);
        validateWorkflowReferences(entry.id, version.definition, all);
        for (const node of version.definition.nodes)
          if (
            node.kind === 'workflow' &&
            (node.version === null ||
              !store.getVersion(node.workflowId, node.version))
          )
            throw new InterlockError(
              `Missing published dependency for ${node.label}`,
            );
      }
    }
    return {
      rootId: bundle.rootId,
      changed,
      workflows: bundle.workflows.map((w) => ({
        id: w.id,
        draftRevision: store.get<Workflow>('workflows', w.id)!.draftRevision,
      })),
    };
  });
}
