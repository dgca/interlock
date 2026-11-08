import { randomUUID } from 'node:crypto';
import type { Store } from '@interlock/storage';
import {
  InterlockError,
  modelAliasMutationSchema,
  modelAliasReadSchema,
  modelReferences,
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
  constructor(private store: Store) {}

  get(idOrName: string): SavedModelAlias | undefined {
    const byId = this.store.get<SavedModelAlias>('modelAliases', idOrName);
    if (byId) return byId;
    const list = this.store.list<SavedModelAlias>('modelAliases');
    return list.find((a) => a.name.toLowerCase() === idOrName.toLowerCase());
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
      throw new InterlockError(`Model alias "${q.id}" does not exist.`);
    }
    return alias;
  }

  mutate(input: ModelAliasMutation): SavedModelAlias | { id: string } {
    const q = modelAliasMutationSchema.parse(input);
    return this.store.transaction(() => {
      if (q.action === 'create') {
        return this.create(q.name, q.description ?? '', q.candidates);
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
      existing.revision++;
      existing.updatedAt = stamp();
      this.store.put('modelAliases', existing);
      return existing;
    });
  }

  private checkName(name: string, excludeId?: string) {
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
  ): SavedModelAlias {
    this.checkName(name);
    const time = stamp();
    const alias: SavedModelAlias = {
      id: randomUUID(),
      name,
      description,
      candidates,
      revision: 1,
      createdAt: time,
      updatedAt: time,
    };
    this.store.put('modelAliases', alias);
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
        (c) => c.name.toLowerCase() === ref.toLowerCase() || c.aliasId === ref,
      );
      if (inherited) {
        captures.push(inherited);
        seen.add(ref);
        continue;
      }
      const alias = this.get(ref);
      if (alias) {
        captures.push({
          aliasId: alias.id,
          name: alias.name,
          revision: alias.revision,
          candidates: alias.candidates,
        });
        seen.add(ref);
      }
    }
    return captures;
  }

  resolveCandidates(
    captures: ModelAliasCapture[] | undefined,
    modelOrAlias: string,
  ): ModelAliasCandidate[] | null {
    if (captures) {
      const captured = captures.find(
        (c) =>
          c.name.toLowerCase() === modelOrAlias.toLowerCase() ||
          c.aliasId === modelOrAlias,
      );
      if (captured) return captured.candidates;
    }
    const live = this.get(modelOrAlias);
    if (live) return live.candidates;
    return null;
  }

  expandCandidates(
    captures: ModelAliasCapture[] | undefined,
    reference: string,
  ): ExpandedModelCandidate[] {
    const candidates = this.resolveCandidates(captures, reference);
    if (!candidates?.length) return [{ model: reference }];
    // Resolution returns the captured array when historical evidence exists.
    // Live-only legacy resolution must not invent a captured revision.
    const capture = captures?.find((item) => item.candidates === candidates);
    return candidates.map((candidate) => ({
      ...candidate,
      ...(capture
        ? {
            modelAliasSelection: {
              aliasId: capture.aliasId,
              name: capture.name,
              revision: capture.revision,
              candidateModel: candidate.model,
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
      const alias = this.get(name);
      if (alias) {
        requirements.push({
          name: alias.name,
          ...(alias.description ? { description: alias.description } : {}),
        });
        seen.add(name.toLowerCase());
      }
    }
    return requirements;
  }
}
