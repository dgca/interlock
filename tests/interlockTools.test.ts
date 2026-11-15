import { afterEach, expect, it, vi } from 'vitest';
import { Engine, type HarnessRun } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { blankDefinition } from '@interlock/core';

// The manager's side of Interlock's own tools for managed sessions. The
// adapters' side is in nativeExecutors and piExecutor.
const engines: Engine[] = [];
afterEach(async () => {
  for (const e of engines.splice(0)) {
    await e.executors.stop();
    e.stop();
    e.store.close();
  }
});

/** A managed Pi profile at `permissions` whose fake adapter runs `run`. */
function managed(
  permissions: 'standard' | 'read-only',
  run: (i: HarnessRun) => Promise<void>,
) {
  const e = new Engine(new Store(':memory:'), process.cwd());
  engines.push(e);
  e.executors.saveProfile({
    id: 'pi',
    harness: 'pi',
    name: 'pi',
    enabled: true,
    expectedRevision: 0,
    permissions,
  });
  e.executors.start([
    {
      id: 'pi',
      detect: () =>
        Promise.resolve({
          command: '/fake/pi',
          status: 'detected',
          version: 'test',
        }),
      run: async (i) => {
        i.onSession('session-' + i.work.id);
        await run(i);
        return { output: i.work.input };
      },
    },
  ]);
  const d = blankDefinition();
  d.executor = 'pi';
  const w = e.create('Managed tools', '', d);
  e.publish(w.id);
  e.memory.manage({ action: 'configure', workflowId: w.id, enabled: true });
  return { e, workflowId: w.id };
}

it('hands managed sessions Interlock tools for their claim, except under Read only', async () => {
  for (const permissions of ['standard', 'read-only'] as const) {
    let tools: HarnessRun['interlockTools'];
    const { e, workflowId } = managed(permissions, async (i) => {
      tools = i.interlockTools;
      if (!tools) return;
      i.onInterlockTools?.({ state: 'attached', tools: ['save_memory_note'] });
      await tools.invoke('save_memory_note', { content: 'Managed fact' });
      // A failed call is logged by tool and error class, never its content.
      await tools.invoke('save_memory_note', { content: 'Secret', extra: 1 });
    });
    const run = e.start(workflowId, { value: 1 }).run;
    await vi.waitFor(() => expect(e.run(run.id).status).toBe('completed'));
    const record = e.executors.inspect(e.store.work()[0].id).items[0];
    if (permissions === 'read-only') {
      expect(tools).toBeUndefined();
      expect(e.memory.list(workflowId).notes).toEqual([]);
      continue;
    }
    expect(record.interlockTools).toEqual({
      state: 'attached',
      tools: ['save_memory_note'],
    });
    expect(e.memory.list(workflowId).notes).toMatchObject([
      { content: 'Managed fact', status: 'pending' },
    ]);
    const logs = record.logs.map((l) => l.message);
    expect(logs).toContain('Interlock tool save_memory_note failed (ZodError)');
    expect(logs.join('\n')).not.toContain('Secret');
  }
});
