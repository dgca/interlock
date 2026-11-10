import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { blankDefinition, nodeSchema } from '@interlock/core';
import { migrate, migrations } from '../packages/storage/src/migrations';
import {
  importWorkflows,
  exportWorkflows,
} from '../packages/runtime/src/transfer';

const engines: Engine[] = [];
function setup() {
  const engine = new Engine(new Store(':memory:'), process.cwd());
  engines.push(engine);
  return engine;
}
afterEach(() => {
  for (const engine of engines.splice(0)) {
    engine.stop();
    engine.store.close();
  }
});

it('allows author and reviewer aliases from the same provider and retains provider attribution', () => {
  const e = setup();
  for (const name of ['author', 'reviewer'])
    e.modelAliases.mutate({
      action: 'create',
      name,
      candidates: [{ model: 'gpt-review-model' }],
    });
  const d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({
    ...d.nodes[1],
    id: 'author',
    model: 'author',
  });
  d.nodes.splice(
    2,
    0,
    nodeSchema.parse({ ...d.nodes[1], id: 'review', model: 'reviewer' }),
  );
  d.edges = [
    { id: 'a', source: 'entry', target: 'author', port: 'default' },
    { id: 'b', source: 'author', target: 'review', port: 'default' },
    { id: 'c', source: 'review', target: 'exit', port: 'default' },
  ];
  const workflow = e.create('Review', '', d);
  e.publish(workflow.id);
  const run = e.start(workflow.id, {}).run;
  for (const name of ['author', 'reviewer']) {
    const work = e.available(run.id)[0];
    expect(work.modelAliasSelection).toMatchObject({
      name,
      candidateModel: 'gpt-review-model',
    });
    const claim = e.claim(work.id, {
      workerId: name,
      freshContext: false,
      tools: [],
      skills: [],
      modelSelection: { model: 'gpt-review-model', provider: 'openai' },
    });
    e.submit(work.id, claim.token!, {});
  }
  expect(e.run(run.id).status).toBe('completed');
  expect(
    e
      .run(run.id)
      .executions.filter((execution) => execution.kind === 'agent')
      .map((execution) => execution.provenance?.provider),
  ).toEqual(['openai', 'openai']);
});

it.each(['distinctProviderFrom', 'candidateModels'])(
  'rejects removed %s authoring and imports without mutating workflows',
  (field) => {
    const e = setup();
    const d = blankDefinition() as any;
    d.nodes[1][field] = ['removed'];
    expect(() => e.create('Removed', '', d)).toThrow(
      'Provider-diversity settings are no longer supported',
    );
    expect(e.store.workflows()).toEqual([]);
    const workflow = e.create('Keep');
    const bundle = exportWorkflows(e.store, workflow.id) as any;
    bundle.workflows[0].draft.nodes[1][field] = ['removed'];
    expect(() => importWorkflows(e.store, bundle, { force: true })).toThrow(
      'Provider-diversity settings are no longer supported',
    );
    expect(e.workflow(workflow.id).draftRevision).toBe(workflow.draftRevision);
  },
);

it('upgrades development assignments without changing pins, captures, or execution provenance', () => {
  const directory = mkdtempSync(join(tmpdir(), 'interlock-provider-removal-'));
  const file = join(directory, 'interlock.db');
  const db = new DatabaseSync(file);
  try {
    migrate(db, file, migrations.slice(0, 15));
    const assignment = {
      id: 'work',
      status: 'available',
      distinctProviderFrom: ['author'],
      candidateModels: ['gpt-model'],
      providerDiversityBlocked: { reason: 'provider_diversity_exhausted' },
      modelAliasSelection: { name: 'reviewer', revision: 1 },
      executorModel: 'gpt-model',
    };
    db.prepare('INSERT INTO documents VALUES (?, ?, ?)').run(
      'work',
      assignment.id,
      JSON.stringify(assignment),
    );
    for (const collection of ['versions', 'workflows', 'runs'])
      db.prepare('INSERT INTO documents VALUES (?, ?, ?)').run(
        collection,
        collection,
        JSON.stringify({
          id: collection,
          definition: { pinPromptsAtPublish: true },
          pinnedPromptRevisions: { prompt: 1 },
          provenance: { provider: 'openai' },
        }),
      );
    const before = db
      .prepare(
        "SELECT * FROM documents WHERE collection != 'work' ORDER BY rowid",
      )
      .all();
    expect(migrate(db, file)).toMatchObject({
      from: 15,
      to: 17,
      backup: expect.any(String),
    });
    const row = db
      .prepare("SELECT value FROM documents WHERE collection = 'work'")
      .get()!;
    const {
      distinctProviderFrom,
      candidateModels,
      providerDiversityBlocked,
      ...kept
    } = assignment;
    expect(JSON.parse(row.value as string)).toEqual(kept);
    expect(
      db
        .prepare(
          "SELECT * FROM documents WHERE collection != 'work' ORDER BY rowid",
        )
        .all(),
    ).toEqual(before);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
