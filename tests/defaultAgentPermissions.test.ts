import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine, type HarnessRun } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { blankDefinition, executorProfileSchema } from '@interlock/core';

const engines: Engine[] = [],
  dirs: string[] = [];
const create = (path = ':memory:') => {
  const e = new Engine(new Store(path), process.cwd());
  engines.push(e);
  return e;
};
afterEach(async () => {
  for (const e of engines.splice(0)) {
    await e.executors.stop();
    e.stop();
    e.store.close();
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const legacyCodex = (extra = {}) => ({
  ...executorProfileSchema.parse({
    id: 'codex',
    harness: 'codex',
    name: 'Codex',
  }),
  permissions: 'standard',
  ...extra,
});

// Workflow override, then the harness's own level, then the shared default,
// then standard. Profiles saved before the shared default stored `standard`
// as their creation value, so that value follows the shared default.
it.each([
  ['read-only', undefined, 'full-access', 'full-access', 'workflow'],
  ['full-access', 'read-only', 'standard', 'standard', 'workflow'],
  ['full-access', 'read-only', undefined, 'full-access', 'harness'],
  ['standard', 'full-access', undefined, 'standard', 'harness'],
  ['legacy standard', 'full-access', undefined, 'full-access', 'global'],
  [undefined, 'full-access', undefined, 'full-access', 'global'],
  [undefined, undefined, undefined, 'standard', 'global'],
] as const)(
  'resolves harness %s, shared default %s and workflow override %s',
  async (harness, shared, override, effective, source) => {
    const e = create();
    if (harness === 'legacy standard')
      e.store.put('executorProfiles', legacyCodex({ enabled: true }));
    else
      e.executors.saveProfile({
        id: 'codex',
        harness: 'codex',
        name: 'Codex',
        enabled: true,
        expectedRevision: 0,
        ...(harness ? { permissions: harness } : {}),
      });
    if (shared)
      e.executors.saveSettings({
        expectedRevision: 0,
        concurrency: 3,
        defaultPermissions: shared,
      });
    const calls: HarnessRun[] = [];
    e.executors.start([
      {
        id: 'codex',
        detect: () =>
          Promise.resolve({ command: '/fake/codex', status: 'detected' }),
        run: (input) => {
          calls.push(input);
          return Promise.resolve({ output: input.work.input });
        },
      },
    ]);
    const d = blankDefinition();
    d.executor = 'codex';
    d.agentPermissions = override;
    const w = e.create('Permissions', '', d);
    e.publish(w.id);
    const r = e.start(w.id, 1).run;
    await vi.waitFor(() => expect(e.run(r.id).status).toBe('completed'));
    expect(calls[0].profile.permissions).toBe(effective);
    expect(e.store.work()[0].executorPermissions).toBe(override);
    expect(e.executors.inspect(e.store.work()[0].id).items[0]).toMatchObject({
      profile: { permissions: effective },
      permissionSource: source,
    });
  },
);

it('reads stored ask and standard levels as inheriting without changing their revision', () => {
  const e = create();
  e.store.put(
    'executorProfiles',
    legacyCodex({ permissions: 'ask', revision: 3 }),
  );
  const stored = e.executors.profiles().find((p) => p.id === 'codex');
  expect(stored).toMatchObject({ revision: 3 });
  expect(stored).not.toHaveProperty('permissions');
});

it('saves the shared default with revision checks and keeps it across other saves', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-default-permissions-'));
  dirs.push(dir);
  const path = join(dir, 'state.db'),
    e = create(path);
  e.executors.saveSettings({
    expectedRevision: 0,
    concurrency: 3,
    defaultPermissions: 'full-access',
  });
  expect(() =>
    e.executors.saveSettings({
      expectedRevision: 0,
      concurrency: 3,
      defaultPermissions: 'read-only',
    }),
  ).toThrow('Reload');
  // A concurrency save omits the field and must not clear it.
  e.executors.saveSettings({ expectedRevision: 1, concurrency: 2 });
  const reopened = create(path);
  expect(await reopened.executors.manage({ action: 'settings' })).toEqual({
    revision: 2,
    concurrency: 2,
    defaultPermissions: 'full-access',
  });
  reopened.executors.saveSettings({
    expectedRevision: 2,
    concurrency: 2,
    defaultPermissions: null,
  });
  expect(reopened.executors.settings()).toEqual({
    revision: 3,
    concurrency: 2,
  });
});
