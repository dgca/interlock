import {
  InterlockError,
  assertContract,
  assertOwnPropertyContract,
  promptIds,
  runVersionReadSchema,
  runVersionPreviewSchema,
  runVersionApplySchema,
  setRunVersionPolicySchema,
  type Json,
  type Run,
  type Workflow,
  type WorkflowDefinition,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import type { z } from 'zod';
import { fingerprint } from './versionIdentity.js';

const active = (status: string) =>
  ['queued', 'running', 'waiting'].includes(status);
const chainConfig = (definition: WorkflowDefinition) =>
  Object.fromEntries(
    definition.nodes.flatMap((node) =>
      node.kind === 'exit' && node.continueAsNew
        ? [[node.id, node.continueAsNew]]
        : [],
    ),
  );

/** Changes only a run's future execution binding, never an existing visit. */
export class RunVersions {
  constructor(
    private store: Store,
    private hooks: {
      input: (run: Run, definition: WorkflowDefinition) => Json;
      prompts: (
        definition: WorkflowDefinition,
        pins?: Record<string, number>,
      ) => NonNullable<Run['promptSnapshots']>;
      validateCaptures: (run: Run, definition: WorkflowDefinition) => void;
      save: (run: Run) => void;
      event: (run: Run, type: string, message: string) => void;
      assertRunnable: (run: Pick<Run, 'workflowId' | 'version'>) => void;
    },
  ) {}

  private run(id: string) {
    const run = this.store.get<Run>('runs', id);
    if (!run) throw new InterlockError('Run not found');
    return run;
  }
  read(input: z.input<typeof runVersionReadSchema>) {
    const q = runVersionReadSchema.parse(input),
      run = this.run(q.runId);
    const history = [...(run.versionChanges ?? [])].reverse();
    return {
      runId: run.id,
      version: run.version,
      policy: run.versionPolicy ?? ('pinned' as const),
      revision: run.versionRevision ?? 0,
      ...(run.versionBlocker ? { blocker: run.versionBlocker } : {}),
      history: {
        items: history.slice(q.offset, q.offset + q.limit),
        total: history.length,
        truncated: q.offset + q.limit < history.length,
      },
    };
  }
  setPolicy(input: z.input<typeof setRunVersionPolicySchema>) {
    const q = setRunVersionPolicySchema.parse(input);
    return this.store.transaction(() => {
      const run = this.run(q.runId);
      if (!active(run.status))
        throw new InterlockError('Version policy requires an active run');
      if (run.parallelBranch)
        throw new InterlockError(
          'Parallel branches retain the version of their invocation',
        );
      if (run.comparison)
        throw new InterlockError(
          'Workflow comparisons keep their selected versions',
        );
      if ((run.versionRevision ?? 0) !== q.expectedRevision)
        throw new InterlockError(
          'Run version policy changed. Reload before saving.',
        );
      if ((run.versionPolicy ?? 'pinned') !== q.policy) {
        run.versionPolicy = q.policy;
        run.versionRevision = (run.versionRevision ?? 0) + 1;
        delete run.versionBlocker;
        this.hooks.save(run);
        this.hooks.event(
          run,
          'run.version_policy_changed',
          `Version policy: ${q.policy}`,
        );
      }
      return this.read({ runId: run.id });
    });
  }

  private plan(run: Run, version: number, recapturePrompts: boolean) {
    const target = this.store.getVersion(run.workflowId, version);
    const current = this.store.getVersion(run.workflowId, run.version);
    const blockers: string[] = [];
    const add = (reason: string) => {
      if (blockers.length < 32) blockers.push(reason.slice(0, 1000));
    };
    if (!active(run.status)) add('Only active runs can move versions');
    if (run.parallelBranch)
      add('Parallel branches retain the version of their invocation');
    if (run.comparison)
      add('Workflow comparisons keep their selected versions');
    if (version <= run.version) add('Select a newer published version');
    if (!target) add('Target published version is not retained');
    if (!current) add('Current published definition is not retained');
    const execution = run.executions.at(-1);
    if (execution && active(execution.status))
      add(
        'The current execution must finish before moving, including available or claimed assignments',
      );
    let snapshots = run.promptSnapshots;
    if (target && current) {
      if (
        run.executions.length + (run.parallelSteps ?? 0) >=
        target.definition.maxSteps
      )
        add('Target step limit would reject the next execution');
      const node = target.definition.nodes.find((n) => n.id === run.cursor);
      if (!node) add(`Next node ${run.cursor} is missing from target version`);
      else {
        if (node.batchId !== run.batchNodeId)
          add('Next node belongs to a different Batch scope');
        if (
          node.parallelId !== run.parallelBranch?.nodeId ||
          node.parallelBranchId !== run.parallelBranch?.id
        )
          add('Next node belongs to a different Parallel scope');
        if (
          run.batchNodeId &&
          !target.definition.nodes.some(
            (n) => n.id === run.batchNodeId && n.kind === 'batch',
          )
        )
          add('The current Batch is missing from target version');
        let batchId = run.batchNodeId;
        while (batchId) {
          const previousBatch = current.definition.nodes.find(
            (n) => n.id === batchId,
          );
          const nextBatch = target.definition.nodes.find(
            (n) => n.id === batchId,
          );
          if (
            !nextBatch ||
            nextBatch.kind !== 'batch' ||
            previousBatch?.batchId !== nextBatch.batchId
          ) {
            add('Batch ancestry must remain unchanged');
            break;
          }
          batchId = previousBatch?.batchId;
        }
        try {
          const input = this.hooks.input(run, target.definition);
          const assertInput =
            node.kind === 'parallel'
              ? assertOwnPropertyContract
              : assertContract;
          assertInput(node.inputSchema, input, 'Target node input');
          if (node.kind === 'entry')
            assertContract(
              target.definition.inputSchema,
              run.input,
              'Target workflow input',
            );
        } catch (error) {
          add(error instanceof Error ? error.message : String(error));
        }
      }
      if (
        fingerprint(chainConfig(current.definition)) !==
        fingerprint(chainConfig(target.definition))
      )
        add('Continue-as-new configuration must remain unchanged');
      try {
        this.hooks.assertRunnable({ workflowId: run.workflowId, version });
      } catch (error) {
        add(error instanceof Error ? error.message : String(error));
      }
      try {
        if (recapturePrompts)
          snapshots = this.hooks.prompts(
            target.definition,
            target.pinnedPromptRevisions,
          );
        else
          for (const id of promptIds(target.definition))
            if (!snapshots?.some((prompt) => prompt.id === id))
              add(
                `Prompt capture ${id} is missing; explicitly recapture prompts to include it`,
              );
        this.hooks.validateCaptures(run, target.definition);
      } catch (error) {
        add(error instanceof Error ? error.message : String(error));
      }
    }
    const result = {
      runId: run.id,
      fromVersion: run.version,
      toVersion: version,
      nodeId: run.cursor,
      recapturePrompts,
      canApply: blockers.length === 0,
      blockers,
    };
    // Include private capture content only in the fingerprint, never in previews.
    return {
      ...result,
      confirmation: fingerprint({ result, run, target, snapshots }),
      snapshots,
    };
  }
  preview(input: z.input<typeof runVersionPreviewSchema>) {
    const q = runVersionPreviewSchema.parse(input);
    const { snapshots: _, ...preview } = this.plan(
      this.run(q.runId),
      q.version,
      q.recapturePrompts,
    );
    return preview;
  }
  private move(
    run: Run,
    version: number,
    reason: string,
    recapturePrompts: boolean,
    snapshots: Run['promptSnapshots'],
  ) {
    // Legacy executions must retain their original version before rebinding.
    for (const execution of run.executions) execution.version ??= run.version;
    run.versionChanges = [
      ...(run.versionChanges ?? []),
      {
        fromVersion: run.version,
        toVersion: version,
        at: new Date().toISOString(),
        reason,
        recapturePrompts,
      },
    ];
    run.version = version;
    run.versionRevision = (run.versionRevision ?? 0) + 1;
    if (recapturePrompts) run.promptSnapshots = snapshots;
    delete run.versionBlocker;
    this.hooks.save(run);
    this.hooks.event(
      run,
      'run.version_changed',
      `Moved to v${version}: ${reason}`,
    );
  }
  apply(input: z.input<typeof runVersionApplySchema>) {
    const q = runVersionApplySchema.parse(input);
    return this.store.transaction(() => {
      const run = this.run(q.runId),
        plan = this.plan(run, q.version, q.recapturePrompts);
      if (q.confirmation !== plan.confirmation)
        throw new InterlockError(
          'Version move preview changed. Preview again before applying.',
        );
      if (!plan.canApply)
        throw new InterlockError(
          `Cannot move run: ${plan.blockers.join('; ')}`,
        );
      this.move(run, q.version, q.reason, q.recapturePrompts, plan.snapshots);
      return this.read({ runId: run.id });
    });
  }
  /** Called inside the engine transaction, only before creating a visit. */
  advance(run: Run) {
    if (run.versionPolicy !== 'latest-compatible' || run.comparison) return;
    const workflow = this.store.get<Workflow>('workflows', run.workflowId);
    if (!workflow || workflow.latestVersion <= run.version) return;
    const plan = this.plan(run, workflow.latestVersion, false);
    if (plan.canApply)
      this.move(
        run,
        plan.toVersion,
        'Automatic compatible step-boundary upgrade',
        false,
        plan.snapshots,
      );
    else {
      const blocker = {
        version: plan.toVersion,
        nodeId: run.cursor,
        reasons: plan.blockers,
      };
      if (fingerprint(run.versionBlocker ?? null) !== fingerprint(blocker)) {
        run.versionBlocker = blocker;
        this.hooks.save(run);
        this.hooks.event(
          run,
          'run.version_blocked',
          `Could not move to v${plan.toVersion}: ${plan.blockers.join('; ')}`,
        );
      }
    }
  }
}
