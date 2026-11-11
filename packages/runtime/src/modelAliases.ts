import { randomUUID } from 'node:crypto';
import type { Store } from '@interlock/storage';
import {
  InterlockError,
  modelAliasMutationSchema,
  modelAliasReadSchema,
  modelReferences,
  firstEligiblePresetChoice,
  presetPermissions,
  type ExecutorProfile,
  type ExecutorPermissionMode,
  type SavedModelAlias,
  type ModelAliasCandidate,
  type ExpandedModelCandidate,
  type ModelAliasCapture,
  type ModelAliasRequirement,
  type ModelAliasRead,
  type ModelAliasMutation,
  type WorkflowDefinition,
} from '@interlock/core';

const stamp = () => new Date().toISOString();

export class ModelAliases {
  constructor(
    private store: Store,
    private configuredPresetProfile = (id: string) => {
      const profile = store.get<ExecutorProfile>('executorProfiles', id);
      return profile?.enabled ? profile : undefined;
    },
  ) {}

  // Legacy workflow references remain required. An unused workflow default
  // cannot prevent newer explicit executor selections from running.
  usesReference(definition: WorkflowDefinition, ref: string) {
    if (ref !== definition.agentModel) return true;
    const agents = definition.nodes.filter((node) => node.kind === 'agent');
    if (!agents.some((node) => node.executorMode)) return true;
    return agents.some(
      (node) =>
        node.executor !== null &&
        node.executorMode !== 'harness' &&
        (node.model ?? definition.agentModel) === ref,
    );
  }

  get(idOrName: string): SavedModelAlias | undefined {
    const byId = this.store.get<SavedModelAlias>('modelAliases', idOrName);
    if (byId) return byId;
    const list = this.store.list<SavedModelAlias>('modelAliases');
    const name =
      this.store.get<ModelAliasRequirement>(
        'modelAliasRequirements',
        idOrName.toLowerCase(),
      )?.name ?? idOrName;
    return list.find((a) => a.name.toLowerCase() === name.toLowerCase());
  }

  requirement(reference: string): ModelAliasRequirement | undefined {
    const alias =
      this.get(reference) ??
      this.store.get<ModelAliasRequirement>(
        'modelAliasRequirements',
        reference.toLowerCase(),
      );
    if (!alias) return undefined;
    return {
      name: alias.name,
      ...(alias.description ? { description: alias.description } : {}),
      ...(reference.toLowerCase() !== alias.name.toLowerCase()
        ? { reference }
        : {}),
    };
  }

  importRequirements(requirements: ModelAliasRequirement[]) {
    for (const requirement of requirements) {
      for (const reference of [
        requirement.name,
        ...(requirement.reference ? [requirement.reference] : []),
      ]) {
        const existing = this.requirement(reference);
        if (
          existing &&
          existing.name.toLowerCase() !== requirement.name.toLowerCase()
        )
          throw new InterlockError(
            `Model alias requirement conflict for ${reference}`,
          );
        this.store.put('modelAliasRequirements', {
          id: reference.toLowerCase(),
          name: requirement.name,
          description: requirement.description,
        });
      }
    }
  }

  private remember(alias: SavedModelAlias) {
    for (const reference of [alias.id, alias.name])
      this.store.put('modelAliasRequirements', {
        id: reference.toLowerCase(),
        name: alias.name,
        description: alias.description,
      });
  }

