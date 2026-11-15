import { execFileSync } from 'node:child_process';
import { mkdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface ResolveBundledCliOptions {
  isPackaged?: boolean;
  resourcesPath?: string;
  moduleDir?: string;
}

export function resolveBundledCliWrapper(
  options?: ResolveBundledCliOptions,
): string {
  const isPackaged =
    options?.isPackaged ??
    (typeof process !== 'undefined' &&
      (process as unknown as { resourcesPath?: string }).resourcesPath !==
        undefined);

  if (isPackaged) {
    const resourcesPath =
      options?.resourcesPath ??
      (process as unknown as { resourcesPath: string }).resourcesPath;
    return join(resourcesPath, 'bin', 'interlock');
  }

  const moduleDir = options?.moduleDir ?? resolve(import.meta.dirname, '..');
  return join(moduleDir, 'bin', 'interlock');
}

export interface InstallCliOptions {
  sourcePath?: string;
  targetPath?: string;
  execAdmin?: (shellCommand: string) => void;
}

export function installCliCommandInPath(options?: InstallCliOptions): {
  installedPath: string;
  sourcePath: string;
} {
  const sourcePath = options?.sourcePath ?? resolveBundledCliWrapper();
  const targetPath = options?.targetPath ?? '/usr/local/bin/interlock';

  try {
    mkdirSync(dirname(targetPath), { recursive: true });
    try {
      unlinkSync(targetPath);
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') throw e;
    }
    symlinkSync(sourcePath, targetPath);
    return { installedPath: targetPath, sourcePath };
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      const command = `mkdir -p "${dirname(targetPath)}" && ln -sf "${sourcePath}" "${targetPath}"`;
      if (options?.execAdmin) {
        options.execAdmin(command);
      } else {
        execFileSync('/usr/bin/osascript', [
          '-e',
          `do shell script ${JSON.stringify(command)} with administrator privileges`,
        ]);
      }
      return { installedPath: targetPath, sourcePath };
    }
    throw error;
  }
}
