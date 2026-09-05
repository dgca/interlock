import { spawn } from 'node:child_process';
import { jsonSchema, type Json, type WorkflowNode } from '@interlock/core';

type ScriptLanguage = Extract<WorkflowNode, { kind: 'script' }>['language'];

function javascriptRunner(command: string) {
  const source = `(async function(input, require) {\n${command}\n})`;
  return `
const input = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
console.log = console.info = console.debug = console.error;
const { Script, constants } = require('node:vm');
const execute = new Script(${JSON.stringify(source)}, {
  filename: 'script.js',
  lineOffset: -1,
  importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
}).runInThisContext();
execute(input, require)
  .then(output => {
    const json = JSON.stringify(output);
    if (json === undefined) throw new Error('JavaScript must return a JSON value');
    process.stdout.write(json);
  })
  .catch(error => { console.error(error); process.exitCode = 1; });
`;
}

/** Scripts read JSON on stdin and return JSON on stdout. They are never retried automatically. */
export function executeScript(
  command: string,
  input: Json,
  timeoutMs: number,
  cwd: string,
  signal?: AbortSignal,
  language: ScriptLanguage = 'bash',
): Promise<Json> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      language === 'javascript' ? process.execPath : '/bin/bash',
      language === 'javascript'
        ? ['--input-type=commonjs', '-e', javascriptRunner(command)]
        : ['-c', command],
      {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
      },
    );
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
