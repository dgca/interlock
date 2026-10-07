import { isDeepStrictEqual } from 'node:util';
import { Store } from '@interlock/storage';
import { InterlockError, type SavedPrompt } from '@interlock/core';
import { parseImportDocument } from '../../core/src/importDocument.js';
import { type WorkflowBundle } from '../../core/src/transfer.js';
import { importWorkflows } from './transfer.js';
import { Engine } from './index.js';

export type SelectedFile = { fileId: string; filename: string; data: unknown };
/** Stage with existing import policy, then persist the validated selection in one transaction. */
export function importSelection(store: Store, files: SelectedFile[]) {
  const parsed = files.map((file) => {
    try {
      return { ...file, document: parseImportDocument(file.data) };
    } catch (e) {
      throw new InterlockError(
        `${file.filename}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  });
  return store.transaction(() => {
    const staged = new Store(':memory:');
    const collections = [
      'workflows',
      'versions',
      'prompts',
      'promptRevisions',
    ] as const;
    try {
      for (const collection of collections)
        for (const record of store.list<{ id: string }>(collection))
          staged.put(collection, record);
      // Merge portable records first so file order cannot decide whether conflicting drafts win.
      const records = new Map<string, WorkflowBundle['workflows'][number]>();
      const prompts = new Map<
        string,
        NonNullable<WorkflowBundle['prompts']>[number]
      >();
      for (const file of parsed) {
        if (file.document.format !== 'portable') continue;
        for (const record of file.document.bundle.workflows) {
          const previous = records.get(record.id);
          if (previous) {
            const fields = (w: typeof record) => ({
              name: w.name,
              description: w.description,
              draft: w.draft,
              ownerWorkflowId: w.ownerWorkflowId,
            });
            if (!isDeepStrictEqual(fields(previous), fields(record)))
              throw new InterlockError(
                `${file.filename}: selected files disagree on draft, metadata or ownership for ${record.id}. Deselect one conflicting file.`,
              );
            for (const version of record.versions) {
              const old = previous.versions.find(
                (v) => v.version === version.version,
              );
              if (old && !isDeepStrictEqual(old.definition, version.definition))
                throw new InterlockError(
                  `${file.filename}: Published version conflict for ${record.id}:${version.version}. Deselect one conflicting file.`,
                );
              if (!old) previous.versions.push(structuredClone(version));
            }
            previous.versions.sort((a, b) => a.version - b.version);
          } else records.set(record.id, structuredClone(record));
        }
        for (const prompt of file.document.bundle.prompts ?? []) {
          const old = prompts.get(prompt.id);
          const content = (p: typeof prompt) => ({
            name: p.name,
            description: p.description,
            content: p.content,
          });
          if (old && !isDeepStrictEqual(content(old), content(prompt)))
            throw new InterlockError(
              `${file.filename}: Prompt conflict for ${prompt.id}. Deselect one conflicting file.`,
            );
          if (!old || old.revision < prompt.revision)
            prompts.set(prompt.id, prompt);
        }
      }
      let changed: string[] = [];
      if (records.size) {
        const root = parsed.find((f) => f.document.format === 'portable')!;
        try {
          changed = importWorkflows(staged, {
            format: 'interlock-workflows',
            formatVersion: prompts.size ? 2 : 1,
            rootId:
              root.document.format === 'portable'
                ? root.document.bundle.rootId
                : '',
            workflows: [...records.values()],
            ...(prompts.size ? { prompts: [...prompts.values()] } : {}),
          }).changed;
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          throw new InterlockError(
            `${parsed
              .filter((f) => f.document.format === 'portable')
              .map((f) => f.filename)
              .join(
                ', ',
              )}: ${detail.replace(/ Supply its current draftRevisions entry or use force to replace the draft\./, ' Inspect the existing workflow before importing. Nothing is overwritten.')}`,
          );
        }
      }
      const changedPromptIds = [...prompts.keys()].filter(
        (id) => !store.get<SavedPrompt>('prompts', id),
      );
      const engine = new Engine(staged, '');
      const results = parsed.map((file) => {
        let rootId: string;
        if (file.document.format === 'legacy') {
          const w = file.document.workflow;
          rootId = engine.create(w.name, w.description, w.definition).id;
          changed.push(rootId);
        } else rootId = file.document.bundle.rootId;
        const ids =
          file.document.format === 'portable'
            ? file.document.bundle.workflows.map((w) => w.id)
            : [rootId];
        return {
          fileId: file.fileId,
          filename: file.filename,
          rootId,
          format: file.document.format,
          rootChanged: changed.includes(rootId),
          changedWorkflowIds: ids.filter((id) => changed.includes(id)),
          changedPromptIds:
            file.document.format === 'portable'
              ? (file.document.bundle.prompts ?? [])
                  .map((p) => p.id)
                  .filter((id) => changedPromptIds.includes(id))
              : [],
        };
      });
      engine.stop();
      // No application write occurs until every selected document and current-state conflict has passed.
      for (const collection of collections)
        for (const record of staged.list<{ id: string }>(collection))
          if (!isDeepStrictEqual(store.get(collection, record.id), record))
            store.put(collection, record);
      return {
        results,
        changedWorkflowIds: [...new Set(changed)],
        changedPromptIds,
      };
    } finally {
      staged.close();
    }
  });
}
