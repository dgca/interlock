import { InterlockError, type Run, type RunChain } from '@interlock/core';
import type { Store } from '@interlock/storage';

/** One durable pointer per chain, independent of child-run ancestry. */
export class RunChains {
  constructor(private store: Store) {}
  read(run: Run) {
    return run.chain
      ? this.store.get<RunChain>('runChains', run.chain.rootRunId)
      : undefined;
  }
  start(run: Run, maxRuns: number) {
    run.chain = { rootRunId: run.id, index: 1 };
    this.store.put<RunChain>('runChains', {
      id: run.id,
      latestRunId: run.id,
      runCount: 1,
      maxRuns,
    });
  }
  next(run: Run, create: () => Run) {
    const chain = this.read(run);
    if (!chain || !run.chain) throw new InterlockError('Run chain not found');
    if (chain.cancelledAt) throw new InterlockError('Run chain was cancelled');
    if (chain.latestRunId !== run.id || run.chain.nextRunId)
      throw new InterlockError('This run already has a successor');
    if (chain.runCount >= chain.maxRuns)
      throw new InterlockError(
        `Run chain limit reached (${chain.maxRuns} runs); checkpoint retained in failed Exit input`,
      );
    const next = create();
    next.chain = {
      rootRunId: chain.id,
      index: chain.runCount + 1,
      previousRunId: run.id,
    };
    run.chain.nextRunId = next.id;
    this.store.put<RunChain>('runChains', {
      ...chain,
      latestRunId: next.id,
      runCount: chain.runCount + 1,
    });
    this.store.put('runs', next);
    return next;
  }
  cancel(run: Run) {
    const chain = this.read(run);
    if (!chain) return run.id;
    this.store.put('runChains', {
      ...chain,
      cancelledAt: chain.cancelledAt ?? new Date().toISOString(),
    });
    return chain.latestRunId;
  }
  assertRetry(run: Run) {
    if (this.read(run)?.cancelledAt)
      throw new InterlockError('Cannot retry a cancelled run chain');
  }
  removeRuns(ids: Set<string>) {
    for (const chain of this.store.list<RunChain>('runChains'))
      if (ids.has(chain.id)) this.store.remove('runChains', chain.id);
  }
}
