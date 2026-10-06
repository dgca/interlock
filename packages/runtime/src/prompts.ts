import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Store } from '@interlock/storage';
import {
  InterlockError,
  promptContentSchema,
  promptIds,
  snapshotPrompt,
  type SavedPrompt,
  type PromptContent,
  type PromptUsage,
  type WorkflowDefinition,
} from '@interlock/core';

export class Prompts {
  constructor(private store: Store) {}
  list() {
    return this.store.list<SavedPrompt>('prompts');
  }
  get(id: string) {
    const prompt = this.store.get<SavedPrompt>('prompts', id);
    if (!prompt) throw new InterlockError(`Saved prompt ${id} does not exist`);
    return prompt;
  }
  create(input: PromptContent) {
    const content = promptContentSchema.parse(input);
    const time = new Date().toISOString();
    const prompt: SavedPrompt = {
      ...content,
      id: randomUUID(),
      revision: 1,
      createdAt: time,
      updatedAt: time,
    };
    this.store.transaction(() => this.store.savePrompt(prompt));
    return prompt;
  }
  update(id: string, revision: number, input: PromptContent) {
    return this.store.transaction(() => {
      const old = this.get(id);
      if (revision !== old.revision)
        throw new InterlockError(
          'Prompt changed elsewhere. Reload before saving. Your edits have not been saved.',
        );
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
        revision: old.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      this.store.savePrompt(prompt);
      return prompt;
    });
  }
  usage(id: string): PromptUsage[] {
    this.get(id);
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
  capture(definition: WorkflowDefinition) {
    return promptIds(definition).map((id) => snapshotPrompt(this.get(id)));
  }
}
