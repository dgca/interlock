import { execFile } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { InterlockError, type ManagedWorkspace } from '@interlock/core';

const ownedId = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
const markerSuffix = '.owner.json';

/** Git with array arguments, no shell, no repository hooks and no prompts. */
function git(cwd: string, args: string[], signal?: AbortSignal) {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  // An inherited repository selection would redirect every command.
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'])
    delete env[name];
  return new Promise<string>((accept, reject) =>
    execFile(
      'git',
      ['-c', 'core.hooksPath=/dev/null', ...args],
      { cwd, env, signal, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) =>
        error
          ? reject(
              new InterlockError(
                `git ${args[0]} failed: ${(stderr || error.message).trim()}`.slice(
                  0,
                  512,
                ),
              ),
            )
          : accept(stdout.trim()),
    ),
  );
}

/** The checkout and ownership marker for a run, always derived from the root. */
export function workspacePaths(root: string, id: string) {
  if (!ownedId.test(id))
    throw new InterlockError('Workspace ID is not a run ID');
  return {
    path: join(resolve(root), id),
    marker: join(resolve(root), id + markerSuffix),
  };
}

type Owner = Pick<ManagedWorkspace, 'id' | 'ownerToken' | 'repository'>;
const ownerText = (w: Owner) =>
  JSON.stringify({
    id: w.id,
    ownerToken: w.ownerToken,
    repository: w.repository,
  });

function readMarker(path: string): Owner | undefined {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 8192) return undefined;
    const value = JSON.parse(readFileSync(path, 'utf8')) as Owner;
    return typeof value.id === 'string' &&
      typeof value.ownerToken === 'string' &&
      typeof value.repository === 'string'
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Prove a checkout is Interlock's before deleting it: it sits directly in the
 * workspaces folder, is a real directory, and its marker names this owner.
 */
function assertOwned(root: string, owner: Owner) {
  const { path, marker } = workspacePaths(root, owner.id);
  const saved = readMarker(marker);
  if (!saved || ownerText(saved) !== ownerText(owner))
    throw new InterlockError(
      'Workspace ownership marker is missing or does not match',
    );
  if (!existsSync(path)) return { path, marker, exists: false };
  const stat = lstatSync(path);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    realpathSync(path) !== join(realpathSync(root), owner.id)
  )
    throw new InterlockError(
      'Workspace path is outside the workspaces folder; it was not removed',
    );
  return { path, marker, exists: true };
}

async function branchExists(repository: string, branch: string) {
  return git(repository, [
    'show-ref',
    '--verify',
    '--quiet',
    `refs/heads/${branch}`,
  ]).then(
    () => true,
    () => false,
  );
}

/**
 * Remove one owned checkout and its Git registration. The branch is kept, and
 * a checkout with uncommitted or untracked changes is left in place.
 */
export async function removeWorktree(
  root: string,
  owner: Owner,
): Promise<'removed' | 'dirty'> {
  const { path, marker } = workspacePaths(root, owner.id);
  if (!existsSync(marker)) {
    if (existsSync(path))
      throw new InterlockError(
        'Workspace ownership marker is missing; the directory was not removed',
      );
    return 'removed';
  }
  const owned = assertOwned(root, owner);
  // A checkout without Git metadata never finished preparing; nothing was edited.
  if (
    owned.exists &&
    existsSync(join(path, '.git')) &&
    (await git(path, ['status', '--porcelain', '--untracked-files=all']))
  )
    return 'dirty';
  const repository = existsSync(owner.repository) ? owner.repository : null;
  if (owned.exists && repository)
    await git(repository, ['worktree', 'remove', '--force', '--', path]).catch(
      () => undefined,
    );
  if (existsSync(path)) {
    assertOwned(root, owner);
    await rm(path, { recursive: true, force: true });
  }
  if (repository)
    await git(repository, ['worktree', 'prune']).catch(() => undefined);
  await rm(marker, { force: true });
  return 'removed';
}

/** Create the run's checkout on a new branch, or on the branch it already claimed. */
export async function createWorktree(
  root: string,
  workspace: ManagedWorkspace,
  baseRef: string,
  claimBranch: () => void,
  signal: AbortSignal,
) {
  if (!isAbsolute(workspace.repository))
    throw new InterlockError('Workspace repository must be an absolute path');
  const repository = await realpath(workspace.repository);
  if (
    (await realpath(
      await git(repository, ['rev-parse', '--show-toplevel'], signal),
    )) !== repository
  )
    throw new InterlockError(
      'Workspace repository must name the repository root',
    );
  const baseCommit = await git(
    repository,
    ['rev-parse', '--verify', '--end-of-options', `${baseRef}^{commit}`],
    signal,
  );
  await git(
    repository,
    ['check-ref-format', '--branch', workspace.branch],
    signal,
  );
  await mkdir(root, { recursive: true });
  const { path, marker } = workspacePaths(root, workspace.id);
  // A previous attempt of this run may have left a partial checkout.
  if ((await removeWorktree(root, workspace)) === 'dirty')
    throw new InterlockError(
      'The previous checkout of this run has uncommitted changes; it was kept',
    );
  await writeFile(marker, ownerText(workspace), { flag: 'wx', mode: 0o600 });
  const exists = await branchExists(repository, workspace.branch);
  if (exists && !workspace.branchClaimed)
    throw new InterlockError(
      `Branch ${workspace.branch} already exists; Interlock only creates new branches`,
    );
  if (!exists) claimBranch();
  await git(
    repository,
    exists
      ? ['worktree', 'add', '--', path, workspace.branch]
      : ['worktree', 'add', '-b', workspace.branch, '--', path, baseCommit],
    signal,
  );
  if (realpathSync(path) !== join(realpathSync(root), workspace.id))
    throw new InterlockError('Workspace checkout was replaced');
  return { baseCommit, path };
}

/**
 * Startup reconciliation: prune stale Git registrations and remove checkouts
 * whose marker proves Interlock made them but no live record keeps them.
 */
export async function reconcileWorktrees(
  root: string,
  keep: (id: string) => boolean,
  repositories: string[],
) {
  const errors: string[] = [];
  const names = existsSync(root) ? await readdir(root) : [];
  for (const name of names) {
    if (!name.endsWith(markerSuffix)) continue;
    const id = name.slice(0, -markerSuffix.length);
    if (!ownedId.test(id) || keep(id)) continue;
    const owner = readMarker(join(root, name));
    if (owner?.id !== id) continue;
    await removeWorktree(root, owner).catch((error: unknown) =>
      errors.push(`${id}: ${(error as Error).message}`),
    );
  }
  for (const repository of new Set(repositories))
    if (existsSync(repository))
      await git(repository, ['worktree', 'prune']).catch(() => undefined);
  return errors;
}