  list(options: { search?: string; offset?: number; limit?: number } = {}) {
    const { search, offset = 0, limit = 25 } = options;
    let items = this.store.list<SavedModelAlias>('modelAliases');
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q) ||
          a.candidates.some((c) => c.model.toLowerCase().includes(q)),
      );
    }
    const total = items.length;
    const paged = items.slice(offset, offset + limit);
    return {
      items: paged,
      total,
      offset,
      limit,
      truncated: offset + limit < total,
    };
  }

  read(input: ModelAliasRead) {
    const q = modelAliasReadSchema.parse(input);
    if (q.action === 'list') {
      return this.list(q);
    }
    const alias = this.get(q.id);
    if (!alias) {
      throw new InterlockError(
        this.requirement(q.id)
          ? `Model alias "${q.id}" is a known requirement but does not exist.`
          : `Model alias "${q.id}" does not exist.`,
      );
    }
    return alias;
  }

  mutate(input: ModelAliasMutation): SavedModelAlias | { id: string } {
    const q = modelAliasMutationSchema.parse(input);
    return this.store.transaction(() => {
      if (q.action === 'create') {
        return this.create(
          q.name,
          q.description ?? '',
          q.candidates,
          q.permissions,
        );
      }
      const existing = this.get(q.id);
      if (!existing) {
        throw new InterlockError(`Model alias "${q.id}" does not exist.`);
      }
      if (existing.revision !== q.expectedRevision) {
        throw new InterlockError(
          'Model alias changed elsewhere. Reload before saving. Your edits have not been saved.',
        );
      }
      this.remember(existing);
      if (q.action === 'delete') {
        this.store.remove('modelAliases', existing.id);
        return { id: existing.id };
      }
      if (
        q.name !== undefined &&
        q.name.toLowerCase() !== existing.name.toLowerCase()
      ) {
        this.checkName(q.name, existing.id);
        existing.name = q.name;
      }
      if (q.description !== undefined) existing.description = q.description;
      if (q.candidates !== undefined) existing.candidates = q.candidates;
      if (q.permissions === null) delete existing.permissions;
      else if (q.permissions !== undefined)
        existing.permissions = q.permissions;
      existing.revision++;
      existing.updatedAt = stamp();
      this.store.put('modelAliases', existing);
      this.remember(existing);
      return existing;
    });
  }

  private checkName(name: string, excludeId?: string) {
    const requirement = this.store.get<ModelAliasRequirement>(
      'modelAliasRequirements',
      name.toLowerCase(),
    );
    if (requirement && requirement.name.toLowerCase() !== name.toLowerCase())
      throw new InterlockError(
        `Alias name "${name}" is an imported reference for "${requirement.name}". Choose a different name.`,
      );
    const existing = this.store
      .list<SavedModelAlias>('modelAliases')
      .find(
        (a) =>
          a.id !== excludeId && a.name.toLowerCase() === name.toLowerCase(),
      );
    if (existing) {
      throw new InterlockError(
        `A model alias with name "${name}" already exists. Choose a different name.`,
      );
    }
  }

  private create(
    name: string,
    description: string,
    candidates: ModelAliasCandidate[],
    permissions?: ExecutorPermissionMode,
  ): SavedModelAlias {
    this.checkName(name);
    const time = stamp();
    const alias: SavedModelAlias = {
      id: randomUUID(),
      name,
      description,
      candidates,
      ...(permissions ? { permissions } : {}),
      revision: 1,
      createdAt: time,
      updatedAt: time,
    };
    this.store.put('modelAliases', alias);
    this.remember(alias);
    return alias;
  }

  capture(
    definition: WorkflowDefinition,
    inheritedCaptures?: ModelAliasCapture[],
  ): ModelAliasCapture[] {
    const refs = modelReferences(definition);
    const captures: ModelAliasCapture[] = [];
    const seen = new Set<string>();

    for (const ref of refs) {
      if (seen.has(ref)) continue;
      const inherited = inheritedCaptures?.find(
        (c) =>
          c.reference?.toLowerCase() === ref.toLowerCase() ||
          c.name.toLowerCase() === ref.toLowerCase() ||
          c.aliasId === ref,
      );
      if (inherited) {
        captures.push(inherited);
        seen.add(ref);
        continue;
      }
      if (inheritedCaptures !== undefined) continue;
      const alias = this.get(ref);
      const requirement = this.requirement(ref);
      if (!alias && requirement && this.usesReference(definition, ref))
        throw new InterlockError(
          `Model alias "${ref}" is missing. Configure local alias "${requirement.name}" before starting a new run.`,
        );
      if (alias) {
        captures.push({
          reference: ref,
          aliasId: alias.id,
          name: alias.name,
          revision: alias.revision,
          candidates: alias.candidates,
          ...(alias.permissions ? { permissions: alias.permissions } : {}),
        });
        seen.add(ref);
      }
    }
    if (inheritedCaptures === undefined)
      for (const node of definition.nodes) {
        if (node.kind !== 'agent') continue;
        const model = node.model ?? definition.agentModel;
        const alias = model ? this.capturedAlias(captures, model) : undefined;
        const problem = this.eligibilityProblem(definition, node, alias);
        if (problem) throw new InterlockError(problem);
      }
    return captures;
  }

  eligibilityProblem(
    definition: WorkflowDefinition,
    node: Extract<WorkflowDefinition['nodes'][number], { kind: 'agent' }>,
    alias?: Pick<SavedModelAlias, 'candidates' | 'permissions'>,
  ) {
    if (node.executor === null || node.executorMode === 'harness') return;
    if (node.executorMode === 'preset' && !alias)
      return `Agent preset "${node.model}" is missing for "${node.label}". Configure the preset before starting a new run.`;
    if (!alias) return;
    if (node.executorMode === 'preset' || alias.permissions) {
      if (
        !firstEligiblePresetChoice(
          alias.candidates,
          node.executor ?? definition.executor,
          this.configuredPresetProfile,
          presetPermissions(alias.permissions, definition.agentPermissions),
        )
      )
        return `Agent preset for "${node.label}" has no eligible harness. Check its choices and permissions before starting a new run.`;
    } else if (
      !alias.candidates.some(
        (candidate) =>
          !candidate.profileId ||
          this.store.get<{ enabled: boolean }>(
            'executorProfiles',
            candidate.profileId,
          )?.enabled,
      )
    )
      return `Model alias candidates for "${node.label}" have no enabled executor profile. Configure an available candidate before starting a new run.`;
  }

  capturedAlias(captures: ModelAliasCapture[], reference: string) {
    const name = reference.toLowerCase();
    return captures.find(
      (c) =>
        c.name.toLowerCase() === name ||
        c.reference?.toLowerCase() === name ||
        c.aliasId === reference,
    );
  }

  resolveCandidates(
    captures: ModelAliasCapture[] | undefined,
    modelOrAlias: string,
  ): ModelAliasCandidate[] | null {
    if (captures)
      return this.capturedAlias(captures, modelOrAlias)?.candidates ?? null;
    const live = this.get(modelOrAlias);
    if (live) return live.candidates;
    return null;
  }

  expandCandidates(
    captures: ModelAliasCapture[] | undefined,
    reference: string,
  ): ExpandedModelCandidate[] {
    const candidates = this.resolveCandidates(captures, reference);
    if (candidates === null) return [{ model: reference }];
    // Resolution returns the captured array when historical evidence exists.
    // Live-only legacy resolution must not invent a captured revision.
    const capture = captures?.find((item) => item.candidates === candidates);
    return candidates.map((candidate, candidateIndex) => ({
      ...candidate,
      ...(capture
        ? {
            modelAliasSelection: {
              aliasId: capture.aliasId,
              name: capture.name,
              revision: capture.revision,
              candidateModel: candidate.model,
              candidateIndex,
              ...(candidate.profileId
                ? { candidateProfileId: candidate.profileId }
                : {}),
              ...(candidate.effort !== undefined
                ? { candidateEffort: candidate.effort }
                : {}),
            },
          }
        : {}),
    }));
  }

  requirements(referencedNames: string[]): ModelAliasRequirement[] {
    const requirements: ModelAliasRequirement[] = [];
    const seen = new Set<string>();
    for (const name of referencedNames) {
      if (seen.has(name.toLowerCase())) continue;
      const alias = this.requirement(name);
      if (alias) {
        requirements.push({
          name: alias.name,
          ...(alias.description ? { description: alias.description } : {}),
          ...(alias.reference ? { reference: alias.reference } : {}),
        });
        seen.add(name.toLowerCase());
      }
    }
    return requirements;
  }
}
