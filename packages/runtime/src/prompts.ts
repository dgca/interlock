import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Store } from '@interlock/storage';
import {
  InterlockError,
  promptContentSchema,
  promptCreateSchema,
  promptRevisionConflict,
  promptIds,
  snapshotPrompt,
  promptReadSchema,
  type SavedPrompt,
  type PromptContent,
  type PromptUsage,
  type WorkflowDefinition,
} from '@interlock/core';
import { fingerprint } from './versionIdentity.js';

const creations = 'promptCreations';

interface PromptCreation {
  id: string;
  requestHash: string;
  promptId: string;
}

export class Prompts {
  constructor(private store: Store) {}
  list() {
    return this.store.list<SavedPrompt>('prompts');
  }
  get(id: string, revision?: number) {
    const current = this.store.get<SavedPrompt>('prompts', id);
    const prompt =
      revision === undefined
        ? current
        : (this.store.promptRevision(id, revision) ??
          (current?.revision === revision ? current : undefined));
    if (!prompt)
      throw new InterlockError(
        `Saved prompt ${id}${revision === undefined ? '' : ` revision ${revision}`} does not exist`,
      );
    return prompt;
  }
  read(input: {
    id: string;
    revision?: number;
    history?: { offset?: number; limit?: number };
  }) {
    const q = promptReadSchema.parse(input);
    return {
      ...this.get(q.id, q.revision),
      usage: this.references(q.id),
      ...(q.revision !== undefined
        ? {
            currentRevision:
              this.store.get<SavedPrompt>('prompts', q.id)?.revision ?? null,
          }
        : {}),
      ...(q.history
        ? {
            history: this.store.promptHistory(
              q.id,
              q.history.offset,
              q.history.limit,
            ),
          }
        : {}),
    };
  }
  create(input: PromptContent & { requestId?: string }) {
    const { requestId, ...content } = promptCreateSchema.parse(input);
    return this.store.transaction(() => {
      const receipt =
        requestId === undefined
          ? undefined
          : { id: fingerprint(requestId), requestHash: fingerprint(content) };
      if (receipt) {
        const prior = this.store.get<PromptCreation>(creations, receipt.id);
        if (prior) {
          if (prior.requestHash !== receipt.requestHash)
            throw new InterlockError(
              'Prompt creation requestId was already used with different content.',
            );
          const saved = this.store.get<SavedPrompt>('prompts', prior.promptId);
          if (!saved)
            throw new InterlockError(
              'The prompt created by this request was deleted. Use a new requestId to create another prompt.',
            );
          return saved;
        }
      }
      const time = new Date().toISOString();
      const prompt: SavedPrompt = {
        ...content,
        id: randomUUID(),
        revision: 1,
        createdAt: time,
        updatedAt: time,
      };
      this.store.savePrompt(prompt);
      if (receipt)
        this.store.put<PromptCreation>(creations, {
          ...receipt,
          promptId: prompt.id,
        });
      return prompt;
    });
  }
  update(id: string, revision: number, input: PromptContent) {
    return this.store.transaction(() => {
      const old = this.get(id);
      if (revision !== old.revision)
        throw new InterlockError(promptRevisionConflict);
      const content = promptContentSchema.parse(input);
      if (
        isDeepStrictEqual(content, {
          name: old.name,
          description: old.description,
          content: old.content,
        })
      )
        return old;
      const prompt = {
        ...old,
        ...content,
        revision:
          Math.max(old.revision, this.store.latestPromptRevision(id)) + 1,
        updatedAt: new Date().toISOString(),
      };
      this.store.savePrompt(prompt);
      return prompt;
    });
  }
  usage(id: string): PromptUsage[] {
    this.get(id);
    return this.references(id);
  }
  private references(id: string): PromptUsage[] {
    return this.store.workflows().flatMap((w) => {
      const draft = promptIds(w.draft).includes(id);
      const versions: number[] = [];
      for (let v = 1; v <= w.latestVersion; v++) {
        const definition = this.store.getVersion(w.id, v)?.definition;
        if (definition && promptIds(definition).includes(id)) versions.push(v);
      }
      return draft || versions.length
        ? [{ workflowId: w.id, name: w.name, draft, versions }]
        : [];
    });
  }
  delete(id: string) {
    return this.store.transaction(() => {
      const usage = this.usage(id);
      if (usage.length)
        throw new InterlockError(
          `Cannot delete prompt: referenced by ${usage.map((w) => `${w.name} (${w.workflowId})`).join(', ')}`,
        );
      this.store.remove('prompts', id);
      return { id };
    });
  }
  capture(
    definition: WorkflowDefinition,
    pinnedRevisions?: Record<string, number>,
  ) {
    return promptIds(definition).map((id) =>
      snapshotPrompt(this.get(id, pinnedRevisions?.[id])),
    );
  }
}
