import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import type { StartupSettings } from '@interlock/core';
import type { DataPaths } from '@interlock/core/dataPaths';
import { logLevels, parseLogLevel } from '@interlock/runtime/log';
import { isLoopback, parseRequireToken } from './apiToken.js';

const absolutePath = z
  .string()
  .refine(
    (path) => isAbsolute(path) && !path.includes('\0'),
    'Expected a valid absolute path',
  );
const configSchema = z
  .object({
    requireToken: z.boolean().optional(),
    allowedRoots: z.array(absolutePath).optional(),
    logLevel: z.enum(logLevels).optional(),
    syncDir: absolutePath.optional(),
  })
  .strict();

function readConfig({ path, source }: DataPaths['configFile']) {
  if (source === 'INTERLOCK_CONFIG' && !isAbsolute(path))
    throw new Error(
      `INTERLOCK_CONFIG must be an absolute path. Received ${JSON.stringify(path)}.`,
    );

  const fail = (message: string) =>
    new Error(`Config file ${JSON.stringify(path)}: ${message}`);
  let content: string;
  try {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      if (!fstatSync(fd).isFile()) throw new Error('Expected a regular file.');
      content = readFileSync(fd, 'utf8');
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' && source !== 'INTERLOCK_CONFIG') return;
    throw fail(
      `Cannot read the file selected by ${source}. ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    throw fail('Expected valid JSON.');
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json))
    throw fail('Expected a JSON object.');
  for (const key of Object.keys(json)) {
    if (!Object.hasOwn(configSchema.shape, key))
      throw fail(`Unknown key ${JSON.stringify(key)}.`);
  }
  const parsed = configSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw fail(`${issue.path.join('.')}: ${issue.message}.`);
  }
  return parsed.data;
}

function parseAllowedRoots(value?: string): string[] | undefined {
  if (!value || !value.trim()) return undefined;
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed))
        return parsed
          .map(String)
          .map((path) => path.trim())
          .filter(Boolean);
    } catch {
      // Fall through to delimiter splitting.
    }
  }
  return trimmed
    .split(/[,:]/)
    .map((path) => path.trim())
    .filter(Boolean);
}

function checkConfigLocation(path: string, paths: DataPaths) {
  const database = paths.database.path;
  const log = join(paths.logRoot, 'interlock.log');
  const outputs = [
    ...(database === ':memory:'
      ? []
      : [
          database,
          `${database}.lock`,
          `${database}-wal`,
          `${database}-shm`,
          `${database}-journal`,
        ]),
    paths.token.path,
    paths.keyFile?.path,
    log,
    `${log}.1`,
    `${log}.2`,
    `${log}.3`,
  ];
  const stat = (file: string) => {
    try {
      return statSync(file);
    } catch {
      return undefined;
    }
  };
  const config = stat(path);
  const selected = resolve(path);
  for (const output of outputs) {
    if (!output) continue;
    const existing = config && stat(output);
    if (
      selected === resolve(output) ||
      (config &&
        existing &&
        config.dev === existing.dev &&
        config.ino === existing.ino)
    )
      throw new Error(
        `Config file ${JSON.stringify(path)} also points to engine state at ${JSON.stringify(output)}. Choose a separate config file.`,
      );
  }
}

export interface StartupOptions {
  allowedRoots?: string[];
  logLevel?: StartupSettings['logLevel']['value'];
  requireToken?: boolean;
  syncDir?: string;
}

function setting<T>(
  option: T | undefined,
  envName: string,
  envValue: () => T | undefined,
  fileValue: T | undefined,
  fallback: T,
) {
  if (option !== undefined) return { value: option, source: 'flag' };
  const value = envValue();
  if (value !== undefined) return { value, source: envName };
  if (fileValue !== undefined)
    return { value: fileValue, source: 'config file' };
  return { value: fallback, source: 'default' };
}

export function loadOperatorConfig(
  paths: DataPaths,
  options: StartupOptions,
  hostname: string,
  env = process.env,
): StartupSettings {
  const selected = paths.configFile;
  const file = readConfig(selected);
  checkConfigLocation(selected.path, paths);
  const requireToken = setting(
    options.requireToken,
    'INTERLOCK_REQUIRE_TOKEN',
    () => {
      const value = env.INTERLOCK_REQUIRE_TOKEN;
      return value?.trim() ? parseRequireToken(value) : undefined;
    },
    file?.requireToken,
    false,
  );
  const forced = !isLoopback(hostname);
  const allowedRoots = setting(
    options.allowedRoots,
    'INTERLOCK_ALLOWED_ROOTS',
    () => parseAllowedRoots(env.INTERLOCK_ALLOWED_ROOTS),
    file?.allowedRoots,
    [],
  );
  const logLevel = setting(
    options.logLevel,
    'INTERLOCK_LOG_LEVEL',
    () =>
      env.INTERLOCK_LOG_LEVEL
        ? parseLogLevel(env.INTERLOCK_LOG_LEVEL)
        : undefined,
    file?.logLevel,
    'info',
  );
  const syncDir = setting(
    options.syncDir,
    'INTERLOCK_SYNC_DIR',
    () => env.INTERLOCK_SYNC_DIR?.trim() || undefined,
    file?.syncDir,
    null,
  );
  return {
    configFile: {
      path: isAbsolute(selected.path) ? selected.path : resolve(selected.path),
      found: file !== undefined,
    },
    requireToken: {
      ...requireToken,
      value: requireToken.value || forced,
      forced,
    },
    allowedRoots: {
      ...allowedRoots,
      value: [...allowedRoots.value],
      controlledByConfig: file?.allowedRoots !== undefined,
    },
    logLevel,
    syncDir: {
      ...syncDir,
      value: syncDir.value ? resolve(syncDir.value) : null,
    },
  };
}
