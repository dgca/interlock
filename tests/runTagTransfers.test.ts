import { afterEach, expect, it } from 'vitest';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  type TriggerConfig,
  type WorkflowTrigger,
  type VariableImportBindings,
} from '@interlock/core';
import {
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';
import { importSelection } from '../packages/runtime/src/importSelection';

const engines: Engine[] = [];
const literalTags = JSON.parse(
  '{"__proto__":"literal","constructor":"metadata"}',
) as Record<string, string>;
function setup() {
  const engine = new Engine(new Store(':memory:'), process.cwd());
  engines.push(engine);
  return engine;
}
afterEach(() => {
  for (const e of engines.splice(0)) {
    e.stop();
    e.store.close();
  }
});
function fixture() {
  const source = setup(),
    workflow = source.create('Tagged imports', '', blankDefinition());
  source.publish(workflow.id);
  const configs: TriggerConfig[] = [
    {
      kind: 'schedule',
      name: 'Scheduled',
      timing: { type: 'interval', intervalMs: 30000 },
      tags: literalTags,
    } as TriggerConfig,
    {
      kind: 'event',
      name: 'Lifecycle',
      events: ['completed'],
      scope: { type: 'library' },
      tags: literalTags,
    } as TriggerConfig,
  ];
  const triggers = configs.map(
    (config) =>
      source.triggers.mutate({
        action: 'create',
        workflowId: workflow.id,
        config,
      }).trigger!,
  );
  const tagged = exportWorkflows(source.store, workflow.id),
    untagged = structuredClone(tagged);
  for (const entry of untagged.workflows)
    for (const trigger of [
      ...(entry.schedules ?? []),
      ...(entry.eventTriggers ?? []),
    ])
      delete trigger.config.tags;
  return { tagged, untagged, triggers, bindings: {} as VariableImportBindings };
}
function retained(e: Engine, triggers: WorkflowTrigger[]) {
  return triggers.map((t) => e.triggers.inspect(t.id).trigger);
}
function state(e: Engine) {
  return Object.fromEntries(
    [
      'workflows',
      'versions',
      'workflowTriggers',
      'variables',
      'variableRevisions',
    ].map((c) => [c, e.store.list(c)]),
  );
}

it.each(['full', 'selected'] as const)(
  'preserves literal and omitted tags in fresh %s transfers for all trigger kinds',
  (mode) => {
    const { tagged, untagged, triggers, bindings } = fixture();
    const withTags = setup(),
      withoutTags = setup();
    if (mode === 'full') {
      importWorkflows(withTags.store, tagged, { variableBindings: bindings });
      importWorkflows(withoutTags.store, untagged, {
        variableBindings: bindings,
      });
    } else {
      importSelection(withTags, [tagged], bindings);
      importSelection(withoutTags, [untagged], bindings);
    }
    for (const t of retained(withTags, triggers)) {
      expect(t.enabled).toBe(false);
      expect(t.tags).toEqual(literalTags);
      expect(Object.hasOwn(t.tags!, '__proto__')).toBe(true);
    }
    for (const t of retained(withoutTags, triggers)) {
      expect(t.enabled).toBe(false);
      expect(t.tags).toBeUndefined();
    }
  },
);

it('clears omitted tags on forced full replacement and keeps selected conflicts read-only', () => {
  const { tagged, untagged, triggers, bindings } = fixture(),
    target = setup();
  importWorkflows(target.store, tagged, { variableBindings: bindings });
  const bound: VariableImportBindings = {};
  const before = state(target);
  expect(() =>
    importWorkflows(target.store, untagged, { variableBindings: bound }),
  ).toThrow('Trigger configuration conflict');
  expect(state(target)).toEqual(before);
  expect(() => importSelection(target, [untagged], bound)).toThrow(
    'Trigger configuration conflict',
  );
  expect(state(target)).toEqual(before);
  const preview = importWorkflows(target.store, untagged, {
    force: true,
    dryRun: true,
    variableBindings: bound,
  });
  expect(preview.triggers).toEqual(
    triggers.map((t) => ({
      id: t.id,
      workflowId: t.workflowId,
      kind: t.kind,
      status: 'changed',
    })),
  );
  expect(state(target)).toEqual(before);
  importWorkflows(target.store, untagged, {
    force: true,
    variableBindings: bound,
  });
  for (const t of retained(target, triggers)) {
    expect(t.tags).toBeUndefined();
    expect(t.enabled).toBe(false);
  }
  // The selected-set path may safely reimport the same now-untagged configuration.
  importSelection(target, [untagged], bound);
  expect(retained(target, triggers).every((t) => t.tags === undefined)).toBe(
    true,
  );
  importWorkflows(target.store, tagged, {
    force: true,
    variableBindings: bound,
  });
  expect(retained(target, triggers).map((t) => t.tags)).toEqual(
    triggers.map(() => literalTags),
  );
});
