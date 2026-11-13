import { spawn } from 'node:child_process';
import {
  jsonSchema,
  type EnvironmentMode,
  type Json,
  type WorkflowNode,
} from '@interlock/core';

type ScriptLanguage = Extract<WorkflowNode, { kind: 'script' }>['language'];

export function javascriptRunner(command: string) {
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

interface EnvironmentPolicy {
  environmentMode?: EnvironmentMode;
  environmentPassthrough?: string[];
}
const minimalName = /^(?:PATH|HOME|LANG|LANGUAGE|LC_\w+|INTERLOCK_\w*)$/;

/** Server environment a Script or custom executor process starts from. */
export function baseEnvironment(
  policy: EnvironmentPolicy,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (policy.environmentMode !== 'minimal') return { ...source };
  const passthrough = new Set(policy.environmentPassthrough);
  return Object.fromEntries(
    Object.entries(source).filter(
      ([name]) => minimalName.test(name) || passthrough.has(name),
    ),
  );
}

/**
 * Server variables withheld in minimal mode that a failed process's source or
 * error output mentions. Only names are reported, never values.
 */
export function withheldEnvironmentNames(
  policy: EnvironmentPolicy,
  texts: string[],
  explicit: string[],
  source: NodeJS.ProcessEnv = process.env,
) {
  if (policy.environmentMode !== 'minimal') return [];
  const delivered = baseEnvironment(policy, source);
  const text = texts.join('\n');
  return Object.keys(source)
    .filter(
      (name) =>
        /^[A-Za-z_]\w+$/.test(name) &&
        !(name in delivered) &&
        !explicit.includes(name) &&
        new RegExp(`(?<!\\w)${name}(?!\\w)`).test(text),
    )
    .sort();
}

/** Appends the withheld variables and their fix to a failed Script's error. */
export function scriptFailure(
  operation: EnvironmentPolicy & {
    kind: string;
    command?: string;
    environment?: { name: string }[];
  },
  error: string,
  source?: NodeJS.ProcessEnv,
) {
  if (operation.kind !== 'script') return error;
  const names = withheldEnvironmentNames(
    operation,
    [operation.command ?? '', error],
    (operation.environment ?? []).map((entry) => entry.name),
    source,
  );
  return names.length
    ? `${error} Minimal environment mode did not pass ${names.join(', ')} from the server environment. Add ${names.length > 1 ? 'these names' : 'it'} to the Script's environmentPassthrough list, bind a saved variable, or set environmentMode to inherit.`
    : error;
}

/** Scripts read JSON on stdin and return JSON on stdout. They are never retried automatically. */
export function executeScript(
  command: string,
  input: Json,
  timeoutMs: number,
  cwd: string,
  signal?: AbortSignal,
  language: ScriptLanguage = 'bash',
  env?: NodeJS.ProcessEnv,
  sanitizeError?: (text: string) => string,
): Promise<Json> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = spawn(
      language === 'javascript' ? process.execPath : '/bin/bash',
      language === 'javascript'
        ? ['--input-type=commonjs', '-e', javascriptRunner(command)]
        : ['-c', command],
      {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
      },
    );
    let stdout = '',
      stderr = '',
      failure: string | undefined;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
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
      if (sanitizeError) {
        stderr += chunk;
        if (stderr.length > 1024 * 1024) {
          failure = 'Script error output exceeded 1 MiB';
          kill();
        }
      } else stderr = (stderr + chunk).slice(-8192);
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
        return reject(
          new Error(
            failure ??
              `Script exited ${code}: ${(sanitizeError ? sanitizeError(stderr) : stderr).slice(-8192)}`,
          ),
        );
      try {
        resolve(jsonSchema.parse(JSON.parse(stdout)));
      } catch {
        reject(new Error('Script stdout must contain one JSON value'));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
