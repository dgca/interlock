import { isDeepStrictEqual } from 'node:util';
import { Store } from '@interlock/storage';
import { InterlockError, promptIds, blankDefinition } from '@interlock/core';
import { Engine } from './index.js';
import { importWorkflows } from './transfer.js';
import {
  parseImportDocument,
  type ImportDocument,
} from '../../core/src/importDocument.js';
import type { WorkflowBundle } from '../../core/src/transfer.js';

/** Validate each export independently, without changing the application database. */
export function inspectImportDocument(data: unknown) {
  const document = parseImportDocument(data);
  const store = new Store(':memory:');
  const engine = new Engine(store, process.cwd());
  try {
    if (document.kind === 'bundle') {
      const ids = new Set(document.bundle.workflows.map((w) => w.id));
      for (const w of document.bundle.workflows) {
        if (w.ownerWorkflowId && !ids.has(w.ownerWorkflowId))
          throw new InterlockError(
            `Bundle is missing owner ${w.ownerWorkflowId}`,
          );
        for (const definition of [
          w.draft,
          ...w.versions.map((v) => v.definition),
        ])
          for (const node of definition.nodes) {
            if (node.kind !== 'workflow') continue;
            const dependency = document.bundle.workflows.find(
              (item) => item.id === node.workflowId,
            );
            if (!dependency)
              throw new InterlockError(
                `Bundle is missing workflow dependency ${node.workflowId}`,
              );
            if (
              node.version !== null &&
              !dependency.versions.some((v) => v.version === node.version)
            )
              throw new InterlockError(
                `Bundle is missing published dependency ${node.workflowId}:${node.version}`,
              );
          }
      }
      importWorkflows(store, document.bundle);
      const root = document.bundle.workflows.find(
        (w) => w.id === document.bundle.rootId,
      )!;
      return {
        document,
        name: root.name,
        description: root.description,
        workflows: document.bundle.workflows
          .filter((w) => w.id !== root.id)
          .map((w) => ({ id: w.id, name: w.name, owned: !!w.ownerWorkflowId })),
        prompts: (document.bundle.prompts ?? []).map((p) => ({
          id: p.id,
          name: p.name,
        })),
      };
    }
    const w = document.workflow;
    const definition = w.definition ?? blankDefinition();
    if (
      w.ownerWorkflowId ||
      definition.nodes.some((n) => n.kind === 'workflow') ||
      promptIds(definition).length
    )
      throw new InterlockError(
        'Legacy file has dependencies. Export it as a portable bundle including its workflows and saved prompts.',
      );
    engine.create(w.name, w.description, w.definition, w.ownerWorkflowId);
    return {
      document,
      name: w.name,
      description: w.description,
      workflows: [],
      prompts: [],
    };
  } finally {
    engine.stop();
    store.close();
  }
}

function combineBundles(
  documents: ImportDocument[],
): WorkflowBundle | undefined {
  const workflows = new Map<string, WorkflowBundle['workflows'][number]>();
  const prompts = new Map<
    string,
    NonNullable<WorkflowBundle['prompts']>[number]
  >();
  let rootId = '';
  for (const document of documents) {
    if (document.kind !== 'bundle') continue;
    rootId ||= document.bundle.rootId;
    for (const entry of document.bundle.workflows) {
      const previous = workflows.get(entry.id);
      if (!previous) {
        workflows.set(entry.id, structuredClone(entry));
        continue;
      }
      if (
        !isDeepStrictEqual(
          {
            name: previous.name,
            description: previous.description,
            owner: previous.ownerWorkflowId,
            draft: previous.draft,
          },
          {
            name: entry.name,
            description: entry.description,
            owner: entry.ownerWorkflowId,
            draft: entry.draft,
          },
        )
      )
        throw new InterlockError(
          `Selected files conflict for workflow ${entry.id}`,
        );
      for (const version of entry.versions) {
        const existing = previous.versions.find(
          (v) => v.version === version.version,
        );
        if (
          existing &&
          !isDeepStrictEqual(existing.definition, version.definition)
        )
          throw new InterlockError(
            `Selected files conflict for published version ${entry.id}:${version.version}`,
          );
        if (!existing) previous.versions.push(structuredClone(version));
      }
      previous.versions.sort((a, b) => a.version - b.version);
    }
    for (const prompt of document.bundle.prompts ?? []) {
      const previous = prompts.get(prompt.id);
      if (
        previous &&
        !isDeepStrictEqual(
          {
            name: previous.name,
            description: previous.description,
            content: previous.content,
          },
          {
            name: prompt.name,
            description: prompt.description,
            content: prompt.content,
          },
        )
      )
        throw new InterlockError(
          `Selected files conflict for saved prompt ${prompt.id}`,
        );
      if (!previous) prompts.set(prompt.id, prompt);
    }
  }
  return rootId
    ? {
        format: 'interlock-workflows',
        formatVersion: prompts.size ? 2 : 1,
        rootId,
        workflows: [...workflows.values()],
        ...(prompts.size ? { prompts: [...prompts.values()] } : {}),
      }
    : undefined;
}

/** Strict selected-set import. No replacement options and no workflow execution. */
export function importSelection(engine: Engine, data: unknown[]) {
  if (!data.length)
    throw new InterlockError('Select at least one workflow to import');
  const documents = data.map((item) => inspectImportDocument(item).document);
  const bundle = combineBundles(documents);
  return engine.store.transaction(() => {
    let imported: ReturnType<typeof importWorkflows> | undefined;
    if (bundle) {
      try {
        imported = importWorkflows(engine.store, bundle);
      } catch (error) {
        if (
          error instanceof InterlockError &&
          error.message.startsWith('Draft conflict for ')
        )
          throw new InterlockError(
            `${error.message.split('. Supply')[0]}. This selection cannot replace existing drafts or metadata. Review the existing workflow or choose a different export; no selected workflows or prompts were imported.`,
          );
        throw error;
      }
    }
    const rootIds: string[] = [];
    const changed = [...(imported?.changed ?? [])];
    for (const document of documents) {
      if (document.kind === 'bundle') {
        rootIds.push(document.bundle.rootId);
        continue;
      }
      const w = document.workflow;
      const created = engine.create(
        w.name,
        w.description,
        w.definition,
        w.ownerWorkflowId,
      );
      rootIds.push(created.id);
      changed.push(created.id);
    }
    return { rootIds, changed };
  });
}
