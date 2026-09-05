import { spawn } from 'node:child_process';
import { jsonSchema, type Json } from '@interlock/core';

/** Scripts read JSON on stdin and return JSON on stdout. They are never retried automatically. */
export function executeScript(
  command: string,
  input: Json,
  timeoutMs: number,
  cwd: string,
  signal?: AbortSignal,
): Promise<Json> {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/bash', ['-c', command], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    let stdout = '',
      stderr = '',
      failure: string | undefined;
    const kill = () => {
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* Process already exited. */
        }
      }
    };
    const abort = () => {
      failure = 'Script cancelled';
      kill();
    };
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => {
      failure = `Script exceeded ${timeoutMs}ms`;
      kill();
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 1024 * 1024) {
        failure = 'Script output exceeded 1 MiB';
        kill();
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-8192);
    });
    child.stdin.on('error', () => {
      /* Early process exits are reported by close. */
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      if (failure || code !== 0)
        return reject(new Error(failure ?? `Script exited ${code}: ${stderr}`));
      try {
        resolve(jsonSchema.parse(JSON.parse(stdout)));
      } catch {
        reject(new Error('Script stdout must contain one JSON value'));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
