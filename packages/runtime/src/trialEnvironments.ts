import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import {
  InterlockError,
  type WorkflowComparison,
  type ComparisonSample,
  type TrialEnvironment,
  type Run,
  type TrialWorkContext,
  type UsageAttempt,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import { fingerprint } from './versionIdentity.js';
import {
  prepareGitTrial,
  retainAndCleanGitTrial,
  assertTrialOwned,
  trialPaths,
  trialProcessEnvironment,
} from './localGitTrials.js';

export const trialReserved = (s: ComparisonSample) =>
  Boolean(
    !s.runId &&
    !s.observation &&
    s.trial &&
    ['preparing', 'ready'].includes(s.trial.preparation),
  );
const active = (r: Run) => r.status === 'running' || r.status === 'waiting';
const now = () => new Date().toISOString();
const errorText = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 512);
export function publicTrial(trial: TrialEnvironment) {
  const {
    id,
    configurationId,
    setupId,
    baseCommit,
    preparation,
    cleanup,
    requiresQuiescence,
    error,
    cleanupError,
    updatedAt,
  } = trial;
  return {
    id,
    configurationId,
    setupId,
    baseCommit,
    preparation,
    cleanup,
    requiresQuiescence,
    error,
    cleanupError,
    artifactsAvailable: Boolean(trial.artifacts),
    updatedAt,
  };
}

