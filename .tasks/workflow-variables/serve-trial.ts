// Opt-in local trial. All data and keys are temporary; no real account is used.
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import {
  blankDefinition,
  nodeSchema,
  type SavedVariable,
} from '@interlock/core';
import { createApp } from '../../packages/server/src/app.js';
import { developmentConnection } from '../../packages/server/src/connection.js';

const directory = mkdtempSync(join(tmpdir(), 'interlock-variables-trial-'));
const port = Number(process.env.INTERLOCK_TRIAL_PORT ?? 4440);
const store = new Store(join(directory, 'trial.db'), {
  secretKeyFile: join(directory, 'key'),
});
const engine = new Engine(store, directory);
const echo = createServer((req, res) => {
  const authorization = req.headers.authorization ?? '';
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({ authenticated: !!authorization, echo: authorization }),
  );
  console.log(
    `Fake service received a request; credential present: ${!!authorization}`,
  );
});
await new Promise<void>((resolve) => echo.listen(0, '127.0.0.1', resolve));
const address = echo.address();
if (!address || typeof address === 'string')
  throw new Error('Fake service did not start');
const endpoint = `http://127.0.0.1:${address.port}`;
const variable = engine.variables.mutate({
  action: 'create',
  name: 'service_token',
  kind: 'secret',
  value: 'fake-credential-for-local-trial',
}) as SavedVariable;
for (const kind of ['fetch', 'script'] as const) {
  const definition = blankDefinition();
  definition.nodes[1] = nodeSchema.parse(
    kind === 'fetch'
      ? {
          id: 'agent',
          kind,
          label: 'Call fake service',
          url: endpoint,
          headers: [
            {
              name: 'Authorization',
              value: {
                kind: 'variable',
                variableId: variable.id,
                prefix: 'Bearer ',
              },
            },
          ],
        }
      : {
          id: 'agent',
          kind,
          label: 'Call fake service',
          language: 'javascript',
          command: `const response = await fetch(${JSON.stringify(endpoint)}, { headers: { Authorization: process.env.SERVICE_API_TOKEN } }); return await response.json();`,
          environment: [{ name: 'SERVICE_API_TOKEN', variableId: variable.id }],
        },
  );
  const workflow = engine.create(
    `${kind === 'fetch' ? 'Fetch' : 'Script'} variable trial`,
    '',
    definition,
  );
  engine.publish(workflow.id);
}
const url = `http://127.0.0.1:${port}`;
const connection = {
  ...developmentConnection(),
  engineUrl: url,
  env: { INTERLOCK_URL: url },
};
const app = createApp(engine, connection);
const ui = resolve('packages/ui/dist');
app.get('*', serveStatic({ root: ui }));
app.get('*', serveStatic({ path: join(ui, 'index.html') }));
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, () => {
  console.log(`Variable trial: ${url}/variables`);
  console.log(`Temporary database and key: ${directory}`);
  console.log(
    'Use fake values. Try both published workflows, replace service_token, and run them again. Ctrl-C deletes this trial data.',
  );
});
const timer = setInterval(() => engine.pump(), 250);
let stopped = false;
function stop() {
  if (stopped) return;
  stopped = true;
  clearInterval(timer);
  engine.stop();
  echo.closeAllConnections();
  echo.close();
  server.closeAllConnections();
  server.close(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
    process.exit(0);
  });
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
