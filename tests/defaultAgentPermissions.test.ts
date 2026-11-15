import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Engine,
  type HarnessAdapter,
  type HarnessRun,
} from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  executorProfileSchema,
  type WorkflowDefinition,
} from '@interlock/core';

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

const codex = (calls: HarnessRun[], onRun?: () => void): HarnessAdapter => ({
  id: 'codex',
  detect: () => Promise.resolve({ command: '/fake/codex', status: 'detected' }),
  run: (input) => {
    calls.push(input);
    input.onSession('native');
    onRun?.();
    return Promise.resolve({ output: input.work.input });
  },
});
/** Route every Agent through a preset that names Codex and sets no level. */
function usePreset(e: Engine, d: WorkflowDefinition) {
  const preset = e.modelAliases.mutate({
    action: 'create',
    name: 'Builder',
    candidates: [{ profileId: 'codex', model: 'fixture-model' }],
  });
  d.agentModel = preset.id;
  d.agentModelMode = 'preset';
}

// Workflow override, then the harness's own level, then the shared default,
// then full access. Explicit levels keep winning while no default is stored. Profiles saved before the shared default stored `standard`
// as their creation value, so that value follows the shared default. The
// preset row routes through an Agent preset that sets no level.
it.each([
  ['read-only', undefined, 'full-access', 'full-access', 'workflow'],
  ['full-access', 'read-only', 'standard', 'standard', 'workflow'],
  ['full-access', 'read-only', undefined, 'full-access', 'harness'],
  ['standard', 'full-access', undefined, 'standard', 'harness'],
  ['legacy standard', 'full-access', undefined, 'full-access', 'global'],
  [undefined, 'full-access', undefined, 'full-access', 'global'],
  [undefined, undefined, undefined, 'full-access', 'global'],
  [undefined, undefined, 'standard', 'standard', 'workflow'],
  [undefined, undefined, 'read-only', 'read-only', 'workflow'],
  ['standard', undefined, undefined, 'standard', 'harness'],
  ['read-only', undefined, undefined, 'read-only', 'harness'],
  ['legacy standard', undefined, undefined, 'full-access', 'global'],
  [undefined, 'standard', undefined, 'standard', 'global'],
  ['preset', 'full-access', undefined, 'full-access', 'global'],
] as const)(
  'resolves harness %s, shared default %s and workflow override %s',
  async (harness, shared, override, effective, source) => {
    const e = create();
    const preset = harness === 'preset';
    if (harness === 'legacy standard')
      e.store.put('executorProfiles', legacyCodex({ enabled: true }));
    else
      e.executors.saveProfile({
        id: 'codex',
        harness: 'codex',
        name: 'Codex',
        enabled: true,
        expectedRevision: 0,
        ...(harness && !preset ? { permissions: harness } : {}),
      });
    if (shared)
      e.executors.saveSettings({
        expectedRevision: 0,
        concurrency: 3,
        defaultPermissions: shared,
      });
    const calls: HarnessRun[] = [];
    e.executors.start([codex(calls)]);
    const d = blankDefinition();
    d.executor = 'codex';
    d.agentPermissions = override;
    if (preset) usePreset(e, d);
    const w = e.create('Permissions', '', d);
    e.publish(w.id);
    const r = e.start(w.id, 1).run;
    await vi.waitFor(() => expect(e.run(r.id).status).toBe('completed'));
    expect(calls[0].profile.permissions).toBe(effective);
    expect(e.store.work()[0].executorPermissions).toBe(
      preset ? effective : override,
    );
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

// A preset-routed level is written into each assignment when it is created.
// When it is only inherited, a continuity group keeps the mode its session
// captured instead of refusing the next assignment after a default change.
it('keeps a continuity session on its captured mode when the shared default changes', async () => {
  const e = create();
  e.executors.saveProfile({
    id: 'codex',
    harness: 'codex',
    name: 'Codex',
    enabled: true,
    expectedRevision: 0,
  });
  const calls: HarnessRun[] = [];
  e.executors.start([
    codex(calls, () => {
      if (calls.length === 1)
        e.executors.saveSettings({
          expectedRevision: 0,
          concurrency: 3,
          defaultPermissions: 'standard',
        });
    }),
  ]);
  const d = blankDefinition();
  d.executor = 'codex';
  usePreset(e, d);
  const first = d.nodes.find((n) => n.kind === 'agent')!;
  if (first.kind !== 'agent') throw Error();
  first.context = { ...first.context, continuityGroup: 'author' };
  const edge = d.edges.find((item) => item.source === first.id)!;
  d.nodes.push({ ...structuredClone(first), id: 'second' });
  d.edges.push({ ...edge, id: 'second-exit', source: 'second' });
  edge.target = 'second';
  const w = e.create('Grouped', '', d);
  e.publish(w.id);
  const r = e.start(w.id, 1).run;
  await vi.waitFor(() => expect(e.run(r.id).status).toBe('completed'));
  expect(calls.map((c) => c.profile.permissions)).toEqual([
    'full-access',
    'full-access',
  ]);
  expect(e.store.work().map((work) => work.executorPermissions)).toContain(
    'standard',
  );
});

// Older builds parse every stored profile with a strict schema, so the
// explicit-Standard marker must live outside the profile record.
it('stores an explicit Standard without extra profile keys and clears it on inherit', () => {
  const e = create();
  const save = (revision: number, extra = {}) =>
    e.executors.saveProfile({
      id: 'codex',
      harness: 'codex',
      name: 'Codex',
      expectedRevision: revision,
      ...extra,
    });
  const stored = () =>
    executorProfileSchema
      .strict()
      .parse(e.store.get('executorProfiles', 'codex'));
  const level = () =>
    e.executors.profiles().find((p) => p.id === 'codex')?.permissions;
  save(0, { permissions: 'standard' });
  expect(stored().permissions).toBe('standard');
  expect(level()).toBe('standard');
  save(1);
  expect(stored().permissions).toBeUndefined();
  expect(level()).toBeUndefined();
  // An older build re-saving the default Standard does not become explicit.
  e.store.put('executorProfiles', { ...stored(), permissions: 'standard' });
  expect(level()).toBeUndefined();
});
