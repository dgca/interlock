import { Engine } from '../../packages/runtime/src/index.ts';
import { Store } from '../../packages/storage/src/index.ts';
import { blankDefinition } from '../../packages/core/src/index.ts';
const engine = new Engine(new Store(':memory:'), process.cwd());
engine.executors.start([]);
const definition = blankDefinition();
definition.nodes[1] = {
  ...definition.nodes[1],
  kind: 'script',
  language: 'javascript',
  command: 'return input;',
};
const workflow = engine.create(
  'Dispatch scheduling regression',
  '',
  definition,
);
engine.publish(workflow.id);
const { run } = engine.start(workflow.id, 1);
setTimeout(async () => {
  const completed = engine.run(run.id).status === 'completed';
  await engine.executors.stop();
  engine.stop();
  engine.store.close();
  process.exit(completed ? 0 : 1);
}, 200);
