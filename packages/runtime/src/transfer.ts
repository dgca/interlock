import {
  triggerConfig,
  eventConfigSchema,
  webhookConfigSchema,
  nextScheduleSlot,
  type WorkflowTrigger,
  compareWorkflow,
  type DiffItem,
} from '@interlock/core';
import { isDeepStrictEqual } from 'node:util';
import type { Store } from '@interlock/storage';
import { Engine } from './index.js';
import {
  InterlockError,
  validateDefinition,
  validateWorkflowReferences,
  type Workflow,
  type SavedPrompt,
  promptIds,
  snapshotPrompt,
  type DeletedWorkflowVersion,
} from '@interlock/core';
import { definitionHash } from './versionIdentity.js';
import { Variables } from './variables.js';
import { ModelAliases } from './modelAliases.js';
import {
  variableReferences,
  modelReferences,
  type VariableImportBindings,
} from '@interlock/core';
import {
  workflowBundleSchema,
  type WorkflowBundle,
} from '../../core/src/transfer.js';

export function exportWorkflows(
  store: Store,
  rootId: string,
  draft?: Pick<Workflow, 'name' | 'description' | 'draft'>,
): WorkflowBundle {
  const workflows = new Map(store.workflows().map((w) => [w.id, w]));
  if (draft && workflows.has(rootId))
    workflows.set(rootId, { ...workflows.get(rootId)!, ...draft });
  const included = new Set<string>();
  const records: WorkflowBundle['workflows'] = [];
  const include = (id: string) => {
    if (included.has(id)) return;
    const w = workflows.get(id);
    if (!w)
      throw new InterlockError(`Cannot export: workflow ${id} does not exist`);
    included.add(id);
    const versions = store
      .listVersions(id)
      .map(({ version, definition, pinnedPromptRevisions }) => ({
        version,
        definition,
        ...(pinnedPromptRevisions ? { pinnedPromptRevisions } : {}),
      }));
    const deletedVersions = store
      .list<DeletedWorkflowVersion>('deletedVersions')
      .filter((v) => v.workflowId === id && !store.getVersion(id, v.version))
      .sort((a, b) => a.version - b.version)
      .map(({ version, definitionHash, deletedAt }) => ({
        version,
        definitionHash,
        deletedAt,
      }));
    records.push({
      id,
      name: w.name,
      description: w.description,
      ownerWorkflowId: w.ownerWorkflowId ?? null,
      draft: w.draft,
      draftRevision: w.draftRevision,
      versions,
      ...(store.workflowTriggers(id).some((t) => t.kind === 'schedule')
        ? {
            schedules: store
              .workflowTriggers(id)
              .filter((t) => t.kind === 'schedule')
              .map((t) => ({
                id: t.id,
                config: triggerConfig(
                  t,
                ) as import('@interlock/core').ScheduleConfig,
                enabled: false,
              })),
          }
        : {}),
      ...(store.workflowTriggers(id).some((t) => t.kind === 'webhook')
        ? {
            webhooks: store
              .workflowTriggers(id)
              .filter((t) => t.kind === 'webhook')
              .map((t) => ({
                id: t.id,
                config: webhookConfigSchema.parse(triggerConfig(t)),
                enabled: false,
              })),
          }
        : {}),
      ...(store.workflowTriggers(id).some((t) => t.kind === 'event')
        ? {
            eventTriggers: store
              .workflowTriggers(id)
              .filter((t) => t.kind === 'event')
              .map((t) => ({
                id: t.id,
                config: eventConfigSchema.parse(triggerConfig(t)),
                enabled: false,
              })),
          }
        : {}),
      ...(deletedVersions.length ? { deletedVersions } : {}),
    });
    for (const trigger of store.workflowTriggers(id))
      if (trigger.kind === 'event' && trigger.scope.type === 'workflow')
        include(trigger.scope.workflowId);
    if (w.ownerWorkflowId) include(w.ownerWorkflowId);
    for (const child of workflows.values())
      if (child.ownerWorkflowId === id) include(child.id);
    for (const definition of [w.draft, ...versions.map((v) => v.definition)])
      for (const node of definition.nodes)
        if (node.kind === 'workflow') include(node.workflowId);
  };
  include(rootId);
  const referencedPrompts = [
    ...new Set(
      records.flatMap((w) =>
        [w.draft, ...w.versions.map((v) => v.definition)].flatMap(promptIds),
      ),
    ),
  ];
  const prompts = referencedPrompts.map((id) => {
    const prompt = store.get<SavedPrompt>('prompts', id);
    if (!prompt)
      throw new InterlockError(
        `Cannot export: saved prompt ${id} does not exist`,
      );
    return snapshotPrompt(prompt);
  });
  const variables = new Variables(store).requirements([
    ...new Set(
      records.flatMap((w) => [
        ...[w.draft, ...w.versions.map((v) => v.definition)].flatMap(
          variableReferences,
        ),
        ...(w.webhooks ?? []).map((t) => t.config.authentication.secretId),
      ]),
    ),
  ]);
  const referencedModels = [
    ...new Set(
      records.flatMap((w) =>
        [w.draft, ...w.versions.map((v) => v.definition)].flatMap(
          modelReferences,
        ),
      ),
    ),
  ];
  const modelAliases = new ModelAliases(store).requirements(referencedModels);
  return {
    format: 'interlock-workflows',
    formatVersion: records.some((w) => w.eventTriggers?.length)
      ? 8
      : records.some((w) => w.webhooks?.length)
        ? 7
        : modelAliases.length
          ? 6
          : records.some((w) => w.schedules?.length)
            ? 5
            : variables.length
              ? 4
              : records.some((w) => w.deletedVersions?.length)
                ? 3
                : prompts.length
                  ? 2
                  : 1,
    ...(prompts.length ? { prompts } : {}),
    ...(variables.length ? { variables } : {}),
    ...(modelAliases.length ? { modelAliases } : {}),
    rootId,
    workflows: records,
  };
}

