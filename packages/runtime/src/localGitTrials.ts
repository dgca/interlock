import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import {
  mkdir,
  realpath,
  lstat,
  readFile,
  writeFile,
  rm,
  copyFile,
  rename,
} from 'node:fs/promises';
import { realpathSync, lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, dirname, resolve } from 'node:path';
import {
  InterlockError,
  type TrialEnvironment,
  type TrialSetup,
} from '@interlock/core';

const maxArtifactBytes = 32 * 1024 * 1024;
export function trialProcessEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    LANG: process.env.LANG ?? 'C',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_NO_LAZY_FETCH: '1',
  };
}
function git(cwd: string, args: string[], signal?: AbortSignal) {
  return new Promise<string>((accept, reject) => {
    signal?.throwIfAborted();
    const child = spawn(
      'git',
      [
        '--no-pager',
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'protocol.allow=never',
        '-c',
        'protocol.file.allow=always',
        ...args,
      ],
      {
        cwd,
        env: trialProcessEnvironment(),
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '',
      error = '',
      failure = '';
    const kill = () => {
      if (child.pid)
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {}
    };
    const abort = () => {
      failure = 'Trial Git operation interrupted';
      kill();
    };
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => {
      failure = 'Trial Git operation exceeded 120 seconds';
      kill();
    }, 120_000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (Buffer.byteLength(output) > 16 * 1024 * 1024) {
        failure = 'Trial Git output exceeded 16 MiB';
        kill();
      }
    });
    child.stderr.on('data', (chunk) => {
      error = (error + chunk).slice(-8192);
    });
    child.on('error', (e) => {
      failure = e.message;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (failure || code !== 0)
        reject(
          new InterlockError(
            (failure || `Trial Git operation failed: ${error}`).slice(0, 512),
          ),
        );
      else accept(output);
    });
  });
}
export function trialPaths(root: string, receipt: TrialEnvironment) {
  const directory = join(resolve(root), receipt.id);
  return {
    directory,
    workspace: join(directory, 'workspace'),
    artifacts: join(directory, 'artifacts'),
    marker: join(directory, 'owner.json'),
  };
}
function ownership(receipt: TrialEnvironment) {
  return {
    id: receipt.id,
    ownerToken: receipt.ownerToken,
    configurationId: receipt.configurationId,
    setupId: receipt.setupId,
    baseCommit: receipt.baseCommit,
  };
}
function checkPath(root: string, path: string) {
  const r = relative(root, path);
  if (!r || r.startsWith('..') || isAbsolute(r))
    throw new InterlockError('Trial directory is outside its managed root');
}
/** Never trust a stored path as deletion authority; derive it and verify its owner. */
export function assertTrialOwned(
  root: string,
  receipt: TrialEnvironment,
  requireWorkspace = true,
) {
  const paths = trialPaths(root, receipt);
  if (
    receipt.directory !== paths.directory ||
    receipt.workspace !== paths.workspace
  )
    throw new InterlockError(
      'Trial receipt paths no longer match the managed directory',
    );
  const canonicalRoot = realpathSync(root),
    canonical = realpathSync(paths.directory);
  checkPath(canonicalRoot, canonical);
  if (
    lstatSync(paths.directory).isSymbolicLink() ||
    canonical !== join(canonicalRoot, receipt.id)
  )
    throw new InterlockError('Trial directory was replaced');
  const markerStat = lstatSync(paths.marker);
  if (
    !markerStat.isFile() ||
    markerStat.size > 4096 ||
    JSON.stringify(JSON.parse(readFileSync(paths.marker, 'utf8'))) !==
      JSON.stringify(ownership(receipt))
  )
    throw new InterlockError('Trial ownership receipt is missing or stale');
  if (
    requireWorkspace &&
    (lstatSync(paths.workspace).isSymbolicLink() ||
      realpathSync(paths.workspace) !== join(canonical, 'workspace'))
  )
    throw new InterlockError('Trial workspace was replaced');
  return paths;
}
async function writeReceipt(path: string, content: string) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
  await rename(temporary, path);
}
export async function prepareGitTrial(
  root: string,
  setup: TrialSetup,
  receipt: TrialEnvironment,
  signal: AbortSignal,
) {
  if (!isAbsolute(setup.repository))
    throw new InterlockError('Trial repository must be an absolute local path');
  const source = await realpath(setup.repository);
  const top = (
    await git(source, ['rev-parse', '--show-toplevel'], signal)
  ).trim();
  if ((await realpath(top)) !== source)
    throw new InterlockError('Trial repository must name the repository root');
  await git(source, ['cat-file', '-e', `${setup.commit}^{commit}`], signal);
  const tree = await git(
    source,
    ['ls-tree', '-r', '-z', '--full-tree', setup.commit],
    signal,
  );
  if (tree.split('\0').some((entry) => /^(120000|160000) /.test(entry)))
    throw new InterlockError(
      'Local Git trials do not support tracked symlinks or submodules',
    );
  const paths = trialPaths(root, receipt);
  await mkdir(root, { recursive: true });
  await mkdir(paths.directory);
  await writeFile(paths.marker, JSON.stringify(ownership(receipt)), {
    flag: 'wx',
    mode: 0o600,
  });
  await mkdir(join(paths.directory, 'template'));
  await git(
    source,
    [
      'clone',
      '--no-hardlinks',
      '--dissociate',
      '--no-checkout',
      `--template=${join(paths.directory, 'template')}`,
      '--',
      source,
      paths.workspace,
    ],
    signal,
  );
  await git(paths.workspace, ['remote', 'remove', 'origin'], signal);
  await git(paths.workspace, ['config', 'core.hooksPath', '/dev/null'], signal);
  await git(paths.workspace, ['checkout', '--detach', setup.commit], signal);
  if (
    (await git(paths.workspace, ['rev-parse', 'HEAD'], signal)).trim() !==
    setup.commit
  )
    throw new InterlockError(
      'Trial checkout does not match the captured base commit',
    );
  try {
    if (
      (
        await readFile(
          join(paths.workspace, '.git/objects/info/alternates'),
          'utf8',
        )
      ).trim()
    )
      throw new InterlockError('Trial checkout still borrows Git objects');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  signal.throwIfAborted();
  return { directory: paths.directory, workspace: paths.workspace };
}
async function retainedArtifacts(
  paths: ReturnType<typeof trialPaths>,
  receipt: TrialEnvironment,
) {
  try {
    await lstat(join(paths.artifacts, 'receipt.json'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const directoryStat = await lstat(paths.artifacts);
  if (
    !directoryStat.isDirectory() ||
    directoryStat.isSymbolicLink() ||
    (await realpath(paths.artifacts)) !==
      join(await realpath(paths.directory), 'artifacts')
  )
    throw new InterlockError('Trial artifact directory was replaced');
  const receiptPath = join(paths.artifacts, 'receipt.json');
  const stat = await lstat(receiptPath);
  if (!stat.isFile() || stat.size > 4096)
    throw new InterlockError('Trial artifact receipt was replaced');
  const saved = JSON.parse(await readFile(receiptPath, 'utf8')),
    a = saved.artifacts;
  if (
    Object.entries(ownership(receipt)).every(
      ([key, value]) => saved[key] === value,
    ) &&
    a?.patch === join(paths.artifacts, 'changes.patch') &&
    a?.untracked === join(paths.artifacts, 'untracked') &&
    Number.isInteger(a.fileCount) &&
    a.fileCount >= 0 &&
    a.fileCount <= 1000 &&
    Number.isInteger(a.bytes) &&
    a.bytes >= 0 &&
    a.bytes <= maxArtifactBytes
  ) {
    if (
      !(await lstat(a.patch)).isFile() ||
      !(await lstat(a.untracked)).isDirectory() ||
      (await lstat(a.untracked)).isSymbolicLink()
    )
      throw new InterlockError('Trial retained artifacts were replaced');
    return a as NonNullable<TrialEnvironment['artifacts']>;
  }
  throw new InterlockError('Trial artifact receipt is stale or invalid');
}
export async function retainAndCleanGitTrial(
  root: string,
  receipt: TrialEnvironment,
  signal: AbortSignal,
) {
  const paths = assertTrialOwned(root, receipt, false);
  let workspaceExists = true;
  try {
    await lstat(paths.workspace);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') workspaceExists = false;
    else throw e;
  }
  let artifacts = await retainedArtifacts(paths, receipt);
  if (!workspaceExists) {
    if (artifacts || receipt.preparation === 'failed') return artifacts;
    throw new InterlockError(
      'Trial workspace disappeared before artifact capture',
    );
  }
  assertTrialOwned(root, receipt);
  if (receipt.preparation === 'ready' && !artifacts) {
    const gitDirectory = await lstat(join(paths.workspace, '.git'));
    if (!gitDirectory.isDirectory() || gitDirectory.isSymbolicLink())
      throw new InterlockError('Trial Git directory was replaced');
    const patch = await git(
      paths.workspace,
      [
        'diff',
        '--binary',
        '--no-ext-diff',
        '--no-textconv',
        receipt.baseCommit,
        '--',
      ],
      signal,
    );
    const untracked = (
      await git(
        paths.workspace,
        ['ls-files', '--others', '--exclude-standard', '-z'],
        signal,
      )
    )
      .split('\0')
      .filter(Boolean);
    if (untracked.length > 1000)
      throw new InterlockError(
        'Trial artifacts exceed 1000 untracked files; workspace retained',
      );
    await mkdir(paths.artifacts, { recursive: true });
    if (
      (await lstat(paths.artifacts)).isSymbolicLink() ||
      (await realpath(paths.artifacts)) !==
        join(await realpath(paths.directory), 'artifacts')
    )
      throw new InterlockError('Trial artifact directory was replaced');
    const untrackedRoot = join(paths.artifacts, 'untracked');
    await mkdir(untrackedRoot, { recursive: true });
    if ((await lstat(untrackedRoot)).isSymbolicLink())
      throw new InterlockError(
        'Trial untracked artifact directory was replaced',
      );
    // A failed capture has no committed receipt; discard its partial file export.
    await rm(untrackedRoot, { recursive: true });
    await mkdir(untrackedRoot);
    const canonicalWorkspace = await realpath(paths.workspace),
      canonicalUntracked = await realpath(untrackedRoot);
    let bytes = Buffer.byteLength(patch);
    for (const file of untracked) {
      signal.throwIfAborted();
      const source = resolve(canonicalWorkspace, file),
        target = resolve(canonicalUntracked, file);
      checkPath(canonicalWorkspace, source);
      checkPath(canonicalUntracked, target);
      if (
        (await realpath(source)) !== source ||
        !(await lstat(source)).isFile()
      )
        throw new InterlockError(
          'Trial artifacts contain a symlink or unsupported file; workspace retained',
        );
      const stat = await lstat(source);
      bytes += stat.size;
      if (bytes > maxArtifactBytes)
        throw new InterlockError(
          'Trial artifacts exceed 32 MiB; workspace retained',
        );
      await mkdir(dirname(target), { recursive: true });
      if ((await realpath(dirname(target))) !== dirname(target))
        throw new InterlockError('Trial artifact path was replaced');
      try {
        if ((await lstat(target)).isSymbolicLink())
          throw new InterlockError('Trial artifact file was replaced');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      await rm(target, { force: true });
      await copyFile(source, target, constants.COPYFILE_EXCL);
    }
    const patchPath = join(paths.artifacts, 'changes.patch');
    try {
      if ((await lstat(patchPath)).isSymbolicLink())
        throw new InterlockError('Trial patch file was replaced');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    await writeReceipt(patchPath, patch);
    artifacts = {
      patch: patchPath,
      untracked: untrackedRoot,
      fileCount: untracked.length,
      bytes,
    };
    const artifactReceipt = join(paths.artifacts, 'receipt.json');
    try {
      if ((await lstat(artifactReceipt)).isSymbolicLink())
        throw new InterlockError('Trial artifact receipt was replaced');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    await writeReceipt(
      artifactReceipt,
      JSON.stringify({ ...ownership(receipt), artifacts }),
    );
  }
  signal.throwIfAborted();
  assertTrialOwned(root, receipt);
  await rm(paths.workspace, { recursive: true });
  return artifacts;
}
