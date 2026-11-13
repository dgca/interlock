import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  InterlockError,
  workspaceBranch,
  type Json,
  type ManagedWorkspace,
  type PathBinding,
  type Run,
  type WorkflowDefinition,
  type WorkflowNode,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import {
  createWorktree,
  reconcileWorktrees,
  removeWorktree,
  workspacePaths,
} from './gitWorktrees.js';
import type { ContextContinuityGroups } from './contextContinuity.js';
import { sourceQuiescence } from './quiescence.js';
import type { TrialEnvironments } from './trialEnvironments.js';
import {
  resolveAndValidateCwd,
  validateDirectoryContainment,
} from './workingDirectory.js';

const collection = 'workspaces';
const terminal = (run: Run) =>
  ['completed', 'failed', 'cancelled'].includes(run.status);
const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 512);
type Host = {
  readonly store: Store;
  readonly contextGroups: ContextContinuityGroups;
  getAllowedRoots(): string[];
  pump(): void;
};

/**
 * A Git worktree per run for workflows with a workspace setting. The run that
 * owns it is the one whose definition sets it, except Batch items, Parallel
 * branches and continue-as-new runs, which share their owner's checkout;
 * invoked workflows without their own setting share their caller's.
 */
export class ManagedWorkspaces {
  readonly root: string;
  readonly configured: boolean;
  private active = new Set<string>();
  private jobs = new Map<string, AbortController>();
  private retryAt = new Map<string, number>();
  private stopped = false;
  private reconciled = false;
  private store: Store;
  constructor(
    private host: Host,
    private trials: TrialEnvironments,
    private options: { workspaceRoot?: string; substituteOperation?: unknown },
  ) {
    const store = (this.store = host.store);
    const root = options.workspaceRoot;
    this.configured = root !== undefined || store.path !== ':memory:';
    this.root = resolve(
      root ?? join(dirname(resolve(store.path)), 'workspaces'),
    );
    for (const workspace of store.list<ManagedWorkspace>(collection)) {
      if (workspace.state === 'removed') continue;
      this.active.add(workspace.id);
      // A process interruption leaves no evidence of how far Git got.
      if (workspace.state === 'preparing')
        this.update(workspace.id, (w) => {
          w.state = 'failed';
          w.error = 'Workspace preparation was interrupted';
        });
      if (workspace.state === 'removing')
        this.update(workspace.id, (w) => {
          w.state = 'ready';
        });
    }
  }
  private update(id: string, edit: (w: ManagedWorkspace) => void) {
    if (this.stopped) return;
    this.store.transaction(() => {
      const workspace = this.store.get<ManagedWorkspace>(collection, id);
      if (!workspace) return;
      edit(workspace);
      workspace.updatedAt = new Date().toISOString();
      this.store.put(collection, workspace);
    });
  }
  private owns(run: Run, definition: WorkflowDefinition) {
    return Boolean(
      definition.workspace &&
      !run.batchNodeId &&
      !run.parallelBranch &&
      (!run.chain || run.chain.rootRunId === run.id) &&
      // Simulations have no side effects; local Git trials isolate themselves.
      !this.options.substituteOperation &&
      !this.trials.isolates(run),
    );
  }
  private definition(run: Run) {
    const version = this.store.getVersion(run.workflowId, run.version);
    if (!version)
      throw new InterlockError('Published workflow version not found');
    return version.definition;
  }
  private ownerId(run: Run, definition = this.definition(run)) {
    let current: Run | undefined = run;
    for (let depth = 0; current && depth < 64; depth++) {
      if (current.chain && current.chain.rootRunId !== current.id)
        current = this.store.get<Run>('runs', current.chain.rootRunId);
      else if (
        this.owns(
          current,
          current === run ? definition : this.definition(current),
        )
      )
        return current.id;
      else
        current = current.parentRunId
          ? this.store.get<Run>('runs', current.parentRunId)
          : undefined;
    }
    return undefined;
  }
  get(id: string) {
    return this.store.get<ManagedWorkspace>(collection, id);
  }
  /** The checkout a run works in, or undefined when no workspace applies. */
  path(run: Run, definition?: WorkflowDefinition) {
    const id = this.ownerId(run, definition);
    if (!id) return undefined;
    const workspace = this.get(id);
    if (workspace?.state !== 'ready' || !existsSync(workspace.path))
      throw new InterlockError(
        `The run's workspace is ${workspace?.state ?? 'missing'}; no work runs outside it`,
      );
    return workspace.path;
  }
  /**
   * Called before a run takes a step. Undefined lets it proceed, false waits
   * for preparation, and text is a preparation error that fails the step.
   */
  gate(run: Run, definition: WorkflowDefinition): boolean | string | undefined {
    if (!this.owns(run, definition)) return undefined;
    const settings = definition.workspace!;
    const existing = this.get(run.id);
    if (existing?.state === 'ready' && existsSync(existing.path))
      return undefined;
    if (existing?.state === 'preparing' || existing?.state === 'removing')
      return false;
    if (existing?.state === 'failed' && !existing.reported) {
      this.update(run.id, (w) => {
        w.reported = true;
      });
      return `Workspace: ${existing.error}`;
    }
    if (!this.configured)
      return 'Workspace: managed workspaces need a data folder';
    let branch: string;
    try {
      branch = workspaceBranch(settings.branch, run.id);
    } catch (error) {
      return `Workspace: ${errorText(error)}`;
    }
    const time = new Date().toISOString();
    const workspace: ManagedWorkspace = {
      createdAt: time,
      ...existing,
      id: run.id,
      runId: run.id,
      workflowId: run.workflowId,
      repository: existing?.repository ?? settings.repository,
      path: workspacePaths(this.root, run.id).path,
      branch: existing?.branch ?? branch,
      ownerToken: existing?.ownerToken ?? randomUUID(),
      state: 'preparing',
      updatedAt: time,
    };
    delete workspace.error;
    delete workspace.reported;
    this.store.put(collection, workspace);
    this.active.add(run.id);
    this.retryAt.delete(run.id);
    this.job(run.id, (signal) =>
      createWorktree(
        this.root,
        workspace,
        settings.baseRef,
        () =>
          this.update(run.id, (w) => {
            w.branchClaimed = true;
          }),
        signal,
      ).then(
        ({ baseCommit }) =>
          this.update(run.id, (w) => {
            w.state = 'ready';
            w.baseCommit = baseCommit;
          }),
        (error: unknown) =>
          this.update(run.id, (w) => {
            w.state = 'failed';
            w.error = errorText(error);
          }),
      ),
    );
    return false;
  }
  private job(id: string, work: (signal: AbortSignal) => Promise<unknown>) {
    const controller = new AbortController();
    this.jobs.set(id, controller);
    void work(controller.signal).finally(() => {
      this.jobs.delete(id);
      if (!this.stopped) this.host.pump();
    });
  }
  /** Agent working directory: node cwd, then the workspace, then workflow cwd. */
  agentCwd(
    run: Run,
    node: Extract<WorkflowNode, { kind: 'agent' }>,
    definition: WorkflowDefinition,
    source: (binding: PathBinding) => Json | undefined,
  ): { resolvedCwd?: string; cwdBlocked?: { reason: string } } {
    const group = node.context.continuityGroup;
    const continuity = group
      ? this.host.contextGroups.describe(run.id, group)
      : undefined;
    // A continued session keeps the directory it started in.
    if (continuity?.session && continuity.cwd)
      return { resolvedCwd: continuity.cwd };
    const allowed = this.host.getAllowedRoots();
    let result: { resolvedCwd?: string; error?: string };
    try {
      const workspace =
        node.cwd === undefined ? this.path(run, definition) : undefined;
      result = workspace
        ? { resolvedCwd: workspace }
        : resolveAndValidateCwd(
            node.cwd ?? definition.cwd,
            source,
            allowed.length ? allowed : undefined,
          );
    } catch (error) {
      result = { error: errorText(error) };
    }
    return result.error
      ? { cwdBlocked: { reason: `${node.label}: ${result.error}` } }
      : { resolvedCwd: result.resolvedCwd };
  }
  /** Executor directory check; the workspaces folder is always allowed. */
  validateCwd(candidate: string, roots: string[]) {
    return validateDirectoryContainment(
      candidate,
      roots.length ? [...roots, this.root] : undefined,
    );
  }
  stop() {
    this.stopped = true;
    for (const controller of this.jobs.values()) controller.abort();
  }
  /** Remove checkouts whose run tree is quiescent; reconcile once after startup. */
  pump(localJobs: Set<string>) {
    if (this.stopped || !this.configured) return;
    if (!this.reconciled) {
      this.reconciled = true;
      const repositories = [...this.active].flatMap(
        (id) => this.get(id)?.repository ?? [],
      );
      this.job('reconcile', () =>
        reconcileWorktrees(
          this.root,
          (id) => this.active.has(id),
          repositories,
        ),
      );
    }
    for (const id of this.active) {
      const workspace = this.get(id);
      if (!workspace || workspace.state === 'removed') {
        this.active.delete(id);
        continue;
      }
      if (
        this.jobs.has(id) ||
        workspace.state === 'preparing' ||
        (this.retryAt.get(id) ?? 0) > Date.now()
      )
        continue;
      const owner = this.store.get<Run>('runs', workspace.runId);
      if (
        owner &&
        (!terminal(owner) ||
          !sourceQuiescence(this.store, owner.id, localJobs).quiescent)
      )
        continue;
      this.update(id, (w) => {
        w.state = 'removing';
      });
      this.job(id, () =>
        removeWorktree(this.root, workspace).then(
          () =>
            this.update(id, (w) => {
              w.state = 'removed';
              delete w.error;
            }),
          (error: unknown) => {
            this.retryAt.set(id, Date.now() + 60_000);
            this.update(id, (w) => {
              w.state = 'failed';
              w.reported = true;
              w.error = `Removal failed: ${errorText(error)}`;
            });
          },
        ),
      );
    }
  }
}
