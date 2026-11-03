import { expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { JsonLinesProcess } from '../packages/runtime/src/executors/process';
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
it.each(['stay', 'exit'])(
  'stops descendants even when the harness leader can %s',
  async (mode) => {
    const rpc = new JsonLinesProcess(
      process.execPath,
      [
        fileURLToPath(
          new URL('./fixtures/managed-descendants.mjs', import.meta.url),
        ),
        mode,
      ],
      process.cwd(),
    );
    const ended = rpc.ended().catch(() => {});
    let child!: number, leader!: number;
    const ready = new Promise<void>((resolve) => {
      rpc.onMessage = (m) => {
        child = m.params.pid;
        leader = m.params.leader;
        resolve();
      };
    });
    try {
      await ready;
      if (mode === 'exit') await ended;
      await rpc.close();
      await vi.waitFor(() => expect(alive(child)).toBe(false), {
        timeout: 1000,
      });
    } finally {
      try {
        process.kill(-leader, 'SIGKILL');
      } catch {}
      try {
        process.kill(child, 'SIGKILL');
      } catch {}
    }
  },
  10000,
);
