import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  applyWorkflowEdits,
  applyWorkflowPositions,
  blankDefinition,
  definitionSchema,
  diagnoseDraft,
  type DraftDiagnostic,
  draftChanges,
  type DraftLayout,
  draftLayoutSchema,
  InterlockError,
  nodeVariableReferences,
  promptIds,
  sameWorkflowContent,
  summarizeDiagnostics,
  validateDefinition,
  validateWorkflowReferences,
  variableReferences,
  type Workflow,
  type WorkflowDefinition,
  workflowPositions,
  type WorkflowPositions,
} from '@interlock/core';
import { tidyWorkflow } from '@interlock/core/layout';
import type { Store } from '@interlock/storage';
import type { Prompts } from './prompts.js';
import type { ScriptApprovals } from './scriptApprovals.js';
import type { Variables } from './variables.js';
import {
  persistWorkflowPositions,
  readWorkflowLayout,
  saveWorkflowLayout,
} from './workflowLayouts.js';
import { publishObserver } from './workflowSyncHooks.js';

const now = () => new Date().toISOString();

/** Workflow drafts, validation and publication behind the Engine's authoring methods. */
export class WorkflowAuthoring {
  constructor(
    private readonly store: Store,
    private readonly variables: Variables,
    private readonly prompts: Prompts,
    private readonly scriptApprovals: ScriptApprovals,
  ) {}
  workflow(id: string) {
    const w = this.store.get<Workflow>('workflows', id);
    if (!w) throw new InterlockError('Workflow not found');
    return { ...w, ownerWorkflowId: w.ownerWorkflowId ?? null };
  }
  describeWorkflow(workflow: Workflow) {
    const latest = this.store.getVersion(workflow.id, workflow.latestVersion);
    const layout = readWorkflowLayout(this.store, workflow.id);
    return {
      ...workflow,
      draft: applyWorkflowPositions(workflow.draft, layout.positions),
      layoutRevision: layout.revision,
      draftMatchesLatest: latest
        ? sameWorkflowContent(workflow.draft, latest.definition)
        : null,
    };
  }
  saveLayout(input: {
    id: string;
    expectedRevision: number;
    positions: WorkflowPositions;
  }) {
    return saveWorkflowLayout(this.store, input);
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
  private arrangeDraft(definition: WorkflowDefinition, layout?: DraftLayout) {
    const parsed = definitionSchema.parse(definition);
    if (layout === undefined) return parsed;
    draftLayoutSchema.parse(layout);
    if (layout === 'preserve') return parsed;
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
    publishObserver(this.store)?.edited();
    return this.store.transaction(() => {
      const w = this.workflow(id);
      if (
        (patch.draft || patch.layout !== undefined) &&
        patch.draftRevision !== w.draftRevision
      )
        throw new InterlockError(
          'Draft changed elsewhere. Reload before saving.',
        );
      const metadataChanged =
        (patch.name !== undefined && patch.name !== w.name) ||
        (patch.description !== undefined &&
          patch.description !== w.description) ||
        (patch.archived !== undefined && patch.archived !== w.archived);
      if (patch.name !== undefined) w.name = patch.name;
      if (patch.description !== undefined) w.description = patch.description;
      if (patch.archived !== undefined) w.archived = patch.archived;
      let contentChanged = false;
      if (patch.draft || patch.layout !== undefined) {
        const next = this.arrangeDraft(
          patch.draft ?? this.describeWorkflow(w).draft,
          patch.layout,
        );
        validateWorkflowReferences(w.id, next, this.store.workflows());
        contentChanged = !sameWorkflowContent(w.draft, next);
        const positions = workflowPositions(next);
        const before = workflowPositions(this.describeWorkflow(w).draft);
        const savedPositions = readWorkflowLayout(this.store, id).positions;
        persistWorkflowPositions(
          this.store,
          id,
          patch.layout === 'preserve'
            ? Object.fromEntries(
                Object.entries(positions).filter(
                  ([nodeId]) =>
                    !Object.hasOwn(before, nodeId) &&
                    !Object.hasOwn(savedPositions, nodeId),
                ),
              )
            : !contentChanged || patch.layout === 'tidy'
              ? positions
              : Object.fromEntries(
                  Object.entries(positions).filter(
                    ([nodeId, position]) =>
                      !Object.hasOwn(before, nodeId) ||
                      !isDeepStrictEqual(before[nodeId], position),
                  ),
                ),
        );
        if (contentChanged) {
          w.draft =
            patch.layout === 'preserve'
              ? applyWorkflowPositions(next, workflowPositions(w.draft))
              : next;
          w.draftRevision++;
        }
      }
      if (metadataChanged || contentChanged) {
        w.updatedAt = now();
        this.store.put('workflows', w);
      }
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
        for (const reference of nodeVariableReferences(node)) {
          try {
            this.variables.get(reference);
          } catch {
            diagnostics.push({
              severity: 'error',
              category: 'publication',
              code: 'missing_variable',
              nodeId: node.id,
              path: `nodes.${i}`,
              message: `Variable ${reference || '(not selected)'} is missing. Select or provision it in Variables.`,
            });
          }
        }
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
    publishObserver(this.store)?.edited();
    return this.store.transaction(() => {
      const w = this.workflow(id);
      const displayedDraft = this.describeWorkflow(w).draft;
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
      const result = applyWorkflowEdits(displayedDraft, edits);
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
      const changes = draftChanges(displayedDraft, result.definition);
      const changed = !sameWorkflowContent(w.draft, result.definition);
      const beforePositions = workflowPositions(displayedDraft);
      const savedPositions = readWorkflowLayout(this.store, id).positions;
      persistWorkflowPositions(
        this.store,
        id,
        Object.fromEntries(
          Object.entries(workflowPositions(result.definition)).filter(
            ([nodeId, position]) =>
              layout === 'preserve'
                ? !Object.hasOwn(beforePositions, nodeId) &&
                  !Object.hasOwn(savedPositions, nodeId)
                : !Object.hasOwn(beforePositions, nodeId) ||
                  !isDeepStrictEqual(beforePositions[nodeId], position),
          ),
        ),
      );
      if (changed) {
        w.draft =
          layout === 'preserve'
            ? applyWorkflowPositions(
                result.definition,
                workflowPositions(w.draft),
              )
            : result.definition;
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
  clone(id: string) {
    const w = this.workflow(id);
    if (this.store.workflows().some((child) => child.ownerWorkflowId === id))
      throw new InterlockError(
        'Cloning a workflow with children is not available yet.',
      );
    return this.store.transaction(() => {
      const copy = this.create(
        `${w.name} copy`,
        w.description,
        this.describeWorkflow(w).draft,
      );
      // A copy keeps the source's unapproved imported content unapproved.
      this.scriptApprovals.copyPending(id, copy.id);
      return copy;
    });
  }
  publish(id: string | string[], cascade = false) {
    const published = publishObserver(this.store)?.publishing();
    const result = this.publishTargets(id, cascade);
    published?.();
    return result;
  }
  private publishTargets(id: string | string[], cascade: boolean) {
    const targetIds = Array.isArray(id) ? id : [id];
    return this.store.transaction(() => {
      if (!cascade && targetIds.length === 1)
        return this.publishVersion(targetIds[0]);
      const workflows = this.store.workflows();
      const definitions = new Map(
        workflows.map((w) => [
          w.id,
          targetIds.includes(w.id)
            ? w.draft
            : this.store.getVersion(w.id, w.latestVersion)?.definition,
        ]),
      );
      for (const targetId of targetIds) this.workflow(targetId);
      const affected = new Set(targetIds);
      if (cascade) {
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
        if (!targetIds.includes(workflowId)) {
          if (!sameWorkflowContent(w.draft, definitions.get(workflowId)!))
            throw new InterlockError(
              `Cannot cascade: "${w.name}" has unpublished definition edits. Publish or discard them first.`,
            );
        }
        if (cascade) {
          let updated = false;
          for (const node of w.draft.nodes) {
            if (node.kind === 'workflow' && affected.has(node.workflowId)) {
              node.version = this.workflow(node.workflowId).latestVersion;
              updated = true;
            }
          }
          if (updated) {
            w.draftRevision++;
            this.store.put('workflows', w);
          }
        }
        this.publishVersion(workflowId);
      }
      return this.workflow(targetIds[targetIds.length - 1]);
    });
  }
  private publishVersion(id: string) {
    const w = this.workflow(id);
    const definition = validateDefinition(this.describeWorkflow(w).draft);
    for (const reference of variableReferences(definition))
      this.variables.get(reference);
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
    const pinnedPromptRevisions = definition.pinPromptsAtPublish
      ? Object.fromEntries(
          promptIds(definition).map((promptId) => [
            promptId,
            this.prompts.get(promptId).revision,
          ]),
        )
      : undefined;
    w.latestVersion++;
    w.updatedAt = now();
    this.store.version({
      workflowId: id,
      version: w.latestVersion,
      definition,
      ...(pinnedPromptRevisions ? { pinnedPromptRevisions } : {}),
      createdAt: now(),
    });
    this.store.put('workflows', w);
    return w;
  }
}