export interface BundleDryRunResult {
  dryRun: true;
  rootId: string;
  workflows: Array<{
    id: string;
    name: string;
    status: 'added' | 'changed' | 'unchanged';
    latestVersion: number;
    diff: {
      firstPublication: boolean;
      nodes: DiffItem[];
      routes: DiffItem[];
      workflow: DiffItem[];
    };
  }>;
  prompts?: Array<{
    id: string;
    name: string;
    status: 'added' | 'unchanged' | 'conflict';
  }>;
  triggers?: Array<{
    id: string;
    workflowId: string;
    kind: WorkflowTrigger['kind'];
    status: 'added' | 'changed' | 'unchanged' | 'conflict';
  }>;
}

export function diffBundleImport(
  store: Store,
  data: WorkflowBundle,
): BundleDryRunResult {
  const bundle = workflowBundleSchema.parse(data);
  const workflows = bundle.workflows.map((entry) => {
    const existing = store.get<Workflow>('workflows', entry.id);
    const published = existing?.latestVersion
      ? store.getVersion(entry.id, existing.latestVersion)
      : undefined;
    const diff = compareWorkflow(entry.draft, published?.definition);
    const hasSemanticChanges =
      !published ||
      diff.nodes.length > 0 ||
      diff.routes.length > 0 ||
      diff.workflow.length > 0;
    const status: 'added' | 'changed' | 'unchanged' = !existing
      ? 'added'
      : hasSemanticChanges
        ? 'changed'
        : 'unchanged';
    return {
      id: entry.id,
      name: entry.name,
      status,
      latestVersion: existing?.latestVersion ?? 0,
      diff: {
        firstPublication: !published,
        nodes: diff.nodes,
        routes: diff.routes,
        workflow: diff.workflow,
      },
    };
  });

  const prompts = (bundle.prompts ?? []).map((prompt) => {
    const existing = store.get<SavedPrompt>('prompts', prompt.id);
    const status: 'added' | 'unchanged' | 'conflict' = !existing
      ? 'added'
      : isDeepStrictEqual(
            {
              name: existing.name,
              description: existing.description,
              content: existing.content,
            },
            {
              name: prompt.name,
              description: prompt.description,
              content: prompt.content,
            },
          )
        ? 'unchanged'
        : 'conflict';
    return {
      id: prompt.id,
      name: prompt.name,
      status,
    };
  });

  const triggers = bundle.workflows.flatMap((entry) =>
    [
      ...(entry.schedules ?? []),
      ...(entry.webhooks ?? []),
      ...(entry.eventTriggers ?? []),
    ].map((trigger) => {
      const existing = store.get<WorkflowTrigger>(
        'workflowTriggers',
        trigger.id,
      );
      const kind = trigger.config.kind;
      const status: 'added' | 'changed' | 'unchanged' | 'conflict' = !existing
        ? 'added'
        : existing.workflowId !== entry.id
          ? 'conflict'
          : isDeepStrictEqual(triggerConfig(existing), trigger.config)
            ? 'unchanged'
            : 'changed';
      return {
        id: trigger.id,
        workflowId: entry.id,
        kind,
        status,
      };
    }),
  );

  return {
    dryRun: true,
    rootId: bundle.rootId,
    workflows,
    ...(prompts.length ? { prompts } : {}),
    ...(triggers.length ? { triggers } : {}),
  };
}

