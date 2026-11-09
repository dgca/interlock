import { isDeepStrictEqual } from 'node:util';
import { Store } from '@interlock/storage';
import {
  InterlockError,
  promptIds,
  blankDefinition,
  samePromptContent,
  type PromptSnapshot,
} from '@interlock/core';
import {
  variableReferences,
  type VariableImportBindings,
  type VariableRequirement,
} from '@interlock/core';
import { Engine } from './index.js';
import { importWorkflows, type WorkflowImportResult } from './transfer.js';
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
      importWorkflows(store, document.bundle, {
        variableBindings: Object.fromEntries(
          (document.bundle.variables ?? []).map((v, index) => [
            v.id,
            // Multiple portable IDs can share a display name in a real bundle.
            {
              action: 'provision' as const,
              name: `preview_variable_${index + 1}`,
            },
          ]),
        ),
      });
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
        variables: document.bundle.variables ?? [],
      };
    }
    const w = document.workflow;
    const definition = w.definition ?? blankDefinition();
    if (
      w.ownerWorkflowId ||
      definition.nodes.some((n) => n.kind === 'workflow') ||
      promptIds(definition).length ||
      variableReferences(definition).length
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
      variables: [] as VariableRequirement[],
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
  const variables = new Map<string, VariableRequirement>();
  const modelAliases = new Map<
    string,
    NonNullable<WorkflowBundle['modelAliases']>[number]
  >();
  const prompts = new Map<
    string,
    NonNullable<WorkflowBundle['prompts']>[number]
  >();
  const promptRevisions = new Map<string, PromptSnapshot>();
  let rootId = '';
  for (const document of documents) {
    if (document.kind !== 'bundle') continue;
    rootId ||= document.bundle.rootId;
    const pins = new Set(
      document.bundle.workflows.flatMap((workflow) =>
        workflow.versions.flatMap((version) =>
          Object.entries(version.pinnedPromptRevisions ?? {}).map(
            ([id, revision]) => `${id}:${revision}`,
          ),
        ),
      ),
    );
    for (const prompt of [
      ...(document.bundle.promptRevisions ?? []),
      ...(document.bundle.prompts ?? []).filter((prompt) =>
        pins.has(`${prompt.id}:${prompt.revision}`),
      ),
    ]) {
      const key = `${prompt.id}:${prompt.revision}`;
      const previous = promptRevisions.get(key);
      if (previous && !samePromptContent(previous, prompt))
        throw new InterlockError(
          `Selected files conflict for prompt revision ${key}`,
        );
      promptRevisions.set(key, prompt);
    }
    for (const variable of document.bundle.variables ?? []) {
      const old = variables.get(variable.id);
      if (old && !isDeepStrictEqual(old, variable))
        throw new InterlockError(
          'Selected files conflict for a variable requirement',
        );
      variables.set(variable.id, variable);
    }
    for (const alias of document.bundle.modelAliases ?? []) {
      const key = (alias.reference ?? alias.name).toLowerCase();
      const old = modelAliases.get(key);
      if (old && !isDeepStrictEqual(old, alias))
        throw new InterlockError(
          'Selected files conflict for a model alias requirement',
        );
      modelAliases.set(key, alias);
    }
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
      for (const schedule of entry.schedules ?? []) {
        const old = previous.schedules?.find((item) => item.id === schedule.id);
        if (old && !isDeepStrictEqual(old.config, schedule.config))
          throw new InterlockError(
            `Selected files conflict for schedule ${schedule.id}`,
          );
        if (!old) (previous.schedules ??= []).push(structuredClone(schedule));
      }
      for (const trigger of entry.eventTriggers ?? []) {
        const old = previous.eventTriggers?.find(
          (item) => item.id === trigger.id,
        );
        if (old && !isDeepStrictEqual(old.config, trigger.config))
          throw new InterlockError(
            `Selected files conflict for event trigger ${trigger.id}`,
          );
        if (!old)
          (previous.eventTriggers ??= []).push(structuredClone(trigger));
      }
      for (const version of entry.versions) {
        if (
          previous.deletedVersions?.some((v) => v.version === version.version)
        )
          throw new InterlockError(
            `Selected files conflict for deleted version ${entry.id}:${version.version}`,
          );
        const existing = previous.versions.find(
          (v) => v.version === version.version,
        );
        if (existing && !isDeepStrictEqual(existing, version))
          throw new InterlockError(
            `Selected files conflict for published version ${entry.id}:${version.version}`,
          );
        if (!existing) previous.versions.push(structuredClone(version));
      }
      previous.versions.sort((a, b) => a.version - b.version);
      for (const deleted of entry.deletedVersions ?? []) {
        if (previous.versions.some((v) => v.version === deleted.version))
          throw new InterlockError(
            `Selected files conflict for deleted version ${entry.id}:${deleted.version}`,
          );
        const existing = previous.deletedVersions?.find(
          (v) => v.version === deleted.version,
        );
        if (existing && existing.definitionHash !== deleted.definitionHash)
          throw new InterlockError(
            `Selected files conflict for deleted version identity ${entry.id}:${deleted.version}`,
          );
        if (!existing)
          (previous.deletedVersions ??= []).push(structuredClone(deleted));
      }
      previous.deletedVersions?.sort((a, b) => a.version - b.version);
    }
    for (const prompt of document.bundle.prompts ?? []) {
      const previous = prompts.get(prompt.id);
      if (previous && !samePromptContent(previous, prompt))
        throw new InterlockError(
          `Selected files conflict for saved prompt ${prompt.id}`,
        );
      if (!previous) prompts.set(prompt.id, prompt);
    }
  }
  return rootId
    ? {
        format: 'interlock-workflows',
        formatVersion: [...modelAliases.values()].some(
          (alias) => alias.reference,
        )
          ? 10
          : promptRevisions.size
            ? 9
            : [...workflows.values()].some((w) => w.eventTriggers?.length)
              ? 8
              : modelAliases.size
                ? 6
                : [...workflows.values()].some((w) => w.schedules?.length)
                  ? 5
                  : variables.size
                    ? 4
                    : [...workflows.values()].some(
                          (w) => w.deletedVersions?.length,
                        )
                      ? 3
                      : prompts.size
                        ? 2
                        : 1,
        rootId,
        ...(modelAliases.size
          ? { modelAliases: [...modelAliases.values()] }
          : {}),
        workflows: [...workflows.values()],
        ...(prompts.size ? { prompts: [...prompts.values()] } : {}),
        ...(promptRevisions.size
          ? { promptRevisions: [...promptRevisions.values()] }
          : {}),
        ...(variables.size ? { variables: [...variables.values()] } : {}),
      }
    : undefined;
}

/** Strict selected-set import. No replacement options and no workflow execution. */
export function importSelection(
  engine: Engine,
  data: unknown[],
  variableBindings?: VariableImportBindings,
) {
  if (!data.length)
    throw new InterlockError('Select at least one workflow to import');
  const documents = data.map((item) => inspectImportDocument(item).document);
  const bundle = combineBundles(documents);
  return engine.store.transaction(() => {
    let imported: WorkflowImportResult | undefined;
    if (bundle) {
      try {
        imported = importWorkflows(engine.store, bundle, { variableBindings });
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
    return {
      rootIds,
      changed,
      ...(imported?.skippedVersions.length
        ? { skippedVersions: imported.skippedVersions }
        : {}),
    };
  });
}
