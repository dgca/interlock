import { expect, it, vi } from 'vitest';
import type { Run, RunAttention } from '@interlock/core';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { appRouter } from '../packages/server/src/router';

it('pages projected run rows after applying the Runs scope and tab', async () => {
  const store = new Store(':memory:');
  const engine = new Engine(store, process.cwd());
  try {
    const large = 'large step output '.repeat(2000);
    const put = (id: string, fields: Partial<Run> = {}) =>
      store.put('runs', {
        id,
        workflowId: 'main',
        workflowName: 'Main',
        version: 1,
        status: 'completed',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        cursor: 'node',
        value: null,
        input: large,
        output: large,
        executions: [{ id: 'execution', output: large }],
        ...fields,
      });

    put('older-active', { status: 'waiting' });
    put('older-attention', { status: 'cancelled' });
    put('parent');
    put('ordinary-child', {
      workflowId: 'child',
      parentRunId: 'parent',
      parentExecutionId: 'child-execution',
      status: 'waiting',
    });
    put('batch-item', { parentRunId: 'parent', batchNodeId: 'batch' });
    put('detached', {
      workflowId: 'child',
      parentRunId: 'parent',
      parentMode: 'detached',
      parentExecutionId: 'detached-execution',
    });
    for (let index = 0; index < 105; index++) put(`recent-${index}`);

    const attention: RunAttention = {
      runId: 'older-attention',
      reasons: ['recovery'],
      target: { runId: 'older-attention', executionId: 'execution' },
    };
    vi.spyOn(engine, 'runAttention').mockReturnValue([attention]);
    const { runs } = appRouter.createCaller({ engine });

    const history = await runs.summaries({ tab: 'history' });
    expect(history.items).toHaveLength(100);
    expect(history.counts).toEqual({ active: 1, attention: 1, history: 108 });
    expect(history.items[0]).toMatchObject({
      id: 'recent-104',
      executionCount: 1,
    });
    expect(history.items[0]).not.toHaveProperty('executions');
    expect(history.items[0]).not.toHaveProperty('input');
    expect(history.items[0]).not.toHaveProperty('output');
    expect(JSON.stringify(history)).not.toContain(large);
    expect(JSON.stringify(history).length).toBeLessThan(30_000);
    expect(history.nextOffset).toBe(100);

    const older = await runs.summaries({ tab: 'history', offset: 100 });
    expect(older.items.map((run) => run.id)).toEqual([
      'recent-4',
      'recent-3',
      'recent-2',
      'recent-1',
      'recent-0',
      'detached',
      'parent',
      'older-attention',
    ]);
    expect(older.nextOffset).toBeNull();
    expect(older.items.find((run) => run.id === 'detached')).toMatchObject({
      parentRunId: 'parent',
      parentWorkflowName: 'Main',
      parentMode: 'detached',
      parentExecutionId: 'detached-execution',
    });
    expect(
      (await runs.summaries({ tab: 'active' })).items.map((run) => run.id),
    ).toEqual(['older-active']);
    expect((await runs.summaries({ tab: 'attention' })).items).toMatchObject([
      { id: 'older-attention', attention },
    ]);
    expect(
      (await runs.summaries({ tab: 'active', workflowId: 'child' })).items,
    ).toMatchObject([{ id: 'ordinary-child' }]);
    expect(
      (await runs.summaries({ tab: 'history', workflowId: 'main' })).counts
        .history,
    ).toBe(107);
    expect(
      (
        await runs.summaries({
          tab: 'history',
          workflowId: 'main',
          status: 'cancelled',
        })
      ).items,
    ).toMatchObject([{ id: 'older-attention' }]);
    const fullRun = (await runs.list()).find((run) => run.id === 'parent');
    expect(fullRun?.executions[0].output).toBe(large);
    expect((await runs.get({ id: 'parent' })).run).toEqual(fullRun);
  } finally {
    engine.stop();
    store.close();
  }
});
