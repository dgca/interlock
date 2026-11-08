import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { blankDefinition, nodeSchema } from '@interlock/core';
import {
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';

const environments: { engine: Engine; directory: string }[] = [];
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'interlock-pinned-transfer-'));
  const engine = new Engine(new Store(':memory:'), directory);
  environments.push({ engine, directory });
  return engine;
}
afterEach(() => {
  for (const { engine, directory } of environments.splice(0)) {
    engine.stop();
    engine.store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
function fixture() {
  const source = setup();
  const prompt = source.prompts.create({
    name: 'Guidance',
    description: '',
    content: 'First',
  });
  const definition = blankDefinition();
  definition.pinPromptsAtPublish = true;
  const agent = definition.nodes.find((node) => node.kind === 'agent')!;
  agent.promptIds = [prompt.id];
  const next = nodeSchema.parse({ ...agent, id: 'next' });
  definition.nodes.splice(-1, 0, next);
  definition.edges = [
    { id: 'a', source: 'entry', port: 'default', target: agent.id },
    { id: 'b', source: agent.id, port: 'default', target: next.id },
    { id: 'c', source: next.id, port: 'default', target: 'exit' },
  ];
  const workflow = source.create('Pinned transfer', '', definition);
  source.publish(workflow.id);
  source.prompts.update(prompt.id, 1, { ...prompt, content: 'Second' });
  source.publish(workflow.id);
  source.prompts.update(prompt.id, 2, { ...prompt, content: 'Current' });
  return { source, prompt, workflow };
}

it('round-trips multiple historical pins after the source prompt changes', () => {
  const { source, prompt, workflow } = fixture();
  const bundle = exportWorkflows(source.store, workflow.id);
  expect(bundle.formatVersion).toBe(9);
  expect(bundle.promptRevisions?.map((prompt) => prompt.revision)).toEqual([
    1, 2,
  ]);
  const target = setup();
  importWorkflows(target.store, bundle);
  for (const [version, content] of [
    [1, 'First'],
    [2, 'Second'],
  ] as const) {
    expect(
      target.start(workflow.id, null, version).run.promptSnapshots,
    ).toEqual([
      expect.objectContaining({ id: prompt.id, revision: version, content }),
    ]);
  }
  expect(target.prompts.get(prompt.id)).toMatchObject({
    revision: 3,
    content: 'Current',
  });
  importWorkflows(target.store, bundle);
  expect(target.prompts.get(prompt.id).revision).toBe(3);
  expect(target.prompts.get(prompt.id, 1).content).toBe('First');
});

it('recaptures exact imported pins when a run moves to a newer version', () => {
  const { source, prompt, workflow } = fixture();
  const target = setup();
  importWorkflows(target.store, exportWorkflows(source.store, workflow.id));
  const run = target.start(workflow.id, null, 1).run;
  const work = target.store.work('available', run.id)[0];
  const claim = target.claim(work.id, {
    workerId: 'test',
    tools: [],
    skills: [],
    freshContext: false,
  });
  target.pauses.create({
    target: { scope: 'library' },
    actor: 'test',
    reason: 'Version boundary',
  });
  // Existing in-flight work may finish while paused; the next execution stays uncreated.
  target.submit(work.id, claim.token!, null);
  const preview = target.runVersions.preview({
    runId: run.id,
    version: 2,
    recapturePrompts: true,
  });
  expect(preview.canApply).toBe(true);
  target.runVersions.apply({
    runId: run.id,
    version: 2,
    recapturePrompts: true,
    confirmation: preview.confirmation,
    reason: 'Use v2',
  });
  expect(target.run(run.id).promptSnapshots).toEqual([
    expect.objectContaining({ id: prompt.id, revision: 2, content: 'Second' }),
  ]);
});

it('rejects missing pinned dependencies without importing workflows or prompts', () => {
  const { source, workflow } = fixture();
  const bundle = exportWorkflows(source.store, workflow.id);
  // Also exercise legacy bundles that carried pin numbers without historical bodies.
  const incomplete = {
    ...bundle,
    formatVersion: 8,
    promptRevisions: undefined,
  };
  const target = setup();
  expect(() =>
    importWorkflows(target.store, incomplete as typeof bundle),
  ).toThrow(/prompt.*revision|pinned.*prompt/i);
  expect(target.store.workflows()).toEqual([]);
  expect(target.store.list('prompts')).toEqual([]);
});

it('rejects historical revision conflicts even when current prompt content matches', () => {
  const { source, prompt, workflow } = fixture();
  const target = setup();
  target.store.savePrompt({ ...prompt, content: 'Different first revision' });
  target.store.savePrompt(source.prompts.get(prompt.id));
  const before = target.store.list('promptRevisions');
  expect(() =>
    importWorkflows(target.store, exportWorkflows(source.store, workflow.id)),
  ).toThrow(/revision conflict/i);
  expect(target.store.workflows()).toEqual([]);
  expect(target.store.list('promptRevisions')).toEqual(before);
  expect(target.prompts.get(prompt.id)).toMatchObject({
    revision: 3,
    content: 'Current',
  });
});

it('still imports legacy bundles whose current snapshot supplies their pins', () => {
  const source = setup();
  const prompt = source.prompts.create({
    name: 'Legacy',
    description: '',
    content: 'Only revision',
  });
  const definition = blankDefinition();
  definition.pinPromptsAtPublish = true;
  definition.nodes.find((node) => node.kind === 'agent')!.promptIds = [
    prompt.id,
  ];
  const workflow = source.create('Legacy bundle', '', definition);
  source.publish(workflow.id);
  const exported = exportWorkflows(source.store, workflow.id);
  const legacy = { ...exported, formatVersion: 2, promptRevisions: undefined };
  const target = setup();
  importWorkflows(target.store, legacy as typeof exported);
  expect(target.start(workflow.id, null).run.promptSnapshots?.[0].content).toBe(
    'Only revision',
  );
});

it('rejects incomplete format-9 snapshots and missing source history', () => {
  const { source, prompt, workflow } = fixture();
  const bundle = exportWorkflows(source.store, workflow.id);
  const target = setup();
  expect(() =>
    importWorkflows(target.store, { ...bundle, promptRevisions: [] }),
  ).toThrow(/missing a pinned prompt revision/);
  expect(target.store.workflows()).toEqual([]);
  source.store.remove('promptRevisions', `${prompt.id}:1`);
  expect(() => exportWorkflows(source.store, workflow.id)).toThrow(
    /revision 1 does not exist/,
  );
});

it('retains imported history without rebinding an identical current prompt or colliding with its next edit', () => {
  const { source, prompt, workflow } = fixture();
  const bundle = exportWorkflows(source.store, workflow.id);
  bundle.workflows[0].versions = bundle.workflows[0].versions.slice(1);
  bundle.promptRevisions = bundle.promptRevisions?.filter(
    (snapshot) => snapshot.revision === 2,
  );
  const target = setup();
  target.store.savePrompt({ ...prompt, content: 'Current' });
  importWorkflows(target.store, bundle);
  expect(target.prompts.get(prompt.id)).toMatchObject({
    revision: 1,
    content: 'Current',
  });
  expect(target.prompts.get(prompt.id, 2).content).toBe('Second');
  const edited = target.prompts.update(prompt.id, 1, {
    name: prompt.name,
    description: '',
    content: 'Local edit',
  });
  expect(edited.revision).toBe(3);
  expect(target.prompts.get(prompt.id, 2).content).toBe('Second');
});
