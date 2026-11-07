import { isAbsolute, resolve, sep } from 'node:path';
import { existsSync, realpathSync, statSync } from 'node:fs';
import {
  InterlockError,
  type CwdBinding,
  type Json,
  type PathBinding,
  resolveValueBinding,
} from '@interlock/core';

export function isPathInsideRoot(
  targetCanonical: string,
  rootCanonical: string,
): boolean {
  if (targetCanonical === rootCanonical) return true;
  const prefix = rootCanonical.endsWith(sep)
    ? rootCanonical
    : rootCanonical + sep;
  return targetCanonical.startsWith(prefix);
}

export function validateDirectoryContainment(
  targetPath: string,
  allowedRoots?: string[],
): string {
  if (!isAbsolute(targetPath)) {
    throw new InterlockError(
      `Working directory path "${targetPath}" must be absolute`,
    );
  }
  if (!existsSync(targetPath)) {
    throw new InterlockError(
      `Working directory "${targetPath}" does not exist`,
    );
  }
  let stat;
  try {
    stat = statSync(targetPath);
  } catch (error) {
    throw new InterlockError(
      `Failed to inspect working directory "${targetPath}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!stat.isDirectory()) {
    throw new InterlockError(
      `Working directory "${targetPath}" is not a directory`,
    );
  }
  let canonicalTarget: string;
  try {
    canonicalTarget = realpathSync(targetPath);
  } catch (error) {
    throw new InterlockError(
      `Failed to resolve real path for "${targetPath}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (allowedRoots && allowedRoots.length > 0) {
    const isContained = allowedRoots.some((root) => {
      try {
        const canonicalRoot = existsSync(root)
          ? realpathSync(resolve(root))
          : resolve(root);
        return isPathInsideRoot(canonicalTarget, canonicalRoot);
      } catch {
        return false;
      }
    });
    if (!isContained) {
      throw new InterlockError(
        `Working directory "${targetPath}" is outside allowed roots: [${allowedRoots.join(', ')}]`,
      );
    }
  }

  return canonicalTarget;
}

export function resolveDynamicCwd(
  binding: CwdBinding | undefined,
  source: (b: PathBinding) => Json | undefined,
): string | undefined {
  if (binding === undefined) return undefined;
  if (typeof binding === 'string') {
    const trimmed = binding.trim();
    if (!trimmed) {
      throw new InterlockError('Working directory path cannot be empty');
    }
    return trimmed;
  }
  const resolved = resolveValueBinding(binding, source);
  if (typeof resolved !== 'string' || !resolved.trim()) {
    throw new InterlockError(
      'Dynamic cwd binding must resolve to a non-empty string directory path',
    );
  }
  return resolved.trim();
}

export function resolveAndValidateCwd(
  binding: CwdBinding | undefined,
  source: (b: PathBinding) => Json | undefined,
  allowedRoots?: string[],
): { resolvedCwd?: string; error?: string } {
  if (binding === undefined) return {};
  try {
    const rawPath = resolveDynamicCwd(binding, source);
    if (!rawPath) return {};
    const validated = validateDirectoryContainment(rawPath, allowedRoots);
    return { resolvedCwd: validated };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
