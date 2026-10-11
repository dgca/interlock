import {
  InterlockError,
  versionSelectionSchema,
  versionDeletionSchema,
  type VersionReference,
  type WorkflowDefinition,
  type Run,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import { definitionHash, fingerprint } from './versionIdentity.js';

const key = (ref: VersionReference) => `${ref.workflowId}:${ref.version}`;
const active = (run: Run) => ['running', 'waiting'].includes(run.status);

/** Explicit cleanup of definitions, independently of workflow/run lifecycles. */
export class VersionCleanup {
  constructor(private store: Store) {}

  preview(input: { versions: VersionReference[] }) {
    const { versions } = versionSelectionSchema.parse(input);
    const selected = new Set(versions.map(key));
    if (selected.size !== versions.length)
      throw new InterlockError('Select each workflow version only once');
    const workflows = new Map(this.store.workflows().map((w) => [w.id, w]));
    const selection = versions
      .map((ref) => {
        const workflow = workflows.get(ref.workflowId);
        const version = this.store.getVersion(ref.workflowId, ref.version);
        if (!workflow || !version)
          throw new InterlockError(
            `Published workflow version ${key(ref)} not found`,
          );
        return {
          ...ref,
          name: workflow.name,
          definitionHash: definitionHash(version.definition),
        };
      })
      .sort((a, b) => key(a).localeCompare(key(b)));
    const blockers: {
      kind: 'latest' | 'reference' | 'active_run';
      target: VersionReference;
      workflowId: string;
      name: string;
      version?: number;
      draft?: boolean;
      nodeId?: string;
      nodeLabel?: string;
      runId?: string;
      reason: string;
    }[] = [];
    for (const ref of selection) {
      const workflow = workflows.get(ref.workflowId)!;
      if (workflow.latestVersion === ref.version)
        blockers.push({
          kind: 'latest',
          target: { workflowId: ref.workflowId, version: ref.version },
          workflowId: workflow.id,
          name: workflow.name,
          version: ref.version,
          reason: 'Latest published version is protected',
        });
    }
    const references = (
      workflowId: string,
      definition: WorkflowDefinition,
      location: { version?: number; draft?: boolean },
    ) => {
      for (const node of definition.nodes) {
        if (node.kind !== 'workflow' || node.version === null) continue;
        const target = { workflowId: node.workflowId, version: node.version };
        if (!selected.has(key(target))) continue;
        const caller = workflows.get(workflowId)!;
        blockers.push({
          kind: 'reference',
          target,
          workflowId,
          name: caller.name,
          ...location,
          nodeId: node.id,
          nodeLabel: node.label,
          reason: `${caller.name} ${location.draft ? 'draft' : `v${location.version}`} node "${node.label}" pins ${key(target)}. Update the draft or explicitly select the historical caller version.`,
        });
      }
    };
    for (const workflow of workflows.values())
      references(workflow.id, workflow.draft, { draft: true });
    for (const version of this.store.listVersions())
      if (!selected.has(key(version)))
        references(version.workflowId, version.definition, {
          version: version.version,
        });
    const runs = this.store.runs();
    for (const run of runs.filter(active)) {
      for (const ref of this.dependencies(run)) {
        if (!selected.has(key(ref))) continue;
        blockers.push({
          kind: 'active_run',
          target: ref,
          workflowId: run.workflowId,
          name: run.workflowName,
          version: run.version,
          runId: run.id,
          reason: `Active run ${run.id} may need ${key(ref)}. Wait for it to finish or explicitly cancel it before cleanup.`,
        });
      }
    }
    blockers.sort((a, b) => fingerprint(a).localeCompare(fingerprint(b)));
    const affectedRuns = runs
      .filter((run) => selected.has(key(run)))
      .map((run) => ({
        runId: run.id,
        workflowId: run.workflowId,
        name: run.workflowName,
        version: run.version,
        status: run.status,
      }))
      .sort((a, b) => a.runId.localeCompare(b.runId));
    const impact = {
      versions: selection,
      blockers,
      affectedRuns,
      consequences:
        'Selected definitions are deleted. Affected runs retain inputs, outputs, executions, events, prompts, and ancestry, but lose graph inspection and retry. Ordinary imports do not restore deleted versions. Explicit restoration requires an original-definition backup and valid ownership and dependencies.',
    };
    return {
      ...impact,
      canDelete: blockers.length === 0,
      confirmation: fingerprint(impact),
    };
  }

  delete(input: {
    versions: VersionReference[];
    confirmation: string;
    acknowledgeHistoryLoss: true;
  }) {
    const parsed = versionDeletionSchema.parse(input);
    return this.store.transaction(() => {
      const preview = this.preview({ versions: parsed.versions });
      if (preview.confirmation !== parsed.confirmation)
        throw new InterlockError(
          'Cleanup impact changed. Preview again and obtain agreement to the updated impact.',
        );
      if (!preview.canDelete)
        throw new InterlockError(
          `Cannot delete versions: ${preview.blockers.map((b) => b.reason).join('; ')}`,
        );
      const deletedAt = new Date().toISOString();
      for (const version of preview.versions)
        this.store.deleteVersion({
          workflowId: version.workflowId,
          version: version.version,
          definitionHash: version.definitionHash,
          deletedAt,
        });
      return {
        deleted: preview.versions.map(({ definitionHash, ...ref }) => ref),
        affectedRuns: preview.affectedRuns,
      };
    });
  }

  private dependencies(root: VersionReference) {
    const found = new Map<string, VersionReference>();
    const visit = (ref: VersionReference) => {
      if (found.has(key(ref))) return;
      found.set(key(ref), { workflowId: ref.workflowId, version: ref.version });
      const definition = this.store.getVersion(
        ref.workflowId,
        ref.version,
      )?.definition;
      for (const node of definition?.nodes ?? [])
        if (node.kind === 'workflow' && node.version !== null)
          visit({ workflowId: node.workflowId, version: node.version });
    };
    visit(root);
    return [...found.values()];
  }

  assertRunnable(ref: VersionReference, onlyDeletedDependencies = false) {
    for (const dependency of this.dependencies(ref))
      if (
        !this.store.getVersion(dependency.workflowId, dependency.version) &&
        (!onlyDeletedDependencies ||
          key(dependency) === key(ref) ||
          this.store.deletedVersion(dependency.workflowId, dependency.version))
      )
        throw new InterlockError(
          `Published workflow version ${key(dependency)} is unavailable${this.store.deletedVersion(dependency.workflowId, dependency.version) ? ' after explicit cleanup' : ''}. Starting or retrying this run requires the original version; restore it from a backup first.`,
        );
  }
}
