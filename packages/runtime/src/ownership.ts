import {
  InterlockError,
  ownershipPreviewSchema,
  ownershipChangeSchema,
  type OwnershipPreviewInput,
  type OwnershipChangeInput,
  type Workflow,
  type WorkflowDefinition,
} from '@interlock/core';
import type { Store } from '@interlock/storage';

/** Ownership metadata changes leave definition and execution identities intact. */
export class Ownership {
  constructor(private store: Store) {}

  private workflow(id: string) {
    const w = this.store.get<Workflow>('workflows', id);
    if (!w) throw new InterlockError(`Workflow ${id} not found`);
    return { ...w, ownerWorkflowId: w.ownerWorkflowId ?? null };
  }

  preview(input: OwnershipPreviewInput) {
    const { id, ownerWorkflowId } = ownershipPreviewSchema.parse(input);
    const target = this.workflow(id);
    const blockers: {
      kind: 'owner' | 'child' | 'reference';
      workflowId: string;
      name: string;
      draft?: boolean;
      version?: number;
      latest?: boolean;
      nodeId?: string;
      nodeLabel?: string;
      reason: string;
    }[] = [];
    const unchanged = target.ownerWorkflowId === ownerWorkflowId;
    if (ownerWorkflowId !== null && !unchanged) {
      const owner = this.workflow(ownerWorkflowId);
      if (owner.id === id || owner.ownerWorkflowId || owner.archived)
        blockers.push({
          kind: 'owner',
          workflowId: owner.id,
          name: owner.name,
          reason:
            owner.id === id
              ? 'A workflow cannot own itself'
              : owner.ownerWorkflowId
                ? 'Children cannot own workflows'
                : 'Restore the proposed parent before adopting a child',
        });
      for (const child of this.store
        .workflows()
        .filter((w) => w.ownerWorkflowId === id))
        blockers.push({
          kind: 'child',
          workflowId: child.id,
          name: child.name,
          reason: `Release or reparent child "${child.name}" (${child.id}) first; children cannot own workflows`,
        });
      const references = (
        caller: Workflow,
        definition: WorkflowDefinition,
        location: { draft?: boolean; version?: number; latest?: boolean },
      ) => {
        if (caller.id === ownerWorkflowId) return;
        for (const node of definition.nodes) {
          if (node.kind !== 'workflow' || node.workflowId !== id) continue;
          const historical = location.version !== undefined && !location.latest;
          blockers.push({
            kind: 'reference',
            workflowId: caller.id,
            name: caller.name,
            ...location,
            nodeId: node.id,
            nodeLabel: node.label,
            reason: `"${caller.name}" (${caller.id}) ${location.draft ? 'draft' : `v${location.version}${location.latest ? ' (latest)' : ' (historical)'}`} node "${node.label}" (${node.id}) references this workflow. ${historical ? 'Preview explicit old-version cleanup and obtain agreement to its history loss.' : 'Remove this reference from the draft and publish a new version when necessary.'}`,
          });
        }
      };
      for (const caller of this.store.workflows()) {
        references(caller, caller.draft, { draft: true });
        for (const version of this.store.listVersions(caller.id))
          references(caller, version.definition, {
            version: version.version,
            latest: version.version === caller.latestVersion,
          });
      }
    }
    return {
      id,
      name: target.name,
      currentOwnerWorkflowId: target.ownerWorkflowId,
      ownerWorkflowId,
      unchanged,
      canSetOwner: blockers.length === 0,
      blockers,
    };
  }

  set(input: OwnershipChangeInput) {
    const parsed = ownershipChangeSchema.parse(input);
    return this.store.transaction(() => {
      const target = this.workflow(parsed.id);
      if (target.ownerWorkflowId !== parsed.expectedOwnerWorkflowId)
        throw new InterlockError(
          'Workflow ownership changed. Read get_workflow or preview ownership again before moving it.',
        );
      const preview = this.preview({
        id: parsed.id,
        ownerWorkflowId: parsed.ownerWorkflowId,
      });
      if (!preview.canSetOwner)
        throw new InterlockError(
          `Cannot change ownership: ${preview.blockers.map((b) => b.reason).join('; ')}`,
        );
      if (preview.unchanged) return { applied: false, workflow: target };
      const workflow = {
        ...target,
        ownerWorkflowId: parsed.ownerWorkflowId,
        updatedAt: new Date().toISOString(),
      };
      this.store.put('workflows', workflow);
      return { applied: true, workflow };
    });
  }
}