export type WorkflowImportResult = {
  rootId: string;
  changed: string[];
  skippedVersions: { workflowId: string; version: number }[];
  restoredVersions: { workflowId: string; version: number }[];
  workflows: {
    id: string;
    draftRevision: number;
    latestVersion?: number;
  }[];
  published?: { id: string; version: number }[];
};

export function importWorkflows(
  store: Store,
  data: WorkflowBundle,
  options: {
    force?: boolean;
    draftRevisions?: Record<string, number>;
    restoreDeletedVersions?: boolean;
    variableBindings?: VariableImportBindings;
    publish?: boolean;
    cascade?: boolean;
    dryRun: true;
    engine?: Engine;
  },
): BundleDryRunResult;
export function importWorkflows(
  store: Store,
  data: WorkflowBundle,
  options?: {
    force?: boolean;
    draftRevisions?: Record<string, number>;
    restoreDeletedVersions?: boolean;
    variableBindings?: VariableImportBindings;
    publish?: boolean;
    cascade?: boolean;
    dryRun?: false;
    engine?: Engine;
  },
): WorkflowImportResult;
export function importWorkflows(
  store: Store,
  data: WorkflowBundle,
  options?: {
    force?: boolean;
    draftRevisions?: Record<string, number>;
    restoreDeletedVersions?: boolean;
    variableBindings?: VariableImportBindings;
    publish?: boolean;
    cascade?: boolean;
    dryRun?: boolean;
    engine?: Engine;
  },
): WorkflowImportResult | BundleDryRunResult;
export function importWorkflows(
  store: Store,
  data: WorkflowBundle,
  options: {
    force?: boolean;
    draftRevisions?: Record<string, number>;
    restoreDeletedVersions?: boolean;
    variableBindings?: VariableImportBindings;
    publish?: boolean;
    cascade?: boolean;
    dryRun?: boolean;
    engine?: Engine;
  } = {},
): WorkflowImportResult | BundleDryRunResult {
  if (options.dryRun) {
    return diffBundleImport(store, data);
  }
  const bundle = workflowBundleSchema.parse(data);
  return store.transaction(() => {
    new Variables(store).importRequirements(
      bundle.variables ?? [],
      options.variableBindings,
    );
    const ids = new Set(bundle.workflows.map((w) => w.id));
    if (ids.size !== bundle.workflows.length || !ids.has(bundle.rootId))
      throw new InterlockError(
        'Bundle must contain unique workflow IDs and its root',
      );
    const now = new Date().toISOString();
    const includedPrompts = bundle.prompts ?? [];
    if (
      new Set(includedPrompts.map((p) => p.id)).size !== includedPrompts.length
    )
      throw new InterlockError('Bundle must contain unique prompt IDs');
    for (const prompt of includedPrompts) {
      const existing = store.get<SavedPrompt>('prompts', prompt.id);
      if (
        existing &&
        !isDeepStrictEqual(
          {
            name: existing.name,
            description: existing.description,
            content: existing.content,
          },
          {
            name: prompt.name,
            description: prompt.description,
            content: prompt.content,
          },
        )
      )
        throw new InterlockError(
          `Prompt conflict for ${prompt.id}. Shared prompt content cannot be overwritten by workflow import, even with force.`,
        );
      if (!existing)
        store.savePrompt({
          ...prompt,
          revision: Math.max(
            prompt.revision,
            store.latestPromptRevision(prompt.id) + 1,
          ),
          createdAt: now,
          updatedAt: now,
        });
    }
    const changed: string[] = [];
    const skippedVersions: { workflowId: string; version: number }[] = [];
    const restoredVersions: { workflowId: string; version: number }[] = [];
    const added = new Set<string>();
    for (const entry of bundle.workflows) {
      for (const definition of [
        entry.draft,
        ...entry.versions.map((v) => v.definition),
      ])
        for (const id of promptIds(definition))
          if (!includedPrompts.some((p) => p.id === id))
            throw new InterlockError(`Bundle is missing saved prompt ${id}`);
      const existing = store.get<Workflow>('workflows', entry.id);
      if (
        existing &&
        (existing.ownerWorkflowId ?? null) !== entry.ownerWorkflowId
      )
        throw new InterlockError(`Ownership conflict for ${entry.id}`);
      const sameDraft =
        existing &&
        isDeepStrictEqual(existing.draft, entry.draft) &&
        existing.name === entry.name &&
        existing.description === entry.description;
      if (
        existing &&
        !sameDraft &&
        !options.force &&
        options.draftRevisions?.[entry.id] !== existing.draftRevision
      )
        throw new InterlockError(
          `Draft conflict for ${entry.id}. Supply its current draftRevisions entry or use force to replace the draft.`,
        );
      let previous = 0;
      for (const deleted of entry.deletedVersions ?? []) {
        if (
          deleted.version <= previous ||
          entry.versions.some((v) => v.version === deleted.version)
        )
          throw new InterlockError(
            `Invalid deleted version identities for ${entry.id}`,
          );
        previous = deleted.version;
        const retained = store.getVersion(entry.id, deleted.version);
        const local = store.deletedVersion(entry.id, deleted.version);
        if (
          (retained &&
            definitionHash(retained.definition) !== deleted.definitionHash) ||
          (local && local.definitionHash !== deleted.definitionHash)
        )
          throw new InterlockError(
            `Deleted version identity conflict for ${entry.id}:${deleted.version}`,
          );
        // Transfer cleanup decisions without deleting definitions retained locally.
        if (!retained && !local) {
          store.recordDeletedVersion({ workflowId: entry.id, ...deleted });
          added.add(entry.id);
        }
      }
      for (let i = 0; i < entry.versions.length; i++) {
        const version = entry.versions[i];
        if (i > 0 && version.version <= entry.versions[i - 1].version)
          throw new InterlockError(
            `Versions for ${entry.id} must be unique and in increasing order`,
          );
        const published = store.getVersion(entry.id, version.version);
        if (
          published &&
          (!isDeepStrictEqual(published.definition, version.definition) ||
            !isDeepStrictEqual(
              published.pinnedPromptRevisions ?? undefined,
              version.pinnedPromptRevisions ?? undefined,
            ))
        )
          throw new InterlockError(
            `Published version conflict for ${entry.id}:${version.version}. Published versions cannot be overwritten, even with force.`,
          );
        const deleted = store.deletedVersion(entry.id, version.version);
        if (
          deleted &&
          deleted.definitionHash !== definitionHash(version.definition)
        )
          throw new InterlockError(
            `Deleted version identity conflict for ${entry.id}:${version.version}. Only the original definition can be restored.`,
          );
        if (!published && deleted && !options.restoreDeletedVersions) {
          skippedVersions.push({
            workflowId: entry.id,
            version: version.version,
          });
          continue;
        }
        if (!published) {
          store.version({ workflowId: entry.id, ...version, createdAt: now });
          added.add(entry.id);
          if (deleted) {
            restoredVersions.push({
              workflowId: entry.id,
              version: version.version,
            });
            store.remove('deletedVersions', `${entry.id}:${version.version}`);
          }
        }
      }
      const latestVersion = Math.max(
        existing?.latestVersion ?? 0,
        ...entry.versions.map((v) => v.version),
        ...(entry.deletedVersions ?? []).map((v) => v.version),
      );
      if (
        !sameDraft ||
        latestVersion !== existing?.latestVersion ||
        added.has(entry.id)
      )
        changed.push(entry.id);
      const workflow: Workflow = {
        id: entry.id,
        ownerWorkflowId: entry.ownerWorkflowId,
        name: entry.name,
        description: entry.description,
        archived: existing?.archived ?? false,
        draft: entry.draft,
        draftRevision: existing
          ? existing.draftRevision + (sameDraft ? 0 : 1)
          : 1,
        latestVersion,
        createdAt: existing?.createdAt ?? now,
        updatedAt:
          !sameDraft ||
          latestVersion !== existing?.latestVersion ||
          added.has(entry.id)
            ? now
            : existing.updatedAt,
      };
      store.put('workflows', workflow);
    }
    const scheduleIds = new Set<string>();
    for (const entry of bundle.workflows)
      for (const schedule of [
        ...(entry.schedules ?? []),
        ...(entry.webhooks ?? []),
        ...(entry.eventTriggers ?? []),
      ]) {
        if (scheduleIds.has(schedule.id))
          throw new InterlockError('Duplicate trigger identity in bundle');
        scheduleIds.add(schedule.id);
        const existing = store.get<WorkflowTrigger>(
          'workflowTriggers',
          schedule.id,
        );
        if (existing && existing.workflowId !== entry.id)
          throw new InterlockError(
            'Trigger identity belongs to another workflow',
          );
        if (
          existing &&
          !options.force &&
          !isDeepStrictEqual(triggerConfig(existing), schedule.config)
        )
          throw new InterlockError(
            'Trigger configuration conflict; use force to replace after inspection',
          );
        if (existing && existing.kind !== schedule.config.kind)
          throw new InterlockError('Trigger identity cannot change kind');
        store.put<WorkflowTrigger>('workflowTriggers', {
          ...existing,
          tags: schedule.config.tags,
          ...schedule.config,
          id: schedule.id,
          workflowId: entry.id,
          revision: (existing?.revision ?? 0) + 1,
          enabled: false,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          ...(schedule.config.kind === 'schedule'
            ? {
                anchorAt: now,
                nextFireAt: nextScheduleSlot(schedule.config.timing, now),
              }
            : schedule.config.kind === 'webhook'
              ? {
                  ignoredCount:
                    existing?.kind === 'webhook' ? existing.ignoredCount : 0,
                  rejectedCount:
                    existing?.kind === 'webhook' ? existing.rejectedCount : 0,
                  deliveryCount:
                    existing?.kind === 'webhook' ? existing.deliveryCount : 0,
                }
              : {
                  lastFireAt: undefined,
                  previousRunId: undefined,
                  lastCheckedAt: undefined,
                }),
          consecutiveFailures: 0,
          autoPaused: undefined,
          lastLagMs: undefined,
        } as WorkflowTrigger);
        if (schedule.config.kind === 'event')
          store.deleteEventHistory(schedule.id);
      }
    const all = store.workflows();
    for (const entry of bundle.workflows) {
      if (entry.ownerWorkflowId) {
        const owner = all.find((w) => w.id === entry.ownerWorkflowId);
        if (!owner || owner.ownerWorkflowId || owner.id === entry.id)
          throw new InterlockError(`Invalid owner for ${entry.id}`);
      }
      validateWorkflowReferences(entry.id, entry.draft, all);
      if (latestVersionUnavailable(store, entry.id))
        throw new InterlockError(
          `Latest published version for ${entry.id} must be retained`,
        );
      for (const version of store.listVersions(entry.id)) {
        validateDefinition(version.definition);
        validateWorkflowReferences(entry.id, version.definition, all);
        for (const node of version.definition.nodes)
          if (
            node.kind === 'workflow' &&
            (node.version === null ||
              !store.getVersion(node.workflowId, node.version))
          )
            throw new InterlockError(
              `Missing published dependency for ${node.label}`,
            );
      }
    }
    let published: { id: string; version: number }[] | undefined;
    if (options.publish) {
      const engine = options.engine ?? new Engine(store, process.cwd());
      try {
        const workflowIds = bundle.workflows.map((w) => w.id);
        engine.publish(workflowIds, options.cascade ?? false);
        published = workflowIds.map((id) => ({
          id,
          version: store.get<Workflow>('workflows', id)!.latestVersion,
        }));
      } finally {
        if (!options.engine) engine.stop();
      }
    }
    return {
      rootId: bundle.rootId,
      changed,
      skippedVersions,
      restoredVersions,
      workflows: bundle.workflows.map((w) => ({
        id: w.id,
        draftRevision: store.get<Workflow>('workflows', w.id)!.draftRevision,
        ...(published
          ? {
              latestVersion: store.get<Workflow>('workflows', w.id)!
                .latestVersion,
            }
          : {}),
      })),
      ...(published ? { published } : {}),
    };
  });
}

function latestVersionUnavailable(store: Store, id: string) {
  const latest = store.get<Workflow>('workflows', id)!.latestVersion;
  return latest > 0 && !store.getVersion(id, latest);
}