/** Owns persistent Git preparation/cleanup, never executing filesystem jobs in transactions. */
export class TrialEnvironments {
  readonly root: string;
  readonly configured: boolean;
  private jobs = new Map<string, AbortController>();
  private stopped = false;
  constructor(
    private store: Store,
    root?: string,
    private wake: () => void = () => {},
  ) {
    this.configured = root !== undefined || store.path !== ':memory:';
    this.root = resolve(
      root ?? join(dirname(resolve(store.path)), 'evaluation-trials'),
    );
  }
  create(c: WorkflowComparison, sample: ComparisonSample): TrialEnvironment {
    return {
      id: randomUUID(),
      ownerToken: randomUUID(),
      configurationId: c.configurations![sample.side].id,
      setupId: fingerprint(c.trialSetup),
      baseCommit: c.trialSetup!.commit,
      preparation: 'queued',
      cleanup: 'pending',
      requiresQuiescence: false,
      updatedAt: now(),
    };
  }
  private update(
    comparisonId: string,
    sampleId: string,
    edit: (t: TrialEnvironment) => void,
  ) {
    this.store.transaction(() => {
      const c = this.store.get<WorkflowComparison>('comparisons', comparisonId);
      const t = c?.samples.find((s) => s.id === sampleId)?.trial;
      if (!c || !t) return;
      edit(t);
      t.updatedAt = now();
      c.updatedAt = t.updatedAt;
      this.store.put('comparisons', c);
    });
  }
  private tree(
    c: WorkflowComparison,
    s: ComparisonSample,
    runs = this.store.runs(),
  ) {
    return runs.filter(
      (r) =>
        r.comparison?.comparisonId === c.id && r.comparison.sampleId === s.id,
    );
  }
  recover() {
    const interrupted = new Set<string>();
    for (const c of this.store.list<WorkflowComparison>('comparisons'))
      for (const s of c.samples) {
        const t = s.trial;
        if (!t) continue;
        const tree = this.tree(c, s);
        const ids = new Set(tree.map((r) => r.id));
        const running =
          tree.some((r) =>
            r.executions.some(
              (e) =>
                (e.status === 'running' &&
                  (e.kind === 'script' || e.kind === 'fetch')) ||
                (e.kind === 'wait' &&
                  e.status === 'waiting' &&
                  e.nextCheckAt !== undefined),
            ),
          ) ||
          this.store
            .work()
            .some((w) => ids.has(w.runId) && w.status === 'claimed');
        if (running) for (const r of tree) if (active(r)) interrupted.add(r.id);
        if (t.preparation === 'preparing' || t.cleanup === 'running' || running)
          this.update(c.id, s.id, (t) => {
            t.requiresQuiescence = true;
            if (t.preparation === 'preparing') {
              t.preparation = 'failed';
              t.error =
                'Trial preparation was interrupted; inspect the retained directory before starting a new comparison';
            }
            if (t.cleanup === 'running') {
              t.cleanup = 'blocked';
              t.cleanupError =
                'Trial cleanup was interrupted; confirm worker quiescence and request cleanup again';
            }
          });
      }
    return [...interrupted];
  }
  interrupt(run: Run) {
    if (!run.comparison) return [];
    const c = this.store.get<WorkflowComparison>(
      'comparisons',
      run.comparison.comparisonId,
    );
    const s = c?.samples.find((s) => s.id === run.comparison!.sampleId);
    if (!c || !s?.trial) return [];
    this.update(c.id, s.id, (t) => {
      t.requiresQuiescence = true;
    });
    return this.tree(c, s)
      .filter(active)
      .map((r) => r.id);
  }
  context(run: Run): TrialWorkContext | undefined {
    if (!run.comparison) return undefined;
    const c = this.store.get<WorkflowComparison>(
      'comparisons',
      run.comparison.comparisonId,
    );
    if (!c?.trialSetup) return undefined;
    const sample = c.samples.find((s) => s.id === run.comparison!.sampleId),
      t = sample?.trial;
    if (
      !t ||
      t.preparation !== 'ready' ||
      t.cleanup !== 'pending' ||
      t.requiresQuiescence ||
      t.configurationId !== c.configurations?.[run.comparison.side].id ||
      t.setupId !== fingerprint(c.trialSetup)
    )
      throw new InterlockError(
        'Trial environment is unavailable or stale; no work can run in the server directory',
      );
    assertTrialOwned(this.root, t);
    return {
      id: t.id,
      workspace: t.workspace!,
      baseCommit: t.baseCommit,
      configurationId: t.configurationId,
      policy: 'trusted_local',
    };
  }
  execution(run: Run) {
    const context = this.context(run);
    return context
      ? {
          cwd: context.workspace,
          env: {
            ...trialProcessEnvironment(),
            INTERLOCK_TRIAL_ID: context.id,
            INTERLOCK_TRIAL_WORKSPACE: context.workspace,
            INTERLOCK_TRIAL_BASE_COMMIT: context.baseCommit,
          },
        }
      : undefined;
  }
  read(c: WorkflowComparison, s: ComparisonSample) {
    if (!s.trial)
      throw new InterlockError('This sample has no managed trial environment');
    return {
      comparisonId: c.id,
      sampleId: s.id,
      ...publicTrial(s.trial),
      repository: c.trialSetup!.repository,
      workspace: s.trial.workspace ?? null,
      artifacts: s.trial.artifacts ?? null,
      policy: 'trusted_local' as const,
    };
  }
  requestCleanup(
    c: WorkflowComparison,
    sample: ComparisonSample,
    quiescent: boolean,
  ) {
    if (!sample.trial)
      throw new InterlockError('This sample has no managed trial environment');
    if (
      this.tree(c, sample).some(active) ||
      (!sample.observation && c.status === 'running')
    )
      throw new InterlockError(
        'Trial execution must finish or be cancelled before cleanup',
      );
    if (sample.trial.requiresQuiescence && !quiescent)
      throw new InterlockError(
        'Confirm quiescent:true only after the external harness has stopped uncertain workers',
      );
    this.update(c.id, sample.id, (t) => {
      if (t.cleanup === 'complete' || t.cleanup === 'running') return;
      if (quiescent) t.requiresQuiescence = false;
      t.cleanup = 'pending';
      t.cleanupError = undefined;
      t.cleanupRequested = true;
    });
  }
  stop() {
    this.stopped = true;
    for (const controller of this.jobs.values()) controller.abort();
  }
  pump(localJobs: Set<string>) {
    if (this.stopped) return;
    const comparisons = this.store.list<WorkflowComparison>('comparisons');
    const runs = this.store.runs();
    let reserved = comparisons.reduce(
      (n, c) =>
        n +
        c.samples.filter(
          (s) => this.tree(c, s, runs).some(active) || trialReserved(s),
        ).length,
      0,
    );
    for (const c of comparisons) {
      if (!c.trialSetup) continue;
      let busy = c.samples.filter(
        (s) => this.tree(c, s, runs).some(active) || trialReserved(s),
      ).length;
      for (const sample of c.samples) {
        const t = sample.trial;
        if (!t) continue;
        if (this.jobs.has(t.id)) {
          if (c.status === 'cancelled' && t.preparation === 'preparing')
            this.jobs.get(t.id)!.abort();
          continue;
        }
        const tree = this.tree(c, sample, runs);
        const terminal =
          Boolean(sample.observation) || c.status === 'cancelled';
        if (
          !terminal &&
          t.preparation === 'queued' &&
          c.status === 'running' &&
          busy < c.concurrency &&
          reserved < 10 &&
          this.jobs.size < 10
        ) {
          busy++;
          reserved++;
          const paths = trialPaths(this.root, t);
          this.update(c.id, sample.id, (t) => {
            t.preparation = 'preparing';
            t.directory = paths.directory;
            t.workspace = paths.workspace;
          });
          const controller = new AbortController();
          this.jobs.set(t.id, controller);
          void prepareGitTrial(
            this.root,
            c.trialSetup!,
            { ...t, directory: paths.directory, workspace: paths.workspace },
            controller.signal,
          )
            .then(
              (result) => {
                if (!this.stopped)
                  this.update(c.id, sample.id, (t) => {
                    t.preparation = 'ready';
                    Object.assign(t, result);
                  });
              },
              (error) => {
                if (!this.stopped)
                  this.update(c.id, sample.id, (t) => {
                    t.preparation = 'failed';
                    t.error = errorText(error);
                  });
              },
            )
            .finally(() => {
              this.jobs.delete(t.id);
              if (!this.stopped) this.wake();
            });
          continue;
        }
        if (
          !terminal ||
          tree.some(active) ||
          tree.some((r) => r.executions.some((e) => localJobs.has(e.id))) ||
          t.cleanup === 'complete' ||
          t.cleanup === 'running' ||
          t.cleanup === 'blocked' ||
          this.jobs.size >= 10
        )
          continue;
        // Expiry and cancellation cannot establish that an external process stopped.
        const ids = new Set(tree.map((r) => r.id));
        const uncertain = this.store
          .forRuns<UsageAttempt>('usageAttempts', ids)
          .some((a) => a.outcome === 'expired' || a.outcome === 'cancelled');
        if ((uncertain && !t.cleanupRequested) || t.requiresQuiescence) {
          this.update(c.id, sample.id, (t) => {
            t.requiresQuiescence = true;
            t.cleanup = 'blocked';
            t.cleanupError =
              'An external worker may still be acting; stop it before confirming quiescent cleanup';
          });
          continue;
        }
        if (
          t.preparation === 'queued' ||
          (t.preparation === 'failed' &&
            !existsSync(trialPaths(this.root, t).directory))
        ) {
          this.update(c.id, sample.id, (t) => {
            t.cleanup = 'complete';
          });
          continue;
        }
        this.update(c.id, sample.id, (t) => {
          t.cleanup = 'running';
          t.cleanupRequested = false;
        });
        const controller = new AbortController();
        this.jobs.set(t.id, controller);
        void retainAndCleanGitTrial(this.root, t, controller.signal)
          .then(
            (artifacts) => {
              if (!this.stopped)
                this.update(c.id, sample.id, (t) => {
                  t.cleanup = 'complete';
                  t.artifacts = artifacts;
                });
            },
            (error) => {
              if (!this.stopped)
                this.update(c.id, sample.id, (t) => {
                  t.cleanup = 'blocked';
                  t.cleanupError = errorText(error);
                });
            },
          )
          .finally(() => {
            this.jobs.delete(t.id);
            if (!this.stopped) this.wake();
          });
      }
    }
  }
}
