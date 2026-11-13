#!/usr/bin/env node
// Records each harness process so the kill-recovery test can stop orphans the
// SIGKILLed server left behind, then behaves exactly like managed-harness.mjs.
import { appendFileSync } from 'node:fs';
const log = process.env.INTERLOCK_KILL_TEST_HARNESS_LOG;
if (log)
  appendFileSync(
    log,
    JSON.stringify({ pid: process.pid, argv: process.argv.slice(2) }) + '\n',
  );
await import('./managed-harness.mjs');
