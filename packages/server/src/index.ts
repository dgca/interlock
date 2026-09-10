import './sqliteWarning.js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { startServer } from './start.js';
import { developmentConnection } from './connection.js';
export type { AppRouter } from './router.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
startServer({
  database:
    process.env.INTERLOCK_DB ?? resolve(root, '.interlock/interlock.db'),
  workdir: process.env.INTERLOCK_WORKDIR ?? root,
  ui: fileURLToPath(new URL('../../ui/dist', import.meta.url)),
  port: 4310,
  connection: developmentConnection(),
}).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
