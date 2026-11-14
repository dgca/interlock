import { afterAll, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { permissionPolicySchema, type PermissionPolicy } from '@interlock/core';
import { commandAllowed } from '../packages/runtime/src/permissionCommands';
import { policyAllows } from '../packages/runtime/src/executors/permissionPolicy';

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'interlock-policy-')));
const root = join(scratch, 'workspace');
mkdirSync(join(root, 'src'), { recursive: true });
symlinkSync(scratch, join(root, 'outside'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const patterns = ['git status', 'git diff *', 'cat *', 'pnpm test *', 'ls *'];
const allowed = (command: string, cwd = root) =>
  commandAllowed(command, cwd, root, patterns);

it('allows compound commands only when every part matches inside the workspace', () => {
  expect(allowed('git status && git diff --stat')).toBe(true);
  expect(allowed('cat src/a.ts | pnpm test -- --run 2>&1 >/dev/null')).toBe(
    true,
  );
  expect(allowed(`/bin/zsh -lc 'git status; cat "src/a b.ts"'`)).toBe(true);
  for (const escape of [
    'git status && rm -rf src',
    'git status; curl example.com',
    'git status || sh -c x',
    'cat $(echo /etc/passwd)',
    'cat `id`',
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
    'cat <<EOF\nx\nEOF',
    'PATH=/tmp git status',
    'git diff --output=/tmp/x',
    'git diff -c',
    'ls *',
    `/bin/zsh -lc "cat $HOME/x"`,
    "bash -c 'git status' && rm x",
  ])
    expect(allowed(escape), escape).toBe(false);
  expect(allowed('git status', scratch)).toBe(false);
  expect(allowed('git status', join(root, 'outside'))).toBe(false);
});

it('applies rule kinds and never matches a symlink out of the workspace', () => {
  const policy: PermissionPolicy = permissionPolicySchema.parse({
    allow: [{ kind: 'edit' }, { kind: 'tool', name: 'WebSearch' }],
  });
  const allows = (
    action: Parameters<typeof policyAllows>[1],
    harness = 'claude-code' as const,
  ) => policyAllows(policy, action, root, harness);
  expect(allows({ kind: 'edit', paths: [join(root, 'src/new.ts')] })).toBe(
    true,
  );
  expect(allows({ kind: 'edit', paths: ['outside/secret'] })).toBe(false);
  expect(allows({ kind: 'read', paths: ['src/a.ts'] })).toBe(false);
  expect(allows({ kind: 'tool', name: 'WebSearch' })).toBe(true);
  expect(
    policyAllows(policy, { kind: 'tool', name: 'WebSearch' }, root, 'codex'),
  ).toBe(false);
  expect(allows({ kind: 'command', command: 'git status', cwd: root })).toBe(
    false,
  );
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
