import { afterAll, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  permissionPolicySchema,
  type PermissionAction,
  type PermissionPolicy,
} from '@interlock/core';
import { policyAllows } from '../packages/runtime/src/executors/permissionPolicy';

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'interlock-policy-')));
const root = join(scratch, 'workspace');
mkdirSync(join(root, 'src'), { recursive: true });
symlinkSync(scratch, join(root, 'outside'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// A worktree's `.git` file points at a Git directory outside the checkout.
writeFileSync(join(root, '.git'), `gitdir: ${join(scratch, 'gitdir')}\n`);
const patterns = [
  'git status',
  'git diff *',
  'git log *',
  'git format-patch *',
  'cat *',
  'cp *',
  'mv *',
  'tar *',
  'sort *',
  'find *',
  'rg *',
  'pnpm test *',
  'ls *',
];
const policy: PermissionPolicy = permissionPolicySchema.parse({
  allow: [
    { kind: 'edit' },
    { kind: 'tool', name: 'WebSearch' },
    ...patterns.map((pattern) => ({ kind: 'command', pattern })),
  ],
});
const allows = (
  action: PermissionAction,
  harness: 'claude-code' | 'codex' = 'claude-code',
) => policyAllows(policy, action, root, harness);
const command = (text: string, cwd = root): PermissionAction => ({
  kind: 'command',
  command: text,
  cwd,
});

it('allows matching actions inside the workspace and names the rules', () => {
  expect(allows(command('git status && git diff --stat'))).toEqual([
    'Run: git status',
    'Run: git diff *',
  ]);
  expect(
    allows(command('cat src/a.ts | pnpm test -- --run 2>&1 >/dev/null')),
  ).toBeDefined();
  expect(
    allows(command(`/bin/zsh -lc 'git status; cat "src/a b.ts"'`)),
  ).toBeDefined();
  expect(allows(command('cat src/{a,b}.ts'))).toBeDefined();
  expect(allows({ kind: 'edit', paths: [join(root, 'src/new.ts')] })).toEqual([
    'Create and edit files in the workspace',
  ]);
  expect(allows({ kind: 'tool', name: 'WebSearch' })).toBeDefined();
});

it.each<[string, PermissionAction]>([
  ...[
    'git status && rm -rf src',
    'git status; curl example.com',
    'git status || sh -c x',
    'cat $(echo /etc/passwd)',
    'cat `id`',
    "cat $'\\x2e\\x2e/x'",
    'cat <(id)',
    'cat src/a.ts & rm x',
    '(git status)',
    'git status\nrm -rf .',
    'git status --porcelain',
    'cat ../secret',
    'cat src/../../secret',
    'cat /etc/passwd',
    'cat ~/.ssh/id_rsa',
    'cat outside/workspace/../secret',
    'cat src/a.ts > ../copy',
    'cat src/a.ts > .git',
    'cat <<EOF\nx\nEOF',
    'cat {src,..}/x',
    'cat {src,outside}/x',
    'PATH=/tmp git status',
    'git diff --output=/tmp/x',
    'git diff -c',
    'ls *',
    `/bin/zsh -lc "cat $HOME/x"`,
    "bash -c 'git status' && rm x",
    'cp -t.. f',
    'mv -t.. f',
    'cp -toutside f',
    'tar -xf a.tar -C..',
    'sort -o.. f',
    'git format-patch -o.. HEAD',
    'tar -cf f -Iid .',
    'find . -exec rm {} ;',
    'find . -delete',
    'rg --pre=sh x',
    'cp f .GIT/config',
    'cp -vt.. f',
    'mv -ft.. f',
    'sort -uo.. f',
    'tar -xvC.. -f a.tar',
    'tar -cvIid -f f .',
    'tar -xIid -f a.tar',
    'git -C evil status',
    'git --git-dir=evil status',
    'git --work-tree=.. status',
  ].map((text): [string, PermissionAction] => [text, command(text)]),
  ['git status from outside', command('git status', scratch)],
  ['git status through a link', command('git status', join(root, 'outside'))],
  ...[
    '.git',
    '.GIT/config',
    'src/.git/hooks/pre-commit',
    '.g\u200cit/config',
    'outside/x',
    '../x',
  ].map((path): [string, PermissionAction] => [
    `edit ${path}`,
    { kind: 'edit', paths: [path] },
  ]),
  ['read without a read rule', { kind: 'read', paths: ['src/a.ts'] }],
])('asks for %s', (_name, action) => {
  expect(allows(action)).toBeUndefined();
});

const readOnly: PermissionPolicy = permissionPolicySchema.parse({
  allow: patterns.map((pattern) => ({ kind: 'command', pattern })),
});
it.each([
  'git log --output=x',
  'git diff --output x',
  'git format-patch -o out HEAD',
  'git diff > x',
  'cat src/a.ts > b',
  'cat src/a.ts >> b',
  'sort -o x f',
])('without an edit rule asks for %s, which writes a file', (text) => {
  expect(
    policyAllows(readOnly, command(text), root, 'claude-code'),
  ).toBeUndefined();
  expect(allows(command(text))).toBeDefined();
});
it('without an edit rule still allows reading and output to /dev/null', () => {
  expect(
    policyAllows(
      readOnly,
      command('git diff --stat 2>/dev/null'),
      root,
      'claude-code',
    ),
  ).toBeDefined();
});

it('asks for Git in a directory that looks like another repository', () => {
  // An edit rule can write a bare repository whose config runs a program.
  const nested = join(root, 'evil');
  mkdirSync(join(nested, 'sub'), { recursive: true });
  writeFileSync(join(nested, 'HEAD'), 'ref: refs/heads/main\n');
  for (const cwd of [nested, join(nested, 'sub')])
    expect(allows(command('git status', cwd)), cwd).toBeUndefined();
  expect(allows(command('git status', join(root, 'src')))).toBeDefined();
});

it('asks for named tools on Codex', () => {
  expect(allows({ kind: 'tool', name: 'WebSearch' }, 'codex')).toBeUndefined();
});

it('rejects patterns that would allow any command', () => {
  for (const pattern of [
    'bash *',
    'env *',
    'xargs *',
    'cd *',
    '*',
    'git $(x)',
    'FOO=1 git',
  ])
    expect(
      permissionPolicySchema.safeParse({
        allow: [{ kind: 'command', pattern }],
      }).success,
      pattern,
    ).toBe(false);
});
