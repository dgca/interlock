// Local UI fixtures. This adapter never launches a harness, runs commands, or calls a model.
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '@interlock/storage';
import { Engine, type HarnessAdapter } from '@interlock/runtime';
import { blankDefinition } from '@interlock/core';
import { createApp } from '../../packages/server/src/app.js';
const dir = mkdtempSync(join(tmpdir(), 'interlock-inspector-'));
const store = new Store(join(dir, 'preview.db'));
const engine = new Engine(store, dir);
engine.executors.saveSettings({ expectedRevision: 0, concurrency: null });
engine.executors.saveProfile({
  id: 'codex',
  name: 'Codex',
  harness: 'codex',
  enabled: true,
  expectedRevision: 0,
});
const adapter: HarnessAdapter = {
  id: 'codex',
  detect: async () => ({
    status: 'detected',
    command: '/simulated/codex',
    version: 'UI fixture, no native execution',
  }),
  run: async (input) => {
    input.onSession(randomUUID());
    if (input.work.prompt === 'Question') {
      const answer = await input.request({
        kind: 'question',
        title: 'Choose how to handle the review',
        detail: '',
        questions: [
          {
            id: 'approach',
            text: 'How should I handle the remaining review comments?',
            options: ['Fix and rerun checks', 'Leave a summary for review'],
            allowOther: true,
          },
        ],
      });
      return { output: answer.answers ?? {} };
    }
    if (input.work.prompt === 'Recovery' && input.work.attempt > 1)
      return { output: { recovered: true } };
    const answer = await input.request({
      kind: 'permission',
      title:
        input.work.prompt === 'Long'
          ? 'Codex requests file changes'
          : 'Codex requests a command',
      detail:
        input.work.prompt === 'Long'
          ? JSON.stringify(
              {
                changes: Array.from({ length: 12 }, (_, index) => ({
                  path: `packages/runtime/src/review-${index + 1}.ts`,
                  diff:
                    '- previous review output\n+ ' +
                    'A long native patch line '.repeat(12),
                })),
              },
              null,
              2,
            )
          : `Working directory: ${dir}\n\nCreate the review summary after checking the changed files.\n\nnode scripts/write-review-summary.mjs --output ./artifacts/review-summary.md`,
    });
    if (input.work.prompt !== 'Recovery')
      return { output: { approved: answer.allow ?? false } };
    input.onProgress('Writing the review summary.');
    await new Promise<void>((_, reject) => {
      input.signal.addEventListener(
        'abort',
        () => reject(new Error('Preview session stopped')),
        { once: true },
      );
    });
    return { output: {} };
  },
};
engine.executors.start([adapter]);
const runs: Record<string, string> = {};
for (const [name, prompt] of [
  ['Review changes', 'Approval'],
  ['Recover a stopped review', 'Recovery'],
  ['Answer an agent question', 'Question'],
  ['Review a long patch', 'Long'],
]) {
  const d = blankDefinition();
  d.executor = 'codex';
  const agent = d.nodes.find((n) => n.kind === 'agent')!;
  Object.assign(agent, {
    label: name,
    prompt,
    resources: [
      { source: 'literal', value: name.toLowerCase().replaceAll(' ', '-') },
    ],
  });
  const workflow = engine.create(
    name,
    'Isolated UI review fixture. No commands or model calls are executed.',
    d,
  );
  engine.publish(workflow.id);
  runs[prompt] = engine.start(workflow.id, {}).run.id;
}
const port = 4332;
const app = createApp(engine, {
  command: 'interlock',
  args: [],
  engineUrl: `http://127.0.0.1:${port}`,
  development: true,
});
app.get('*', serveStatic({ root: resolve('packages/ui/dist') }));
app.get('*', serveStatic({ path: resolve('packages/ui/dist/index.html') }));
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, () =>
  console.log(JSON.stringify({ dir, port, runs })),
);
writeFileSync(
  join(dir, 'fixtures.json'),
  JSON.stringify({ dir, port, runs }, null, 2),
);
const timer = setInterval(() => engine.pump(), 1000);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    clearInterval(timer);
    await engine.executors.stop();
    engine.stop();
    server.close();
    store.close();
    process.exit(0);
  });
