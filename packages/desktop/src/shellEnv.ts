import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ENV_START_MARKER = '__INTERLOCK_ENV_START__';
const ENV_END_MARKER = '__INTERLOCK_ENV_END__';

export function parseDelimitedEnv(output: string): Record<string, string> {
  const startIndex = output.indexOf(ENV_START_MARKER);
  if (startIndex === -1) return {};
  const payloadStart = startIndex + ENV_START_MARKER.length;
  const endIndex = output.indexOf(ENV_END_MARKER, payloadStart);
  if (endIndex === -1) return {};

  const payload = output.slice(payloadStart, endIndex);
  const delimiter = payload.includes('\0') ? '\0' : '\n';
  const entries = payload.split(delimiter);
  const result: Record<string, string> = {};

  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex);
    const value = trimmed.slice(eqIndex + 1);
    result[key] = value;
  }

  return result;
}

export function fallbackMacPath(currentPath?: string, home?: string): string {
  const resolvedHome = home ?? homedir();
  const standardPaths = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    join(resolvedHome, '.local/bin'),
  ];

  const seen = new Set<string>();
  const parts: string[] = [];

  if (currentPath) {
    for (const segment of currentPath.split(':')) {
      const trimmed = segment.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      parts.push(trimmed);
    }
  }

  for (const standard of standardPaths) {
    if (!seen.has(standard)) {
      seen.add(standard);
      parts.push(standard);
    }
  }

  return parts.join(':');
}

export interface ResolveLoginShellEnvOptions {
  shell?: string;
  timeoutMs?: number;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
  runShell?: (
    shell: string,
    args: string[],
    timeoutMs: number,
    env: NodeJS.ProcessEnv,
  ) => string;
}

export function resolveLoginShellEnv(
  options?: ResolveLoginShellEnvOptions,
): Record<string, string> {
  const platform = options?.platform ?? process.platform;
  const currentEnv = options?.env ?? process.env;

  if (platform !== 'darwin') {
    return { ...(currentEnv as Record<string, string>) };
  }

  const shell = options?.shell ?? currentEnv.SHELL ?? '/bin/zsh';
  const timeoutMs = options?.timeoutMs ?? 5000;
  const args = [
    '-ilc',
    'printf "__INTERLOCK_ENV_START__"; env -0; printf "__INTERLOCK_ENV_END__"',
  ];
  const spawnEnv: NodeJS.ProcessEnv = {
    ...currentEnv,
    INTERLOCK_SHELL_ENV_PROBE: '1',
  };

  let rawOutput: string;
  try {
    if (options?.runShell) {
      rawOutput = options.runShell(shell, args, timeoutMs, spawnEnv);
    } else {
      rawOutput = execFileSync(shell, args, {
        timeout: timeoutMs,
        env: spawnEnv,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });
    }
  } catch {
    return {
      ...(currentEnv as Record<string, string>),
      PATH: fallbackMacPath(currentEnv.PATH, options?.home),
    };
  }

  const parsed = parseDelimitedEnv(rawOutput);
  if (Object.keys(parsed).length === 0) {
    return {
      ...(currentEnv as Record<string, string>),
      PATH: fallbackMacPath(currentEnv.PATH, options?.home),
    };
  }

  const merged: Record<string, string> = {
    ...(currentEnv as Record<string, string>),
    ...parsed,
  };

  for (const [key, value] of Object.entries(currentEnv)) {
    if (key.startsWith('INTERLOCK_') && value !== undefined) {
      merged[key] = value;
    }
  }

  merged.PATH = fallbackMacPath(merged.PATH, options?.home);
  return merged;
}

export function hydrateProcessEnv(
  options?: ResolveLoginShellEnvOptions,
): Record<string, string> {
  const resolved = resolveLoginShellEnv(options);
  for (const [key, value] of Object.entries(resolved)) {
    process.env[key] = value;
  }
  return resolved;
}
